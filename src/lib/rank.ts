import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { cached, DAY } from "./cache";
import { defaultVisit } from "./timeline";
import { CATEGORY_LABEL, INTERESTS, type Candidate, type Interest, type Pick, type RankResult, type StopSlot } from "./types";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT || "low") as "low" | "medium" | "high";

export type RankInput = {
  stops: { slot: StopSlot; candidates: Candidate[] }[];
  interests: Interest[];
  preferMop: boolean;
  departure: string;
};

const PickSchema = z.object({
  candidate_id: z.string(),
  why: z.string().describe("1–2 zdania po polsku: dlaczego warto się tu zatrzymać"),
  visit_minutes: z.number().int().describe("szacowany czas postoju/zwiedzania w minutach"),
});

const RankSchema = z.object({
  stops: z.array(
    z.object({
      stop_index: z.number().int(),
      main: PickSchema,
      alternatives: z.array(PickSchema).describe("dokładnie 2 alternatywy, jeśli jest z czego wybierać"),
    }),
  ),
});

const SYSTEM = `Jesteś doświadczonym pilotem wycieczek samochodowych po Polsce. Pomagasz wybrać postoje na trasie.
Dla każdego postoju dostajesz listę kandydatów (id, nazwa, typ, odległość od trasy, dodatkowy czas jazdy, opis).
Wybierz 1 propozycję główną i 2 alternatywy (różne od głównej, najlepiej różnego typu), wyłącznie spośród podanych id.
Zasady:
- Dopasuj wybór do zainteresowań użytkownika i pory dnia (np. obiad koło południa, punkt widokowy nie po zmroku).
- Preferuj miejsca bliżej trasy i z konkretnym opisem; nie wymyślaj faktów, których nie ma w danych.
- "why" pisz po polsku, konkretnie i zachęcająco, max 2 zdania. Nie powtarzaj nazwy na początku.
- visit_minutes: realistyczny czas (MOP 15–25 min, punkt widokowy 15–30, zamek/muzeum 60–120, obiad 45–60).`;

const MOP_RULE = `
- UŻYTKOWNIK BARDZO LUBI MOP-y (Miejsca Obsługi Podróżnych). Jeśli na postoju jest MOP po właściwej stronie drogi,
  wybierz go jako propozycję główną (chyba że naprawdę go brak). Atrakcje podaj jako alternatywy.
  W "why" dla MOP wymień udogodnienia z danych (paliwo, jedzenie, toalety, plac zabaw), jeśli są.`;

