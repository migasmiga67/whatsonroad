/**
 * Testy jednostkowe logiki bez sieci (klasyfikacja, MOP-y, podział trasy, oś czasu, ranking):
 *   npm test
 */
import assert from "node:assert/strict";
import { __test as C, findCandidates, scoreCandidate } from "../src/lib/candidates";
import { __test as R, firstSentence, heuristicRank } from "../src/lib/rank";
import { splitRoute } from "../src/lib/split";
import { buildTimeline, googleMapsUrl } from "../src/lib/timeline";
import type { Candidate, RouteData } from "../src/lib/types";

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("✓", name);
};

// Prosta trasa na północ: 50°N → 51°N wzdłuż 19°E w 6 h
const coords: [number, number][] = Array.from({ length: 61 }, (_, i) => [50 + i / 60, 19]);
const route: RouteData = {
  from: { lat: 50, lon: 19, name: "A", label: "A" },
  to: { lat: 51, lon: 19, name: "B", label: "B" },
  provider: "osrm",
  coords,
  cumTimeS: coords.map((_, i) => i * 360),
  cumDistM: coords.map((_, i) => i * 1853),
  durationS: 6 * 3600,
  distanceM: 60 * 1853,
};

test("podział trasy 6 h co 2 h → postoje po 2 h i 4 h", () => {
  const s = splitRoute(route, 2);
  assert.equal(s.length, 2);
  assert.equal(s[0].targetTimeS, 7200);
  assert.ok(Math.abs(s[0].point.lat - 50.3333) < 0.001);
});
test("podział co 3 h → brak postoju tuż przed celem", () => assert.equal(splitRoute(route, 3).length, 1));
test("podział co 1 h → 5 postojów", () => assert.equal(splitRoute(route, 1).length, 5));

test("klasyfikacja OSM", () => {
  assert.equal(C.classifyOsm({ highway: "services", name: "MOP Woźniki" }), "mop");
  assert.equal(C.classifyOsm({ highway: "rest_area" }), "mop");
  assert.equal(C.classifyOsm({ historic: "castle", name: "Zamek" }), "castle");
  assert.equal(C.classifyOsm({ tourism: "viewpoint" }), "viewpoint");
  assert.equal(C.classifyOsm({ natural: "water", water: "lake", name: "Jezioro X" }), "lake");
  assert.equal(C.classifyOsm({ amenity: "restaurant", cuisine: "regional" }), "food");
  assert.equal(C.classifyOsm({ shop: "bakery" }), null);
});

test("klasyfikacja Wikipedii odrzuca wsie i mosty (polskie znaki w granicach słów)", () => {
  const p = (title: string, extract: string, description?: string) => ({ pageid: 1, title, lat: 0, lon: 0, url: "", extract, description });
  assert.equal(C.classifyWiki(p("Byki", "Byki – dawna wieś, od 1977 w granicach miasta Piotrków Trybunalski. Zamek.")), null);
  assert.equal(C.classifyWiki(p("Zamek w Bobolicach", "Zamek w Bobolicach – zamek z XIV wieku.")), "castle");
  assert.equal(C.classifyWiki(p("Most autostradowy im. AK", "Most autostradowy przez Wisłę.")), null);
  assert.equal(C.classifyWiki(p("Jezioro Żarnowieckie", "Jezioro Żarnowieckie – jezioro rynnowe.")), "lake");
  assert.equal(C.classifyWiki(p("Fortepian", "Instrument.")), null, "„fort” tylko jako całe słowo");
});

test("MOP po prawej stronie (ruch prawostronny) vs po lewej", () => {
  // jedziemy na północ: wschód (większa długość) = prawa strona
  const right = C.locate(route, 50.5, 19.002, 0, 60);
  const left = C.locate(route, 50.5, 18.998, 0, 60);
  assert.equal(right.side, "right");
  assert.equal(left.side, "left");
  assert.ok(Math.abs(right.routeTimeS - 3 * 3600) < 60);
  assert.ok(right.distKm < 0.2);
  assert.equal(C.detourMinutes("mop", 0.1, "right"), 2);
});

const cand = (o: Partial<Candidate>): Candidate => ({
  id: "x", name: "X", category: "castle", lat: 50.5, lon: 19, distKm: 2, routeTimeS: 7200, detourMin: 10, source: "osm", score: 0, ...o,
});

test("priorytet MOP: MOP po prawej wygrywa z zamkiem, MOP po lewej przegrywa", () => {
  const mopR = scoreCandidate(cand({ category: "mop", side: "right", distKm: 0.1, facts: ["stacja paliw", "toalety"] }), ["monuments"], true, 10);
  const mopL = scoreCandidate(cand({ category: "mop", side: "left", distKm: 0.1 }), ["monuments"], true, 10);
  const castle = scoreCandidate(cand({ description: "Zamek z XIV w.", imageUrl: "u" }), ["monuments"], true, 10);
  assert.ok(mopR > castle, `${mopR} > ${castle}`);
  assert.ok(mopL < castle);
  const mopNoPref = scoreCandidate(cand({ category: "mop", side: "right", distKm: 0.1 }), ["monuments"], false, 10);
  assert.ok(mopNoPref < castle);
});

