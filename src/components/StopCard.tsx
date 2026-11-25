"use client";

import { CATEGORY_ICON, fmtDuration, hhmm } from "@/lib/timeline";
import { CATEGORY_LABEL, type Candidate, type Pick, type StopPlan } from "@/lib/types";

function Meta({ c }: { c: Candidate }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
      <span>{CATEGORY_LABEL[c.category]}</span>
      <span>· {c.distKm < 0.3 ? "przy trasie" : `${c.distKm} km od trasy`}</span>
      <span>· +{c.detourMin} min jazdy</span>
      {c.side === "left" && <span className="text-red-600">· po drugiej stronie jezdni</span>}
    </div>
  );
}

function Links({ c }: { c: Candidate }) {
  return (
    <div className="flex gap-3 text-xs">
      {c.wikiUrl && (
        <a className="link" href={c.wikiUrl} target="_blank" rel="noreferrer">
          Wikipedia
        </a>
      )}
      {c.osmUrl && (
        <a className="link" href={c.osmUrl} target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      )}
      <a
        className="link"
        href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`}
        target="_blank"
        rel="noreferrer"
      >
        Google Maps
      </a>
    </div>
  );
}

export default function StopCard({
  plan,
  chosenId,
  pickFor,
  arrive,
  leave,
  onChoose,
  onVisitChange,
}: {
  plan: StopPlan;
  chosenId: string | null;
  pickFor: (c: Candidate) => Pick;
  arrive?: Date;
  leave?: Date;
  onChoose: (candidateId: string | null) => void;
  onVisitChange: (candidateId: string, minutes: number) => void;
}) {
  const { slot, candidates } = plan;
  const chosen = candidates.find((c) => c.id === chosenId) ?? null;
  const altIds = plan.alternatives.map((a) => a.candidateId);
  const shortlist = [plan.main?.candidateId, ...altIds]
    .filter((id): id is string => !!id && id !== chosenId)
    .map((id) => candidates.find((c) => c.id === id)!)
    .filter(Boolean);
  const others = candidates.filter((c) => c.id !== chosenId && !shortlist.includes(c));
  const pick = chosen ? pickFor(chosen) : null;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
        <h3 className="font-semibold">
          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
            {slot.index + 1}
          </span>
          Postój po ok. {fmtDuration(slot.targetTimeS / 60)} jazdy
        </h3>
        {arrive && leave && (
          <span className="whitespace-nowrap text-sm font-medium text-slate-700">
            {hhmm(arrive)}–{hhmm(leave)}
          </span>
        )}
      </header>

      {candidates.length === 0 && (
        <p className="p-4 text-sm text-slate-500">
          Brak ciekawych miejsc w tym rejonie. Spróbuj zwiększyć maksymalne zboczenie z trasy.
        </p>
      )}

      {chosen && pick && (
        <div className="space-y-2 p-4">
          <div className="flex gap-3">
            {chosen.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={chosen.imageUrl}
                alt=""
                className="h-20 w-24 flex-none rounded-lg object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-20 w-24 flex-none items-center justify-center rounded-lg bg-slate-100 text-3xl">
                {CATEGORY_ICON[chosen.category]}
              </div>
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold leading-tight">{chosen.name}</h4>
                {chosen.id === plan.main?.candidateId && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                    polecane
                  </span>
                )}
              </div>
              <Meta c={chosen} />
              {chosen.facts && chosen.facts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {chosen.facts.map((f) => (
                    <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">Dlaczego warto: </span>
            {pick.why}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Czas postoju
              <select
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm"
                value={pick.visitMin}
                onChange={(e) => onVisitChange(chosen.id, Number(e.target.value))}
              >
                {[...new Set([10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, pick.visitMin])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {fmtDuration(m)}
                    </option>
                  ))}
              </select>
            </label>
            <Links c={chosen} />
          </div>
        </div>
      )}

      {!chosen && candidates.length > 0 && (
        <p className="px-4 pt-3 text-sm text-slate-500">Postój pominięty – wybierz miejsce poniżej, aby go przywrócić.</p>
      )}

      {shortlist.length > 0 && (
        <div className="space-y-1.5 border-t border-slate-100 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {chosenId === plan.main?.candidateId ? "Alternatywy" : "Propozycje"}
          </div>
          {shortlist.map((c) => (
            <button
              key={c.id}
              onClick={() => onChoose(c.id)}
              className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-blue-50"
            >
              <span className="text-xl leading-none">{CATEGORY_ICON[c.category]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{c.name}</span>
                <Meta c={c} />
                <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">{pickFor(c).why}</span>
              </span>
              <span className="text-xs font-medium text-blue-600">Wybierz</span>
            </button>
          ))}
        </div>
      )}

      <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-xs">
        {others.length > 0 ? (
          <details className="flex-1">
            <summary className="cursor-pointer text-slate-600">Pozostali kandydaci ({others.length})</summary>
            <ul className="mt-2 space-y-1">
              {others.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {CATEGORY_ICON[c.category]} {c.name}{" "}
                    <span className="text-slate-400">
                      ({c.distKm} km, +{c.detourMin} min)
                    </span>
                  </span>
                  <button className="link flex-none" onClick={() => onChoose(c.id)}>
                    Wybierz
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span />
        )}
        {chosen && (
          <button className="flex-none text-slate-500 hover:text-red-600" onClick={() => onChoose(null)}>
            Pomiń postój
          </button>
        )}
      </footer>
    </article>
  );
}
