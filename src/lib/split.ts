import { pointAtTime } from "./geo";
import type { RouteData, StopSlot } from "./types";

/**
 * Dzieli trasę na odcinki według czasu jazdy. Postój wypada co `intervalHours`
 * godzin jazdy; ostatni pomijamy, jeśli do celu zostało mniej niż ~35 % odstępu.
 * Kandydatów szukamy w oknie ±window wokół nominalnego czasu postoju.
 */
export function splitRoute(route: RouteData, intervalHours: number): StopSlot[] {
  const step = intervalHours * 3600;
  const halfWindow = Math.min(40 * 60, Math.max(15 * 60, step * 0.2));
  const slots: StopSlot[] = [];
  for (let t = step, i = 0; t < route.durationS - step * 0.35; t += step, i++) {
    slots.push({
      index: i,
      targetTimeS: t,
      point: pointAtTime(route.coords, route.cumTimeS, t),
      windowStartS: Math.max(0, t - halfWindow),
      windowEndS: Math.min(route.durationS, t + halfWindow),
    });
  }
  return slots;
}