const stops = [
  {
    slot: { index: 0, targetTimeS: 7200, point: { lat: 50.33, lon: 19 }, windowStartS: 6000, windowEndS: 8400 },
    candidates: [
      cand({ id: "mop1", name: "MOP Las", category: "mop", side: "right", distKm: 0.1, detourMin: 2, score: 9 }),
      cand({ id: "z1", name: "Zamek", score: 7, description: "Zamek – gotycka warownia z XIV wieku. Dalej tekst." }),
      cand({ id: "l1", name: "Jezioro", category: "lake", score: 5 }),
      cand({ id: "z2", name: "Zamek 2", score: 6 }),
    ],
  },
];
const base = { stops, interests: [], preferMop: true, departure: "2026-11-28T08:00" };

test("ranking heurystyczny: MOP główny, alternatywy innego typu", () => {
  const r = heuristicRank(base);
  assert.equal(r.stops[0].main?.candidateId, "mop1");
  assert.deepEqual(r.stops[0].alternatives.map((a) => a.candidateId), ["z1", "l1"]);
  assert.equal(r.stops[0].alternatives[0].why, "Zamek – gotycka warownia z XIV wieku.");
});

test("walidacja odpowiedzi Claude: odrzuca nieznane id i duplikaty, przycina czas", () => {
  const out = R.validate(base, {
    stops: [{ stop_index: 0, main: { candidate_id: "z1", why: " Super ", visit_minutes: 999 }, alternatives: [
      { candidate_id: "z1", why: "dup", visit_minutes: 20 },
      { candidate_id: "nieistnieje", why: "?", visit_minutes: 20 },
      { candidate_id: "mop1", why: "ok", visit_minutes: 20 },
    ] }],
  });
  assert.equal(out.rankedBy, "claude");
  assert.equal(out.stops[0].main?.candidateId, "z1");
  assert.equal(out.stops[0].main?.visitMin, 240);
  assert.equal(out.stops[0].main?.why, "Super");
  assert.deepEqual(out.stops[0].alternatives.map((a) => a.candidateId), ["mop1"]);
});

test("walidacja: zła odpowiedź Claude → heurystyka dla tego postoju", () => {
  const out = R.validate(base, { stops: [{ stop_index: 0, main: { candidate_id: "???", why: "", visit_minutes: 10 }, alternatives: [] }] });
  assert.equal(out.stops[0].main?.candidateId, "mop1");
});

test("prompt zawiera dane kandydatów, porę i regułę MOP", () => {
  const p = R.buildPrompt({ ...base, interests: ["nature"] });
  assert.match(p, /id=mop1 \| MOP Las \| MOP \| 0.1 km od trasy/);
  assert.match(p, /Zainteresowania: Przyroda/);
  assert.match(p, /planowo ok\. 10:00/);
  assert.match(R.MOP_RULE, /BARDZO LUBI MOP/);
});

test("oś czasu uwzględnia objazdy i czas postojów", () => {
  const c1 = cand({ id: "a", routeTimeS: 7200, detourMin: 10 });
  const tl = buildTimeline(route, new Date("2026-11-28T08:00"), [{ stopIndex: 0, candidate: c1, pick: { candidateId: "a", why: "", visitMin: 60 } }]);
  const stop = tl.events.find((e) => e.kind === "stop")!;
  assert.ok(stop.kind === "stop");
  const hm = (d: Date) => d.getHours() * 60 + d.getMinutes();
  assert.equal(hm(stop.arrive), 10 * 60 + 5); // 08:00 + 2 h jazdy + 5 min dojazdu
  assert.equal(hm(stop.leave), 11 * 60 + 5);
  assert.equal(hm(tl.arrival), 15 * 60 + 10); // 6 h + 60 min zwiedzania + 10 min objazdu
  assert.equal(tl.totalStopMin, 70);
});

test("link Google Maps z punktami pośrednimi", () => {
  const u = new URL(googleMapsUrl({ lat: 50, lon: 19 }, { lat: 54, lon: 18 }, [{ lat: 51, lon: 19.5 }, { lat: 52, lon: 19 }]));
  assert.equal(u.searchParams.get("origin"), "50.000000,19.000000");
  assert.equal(u.searchParams.get("waypoints"), "51.000000,19.500000|52.000000,19.000000");
  assert.equal(u.searchParams.get("travelmode"), "driving");
});

