import { AnimatePresence, motion } from "motion/react";
import { Sparkles, Trophy } from "lucide-react";
import { useState } from "react";
import { useOutlook } from "../lib/data";
import type { Outlook, Verdict } from "../lib/outlook";
import type { Spot } from "../lib/wind";
import { Skeleton } from "./bits";

const VERDICT: Record<Verdict, { label: string; cls: string; dot: string }> = {
  go: { label: "Go", cls: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/30", dot: "bg-emerald-400" },
  maybe: { label: "Maybe", cls: "bg-amber-400/15 text-amber-100 ring-amber-400/30", dot: "bg-amber-300" },
  no: { label: "No", cls: "bg-white/[.05] text-white/50 ring-white/10", dot: "bg-slate-500" },
};
const CONF = { high: 3, medium: 2, low: 1 } as const;

/** Claude's multi-day outlook for your spots, written from HRRR, NBM, ECMWF and GFS. */
export function OutlookCard({ spots }: { spots: Spot[] }) {
  const q = useOutlook(spots);
  if (!spots.length) return null;
  return (
    <section aria-label="Forecaster's outlook" className="rounded-2xl border border-violet-300/15 bg-gradient-to-br from-violet-500/[.10] via-white/[.03] to-cyan-400/[.06] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-300" />
        <h2 className="text-sm font-semibold">Forecaster's outlook</h2>
        <span className="ml-auto text-[10px] text-white/40">
          {q.data ? `Claude · 4 models · ${new Date(q.data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Claude · 4 models"}
        </span>
      </div>
      {q.data ? <Body o={q.data} />
        : q.isError ? <p className="text-xs text-white/50" data-testid="outlook-error">{q.error.message}</p>
        : (
          <div className="flex flex-col gap-2" aria-busy="true">
            <p className="text-xs text-white/50">Reading HRRR, NBM, ECMWF and GFS for your spots…</p>
            <Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-8/12" /><Skeleton className="h-14" />
          </div>
        )}
    </section>
  );
}

function Body({ o }: { o: Outlook }) {
  const [open, setOpen] = useState<string | null>(o.bestBet?.date ?? o.days[0]?.date ?? null);
  const dayFmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat([], { timeZone: "UTC", ...opts }).format(Date.parse(d + "T12:00:00Z"));
  const day = o.days.find((d) => d.date === open);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[13px] leading-snug text-white/90" data-testid="outlook-headline">{o.headline}</p>
      {o.bestBet && (
        <button onClick={() => setOpen(o.bestBet!.date)}
          className="flex items-start gap-2 rounded-xl bg-emerald-400/10 px-2.5 py-2 text-left ring-1 ring-emerald-400/25">
          <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
          <span className="text-xs leading-snug">
            <b className="font-semibold text-emerald-200">Best bet: {dayFmt(o.bestBet.date, { weekday: "short" })} · {o.bestBet.spot}{o.bestBet.window ? ` · ${o.bestBet.window}` : ""}</b>
            <span className="text-white/60"> — {o.bestBet.why}</span>
          </span>
        </button>
      )}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${o.days.length}, minmax(0, 1fr))` }} role="tablist" aria-label="Days">
        {o.days.map((d) => (
          <button key={d.date} role="tab" aria-selected={open === d.date} onClick={() => setOpen(open === d.date ? null : d.date)}
            className={`flex min-h-11 flex-col items-center gap-1 rounded-xl py-1.5 ring-1 transition ${VERDICT[d.rating].cls} ${open === d.date ? "!ring-2 !ring-white/60" : ""}`}>
            <span className="text-[11px] font-semibold">{dayFmt(d.date, { weekday: "short" })}</span>
            <span className="flex items-center gap-0.5" aria-label={`${d.confidence} confidence`} title={`${d.confidence} confidence`}>
              {[1, 2, 3].map((i) => <i key={i} className={`h-1 w-2 rounded-full ${i <= CONF[d.confidence] ? VERDICT[d.rating].dot : "bg-white/15"}`} />)}
            </span>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false} mode="wait">
        {day && (
          <motion.div key={day.date} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className="flex flex-col gap-1.5" data-testid="outlook-day">
            <p className="text-xs leading-snug text-white/75"><b className="font-semibold text-white">{dayFmt(day.date, { weekday: "long", month: "short", day: "numeric" })}:</b> {day.summary}</p>
            {day.spots.map((s) => (
              <div key={s.name} className="flex items-start gap-2 rounded-lg bg-black/15 px-2 py-1.5 text-xs">
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${VERDICT[s.verdict].cls}`}>{VERDICT[s.verdict].label}</span>
                <span className="min-w-0 leading-snug">
                  <b className="font-semibold">{s.name}</b>
                  <span className="num text-white/70"> · {s.wind}{s.window ? ` · ${s.window}` : ""}</span>
                  {s.note && <span className="block text-white/50">{s.note}</span>}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <p className="text-[10px] leading-snug text-white/30">Written by AI from forecast models, not observed conditions. Check live wind before you go.</p>
    </div>
  );
}
