"use client";

import type { ApiErrorBody, Candidate, Interest, RankResult, RouteData, StopSlot } from "./types";

/**
 * Wspólny interfejs planowania dla UI.
 * - "server": API routes Next.js (npm run dev / start, Vercel) – klucze trzymane na serwerze.
 * - "browser": wszystko w przeglądarce (statyczna wersja na GitHub Pages) – darmowe API bez klucza
 *   (OSRM, Nominatim, Overpass, Wikipedia) + opcjonalny klucz Claude podany przez użytkownika.
 */
export const STATIC_MODE = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

export type SearchOptions = {
  intervalHours: number;
  maxDetourKm: number;
  interests: Interest[];
  preferMop: boolean;
};

export type Planner = {
  route(from: string, to: string, intervalHours: number): Promise<{ route: RouteData; slots: StopSlot[] }>;
  candidates(route: RouteData, slotIndex: number, opts: SearchOptions): Promise<{ candidates: Candidate[]; warnings: string[] }>;
  rank(
    stops: { slot: StopSlot; candidates: Candidate[] }[],
    opts: SearchOptions & { departure: string; claudeApiKey?: string },
  ): Promise<RankResult>;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Brak połączenia z serwerem aplikacji.");
  }
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiErrorBody>;
  if (!res.ok) throw new Error(data.error || `Błąd serwera (HTTP ${res.status}).`);
  return data;
}

const serverPlanner: Planner = {
  route: (from, to, intervalHours) => postJson("/api/route", { from, to, intervalHours }),
  candidates: (route, slotIndex, opts) =>
    postJson("/api/candidates", { from: route.from, to: route.to, slotIndex, ...opts }),
  // Na serwerze klucz Claude jest w .env – klucza z przeglądarki nie wysyłamy.
  rank: (stops, opts) => {
    const body: Record<string, unknown> = { ...opts, stops };
    delete body.claudeApiKey;
    return postJson("/api/rank", body);
  },
};

const browserPlanner: Planner = {
  async route(from, to, intervalHours) {
    const [{ geocode }, { getRoute }, { splitRoute }] = await Promise.all([
      import("./providers/geocode"),
      import("./providers/route"),
      import("./split"),
    ]);
    const [a, b] = await Promise.all([geocode(from), geocode(to)]);
    const route = await getRoute(a.place, b.place);
    return { route, slots: splitRoute(route, intervalHours) };
  },
  async candidates(route, slotIndex, opts) {
    const [{ findCandidates }, { splitRoute }] = await Promise.all([import("./candidates"), import("./split")]);
    const slot = splitRoute(route, opts.intervalHours)[slotIndex];
    if (!slot) throw new Error("Nie ma takiego postoju na trasie.");
    return findCandidates(route, slot, opts);
  },
  async rank(stops, { claudeApiKey, ...opts }) {
    const { rankStops } = await import("./rank");
    return rankStops({ ...opts, stops }, { browserApiKey: claudeApiKey });
  },
};

export const planner: Planner = STATIC_MODE ? browserPlanner : serverPlanner;