test("pierwsze zdanie nie tnie na skrótach", () => {
  assert.equal(firstSentence("Fort XIV Twierdzy Toruń im. Józefa Bema – fort z XIX w. Leży nad Wisłą."), "Fort XIV Twierdzy Toruń im. Józefa Bema – fort z XIX w. Leży nad Wisłą.");
  assert.equal(firstSentence("Kościół św. Anny – zabytkowy kościół. Drugie zdanie."), "Kościół św. Anny – zabytkowy kościół.");
});

// ---------- findCandidates na danych testowych (bez sieci) ----------
const slot0 = splitRoute(route, 2)[0]; // 2 h → lat ≈ 50.333
const osm = [
  // ten sam MOP jako punkt i obszar (deduplikacja), po prawej (wschód) stronie
  { type: "node", id: 1, lat: 50.34, lon: 19.003, tags: { highway: "services", name: "MOP Testowo", toilets: "yes" } },
  { type: "way", id: 2, center: { lat: 50.341, lon: 19.0035 }, tags: { highway: "services", name: "MOP Testowo", amenity: "fuel" } },
  // MOP po lewej stronie jezdni
  { type: "node", id: 3, lat: 50.35, lon: 18.997, tags: { highway: "rest_area", name: "MOP Lewy" } },
  // zamek z tagiem wikipedia → opis z Wikipedii
  { type: "way", id: 4, center: { lat: 50.33, lon: 19.05 }, tags: { historic: "castle", name: "Zamek Testowy", wikipedia: "pl:Zamek Testowy" } },
  // za daleko od trasy (> 10 km)
  { type: "node", id: 5, lat: 50.33, lon: 19.3, tags: { tourism: "museum", name: "Muzeum Daleko" } },
  // poza oknem czasowym postoju
  { type: "node", id: 6, lat: 50.9, lon: 19.01, tags: { tourism: "viewpoint", name: "Widok Daleko" } },
] as const;
const page = (pageid: number, title: string, lat: number, lon: number, extract: string) => ({ pageid, title, lat, lon, extract, url: `https://pl.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` });

const found = await findCandidates(route, slot0, { maxDetourKm: 10, interests: ["monuments"], preferMop: true }, {
  overpass: async () => osm as never,
  wikiGeo: async () => [
    page(10, "Testowo", 50.33, 19.02, "Testowo – wieś w Polsce."),
    page(11, "Jezioro Testowe", 50.32, 19.04, "Jezioro Testowe – jezioro rynnowe."),
  ],
  wikiTitles: async (titles) => titles.map((t, i) => ({ ...page(100 + i, t, 50.33, 19.05, `${t} – gotycki zamek z XIV wieku.`), thumbnail: "https://example/img.jpg" })),
});

test("findCandidates: deduplikacja MOP, strona jezdni, filtry odległości i okna, Wikipedia", () => {
  const byName = (n: string) => found.candidates.find((c) => c.name === n);
  assert.equal(found.warnings.length, 0);
  assert.equal(found.candidates.filter((c) => c.name === "MOP Testowo").length, 1, "jeden MOP po deduplikacji");
  const mop = byName("MOP Testowo")!;
  assert.equal(mop.side, "right");
  assert.ok(mop.facts!.includes("stacja paliw") && mop.facts!.includes("toalety"), "udogodnienia scalone");
  assert.equal(found.candidates[0].id, mop.id, "MOP na pierwszym miejscu przy priorytecie MOP");
  assert.equal(byName("MOP Lewy"), undefined, "MOP po lewej nie trafia do listy");
  const castle = byName("Zamek Testowy")!;
  assert.equal(castle.source, "osm+wikipedia");
  assert.match(castle.description!, /XIV wieku/);
  assert.ok(castle.imageUrl);
  assert.ok(byName("Jezioro Testowe"), "artykuł z GeoSearch jako nowy kandydat");
  assert.equal(byName("Testowo"), undefined, "wieś odrzucona");
  assert.equal(byName("Muzeum Daleko"), undefined, "za daleko od trasy");
  assert.equal(byName("Widok Daleko"), undefined, "poza oknem postoju");
});

const degraded = await findCandidates(route, slot0, { maxDetourKm: 10, interests: [], preferMop: true }, {
  overpass: async () => {
    throw new Error("Overpass API nie odpowiada.");
  },
  wikiGeo: async () => [page(11, "Jezioro Testowe", 50.32, 19.04, "Jezioro Testowe – jezioro rynnowe.")],
  wikiTitles: async () => [],
});

test("findCandidates: awaria Overpass → kandydaci z Wikipedii + ostrzeżenie", () => {
  assert.equal(degraded.candidates.length, 1);
  assert.match(degraded.warnings[0], /Overpass API nie odpowiada\. Pokazuję tylko miejsca z Wikipedii/);
});

console.log(`\n${n} testów OK`);
