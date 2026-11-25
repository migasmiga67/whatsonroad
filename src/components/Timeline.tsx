"use client";

import { CATEGORY_ICON, fmtDuration, hhmm, type TimelineEvent } from "@/lib/timeline";

export default function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative ml-3 border-l-2 border-dashed border-slate-300">
      {events.map((e, i) => {
        if (e.kind === "drive")
          return (
            <li key={i} className="py-1.5 pl-5 text-xs text-slate-500">
              🚗 {fmtDuration(e.minutes)} · {e.km} km
            </li>
          );
        const dot =
          e.kind === "stop" ? "bg-blue-600" : e.kind === "start" ? "bg-emerald-600" : "bg-rose-600";
        return (
          <li key={i} className="relative py-1.5 pl-5">
            <span className={`absolute -left-[7px] top-3 h-3 w-3 rounded-full ring-4 ring-white ${dot}`} />
            {e.kind === "stop" ? (
              <div className="text-sm">
                <span className="font-semibold tabular-nums">
                  {hhmm(e.arrive)}–{hhmm(e.leave)}
                </span>{" "}
                {CATEGORY_ICON[e.candidate.category]} {e.candidate.name}
                <span className="text-slate-500"> · {fmtDuration(e.pick.visitMin)}</span>
              </div>
            ) : (
              <div className="text-sm">
                <span className="font-semibold tabular-nums">{hhmm(e.at)}</span>{" "}
                {e.kind === "start" ? "Wyjazd" : "Przyjazd"} – {e.label}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
