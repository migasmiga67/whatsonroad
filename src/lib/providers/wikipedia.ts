import { cached, DAY } from "../cache";
import { fetchJson } from "../http";

export type WikiPage = {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  extract?: string;
  description?: string;
  thumbnail?: string;
  url: string;
};

const LANG = process.env.WIKIPEDIA_LANG || "pl";
const API = `https://${LANG}.wikipedia.org/w/api.php`;
/** Wikimedia prosi o zapytania szeregowe – bez równoległości. */
const WIKI_FETCH = { queue: { key: "wikipedia", gapMs: 250 }, retries: 2 };

type QueryResponse = {
  query?: {
    pages?: Record<
      string,
      {
        pageid: number;
        title: string;
        missing?: string;
        extract?: string;
        description?: string;
        fullurl?: string;
        thumbnail?: { source: string };
        coordinates?: { lat: number; lon: number }[];
      }
    >;
  };
};

const COMMON = {
  action: "query",
  format: "json",
  origin: "*", // CORS – pozwala wołać API wprost z przeglądarki (wersja na GitHub Pages)
  prop: "extracts|pageimages|coordinates|description|info",
  exintro: "1",
  explaintext: "1",
  exsentences: "3",
  exlimit: "max",
  piprop: "thumbnail",
  pithumbsize: "480",
  pilimit: "max",
  inprop: "url",
  colimit: "max",
  redirects: "1",
};

function toPages(data: QueryResponse): WikiPage[] {
  return Object.values(data.query?.pages ?? {})
    .filter((p) => !p.missing && p.coordinates?.length)
    .map((p) => ({
      pageid: p.pageid,
      title: p.title,
      lat: p.coordinates![0].lat,
      lon: p.coordinates![0].lon,
      extract: p.extract?.trim() || undefined,
      description: p.description,
      thumbnail: p.thumbnail?.source,
      url: p.fullurl || `https://${LANG}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    }));
}

/** Artykuły z Wikipedii w promieniu (max 10 km – limit API GeoSearch). */
export async function wikiGeoSearch(lat: number, lon: number, radiusM: number): Promise<WikiPage[]> {
  const params = {
    ...COMMON,
    generator: "geosearch",
    ggscoord: `${lat.toFixed(4)}|${lon.toFixed(4)}`,
    ggsradius: String(Math.min(10000, Math.max(10, Math.round(radiusM)))),
    // GeoSearch zwraca do 50 stron, ale extracts opisuje max 20 – brakujące opisy dociąga wikiByTitles.
    ggslimit: "50",
  };
  return cached("wiki-geo", params, 30 * DAY, async () =>
    toPages(await fetchJson<QueryResponse>("Wikipedia", `${API}?${new URLSearchParams(params)}`, WIKI_FETCH)),
  );
}

/** Opisy dla konkretnych tytułów (np. z tagu OSM wikipedia=pl:Tytuł). Max 20 na zapytanie. */
export async function wikiByTitles(titles: string[]): Promise<WikiPage[]> {
  const out: WikiPage[] = [];
  const uniq = [...new Set(titles)].sort();
  for (let i = 0; i < uniq.length; i += 20) {
    const params = { ...COMMON, titles: uniq.slice(i, i + 20).join("|") };
    out.push(
      ...(await cached("wiki-titles", params, 30 * DAY, async () =>
        toPages(await fetchJson<QueryResponse>("Wikipedia", `${API}?${new URLSearchParams(params)}`, WIKI_FETCH)),
      )),
    );
  }
  return out;
}
