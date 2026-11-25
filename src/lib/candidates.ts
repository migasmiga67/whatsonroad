import { haversineM, indexAt, nearestOnLine } from "./geo";
import { overpassAround, type OsmElement } from "./providers/overpass";
import { wikiByTitles, wikiGeoSearch, type WikiPage } from "./providers/wikipedia";
import type { Candidate, Category, Interest, RouteData, StopSlot } from "./types";

/** Ile kandydatów na postój trafia do rankingu. */
const MAX_PER_STOP = 16;

// ---------- klasyfikacja ----------

function classifyOsm(t: Record<string, string>): Category | null {
  if (t.highway === "rest_area" || t.highway === "services") return "mop";
  if (t.historic === "castle" || t.historic === "fort" || t.historic === "ruins" || t.castle_type) return "castle";
  if (t.historic === "manor" || t.historic === "palace") return "palace";
  if (t.historic === "monastery" || t.amenity === "place_of_worship" || t.building === "church" || t.building === "cathedral")
    return "church";
  if (t.tourism === "museum" || t.tourism === "gallery") return "museum";
  if (t.tourism === "viewpoint") return "viewpoint";
  if (t.natural === "water") return "lake";
  if (t.tourism === "zoo" || t.tourism === "theme_park" || t.tourism === "aquarium" || t.leisure === "water_park") return "kids";
  if (t.amenity === "restaurant") return "food";
  if (t.leisure === "nature_reserve" || t.leisure === "park" || t.natural) return "nature";
  if (t.historic) return "monument";
  if (t.tourism === "attraction") return "attraction";
  return null;
}

// W JS \b nie działa z polskimi literami (ą, ś, ż…), więc granice słów wyznaczamy przez \p{L}.
const B = "(?<!\\p{L})"; // początek słowa
const E = "(?!\\p{L})"; // koniec słowa
const W = (src: string) => new RegExp(src, "iu");

const WIKI_RULES: [RegExp, Category][] = [
  [W(`${B}zam(ek|ku)${E}|${B}ruiny|grodzisk|twierdz|${B}fort${E}`), "castle"],
  [W(`pałac|${B}dw[óo]r${E}|dworek|rezydencj`), "palace"],
  [W(`muzeum|skansen|galeri`), "museum"],
  [W(`wieża widokowa|punkt widokowy|platforma widokowa`), "viewpoint"],
  [W(`${B}jezior|${B}zalew|zbiornik (wodny|retencyjny)`), "lake"],
  [W(`rezerwat|park krajobrazowy|park narodowy|wodospad|jaskini|pomnik przyrody|${B}wydm`), "nature"],
  [W(`kości[óo]ł|bazylik|katedr|klasztor|opactw|sanktuarium|cerkiew|synagog`), "church"],
  [W(`${B}zoo${E}|ogród zoologiczny|park rozrywki|aquapark|park dinozaurów|miniatur`), "kids"],
  [W(`ratusz|wiatrak|${B}młyn|latarnia morska|mauzoleum|cmentarz wojenny|${B}zabyt`), "monument"],
];

/** Odrzucamy artykuły o miejscowościach, ulicach, stacjach, mostach itp. – to nie są atrakcje. */
const WIKI_EXCLUDE = W(
  [
    `${B}wie[śs]${E}`, `${B}gmin[ay]${E}`, `${B}miasto${E}`, `${B}osada${E}`, "przysiółek", "część (wsi|miasta)",
    "dzielnic", `${B}osiedl`, "sołectw", `${B}ulica${E}`, "przystan", "stacja kolejowa", `${B}węzeł`,
    "droga (krajowa|ekspresowa|wojewódzka)", "autostrad", `${B}szkoł`, `${B}parafi`, `${B}klub${E}`, "stadion",
    "nadleśnictw", `${B}powiat`, `${B}kolonia${E}`, `${B}most${E}`, "wiadukt",
  ].join("|"),
);

/** Kościół z Wikipedii jest ciekawy głównie, gdy to zabytek. */
const HERITAGE = W("zabyt|gotyck|romańsk|barokow|renesans|drewnian|XII|XIII|XIV|XV|XVI|XVII|XVIII|UNESCO|pomnik historii");

