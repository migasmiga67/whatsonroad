import { cached, DAY } from "../cache";
import { fetchJson, ServiceError } from "../http";
import type { Place } from "../types";
import { fallbackEnabled, ors, orsEnabled, orsHeaders } from "./ors";

type PeliasResponse = {
  features: { geometry: { coordinates: [number, number] }; properties: { name: string; label: string } }[];
};

type NominatimItem = { lat: string; lon: string; name?: string; display_name: string };

async function geocodeOrs(text: string): Promise<Place | null> {
  const url = `${ors.geocodeUrl}/search?${new URLSearchParams({ text, size: "1", lang: "pl" })}`;
  const data = await fetchJson<PeliasResponse>("OpenRouteService (geokodowanie)", url, { headers: orsHeaders() });
  const f = data.features?.[0];
  if (!f) return null;
  return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: f.properties.name, label: f.properties.label };
}

async function geocodeNominatim(text: string): Promise<Place | null> {
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: text,
    format: "jsonv2",
    limit: "1",
    "accept-language": "pl",
  })}`;
  // Polityka Nominatim: max 1 zapytanie na sekundę.
  const data = await fetchJson<NominatimItem[]>("Nominatim (geokodowanie)", url, { queue: { key: "nominatim", gapMs: 1100 } });
  const f = data[0];
  if (!f) return null;
  const parts = f.display_name.split(",").map((s) => s.trim());
  return {
    lat: Number(f.lat),
    lon: Number(f.lon),
    name: f.name || parts[0],
    label: parts.slice(0, 3).join(", "),
  };
}

export async function geocode(text: string): Promise<{ place: Place; provider: string }> {
  const q = text.trim();
  if (!q) throw new ServiceError("Formularz", "Podaj nazwę miejsca.", false, 400);

  return cached("geocode", q.toLowerCase(), 30 * DAY, async () => {
    if (orsEnabled) {
      try {
        const place = await geocodeOrs(q);
        if (place) return { place, provider: "openrouteservice" };
      } catch (err) {
        if (!fallbackEnabled) throw err;
        console.warn("[geocode] ORS nie działa, używam Nominatim:", (err as Error).message);
      }
    }
    if (!fallbackEnabled && !orsEnabled)
      throw new ServiceError("OpenRouteService", "Brak ORS_API_KEY w .env, a ROUTING_PROVIDER=ors.", false, 500);
    const place = await geocodeNominatim(q);
    if (!place) throw new ServiceError("Geokodowanie", `Nie znaleziono miejsca „${q}”. Spróbuj dodać województwo lub kraj.`, false, 404);
    return { place, provider: "nominatim" };
  });
}
