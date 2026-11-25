import "server-only";
import { cached, DAY } from "../cache";
import { fetchJson, ServiceError } from "../http";

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const ENDPOINTS = (
  process.env.OVERPASS_URLS ||
  "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Buduje zapytanie Overpass wzdłuż łamanej (around z listą punktów = bufor wokół linii).
 * MOP-y szukamy wąsko (leżą przy drodze), atrakcje w promieniu maksymalnego zboczenia.
 */
export function buildQuery(line: [number, number][], radiusM: number): string {
  const poly = line.map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(",");
  const near = `(around:${Math.min(radiusM, 1200)},${poly})`;
  const r = `(around:${radiusM},${poly})`;
  return `[out:json][timeout:45];
(
  nwr["highway"~"^(rest_area|services)$"]${near};
  nwr["historic"~"^(castle|manor|palace|fort|ruins|monastery|archaeological_site|city_gate|memorial)$"]["name"]${r};
  nwr["tourism"~"^(viewpoint|museum|attraction|zoo|theme_park|gallery|aquarium)$"]["name"]${r};
  node["tourism"="viewpoint"]${near};
  nwr["natural"="water"]["water"~"^(lake|reservoir|oxbow)$"]["name"]${r};
  nwr["leisure"~"^(nature_reserve|water_park|park)$"]["name"]["wikidata"]${r};
  nwr["leisure"~"^(nature_reserve|water_park)$"]["name"]${r};
  nwr["natural"~"^(peak|waterfall|cave_entrance|rock)$"]["name"]${r};
  nwr["amenity"="restaurant"]["cuisine"~"regional|polish|local",i]${r};
  nwr["building"~"^(church|cathedral)$"]["name"]["heritage"]${r};
  nwr["amenity"="place_of_worship"]["name"]["heritage"]${r};
);
out center tags 500;`;
}

type OverpassResponse = { elements: OsmElement[]; remark?: string };

export async function overpassAround(line: [number, number][], radiusM: number): Promise<OsmElement[]> {
  const query = buildQuery(line, radiusM);
  return cached("overpass", query, 7 * DAY, async () => {
    const errors: string[] = [];
    for (const url of ENDPOINTS) {
      try {
        const data = await fetchJson<OverpassResponse>("Overpass API", url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }).toString(),
          timeoutMs: 45000,
          retries: 0,
        });
        if (data.remark && /runtime error|timed out/i.test(data.remark) && data.elements.length === 0)
          throw new Error(data.remark);
        return data.elements;
      } catch (err) {
        errors.push(`${new URL(url).host}: ${(err as Error).message}`);
        console.warn("[overpass]", url, (err as Error).message);
      }
    }
    console.warn("[overpass] wszystkie serwery zawiodły:", errors.join(" | "));
    throw new ServiceError(
      "Overpass API",
      "Overpass API (punkty z OpenStreetMap, w tym MOP-y) nie odpowiada.",
      true,
    );
  });
}
