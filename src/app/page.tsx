"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlanForm from "@/components/PlanForm";
import StopCard from "@/components/StopCard";
import Timeline from "@/components/Timeline";
import { planner, STATIC_MODE } from "@/lib/planner";
import { buildTimeline, defaultVisit, fmtDuration, googleMapsUrl, hhmm, type ChosenStop } from "@/lib/timeline";
import {
  CATEGORY_LABEL,
  type Candidate,
  type Pick,
  type PlanRequest,
  type RankResult,
  type RouteData,
  type StopPlan,
} from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-slate-400">Ładowanie mapy…</div>,
});

type StepStatus = "pending" | "active" | "done" | "warn" | "error";
type Step = { label: string; status: StepStatus; detail?: string };

const STORAGE_KEY = "po-drodze:form";
const CLAUDE_KEY_STORAGE = "po-drodze:claude-key";

function nextQuarter(): string {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fallbackWhy(c: Candidate): string {
  if (c.description) return c.description.slice(0, 180) + (c.description.length > 180 ? "…" : "");
  if (c.category === "mop") return `MOP przy trasie${c.facts?.length ? ` – ${c.facts.join(", ")}` : ""}.`;
  return `${CATEGORY_LABEL[c.category]}, ${c.distKm} km od trasy.`;
}

export default function Home() {
  const [form, setForm] = useState<PlanRequest>({
    from: "Kraków",
    to: "Gdańsk",
    departure: "",
    intervalHours: 2,
    maxDetourKm: 10,
    interests: ["monuments", "viewpoints"],
    preferMop: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [plans, setPlans] = useState<StopPlan[]>([]);
  const [ranking, setRanking] = useState<Omit<RankResult, "stops"> | null>(null);
  const [choice, setChoice] = useState<Record<number, string | null>>({});
  const [visitOverride, setVisitOverride] = useState<Record<string, number>>({});
  const [departureUsed, setDepartureUsed] = useState<string>("");
  const [claudeKey, setClaudeKey] = useState("");
  const runId = useRef(0);

  // Domyślna godzina wyjazdu i zapamiętany formularz – tylko po stronie klienta.
  useEffect(() => {
    let saved: Partial<PlanRequest> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {}
    setForm((f) => ({ ...f, ...saved, departure: nextQuarter() }));
    if (STATIC_MODE) {
      try {
        setClaudeKey(localStorage.getItem(CLAUDE_KEY_STORAGE) || "");
      } catch {}
    }
  }, []);

  const updateStep = (i: number, patch: Partial<Step>) =>
    setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  const run = useCallback(async () => {
    const id = ++runId.current;
    const alive = () => id === runId.current;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...form, departure: undefined }));
    } catch {}
    setBusy(true);
    setError(null);
    setRoute(null);
    setPlans([]);
    setRanking(null);
    setChoice({});
    setVisitOverride({});
    setDepartureUsed(form.departure);
    setSteps([{ label: "Wyznaczam trasę", status: "active" }]);

    const opts = {
      intervalHours: form.intervalHours,
      maxDetourKm: form.maxDetourKm,
      interests: form.interests,
      preferMop: form.preferMop,
    };

    try {
      // 1. Trasa + podział na odcinki
      const r = await planner.route(form.from, form.to, form.intervalHours);
      if (!alive()) return;
      setRoute(r.route);
      const providerName = r.route.provider === "openrouteservice" ? "OpenRouteService" : "OSRM";
      setSteps([
        {
          label: "Trasa",
          status: "done",
          detail: `${Math.round(r.route.distanceM / 1000)} km, ${fmtDuration(r.route.durationS / 60)} (${providerName})`,
        },
        ...r.slots.map((s): Step => ({ label: `Postój ${s.index + 1}: szukam miejsc`, status: "pending" })),
        ...(r.slots.length ? [{ label: "Ranking AI", status: "pending" as StepStatus }] : []),
      ]);
      if (!r.slots.length) {
        setError(`Trasa trwa ${fmtDuration(r.route.durationS / 60)} – krócej niż odstęp między postojami. Zmniejsz odstęp, jeśli chcesz się zatrzymać.`);
        return;
      }

      // 2. Kandydaci – po kolei, żeby nie przeciążać darmowych API
      const collected: StopPlan[] = r.slots.map((slot) => ({ slot, candidates: [], main: null, alternatives: [] }));
      setPlans(collected);
      for (const slot of r.slots) {
        updateStep(slot.index + 1, { status: "active" });
        try {
          const c = await planner.candidates(r.route, slot.index, opts);
          if (!alive()) return;
          collected[slot.index] = { ...collected[slot.index], candidates: c.candidates };
          const mops = c.candidates.filter((x) => x.category === "mop").length;
          updateStep(slot.index + 1, {
            label: `Postój ${slot.index + 1}`,
            status: c.warnings.length ? "warn" : "done",
            detail: `${c.candidates.length} kandydatów${mops ? `, w tym ${mops} MOP` : ""}${c.warnings.length ? ` – ${c.warnings.join(" ")}` : ""}`,
          });
        } catch (err) {
          if (!alive()) return;
          collected[slot.index] = { ...collected[slot.index], error: (err as Error).message };
          updateStep(slot.index + 1, { label: `Postój ${slot.index + 1}`, status: "error", detail: (err as Error).message });
        }
        setPlans([...collected]);
      }

      // 3. Ranking AI
      const rankIdx = r.slots.length + 1;
      updateStep(rankIdx, { status: "active", label: "Ranking AI: wybieram najlepsze postoje" });
      const ranked = await planner.rank(
        collected.map(({ slot, candidates }) => ({ slot, candidates })),
        { ...opts, departure: form.departure, claudeApiKey: claudeKey || undefined },
      );
      if (!alive()) return;
      const final = collected.map((p) => {
        const rr = ranked.stops.find((s) => s.index === p.slot.index);
        return { ...p, main: rr?.main ?? null, alternatives: rr?.alternatives ?? [] };
      });
      setPlans(final);
      setChoice(Object.fromEntries(final.map((p) => [p.slot.index, p.main?.candidateId ?? null])));
      setRanking({ rankedBy: ranked.rankedBy, note: ranked.note });
      updateStep(rankIdx, {
        label: "Ranking",
        status: ranked.note ? "warn" : "done",
        detail: ranked.rankedBy === "claude" ? "wybrane przez Claude" : ranked.note || "heurystyczny",
      });
    } catch (err) {
      if (!alive()) return;
      setError((err as Error).message);
      setSteps((s) => s.map((st) => (st.status === "active" ? { ...st, status: "error" } : st)));
    } finally {
      if (alive()) setBusy(false);
    }
  }, [form, claudeKey]);

  const saveClaudeKey = (k: string) => {
    setClaudeKey(k);
    try {
      if (k) localStorage.setItem(CLAUDE_KEY_STORAGE, k);
      else localStorage.removeItem(CLAUDE_KEY_STORAGE);
    } catch {}
  };

  const pickFor = useCallback(
    (plan: StopPlan) =>
      (c: Candidate): Pick => {
        const ranked = [plan.main, ...plan.alternatives].find((p) => p?.candidateId === c.id);
        const base = ranked ?? { candidateId: c.id, why: fallbackWhy(c), visitMin: defaultVisit(c) };
        return { ...base, visitMin: visitOverride[c.id] ?? base.visitMin };
      },
    [visitOverride],
  );

  const chosen: ChosenStop[] = useMemo(
    () =>
      plans.flatMap((p) => {
        const c = p.candidates.find((x) => x.id === choice[p.slot.index]);
        return c ? [{ stopIndex: p.slot.index, candidate: c, pick: pickFor(p)(c) }] : [];
      }),
    [plans, choice, pickFor],
  );

  const timeline = useMemo(
    () => (route && ranking && departureUsed ? buildTimeline(route, new Date(departureUsed), chosen) : null),
    [route, ranking, departureUsed, chosen],
  );

  const mapStops = plans.map((p) => {
    const sel = p.candidates.find((c) => c.id === choice[p.slot.index]) ?? null;
    const altIds = [p.main?.candidateId, ...p.alternatives.map((a) => a.candidateId)];
    return {
      slot: p.slot,
      chosen: sel,
      alternatives: p.candidates.filter((c) => c.id !== sel?.id && altIds.includes(c.id)),
    };
  });

  const gmaps = route ? googleMapsUrl(route.from, route.to, [...chosen].sort((a, b) => a.candidate.routeTimeS - b.candidate.routeTimeS).map((c) => c.candidate)) : null;

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:flex-row">
      <aside className="flex w-full flex-col border-slate-200 bg-slate-50 lg:w-[440px] lg:flex-none lg:overflow-y-auto lg:border-r">
        <header className="px-5 pb-3 pt-5">
          <h1 className="text-2xl font-bold tracking-tight">
            Po drodze <span className="text-blue-600">→</span>
          </h1>
          <p className="text-sm text-slate-600">Ciekawe postoje mniej więcej co kilka godzin jazdy.</p>
        </header>

        <section className="px-5 pb-5">
          <PlanForm value={form} onChange={setForm} onSubmit={run} busy={busy} />
          {STATIC_MODE && (
            <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                🤖 Ranking AI (Claude) {claudeKey ? <span className="text-emerald-700">– włączony</span> : <span className="text-slate-500">– opcjonalnie</span>}
              </summary>
              <p className="mt-2 text-xs text-slate-600">
                Bez klucza postoje wybiera prosty algorytm. Z kluczem Claude API wybór i opisy „dlaczego warto” robi AI.
                Klucz jest zapisywany tylko w tej przeglądarce i wysyłany wyłącznie do api.anthropic.com. Używaj go tylko na
                własnym urządzeniu.
              </p>
              <input
                type="password"
                autoComplete="off"
                className="input mt-2 font-mono"
                placeholder="sk-ant-…"
                value={claudeKey}
                onChange={(e) => saveClaudeKey(e.target.value.trim())}
              />
            </details>
          )}
        </section>

        {steps.length > 0 && (
          <section className="mx-5 mb-4 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm" aria-live="polite">
            {steps.map((s, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-4 flex-none text-center">
                  {s.status === "done" ? "✓" : s.status === "active" ? <span className="spinner" /> : s.status === "warn" ? "⚠" : s.status === "error" ? "✕" : "·"}
                </span>
                <span className={s.status === "error" ? "text-red-700" : s.status === "pending" ? "text-slate-400" : ""}>
                  <span className="font-medium">{s.label}</span>
                  {s.detail && <span className="text-slate-500"> – {s.detail}</span>}
                </span>
              </div>
            ))}
          </section>
        )}

        {error && (
          <div role="alert" className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <div className="font-semibold">Nie udało się zaplanować trasy</div>
            {error}
            <button className="mt-2 block font-medium underline" onClick={run}>
              Spróbuj ponownie
            </button>
          </div>
        )}

        {route && timeline && (
          <section className="mx-5 mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold">{Math.round(route.distanceM / 1000)} km</div>
                <div className="text-xs text-slate-500">dystans</div>
              </div>
              <div>
                <div className="text-lg font-bold">{fmtDuration(route.durationS / 60)}</div>
                <div className="text-xs text-slate-500">sama jazda</div>
              </div>
              <div>
                <div className="text-lg font-bold">{hhmm(timeline.arrival)}</div>
                <div className="text-xs text-slate-500">przyjazd (+{fmtDuration(timeline.totalStopMin)})</div>
              </div>
            </div>
            <Timeline events={timeline.events} />
            {gmaps && (
              <a
                href={gmaps}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg bg-emerald-600 py-2 text-center font-semibold text-white hover:bg-emerald-700"
              >
                Otwórz w Google Maps ↗
              </a>
            )}
            {ranking?.note && <p className="text-xs text-amber-700">ℹ {ranking.note}</p>}
          </section>
        )}

        <section className="space-y-4 px-5 pb-8">
          {ranking &&
            plans.map((p) => {
              const ev = timeline?.events.find((e) => e.kind === "stop" && e.stopIndex === p.slot.index);
              return (
                <StopCard
                  key={p.slot.index}
                  plan={p}
                  chosenId={choice[p.slot.index] ?? null}
                  pickFor={pickFor(p)}
                  arrive={ev?.kind === "stop" ? ev.arrive : undefined}
                  leave={ev?.kind === "stop" ? ev.leave : undefined}
                  onChoose={(id) => setChoice((c) => ({ ...c, [p.slot.index]: id }))}
                  onVisitChange={(cid, m) => setVisitOverride((v) => ({ ...v, [cid]: m }))}
                />
              );
            })}
        </section>

        <footer className="mt-auto px-5 pb-4 text-[11px] text-slate-400">
          Dane: © OpenStreetMap, Wikipedia, OpenRouteService/OSRM. Czasy są szacunkowe.
        </footer>
      </aside>

      <main className="order-first h-[45vh] flex-none lg:order-none lg:h-screen lg:flex-1">
        <MapView
          route={route}
          stops={mapStops}
          onChoose={(stopIndex, id) => setChoice((c) => ({ ...c, [stopIndex]: id }))}
        />
      </main>
    </div>
  );
}
