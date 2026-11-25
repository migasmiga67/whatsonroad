// Wspólne typy używane przez serwer (API routes) i klienta (UI).

export type LatLon = { lat: number; lon: number };

export type Place = LatLon & { name: string; label: string };

export const INTERESTS = [
  { id: "nature", label: "Przyroda" },
  { id: "monuments", label: "Zabytki" },
  { id: "food", label: "Jedzenie" },
  { id: "kids", label: "Dla dzieci" },
  { id: "viewpoints", label: "Punkty widokowe" },
] as const;

export type Interest = (typeof INTERESTS)[number]["id"];

export type Category =
  | "mop"
  | "castle"
  | "palace"
  | "church"
  | "monument"
  | "museum"
  | "viewpoint"
  | "lake"
  | "nature"
  | "kids"
  | "food"
  | "attraction";

export const CATEGORY_LABEL: Record<Category, string> = {
  mop: "MOP",
  castle: "Zamek / ruiny",
  palace: "Pałac / dwór",
  church: "Kościół / klasztor",
  monument: "Zabytek",
  museum: "Muzeum",
  viewpoint: "Punkt widokowy",
  lake: "Jezioro",
  nature: "Przyroda",
  kids: "Dla dzieci",
  food: "Kuchnia regionalna",
  attraction: "Atrakcja",
};

export type PlanRequest = {
  from: string;
  to: string;
  /** ISO lokalny "YYYY-MM-DDTHH:mm" */
  departure: string;
  intervalHours: number;
  maxDetourKm: number;
  interests: Interest[];
  preferMop: boolean;
};

export type RouteData = {
  from: Place;
  to: Place;
  provider: "openrouteservice" | "osrm";
  /** [lat, lon] – uproszczona geometria do rysowania i obliczeń */
  coords: [number, number][];
  /** skumulowany czas jazdy (s) w każdym punkcie coords */
  cumTimeS: number[];
  /** skumulowany dystans (m) w każdym punkcie coords */
  cumDistM: number[];
  durationS: number;
  distanceM: number;
};

export type StopSlot = {
  index: number;
  /** nominalny czas jazdy od startu, w którym wypada postój */
  targetTimeS: number;
  point: LatLon;
  /** okno trasy (czas jazdy), w którym szukamy kandydatów */
  windowStartS: number;
  windowEndS: number;
};

export type Candidate = {
  id: string;
  name: string;
  category: Category;
  lat: number;
  lon: number;
  /** odległość od trasy w km */
  distKm: number;
  /** czas jazdy od startu do punktu trasy najbliższego kandydatowi */
  routeTimeS: number;
  /** szacowane dodatkowe minuty jazdy (zjazd + powrót) */
  detourMin: number;
  /** tylko MOP: po której stronie jezdni względem kierunku jazdy */
  side?: "right" | "left";
  description?: string;
  imageUrl?: string;
  wikiUrl?: string;
  osmUrl?: string;
  /** krótkie informacje z tagów OSM, np. "stacja paliw, toalety" */
  facts?: string[];
  source: "osm" | "wikipedia" | "osm+wikipedia";
  score: number;
};

export type Pick = {
  candidateId: string;
  why: string;
  visitMin: number;
};

export type StopPlan = {
  slot: StopSlot;
  candidates: Candidate[];
  main: Pick | null;
  alternatives: Pick[];
  /** błąd wyszukiwania kandydatów dla tego postoju (np. API nie odpowiada) */
  error?: string;
};

export type RankResult = {
  stops: { index: number; main: Pick | null; alternatives: Pick[] }[];
  rankedBy: "claude" | "heuristic";
  note?: string;
};

export type ApiErrorBody = { error: string; service?: string };
