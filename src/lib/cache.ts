/**
 * Cache odpowiedzi API – chroni limity darmowych API (ORS, Overpass, Wikipedia, Claude).
 * Backend jest wymienny: na serwerze pliki (.cache/, rejestruje go cache-fs.ts),
 * w przeglądarce (wersja statyczna na GitHub Pages) localStorage.
 */

export type CacheBackend = {
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string): Promise<void>;
};

type Entry<T> = { savedAt: number; value: T };

/** Szybki, deterministyczny hash (FNV-1a 64-bit jako 2×32) – działa w Node i w przeglądarce. */
export function hashKey(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0") + input.length.toString(16);
}

const PREFIX = "po-drodze:cache:";

/** Backend przeglądarkowy. Przy przepełnieniu localStorage czyści własne wpisy i próbuje ponownie. */
const localStorageBackend: CacheBackend = {
  async get(ns, key) {
    try {
      return localStorage.getItem(`${PREFIX}${ns}:${key}`);
    } catch {
      return null;
    }
  },
  async set(ns, key, value) {
    const k = `${PREFIX}${ns}:${key}`;
    try {
      localStorage.setItem(k, value);
    } catch {
      try {
        for (const old of Object.keys(localStorage)) if (old.startsWith(PREFIX)) localStorage.removeItem(old);
        localStorage.setItem(k, value);
      } catch {
        /* cache nie jest krytyczny */
      }
    }
  },
};

const memory = new Map<string, string>();
const memoryBackend: CacheBackend = {
  async get(ns, key) {
    return memory.get(`${ns}:${key}`) ?? null;
  },
  async set(ns, key, value) {
    memory.set(`${ns}:${key}`, value);
  },
};

let backend: CacheBackend = typeof window !== "undefined" ? localStorageBackend : memoryBackend;

export function setCacheBackend(b: CacheBackend) {
  backend = b;
}

export async function cacheGet<T>(namespace: string, key: unknown, ttlS: number): Promise<T | null> {
  try {
    const raw = await backend.get(namespace, hashKey(typeof key === "string" ? key : JSON.stringify(key)));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    return Date.now() - entry.savedAt > ttlS * 1000 ? null : entry.value;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(namespace: string, key: unknown, value: T): Promise<void> {
  try {
    await backend.set(
      namespace,
      hashKey(typeof key === "string" ? key : JSON.stringify(key)),
      JSON.stringify({ savedAt: Date.now(), value } satisfies Entry<T>),
    );
  } catch (err) {
    console.warn("[cache] zapis nieudany:", (err as Error).message);
  }
}

/** Zwraca wartość z cache albo wylicza ją i zapisuje. */
export async function cached<T>(namespace: string, key: unknown, ttlS: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(namespace, key, ttlS);
  if (hit !== null) return hit;
  const value = await compute();
  await cacheSet(namespace, key, value);
  return value;
}

export const DAY = 24 * 3600;
