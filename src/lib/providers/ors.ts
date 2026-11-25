import "server-only";

/**
 * Konfiguracja OpenRouteService.
 * Uwaga: od 2026-11-24 stary host api.openrouteservice.org zwraca 410 – API działa pod api.heigit.org.
 */
export const ors = {
  key: process.env.ORS_API_KEY?.trim() || "",
  baseUrl: (process.env.ORS_BASE_URL || "https://api.heigit.org/openrouteservice").replace(/\/$/, ""),
  geocodeUrl: (process.env.ORS_GEOCODE_URL || "https://api.heigit.org/pelias/v1").replace(/\/$/, ""),
};

/** auto = ORS gdy jest klucz, a przy jego błędzie OSRM/Nominatim; ors = tylko ORS; osrm = tylko darmowe bez klucza */
export type ProviderMode = "auto" | "ors" | "osrm";
export const providerMode: ProviderMode = ((): ProviderMode => {
  const v = (process.env.ROUTING_PROVIDER || "auto").toLowerCase();
  return v === "ors" || v === "osrm" ? v : "auto";
})();

export const orsEnabled = providerMode !== "osrm" && ors.key.length > 0;
export const fallbackEnabled = providerMode !== "ors";

export function orsHeaders(): Record<string, string> {
  return { Authorization: ors.key, "Content-Type": "application/json" };
}