function fmtTime(departure: string, offsetS: number) {
  const d = new Date(new Date(departure).getTime() + offsetS * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function buildPrompt(input: RankInput): string {
  const interests = input.interests.map((i) => INTERESTS.find((x) => x.id === i)?.label ?? i).join(", ") || "brak preferencji";
  const lines = [`Zainteresowania: ${interests}`, `Priorytet MOP: ${input.preferMop ? "TAK" : "nie"}`, ""];
  for (const s of input.stops) {
    lines.push(
      `## Postój ${s.slot.index} (ok. ${Math.round(s.slot.targetTimeS / 360) / 10} h jazdy, planowo ok. ${fmtTime(input.departure, s.slot.targetTimeS)})`,
    );
    for (const c of s.candidates) {
      const extra = [
        c.side === "left" ? "po PRZECIWNEJ stronie jezdni" : "",
        c.facts?.length ? `udogodnienia/info: ${c.facts.join(", ")}` : "",
        c.description ? `opis: ${c.description.replace(/\s+/g, " ").slice(0, 280)}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      lines.push(
        `- id=${c.id} | ${c.name} | ${CATEGORY_LABEL[c.category]} | ${c.distKm} km od trasy | +${c.detourMin} min jazdy${extra ? ` | ${extra}` : ""}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------- heurystyka (bez klucza API lub gdy Claude zawiedzie) ----------

function heuristicWhy(c: Candidate): string {
  if (c.category === "mop")
    return `Wygodny MOP tuż przy trasie${c.facts?.length ? ` – ${c.facts.slice(0, 4).join(", ")}` : ""}. Dobre miejsce na rozprostowanie nóg.`;
  if (c.description) return firstSentence(c.description);
  return `${CATEGORY_LABEL[c.category]} ${c.distKm} km od trasy (ok. +${c.detourMin} min jazdy).`;
}

const ABBREV = /(?:^|[\s(])(?:im|św|ul|al|gen|ks|bł|płk|kpt|dr|prof|ok|tzw|m\.in|r|w|wł|pl|nr|bp|abp|ss|oo)\.$/iu;

/** Pierwsze zdanie opisu (bez cięcia na skrótach typu „im.”, „św.”), max ~220 znaków. */
export function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  for (const m of t.matchAll(/[.!?](?= \p{Lu}|$)/gu)) {
    const end = m.index! + 1;
    if (end > 220) break;
    if (!ABBREV.test(t.slice(0, end))) return t.slice(0, end);
  }
  return t.length <= 220 ? t : t.slice(0, 200).replace(/\s\S*$/, "") + "…";
}

export function heuristicRank(input: RankInput): RankResult {
  return {
    rankedBy: "heuristic",
    stops: input.stops.map(({ slot, candidates }) => {
      const sorted = [...candidates].sort((a, b) => b.score - a.score);
      const main = sorted[0];
      // alternatywy: najlepsze, preferując typy jeszcze nieużyte (różnorodność)
      const rest = sorted.slice(1);
      const used = new Set(main ? [main.category] : []);
      const alts: Candidate[] = [];
      while (alts.length < 2 && alts.length < rest.length) {
        const next = rest.find((c) => !alts.includes(c) && !used.has(c.category)) ?? rest.find((c) => !alts.includes(c))!;
        alts.push(next);
        used.add(next.category);
      }
      const toPick = (c: Candidate): Pick => ({ candidateId: c.id, why: heuristicWhy(c), visitMin: defaultVisit(c) });
      return { index: slot.index, main: main ? toPick(main) : null, alternatives: alts.map(toPick) };
    }),
  };
}

// ---------- Claude ----------

function validate(input: RankInput, parsed: z.infer<typeof RankSchema>): RankResult {
  const fallback = heuristicRank(input);
  return {
    rankedBy: "claude",
    stops: input.stops.map(({ slot, candidates }, i) => {
      const ids = new Set(candidates.map((c) => c.id));
      const r = parsed.stops.find((s) => s.stop_index === slot.index);
      const ok = (p: z.infer<typeof PickSchema>): Pick | null =>
        ids.has(p.candidate_id)
          ? { candidateId: p.candidate_id, why: p.why.trim(), visitMin: Math.max(5, Math.min(240, p.visit_minutes)) }
          : null;
      const main = r ? ok(r.main) : null;
      if (!main) return fallback.stops[i];
      const alts = (r?.alternatives ?? [])
        .map(ok)
        .filter((p): p is Pick => !!p && p.candidateId !== main.candidateId)
        .filter((p, j, arr) => arr.findIndex((q) => q.candidateId === p.candidateId) === j)
        .slice(0, 2);
      return { index: slot.index, main, alternatives: alts };
    }),
  };
}

export async function rankStops(input: RankInput): Promise<RankResult> {
  const withCandidates = input.stops.filter((s) => s.candidates.length > 0);
  if (!withCandidates.length) return heuristicRank(input);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { ...heuristicRank(input), note: "Brak ANTHROPIC_API_KEY – użyto rankingu heurystycznego." };
  }

  const prompt = buildPrompt({ ...input, stops: withCandidates });
  const system = SYSTEM + (input.preferMop ? MOP_RULE : "");
  const departureHour = input.departure.slice(11, 13); // pora dnia wpływa na wybór – reszta daty nie

  try {
    const parsed = await cached("rank", { MODEL, EFFORT, system, prompt, departureHour }, 7 * DAY, async () => {
      const client = new Anthropic({ timeout: 90_000, maxRetries: 2 });
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: EFFORT, format: betaZodOutputFormat(RankSchema) },
        system,
        messages: [{ role: "user", content: prompt }],
      });
      if (response.stop_reason === "refusal") throw new Error("Claude odmówił odpowiedzi");
      if (!response.parsed_output) throw new Error(`Brak poprawnego JSON (stop_reason=${response.stop_reason})`);
      return response.parsed_output;
    });
    return validate(input, parsed);
  } catch (err) {
    const msg =
      err instanceof Anthropic.AuthenticationError
        ? "nieprawidłowy ANTHROPIC_API_KEY"
        : err instanceof Anthropic.RateLimitError
          ? "limit zapytań Claude API"
          : err instanceof Anthropic.APIConnectionError
            ? "brak połączenia z Claude API"
            : err instanceof Anthropic.APIError
              ? `błąd Claude API (HTTP ${err.status})`
              : (err as Error).message;
    console.warn("[rank] Claude niedostępny, ranking heurystyczny:", msg);
    return { ...heuristicRank(input), note: `Ranking AI niedostępny (${msg}) – użyto rankingu heurystycznego.` };
  }
}

export const __test = { buildPrompt, validate, RankSchema, SYSTEM, MOP_RULE };
