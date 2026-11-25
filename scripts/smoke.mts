/**
 * Test dymny całego pipeline'u bez UI:
 *   npx tsx --conditions=react-server scripts/smoke.mts "Kraków" "Gdańsk"
 */
import { findCandidates } from "../src/lib/candidates";
import { geocode } from "../src/lib/providers/geocode";
import { getRoute } from "../src/lib/providers/route";
import { rankStops } from "../src/lib/rank";
import { splitRoute } from "../src/lib/split";
import { buildTimeline, fmtDuration, googleMapsUrl, hhmm } from "../src/lib/timeline";
import { CATEGORY_LABEL, type Interest } from "../src/lib/types";

const [from = "Kraków", to = "Gdańsk", interestsArg = "monuments,viewpoints"] = process.argv.slice(2);
const opts = { maxDetourKm: 10, interests: interestsArg.split(",") as Interest[], preferMop: true, intervalHours: 2 };
const departure = "2026-11-28T08:00";

const t0 = Date.now();
const [a, b] = await Promise.all([geocode(from), geocode(to)]);
console.log(`Start: ${a.place.label} (${a.provider}) → Cel: ${b.place.label}`);
const route = await getRoute(a.place, b.place);
console.log(`Trasa [${route.provider}]: ${(route.distanceM / 1000).toFixed(0)} km, ${fmtDuration(route.durationS / 60)}, ${route.coords.length} pkt`);
const slots = splitRoute(route, opts.intervalHours);
console.log(`Postoje: ${slots.length} → ${slots.map((s) => `${(s.targetTimeS / 3600).toFixed(1)}h @ ${s.point.lat.toFixed(3)},${s.point.lon.toFixed(3)}`).join(" | ")}`);

const stops = [];
for (const slot of slots) {
  const { candidates, warnings } = await findCandidates(route, slot, opts);
  warnings.forEach((w) => console.log("  ⚠", w));
  stops.push({ slot, candidates });
  console.log(`\n# Postój ${slot.index}: ${candidates.length} kandydatów`);
  for (const c of candidates.slice(0, 10))
    console.log(`  ${c.score.toFixed(1).padStart(5)} ${CATEGORY_LABEL[c.category].padEnd(18)} ${c.name} (${c.distKm} km, +${c.detourMin} min${c.side ? ", " + c.side : ""}) ${c.source}${c.facts?.length ? " [" + c.facts.join(", ") + "]" : ""}`);
}

const ranked = await rankStops({ stops, interests: opts.interests, preferMop: opts.preferMop, departure });
console.log(`\nRanking: ${ranked.rankedBy}${ranked.note ? " – " + ranked.note : ""}`);
const chosen = ranked.stops.flatMap((r) => {
  const s = stops.find((x) => x.slot.index === r.index)!;
  const c = r.main && s.candidates.find((x) => x.id === r.main!.candidateId);
  return c && r.main ? [{ stopIndex: r.index, candidate: c, pick: r.main }] : [];
});
const tl = buildTimeline(route, new Date(departure), chosen);
for (const e of tl.events) {
  if (e.kind === "start") console.log(`${hhmm(e.at)}  START ${e.label}`);
  if (e.kind === "drive") console.log(`        jazda ${fmtDuration(e.minutes)}, ${e.km} km`);
  if (e.kind === "stop") console.log(`${hhmm(e.arrive)}–${hhmm(e.leave)}  ${e.candidate.name}: ${e.pick.why}`);
  if (e.kind === "end") console.log(`${hhmm(e.at)}  META ${e.label}`);
}
console.log("\nGoogle Maps:", googleMapsUrl(route.from, route.to, chosen.map((c) => c.candidate)));
console.log(`(czas: ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
