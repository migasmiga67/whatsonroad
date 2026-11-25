import "server-only";

/** Błąd zewnętrznego API z czytelnym (polskim) komunikatem dla użytkownika. */
export class ServiceError extends Error {
  constructor(
    public service: string,
    message: string,
    public retryable = false,
    public status = 502,
  ) {
    super(message);
  }
  retryAfterMs?: number;
}

export const USER_AGENT =
  process.env.HTTP_USER_AGENT || "PoDrodze/0.1 (planer postojow; https://github.com/migasmiga67/whatsonroad)";

type FetchOpts = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  /** Szeregowa kolejka: zapytania z tym samym kluczem idą jedno po drugim, co najmniej `gapMs` od siebie. */
  queue?: { key: string; gapMs: number };
};

const queues = new Map<string, Promise<unknown>>();

/** Wykonuje fn w kolejce `key` (bez równoległości), zachowując odstęp gapMs (polityki Wikimedia, Nominatim). */
function enqueue<T>(key: string, gapMs: number, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  queues.set(
    key,
    run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, gapMs))),
  );
  return run;
}

async function once<T>(service: string, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    const body = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200);
    if (res.status === 401 || res.status === 403)
      throw new ServiceError(service, `${service}: odmowa dostępu (HTTP ${res.status}). Sprawdź klucz API w .env.`);
    if (res.status === 429) {
      const err = new ServiceError(service, `${service}: przekroczono limit zapytań. Spróbuj ponownie za minutę.`, true);
      err.retryAfterMs = Math.min(10_000, Number(res.headers.get("retry-after")) * 1000 || 3000);
      throw err;
    }
    if (res.status >= 500)
      throw new ServiceError(service, `${service} chwilowo nie odpowiada (HTTP ${res.status}).`, true);
    throw new ServiceError(service, `${service}: błąd zapytania (HTTP ${res.status}): ${body}`);
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    const e = err as Error;
    throw new ServiceError(
      service,
      e.name === "AbortError"
        ? `${service} nie odpowiedział w ${Math.round(timeoutMs / 1000)} s.`
        : `${service} jest nieosiągalny (${e.message}).`,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** fetch + timeout + ponawianie przy 429/5xx/błędach sieci. Zwraca sparsowany JSON. */
export async function fetchJson<T>(service: string, url: string, opts: FetchOpts = {}): Promise<T> {
  const { timeoutMs = 20000, retries = 1, headers, queue, ...rest } = opts;
  const init: RequestInit = {
    ...rest,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(headers as Record<string, string>) },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const call = () => once<T>(service, url, init, timeoutMs);
      return await (queue ? enqueue(queue.key, queue.gapMs, call) : call());
    } catch (err) {
      if (!(err instanceof ServiceError) || !err.retryable || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, err.retryAfterMs ?? 1500 * (attempt + 1)));
    }
  }
}