function classifyWiki(p: WikiPage): Category | null {
  const head = `${p.description ?? ""} ${p.title}`;
  if (WIKI_EXCLUDE.test(p.description ?? "")) return null;
  for (const [re, cat] of WIKI_RULES) if (re.test(head)) return cat;
  const lead = (p.extract ?? "").slice(0, 160);
  if (WIKI_EXCLUDE.test(lead)) return null;
  for (const [re, cat] of WIKI_RULES) if (re.test(lead)) return cat;
  return null;
}

// ---------- scoring ----------

const INTEREST_CATS: Record<Interest, Category[]> = {
  nature: ["nature", "lake"],
  monuments: ["castle", "palace", "church", "monument", "museum"],
  food: ["food"],
  kids: ["kids", "museum", "lake"],
  viewpoints: ["viewpoint"],
};

const BASE: Record<Category, number> = {
  mop: 0,
  castle: 3,
  palace: 2.5,
  museum: 2,
  viewpoint: 2,
  lake: 2,
  nature: 1.8,
  kids: 1.8,
  church: 1.5,
  monument: 1.2,
  food: 1.5,
  attraction: 1.5,
};

export const __test = { classifyOsm, classifyWiki, locate, detourMinutes };

export function scoreCandidate(c: Candidate, interests: Interest[], preferMop: boolean, maxDetourKm: number): number {
  let s = BASE[c.category];
  if (c.category === "mop") {
    s = preferMop ? 8 : 2;
    if (c.side === "left") s -= 6; // po drugiej stronie jezdni – praktycznie niedostępny
    if (c.facts?.length) s += Math.min(1.5, c.facts.length * 0.3);
  } else {
    if (c.category === "church" && !HERITAGE.test(c.description ?? "")) s -= 1.2;
    if (interests.some((i) => INTEREST_CATS[i].includes(c.category))) s += 3;
    if (c.description) s += 1.5;
    if (c.imageUrl) s += 0.7;
    if (c.source === "osm+wikipedia") s += 0.8;
    if (c.name.startsWith("Punkt widokowy (")) s -= 1.5;
  }
  s -= (c.distKm / Math.max(1, maxDetourKm)) * 2.5;
  return Math.round(s * 100) / 100;
}

// ---------- budowanie kandydatów ----------

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function osmFacts(t: Record<string, string>): string[] {
  const f: string[] = [];
  if (t.highway === "services" || t.amenity === "fuel") f.push("stacja paliw");
  if (t.toilets === "yes" || t["toilets:disposal"]) f.push("toalety");
  if (t.restaurant === "yes" || t.food === "yes" || t.fast_food === "yes") f.push("jedzenie");
  if (t.shop === "yes" || t.shop) f.push("sklep");
  if (t.playground === "yes") f.push("plac zabaw");
  if (t.charging_station === "yes" || t["socket:type2"]) f.push("ładowarka EV");
  if (t.opening_hours) f.push(`godz.: ${t.opening_hours}`);
  if (t.fee === "yes") f.push("płatne");
  if (t.fee === "no") f.push("bezpłatne");
  if (t.cuisine) f.push(`kuchnia: ${t.cuisine.replace(/;/g, ", ")}`);
  return f;
}

/** Fragment trasy w oknie czasowym postoju, przerzedzony do ~1 punktu na 2,5 km. */
function windowLine(route: RouteData, slot: StopSlot) {
  const from = indexAt(route.cumTimeS, slot.windowStartS);
  const to = Math.min(route.coords.length - 1, indexAt(route.cumTimeS, slot.windowEndS));
  const line: [number, number][] = [];
  let lastD = -Infinity;
  for (let i = from; i <= to; i++) {
    if (route.cumDistM[i] - lastD >= 2500 || i === to) {
      line.push(route.coords[i]);
      lastD = route.cumDistM[i];
    }
  }
  return { from: Math.max(0, from - 1), to, line };
}

type Located = { distKm: number; routeTimeS: number; side: "left" | "right" };

function locate(route: RouteData, lat: number, lon: number, from: number, to: number): Located {
  const n = nearestOnLine({ lat, lon }, route.coords, Math.max(0, from - 5), Math.min(route.coords.length - 1, to + 5));
  const t0 = route.cumTimeS[n.segIndex];
  const t1 = route.cumTimeS[Math.min(n.segIndex + 1, route.cumTimeS.length - 1)];
  return { distKm: n.distM / 1000, routeTimeS: t0 + n.t * (t1 - t0), side: n.cross > 0 ? "left" : "right" };
}

