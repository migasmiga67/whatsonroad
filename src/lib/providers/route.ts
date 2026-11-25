import { cached, DAY } from "../cache";
import { haversineM, simplifyIndices } from "../geo";
import { fetchJson, ServiceError } from "../http";
import type { Place, RouteData } from "../types";
import { fallbackEnabled, ors, orsEnabled, orsHeaders } from "./ors";

type RawRoute = {
  /** [lon, lat] */
  coords: [number, number][];
  /** czas (s) każdego odcinka i→i+1, długość coords-1 */
  segTimeS: number[];
  durationS: number;
  distanceM: number;
};

type OrsGeoJson = {
  features: {
    geometry: { coordinates: [number, number][] };
    properties: {
      summary: { distance: number; duration: number };
      segments: { steps: { duration: number; way_points: [number, number] }[] }[];
    };
  }[];
};

async function routeOrs(a: Place, b: Place): Promise<RawRoute> {
  const data = await fetchJson<OrsGeoJson>(
    "OpenRouteService (trasa)",
    `${ors.baseUrl}/v2/directions/driving-car/geojson`,
    {
      method: "POST",
      headers: orsHeaders(),
      body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]], language: "pl", units: "m" }),
      timeoutMs: 30000,
    },
  );
  const f = data.features?.[0];
  if (!f) throw new ServiceError("OpenRouteService", "Nie znaleziono trasy samochodowej między tymi miejscami.", false, 404);
  const coords = f.geometry.coordinates;
  // ORS podaje czas per krok – rozkładamy go na odcinki proporcjonalnie do długości.
  const segTimeS = new Array(Math.max(0, coords.length - 1)).fill(0);
  for (const seg of f.properties.segments) {
    for (const step of seg.steps) {
      const [s, e] = step.way_points;
      let len = 0;
      const lens: number[] = [];
      for (let i = s; i < e; i++) {
        const d = haversineM({ lat: coords[i][1], lon: coords[i][0] }, { lat: coords[i + 1][1], lon: coords[i + 1][0] });
        lens.push(d);
        len += d;
      }
      for (let i = s; i < e; i++) segTimeS[i] = len > 0 ? (step.duration * lens[i - s]) / len : step.duration / (e - s);
    }
  }
  return { coords, segTimeS, durationS: f.properties.summary.duration, distanceM: f.properties.summary.distance };
}

type OsrmResponse = {
  code: string;
  message?: string;
  routes: {
    duration: number;
    distance: number;
    geometry: { coordinates: [number, number][] };
    legs: { annotation: { duration: number[] } }[];
  }[];
};

async function routeOsrm(a: Place, b: Place): Promise<RawRoute> {
  const base = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
  const url = `${base}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&annotations=duration`;
  const data = await fetchJson<OsrmResponse>("OSRM (trasa)", url, { timeoutMs: 30000 });
  const r = data.routes?.[0];
  if (data.code !== "Ok" || !r)
    throw new ServiceError("OSRM", `Nie znaleziono trasy (${data.message || data.code}).`, false, 404);
  return {
    coords: r.geometry.coordinates,
    segTimeS: r.legs.flatMap((l) => l.annotation.duration),
    durationS: r.duration,
    distanceM: r.distance,
  };
}

function finalize(raw: RawRoute, from: Place, to: Place, provider: RouteData["provider"]): RouteData {
  const latlon: [number, number][] = raw.coords.map(([lon, lat]) => [lat, lon]);
  const cumT = [0];
  const cumD = [0];
  for (let i = 1; i < latlon.length; i++) {
    cumT.push(cumT[i - 1] + (raw.segTimeS[i - 1] ?? 0));
    cumD.push(cumD[i - 1] + haversineM({ lat: latlon[i - 1][0], lon: latlon[i - 1][1] }, { lat: latlon[i][0], lon: latlon[i][1] }));
  }
  // Skalujemy, żeby suma zgadzała się z oficjalnym czasem trasy.
  const scale = cumT[cumT.length - 1] > 0 ? raw.durationS / cumT[cumT.length - 1] : 1;
  const keep = simplifyIndices(latlon, 25);
  return {
    from,
    to,
    provider,
    coords: keep.map((i) => [Number(latlon[i][0].toFixed(5)), Number(latlon[i][1].toFixed(5))]),
    cumTimeS: keep.map((i) => Math.round(cumT[i] * scale)),
    cumDistM: keep.map((i) => Math.round(cumD[i])),
    durationS: Math.round(raw.durationS),
    distanceM: Math.round(raw.distanceM),
  };
}

export async function getRoute(from: Place, to: Place): Promise<RouteData> {
  const key = [from.lat, from.lon, to.lat, to.lon].map((n) => n.toFixed(4));
  return cached(`route-${orsEnabled ? "ors" : "osrm"}`, key, 7 * DAY, async () => {
    if (orsEnabled) {
      try {
        return finalize(await routeOrs(from, to), from, to, "openrouteservice");
      } catch (err) {
        if (!fallbackEnabled || (err instanceof ServiceError && err.status === 404)) throw err;
        console.warn("[route] ORS nie działa, używam OSRM:", (err as Error).message);
      }
    }
    return finalize(await routeOsrm(from, to), from, to, "osrm");
  });
}
