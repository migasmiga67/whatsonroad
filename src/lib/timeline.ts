import type { Candidate, Category, LatLon, Pick, RouteData } from "./types";

/** Domyślny czas postoju wg typu miejsca (minuty). */
export function defaultVisit(c: { category: Category }): number {
  switch (c.category) {
    case "mop":
    case "viewpoint":
      return 20;
    case "castle":
    case "museum":
    case "kids":
      return 75;
    case "food":
      return 50;
    case "palace":
    case "lake":
    case "nature":
      return 40;
    default:
      return 30;
  }
}

export const CATEGORY_ICON: Record<Category, string> = {
  mop: "⛽",
  castle: "🏰",
  palace: "🏛️",
  church: "⛪",
  monument: "🗿",
  museum: "🖼️",
  viewpoint: "🔭",
  lake: "🌊",
  nature: "🌲",
  kids: "🎠",
  food: "🍲",
  attraction: "⭐",
};

export type ChosenStop = { stopIndex: number; candidate: Candidate; pick: Pick };

export type TimelineEvent =
  | { kind: "start"; at: Date; label: string }
  | { kind: "drive"; minutes: number; km: number }
  | { kind: "stop"; stopIndex: number; arrive: Date; leave: Date; candidate: Candidate; pick: Pick }
  | { kind: "end"; at: Date; label: string };

/**
 * Oś czasu: czas jazdy po trasie + objazdy do postojów + czas zwiedzania.
 * Postoje układamy w kolejności położenia na trasie.
 */
export function buildTimeline(route: RouteData, departure: Date, chosen: ChosenStop[]) {
  const stops = [...chosen].sort((a, b) => a.candidate.routeTimeS - b.candidate.routeTimeS);
  const events: TimelineEvent[] = [{ kind: "start", at: departure, label: route.from.label }];
  let clock = departure.getTime();
  let lastRouteT = 0;
  let lastKm = 0;
  let totalStopMin = 0;
  for (const s of stops) {
    const driveS = s.candidate.routeTimeS - lastRouteT;
    const km = kmAtTime(route, s.candidate.routeTimeS);
    const halfDetourMs = (s.candidate.detourMin / 2) * 60_000;
    events.push({ kind: "drive", minutes: Math.round(driveS / 60 + s.candidate.detourMin / 2), km: Math.round(km - lastKm) });
    clock += driveS * 1000 + halfDetourMs;
    const arrive = new Date(clock);
    clock += s.pick.visitMin * 60_000;
    const leave = new Date(clock);
    clock += halfDetourMs;
    totalStopMin += s.pick.visitMin + s.candidate.detourMin;
    events.push({ kind: "stop", stopIndex: s.stopIndex, arrive, leave, candidate: s.candidate, pick: s.pick });
    lastRouteT = s.candidate.routeTimeS;
    lastKm = km;
  }
  const lastDriveS = route.durationS - lastRouteT;
  events.push({
    kind: "drive",
    minutes: Math.round(lastDriveS / 60 + (stops.length ? stops[stops.length - 1].candidate.detourMin / 2 : 0)),
    km: Math.round(route.distanceM / 1000 - lastKm),
  });
  clock += lastDriveS * 1000;
  events.push({ kind: "end", at: new Date(clock), label: route.to.label });
  return { events, arrival: new Date(clock), totalStopMin };
}

function kmAtTime(route: RouteData, t: number) {
  let i = 0;
  while (i < route.cumTimeS.length - 1 && route.cumTimeS[i + 1] < t) i++;
  return route.cumDistM[i] / 1000;
}

/** Link do Google Maps z trasą przez wybrane punkty (max 9 punktów pośrednich w URL). */
export function googleMapsUrl(from: LatLon, to: LatLon, waypoints: LatLon[]): string {
  const f = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const params = new URLSearchParams({ api: "1", origin: f(from), destination: f(to), travelmode: "driving" });
  if (waypoints.length) params.set("waypoints", waypoints.slice(0, 9).map(f).join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}

export function hhmm(d: Date) {
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}
