"use client";

import { INTERESTS, type Interest, type PlanRequest } from "@/lib/types";

export const EXAMPLES = [
  { from: "Kraków", to: "Gdańsk" },
  { from: "Warszawa", to: "Zakopane" },
];

export default function PlanForm({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: PlanRequest;
  onChange: (v: PlanRequest) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof PlanRequest>(k: K, v: PlanRequest[K]) => onChange({ ...value, [k]: v });
  const toggle = (i: Interest) =>
    set("interests", value.interests.includes(i) ? value.interests.filter((x) => x !== i) : [...value.interests, i]);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Skąd</span>
            <input
              required
              className="input"
              placeholder="np. Kraków"
              value={value.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Dokąd</span>
            <input
              required
              className="input"
              placeholder="np. Gdańsk"
              value={value.to}
              onChange={(e) => set("to", e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          title="Zamień start i cel"
          aria-label="Zamień start i cel"
          className="mb-1 rounded-lg border border-slate-300 px-2 py-2 text-slate-600 hover:bg-slate-100"
          onClick={() => onChange({ ...value, from: value.to, to: value.from })}
        >
          ⇅
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="text-slate-500">Przykłady:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.from + ex.to}
            type="button"
            className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-slate-200"
            onClick={() => onChange({ ...value, ...ex })}
          >
            {ex.from} → {ex.to}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-600">Wyjazd</span>
        <input
          type="datetime-local"
          className="input"
          value={value.departure}
          onChange={(e) => set("departure", e.target.value)}
          required
        />
      </label>

      <label className="block">
        <span className="flex justify-between text-xs font-medium text-slate-600">
          <span>Postój co</span>
          <span className="text-slate-900">
            {value.intervalHours.toLocaleString("pl-PL")} h jazdy
          </span>
        </span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.5}
          className="w-full accent-blue-600"
          value={value.intervalHours}
          onChange={(e) => set("intervalHours", Number(e.target.value))}
        />
      </label>

      <label className="block">
        <span className="flex justify-between text-xs font-medium text-slate-600">
          <span>Maks. zboczenie z trasy</span>
          <span className="text-slate-900">{value.maxDetourKm} km</span>
        </span>
        <input
          type="range"
          min={2}
          max={25}
          step={1}
          className="w-full accent-blue-600"
          value={value.maxDetourKm}
          onChange={(e) => set("maxDetourKm", Number(e.target.value))}
        />
      </label>

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-slate-600">Zainteresowania</legend>
        <div className="flex flex-wrap gap-1.5">
          {INTERESTS.map((i) => (
            <button
              key={i.id}
              type="button"
              aria-pressed={value.interests.includes(i.id)}
              onClick={() => toggle(i.id)}
              className={`chip ${value.interests.includes(i.id) ? "chip-on" : ""}`}
            >
              {i.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
        <input
          type="checkbox"
          className="mt-0.5 accent-amber-600"
          checked={value.preferMop}
          onChange={(e) => set("preferMop", e.target.checked)}
        />
        <span className="text-sm">
          <span className="font-medium">⛽ Priorytet dla MOP-ów</span>
          <span className="block text-xs text-slate-600">
            Miejsca Obsługi Podróżnych po właściwej stronie drogi będą proponowane jako postój główny.
          </span>
        </span>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Planuję…" : "Zaplanuj postoje"}
      </button>
    </form>
  );
}