function detourMinutes(cat: Category, distKm: number, side: "left" | "right") {
  if (cat === "mop") return side === "right" ? 2 : 10;
  // zjazd + dojazd tam i z powrotem drogami lokalnymi (~45 km/h, współczynnik krętości 1,3)
  return Math.round(5 + ((2 * distKm * 1.3) / 45) * 60);
}

/** Źródła danych – podmienialne w testach. */
const defaultSources = { overpass: overpassAround, wikiGeo: wikiGeoSearch, wikiTitles: wikiByTitles };

export async function findCandidates(
  route: RouteData,
  slot: StopSlot,
  opts: { maxDetourKm: number; interests: Interest[]; preferMop: boolean },
  src: typeof defaultSources = defaultSources,
): Promise<{ candidates: Candidate[]; warnings: string[] }> {
  const warnings: string[] = [];
  const radiusM = Math.round(opts.maxDetourKm * 1000);
  const { from, to, line } = windowLine(route, slot);

  // Wikipedia GeoSearch: max 10 km promienia, więc próbkujemy kilka punktów okna.
  const wikiPoints = [0, 0.25, 0.5, 0.75, 1].map((f) => line[Math.min(line.length - 1, Math.round(f * (line.length - 1)))]);
  const [osmRes, ...wikiRes] = await Promise.allSettled([
    src.overpass(line, radiusM),
    ...wikiPoints.map(([lat, lon]) => src.wikiGeo(lat, lon, radiusM)),
  ]);
  const osm = osmRes.status === "fulfilled" ? (osmRes.value as OsmElement[]) : [];
  const wikiLists = wikiRes.map((r) => (r.status === "fulfilled" ? (r.value as WikiPage[]) : []));
  if (osmRes.status === "rejected") warnings.push(`${(osmRes.reason as Error).message} Pokazuję tylko miejsca z Wikipedii.`);
  const wikiFailed = wikiRes.filter((r) => r.status === "rejected").length;
  if (wikiFailed === wikiRes.length) warnings.push("Wikipedia nie odpowiada – brak opisów i zdjęć.");
  else if (wikiFailed) warnings.push("Część zapytań do Wikipedii nie powiodła się – lista może być niepełna.");
  if (osmRes.status === "rejected" && wikiRes.every((r) => r.status === "rejected")) throw osmRes.reason;

  const byId = new Map<string, Candidate>();

  // OSM
  const wikiTitleFor = new Map<string, string>();
  for (const el of osm) {
    const t = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const category = classifyOsm(t);
    if (!category) continue;
    const loc = locate(route, lat, lon, from, to);
    const limitKm = category === "mop" ? 1.2 : category === "lake" ? opts.maxDetourKm * 1.3 : opts.maxDetourKm;
    if (loc.distKm > limitKm) continue;
    const name =
      t.name ||
      (category === "mop" ? `MOP${t.ref ? ` ${t.ref}` : ""} (bez nazwy)` : category === "viewpoint" ? "Punkt widokowy (bez nazwy)" : "");
    if (!name) continue;
    const id = `osm:${el.type}/${el.id}`;
    const c: Candidate = {
      id,
      name: category === "mop" && !/mop/i.test(name) ? `MOP ${name}` : name,
      category,
      lat,
      lon,
      distKm: Math.round(loc.distKm * 10) / 10,
      routeTimeS: Math.round(loc.routeTimeS),
      detourMin: detourMinutes(category, loc.distKm, loc.side),
      side: category === "mop" ? loc.side : undefined,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      facts: osmFacts(t),
      source: "osm",
      score: 0,
    };
    if (t.description) c.description = t.description;
    const wp = t.wikipedia?.match(/^pl:(.+)$/)?.[1];
    if (wp) wikiTitleFor.set(wp, id);
    byId.set(id, c);
  }

  // Deduplikacja MOP-ów: ten sam MOP bywa zmapowany jako node + area lub services + rest_area.
  const mops = [...byId.values()].filter((c) => c.category === "mop");
  for (const a of mops)
    for (const b of mops)
      if (a !== b && byId.has(a.id) && byId.has(b.id) && a.side === b.side && haversineM(a, b) < 400) {
        const loser = (a.facts?.length ?? 0) >= (b.facts?.length ?? 0) ? b : a;
        const winner = loser === a ? b : a;
        winner.facts = [...new Set([...(winner.facts ?? []), ...(loser.facts ?? [])])];
        byId.delete(loser.id);
      }

  // Opisy z Wikipedii dla obiektów OSM z tagiem wikipedia=*
  if (wikiTitleFor.size) {
    const pages = await src.wikiTitles([...wikiTitleFor.keys()]).catch(() => [] as WikiPage[]);
    for (const p of pages) {
      const c = byId.get(wikiTitleFor.get(p.title) ?? "");
      if (c) attachWiki(c, p);
    }
  }

  // Artykuły z GeoSearch: dołącz do obiektu OSM o podobnej nazwie albo dodaj jako nowego kandydata.
  const seenPages = new Set<number>();
  const osmList = [...byId.values()];
  for (const p of wikiLists.flat()) {
    if (seenPages.has(p.pageid)) continue;
    seenPages.add(p.pageid);
    const np = normalize(p.title.replace(/\s*\(.*\)$/, ""));
    const match = osmList.find(
      (c) =>
        c.category !== "mop" &&
        haversineM(c, p) < 1500 &&
        (normalize(c.name).includes(np) || np.includes(normalize(c.name))),
    );
    if (match) {
      if (!match.description || match.source === "osm") attachWiki(match, p);
      continue;
    }
    const category = classifyWiki(p);
    if (!category) continue;
    const loc = locate(route, p.lat, p.lon, from, to);
    if (loc.distKm > opts.maxDetourKm) continue;
    byId.set(`wiki:${p.pageid}`, {
      id: `wiki:${p.pageid}`,
      name: p.title.replace(/\s*\(.*\)$/, ""),
      category,
      lat: p.lat,
      lon: p.lon,
      distKm: Math.round(loc.distKm * 10) / 10,
      routeTimeS: Math.round(loc.routeTimeS),
      detourMin: detourMinutes(category, loc.distKm, loc.side),
      description: p.extract,
      imageUrl: p.thumbnail,
      wikiUrl: p.url,
      source: "wikipedia",
      score: 0,
    });
  }

  // Dociągnij opisy/zdjęcia dla kandydatów z Wikipedii, którym GeoSearch ich nie zwrócił (limit 20 wyciągów).
  const missing = [...byId.values()].filter((c) => c.source === "wikipedia" && !c.description);
  if (missing.length) {
    const pages = await src.wikiTitles(missing.map((c) => decodeURIComponent(c.wikiUrl!.split("/wiki/")[1]).replace(/_/g, " "))).catch(
      () => [] as WikiPage[],
    );
    for (const c of missing) {
      const p = pages.find((x) => x.url === c.wikiUrl || `wiki:${x.pageid}` === c.id);
      if (p) {
        c.description = p.extract;
        c.imageUrl = c.imageUrl || p.thumbnail;
      }
    }
  }

  const all = [...byId.values()].filter(
    (c) => c.routeTimeS >= slot.windowStartS - 300 && c.routeTimeS <= slot.windowEndS + 300,
  );
  for (const c of all) c.score = scoreCandidate(c, opts.interests, opts.preferMop, opts.maxDetourKm);
  all.sort((a, b) => b.score - a.score);

  // Zawsze zostaw do 4 MOP-ów (po właściwej stronie) + najlepsze atrakcje, max 4 jednego typu (różnorodność).
  const mopsKept = all.filter((c) => c.category === "mop" && c.side === "right").slice(0, 4);
  const perCat = new Map<Category, number>();
  const others = all
    .filter((c) => c.category !== "mop")
    .filter((c) => {
      const n = perCat.get(c.category) ?? 0;
      perCat.set(c.category, n + 1);
      return n < 4;
    })
    .slice(0, MAX_PER_STOP - mopsKept.length);
  return { candidates: [...mopsKept, ...others].sort((a, b) => b.score - a.score), warnings };
}

function attachWiki(c: Candidate, p: WikiPage) {
  c.description = p.extract || c.description;
  c.imageUrl = p.thumbnail || c.imageUrl;
  c.wikiUrl = p.url;
  c.source = "osm+wikipedia";
}
