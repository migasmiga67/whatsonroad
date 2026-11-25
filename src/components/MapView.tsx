"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { CATEGORY_ICON } from "@/lib/timeline";
import { CATEGORY_LABEL, type Candidate, type RouteData, type StopSlot } from "@/lib/types";

export type MapStop = {
  slot: StopSlot;
  chosen: Candidate | null;
  alternatives: Candidate[];
};

function pin(html: string, cls: string, size: number) {
  return L.divIcon({ html, className: cls, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function FitBounds({ route }: { route: RouteData | null }) {
  const map = useMap();
  useEffect(() => {
    if (route?.coords.length) map.fitBounds(L.latLngBounds(route.coords), { padding: [30, 30] });
  }, [map, route]);
  return null;
}

export default function MapView({
  route,
  stops,
  onChoose,
}: {
  route: RouteData | null;
  stops: MapStop[];
  onChoose: (stopIndex: number, candidateId: string) => void;
}) {
  return (
    <MapContainer center={[52.1, 19.4]} zoom={6} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds route={route} />
      {route && (
        <>
          <Polyline positions={route.coords} pathOptions={{ color: "#ffffff", weight: 9, opacity: 0.9 }} />
          <Polyline positions={route.coords} pathOptions={{ color: "#2563eb", weight: 5 }} />
          <Marker position={[route.from.lat, route.from.lon]} icon={pin("A", "pin pin-start", 30)}>
            <Tooltip>{route.from.label}</Tooltip>
          </Marker>
          <Marker position={[route.to.lat, route.to.lon]} icon={pin("B", "pin pin-end", 30)}>
            <Tooltip>{route.to.label}</Tooltip>
          </Marker>
        </>
      )}
      {stops.map(({ slot, chosen, alternatives }) => (
        <div key={slot.index}>
          {!chosen && (
            <Marker position={[slot.point.lat, slot.point.lon]} icon={pin(String(slot.index + 1), "pin pin-slot", 24)}>
              <Tooltip>Postój {slot.index + 1} – ok. {(slot.targetTimeS / 3600).toFixed(1)} h jazdy</Tooltip>
            </Marker>
          )}
          {alternatives.map((c) => (
            <Marker key={c.id} position={[c.lat, c.lon]} icon={pin(CATEGORY_ICON[c.category], "pin pin-alt", 26)}>
              <Popup>
                <div className="space-y-1">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-slate-500">
                    {CATEGORY_LABEL[c.category]} · {c.distKm} km od trasy
                  </div>
                  <button
                    className="mt-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white"
                    onClick={() => onChoose(slot.index, c.id)}
                  >
                    Wybierz na postój {slot.index + 1}
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
          {chosen && (
            <Marker
              position={[chosen.lat, chosen.lon]}
              icon={pin(`<span>${slot.index + 1}</span>${CATEGORY_ICON[chosen.category]}`, "pin pin-main", 40)}
              zIndexOffset={1000}
            >
              <Tooltip direction="top" offset={[0, -18]} permanent={false}>
                {slot.index + 1}. {chosen.name}
              </Tooltip>
            </Marker>
          )}
        </div>
      ))}
    </MapContainer>
  );
}
