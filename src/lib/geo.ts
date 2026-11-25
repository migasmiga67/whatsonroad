import type { LatLon } from "./types";

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Lokalne rzutowanie równoodległościowe (metry) wokół szerokości lat0. */
function project(p: LatLon, lat0: number): [number, number] {
  return [rad(p.lon) * R * Math.cos(rad(lat0)), rad(p.lat) * R];
}

export type NearestOnLine = {
  /** indeks początku odcinka */
  segIndex: number;
  /** 0..1 – położenie na odcinku */
  t: number;
  distM: number;
  /** >0: punkt po lewej stronie kierunku jazdy, <0: po prawej */
  cross: number;
};

/**
 * Najbliższy punkt na łamanej coords ([lat, lon]) w zakresie indeksów [from, to].
 */
export function nearestOnLine(
  p: LatLon,
  coords: [number, number][],
  from = 0,
  to = coords.length - 1,
): NearestOnLine {
  let best: NearestOnLine = { segIndex: from, t: 0, distM: Infinity, cross: 0 };
  const lat0 = p.lat;
  const [px, py] = project(p, lat0);
  for (let i = Math.max(0, from); i < Math.min(to, coords.length - 1); i++) {
    const [ax, ay] = project({ lat: coords[i][0], lon: coords[i][1] }, lat0);
    const [bx, by] = project({ lat: coords[i + 1][0], lon: coords[i + 1][1] }, lat0);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best.distM) {
      best = { segIndex: i, t, distM: d, cross: dx * (py - ay) - dy * (px - ax) };
    }
  }
  return best;
}

/** Indeks pierwszego punktu, w którym wartość skumulowana >= v (wyszukiwanie binarne). */
export function indexAt(cum: number[], v: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Punkt na trasie po zadanym czasie jazdy (interpolacja liniowa). */
export function pointAtTime(
  coords: [number, number][],
  cumTimeS: number[],
  timeS: number,
): LatLon {
  const i = indexAt(cumTimeS, timeS);
  if (i === 0) return { lat: coords[0][0], lon: coords[0][1] };
  const t0 = cumTimeS[i - 1];
  const t1 = cumTimeS[i];
  const f = t1 > t0 ? (timeS - t0) / (t1 - t0) : 0;
  return {
    lat: coords[i - 1][0] + f * (coords[i][0] - coords[i - 1][0]),
    lon: coords[i - 1][1] + f * (coords[i][1] - coords[i - 1][1]),
  };
}

/** Prosty Douglas–Peucker na [lat, lon] z tolerancją w metrach, zachowuje indeksy. */
export function simplifyIndices(coords: [number, number][], tolM: number): number[] {
  if (coords.length <= 2) return coords.map((_, i) => i);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const a = { lat: coords[s][0], lon: coords[s][1] };
    const b = { lat: coords[e][0], lon: coords[e][1] };
    for (let i = s + 1; i < e; i++) {
      const p = { lat: coords[i][0], lon: coords[i][1] };
      const d = nearestOnLine(p, [
        [a.lat, a.lon],
        [b.lat, b.lon],
      ]).distM;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}
