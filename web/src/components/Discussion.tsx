import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Compass, ExternalLink, Feather, Gauge, Layers, Minus, Rss, Tornado, Triangle, TrendingDown, TrendingUp, X, Zap, CloudLightning, Wind } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ComponentType, type PointerEvent as RPointerEvent } from "react";
import { useDiscussion, useDiscussionIndex } from "../lib/data";
import { SOURCE_LABEL, fmtDay, type Discussion, type Kind, type Trend } from "../lib/discussion";
import { Skeleton } from "./bits";

type Icon = ComponentType<{ className?: string }>;

const KIND: Record<Kind, { label: string; Icon: Icon; tint: string }> = {
  front: { label: "Front", Icon: Triangle, tint: "text-sky-300" },
  pressure: { label: "Pressure", Icon: Gauge, tint: "text-violet-300" },
  tropical: { label: "Tropical", Icon: Tornado, tint: "text-rose-300" },
  storms: { label: "Storms", Icon: CloudLightning, tint: "text-amber-300" },
  "sea-breeze": { label: "Sea breeze", Icon: Wind, tint: "text-emerald-300" },
  "upper-level": { label: "Upper level", Icon: Layers, tint: "text-cyan-300" },
  other: { label: "Other", Icon: Compass, tint: "text-white/60" },
};

const TREND: Record<Trend, { label: string; Icon: Icon; tint: string }> = {
  building: { label: "Building", Icon: TrendingUp, tint: "text-emerald-300" },
  steady: { label: "Steady", Icon: Minus, tint: "text-cyan-300" },
  easing: { label: "Easing", Icon: TrendingDown, tint: "text-white/55" },
  light: { label: "Light", Icon: Feather, tint: "text-white/45" },
  unsettled: { label: "Unsettled", Icon: Zap, tint: "text-amber-300" },
};

const issued = (iso: string) => new Intl.DateTimeFormat([], { weekday: "short", hour: "numeric", minute: "2-digit" }).format(Date.parse(iso));

/** What today's discussion says, in a card at the top of the spot list. The full text opens in a dialog. */
export function DiscussionCard({ onOpen }: { onOpen: (date: string) => void }) {
  const q = useDiscussion();
  const d = q.data?.discussion;
  return (
    <section aria-label="Wind discussion" className="rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-400/[.08] via-white/[.03] to-violet-500/[.07] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Compass className="h-4 w-4 text-cyan-300" />
        <h2 className="text-sm font-semibold">Wind discussion</h2>
        <span className="ml-auto text-[10px] text-white/40">{d ? fmtDay(d.date, { weekday: "short", month: "short", day: "numeric" }) : "Daily · AI"}</span>
      </div>
      {d ? <Summary d={d} onOpen={() => onOpen(d.date)} />
        : q.isError ? <p className="text-xs text-white/50" data-testid="discussion-empty">Couldn't load today's discussion. Try again shortly.</p>
        : q.data ? (
          <p className="text-xs leading-snug text-white/55" data-testid="discussion-empty">
            {q.data.configured
              ? `Today's discussion publishes around ${q.data.publishHour}:00 ${q.data.timeZone === "America/New_York" ? "ET" : q.data.timeZone}. It reads the National Weather Service's discussions and explains what's steering the wind.`
              : "The daily wind discussion isn't switched on for this server yet."}
          </p>
        ) : <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-8/12" /><Skeleton className="h-10" /></div>}
    </section>
  );
}

function Summary({ d, onOpen }: { d: Discussion; onOpen: () => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* The summary itself opens the dialog too, so it's tappable from the sheet's low resting position on phones. */}
      <button onClick={onOpen} aria-label="Read the full wind discussion" className="-m-1 rounded-xl p-1 text-left">
        <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200 ring-1 ring-cyan-300/20">{d.regime}</span>
        <span className="mt-1.5 block text-[13px] font-medium leading-snug text-white/90" data-testid="discussion-headline">{d.headline}</span>
        <span className="mt-1 line-clamp-3 block text-xs leading-snug text-white/60">{d.bottomLine}</span>
      </button>
      <DayStrip d={d} compact />
      <button onClick={onOpen} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-white/[.06] px-3 text-xs font-medium text-white/85 ring-1 ring-white/10 transition hover:bg-white/10">
        Read the full discussion <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DayStrip({ d, compact }: { d: Discussion; compact?: boolean }) {
  return (
    <ul className="grid gap-1" style={{ gridTemplateColumns: `repeat(${d.days.length}, minmax(0, 1fr))` }} aria-label="Day by day">
      {d.days.map((day) => {
        const t = TREND[day.windTrend] ?? TREND.steady;
        return (
          <li key={day.date} title={`${fmtDay(day.date, { weekday: "long" })}: ${t.label}${day.flow ? `, ${day.flow}` : ""}`}
            className={`flex flex-col items-center gap-0.5 rounded-lg bg-black/15 py-1.5 ${compact ? "" : "py-2"}`}>
            <span className="text-[10px] font-semibold text-white/70">{day.label}</span>
            <t.Icon className={`h-3.5 w-3.5 ${t.tint}`} />
            <span className="num text-[9px] text-white/45">{day.flow || "var"}</span>
            <span className="sr-only">{t.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- the full discussion ---------------- */

const W_KEY = "discussion-width", W_MIN = 480, W_DEFAULT = 720;
const clampW = (w: number) => Math.round(Math.min(Math.max(w, W_MIN), Math.max(W_MIN, window.innerWidth - 48)));

/** Dialog width on desktop: drag either edge (or use arrow keys on it) to widen; remembered per device. */
function useDialogWidth() {
  const [w, setW] = useState(() => {
    try { const v = Number(localStorage.getItem(W_KEY)); return v ? clampW(v) : W_DEFAULT; } catch { return W_DEFAULT; }
  });
  const set = (v: number, save = false) => {
    const c = clampW(v);
    setW(c);
    if (save) try { localStorage.setItem(W_KEY, String(c)); } catch { /* private mode: fine */ }
  };
  return [w, set] as const;
}

/** A thin grab bar on one edge. The dialog is centred, so dragging an edge by d changes the width by 2d. */
function ResizeEdge({ side, width, onWidth }: { side: "left" | "right"; width: number; onWidth: (w: number, save?: boolean) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const sign = side === "right" ? 1 : -1;
  const move = (e: RPointerEvent) => drag.current && onWidth(drag.current.w + sign * (e.clientX - drag.current.x) * 2);
  const end = (e: RPointerEvent) => { if (drag.current) { onWidth(drag.current.w + sign * (e.clientX - drag.current.x) * 2, true); drag.current = null; } };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={`Resize discussion (${side} edge)`} aria-valuenow={width} aria-valuemin={W_MIN} tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: width }; }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => onWidth(W_DEFAULT, true)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onWidth(width + (e.key === "ArrowRight" ? 1 : -1) * sign * 40, true); }
      }}
      className={`group absolute inset-y-0 z-10 hidden w-3 cursor-ew-resize touch-none md:block ${side === "right" ? "-right-1.5" : "-left-1.5"}`}>
      <span className="absolute inset-y-6 left-1/2 w-1 -translate-x-1/2 rounded-full bg-white/0 transition group-hover:bg-white/25 group-focus-visible:bg-cyan-300/60 group-active:bg-cyan-300/60" />
    </div>
  );
}

export function DiscussionDialog({ date, onDate, onClose }: { date: string | null; onDate: (d: string) => void; onClose: () => void }) {
  const q = useDiscussion(date);
  const index = useDiscussionIndex(date != null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const d = q.data?.discussion;
  const [width, setWidth] = useDialogWidth();

  useEffect(() => {
    if (date == null) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [date, onClose]);

  const dates = (index.data?.items ?? []).map((i) => i.date); // newest first
  const at = d ? dates.indexOf(d.date) : -1;
  const newer = at > 0 ? dates[at - 1] : null, older = at >= 0 && at < dates.length - 1 ? dates[at + 1] : null;

  // Portalled to <body> so it sits above the phone bottom sheet, which is itself portalled there.
  return createPortal(
    <AnimatePresence>
      {date != null && (
        <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm md:items-center md:p-6" onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="discussion-title"
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}
            onClick={(e) => e.stopPropagation()} style={{ "--dw": `${width}px` } as React.CSSProperties}
            className="glass safe-b relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl md:w-[var(--dw)] md:max-w-[calc(100vw-3rem)] md:rounded-3xl">
            <ResizeEdge side="left" width={width} onWidth={setWidth} />
            <ResizeEdge side="right" width={width} onWidth={setWidth} />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <Compass className="hidden h-4 w-4 shrink-0 text-cyan-300 sm:block" />
              <h2 id="discussion-title" className="min-w-0 flex-1 truncate text-sm font-semibold">Wind discussion</h2>
              <div className="flex shrink-0 items-center gap-1">
                <button aria-label="Older discussion" disabled={!older} onClick={() => older && onDate(older)} className="grid h-11 w-9 place-items-center rounded-lg text-white/70 disabled:opacity-25"><ChevronLeft className="h-4 w-4" /></button>
                {dates.length > 0 ? (
                  <select aria-label="Discussion date" value={d?.date ?? date} onChange={(e) => onDate(e.target.value)}
                    className="h-9 max-w-[7.25rem] rounded-lg bg-white/[.07] px-2 text-xs text-white/85 outline-none ring-1 ring-white/10">
                    {dates.map((x) => <option key={x} value={x} className="bg-slate-900">{fmtDay(x, { weekday: "short", month: "short", day: "numeric" })}</option>)}
                  </select>
                ) : <span className="px-1 text-xs text-white/50">{fmtDay(date, { weekday: "short", month: "short", day: "numeric" })}</span>}
                <button aria-label="Newer discussion" disabled={!newer} onClick={() => newer && onDate(newer)} className="grid h-11 w-9 place-items-center rounded-lg text-white/70 disabled:opacity-25"><ChevronRight className="h-4 w-4" /></button>
                <button ref={closeRef} aria-label="Close" onClick={onClose} className="ml-1 grid h-11 w-11 place-items-center rounded-lg text-white/70 hover:bg-white/10"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4 no-scrollbar">
              {d ? <Full d={d} />
                : q.isError ? <p className="py-8 text-center text-sm text-white/55">Couldn't load this discussion.</p>
                : q.data ? <p className="py-8 text-center text-sm text-white/55" data-testid="discussion-missing">No discussion was published for {fmtDay(date, { weekday: "long", month: "long", day: "numeric" })}.</p>
                : <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-6 w-3/4" /><Skeleton className="h-20" /><Skeleton className="h-32" /></div>}
            </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Full({ d }: { d: Discussion }) {
  const byId = new Map(d.sources.map((s) => [s.id, s]));
  return (
    <article className="flex flex-col gap-5">
      <header>
        <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200 ring-1 ring-cyan-300/20">{d.regime}</span>
        <h3 className="mt-2 text-lg font-semibold leading-snug tracking-tight">{d.headline}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-white/75">{d.bottomLine}</p>
        <p className="mt-2 text-[11px] text-white/40">{d.region} · written {issued(d.generatedAt)}</p>
      </header>

      <section aria-label="What's driving the wind" className="flex flex-col gap-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/45">What's driving the wind</h4>
        {d.drivers.map((x, i) => {
          const k = KIND[x.kind] ?? KIND.other;
          return (
            <div key={i} className="rounded-2xl border border-white/[.07] bg-white/[.035] p-3.5" data-testid="discussion-driver">
              <div className="flex items-center gap-2">
                <k.Icon className={`h-4 w-4 shrink-0 ${k.tint}`} />
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${k.tint}`}>{k.label}</span>
                <span className="ml-auto text-[11px] text-white/45">{x.timing}</span>
              </div>
              <h5 className="mt-1.5 text-sm font-semibold">{x.title}</h5>
              <p className="mt-1 text-xs leading-relaxed text-white/65">{x.detail}</p>
              <p className="mt-2 rounded-lg bg-black/20 px-2.5 py-1.5 text-xs leading-snug text-white/80"><b className="font-semibold text-cyan-200">On the water: </b>{x.windImpact}</p>
              <p className="mt-2 flex flex-wrap gap-1 text-[10px] text-white/40">
                From
                {x.sources.map((id) => <span key={id} className="rounded-full bg-white/[.06] px-1.5 py-0.5">{SOURCE_LABEL[id] ?? byId.get(id)?.name ?? id}</span>)}
              </p>
            </div>
          );
        })}
      </section>

      <section aria-label="Day by day" className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/45">Day by day</h4>
        <DayStrip d={d} />
        <ul className="flex flex-col divide-y divide-white/[.06] rounded-2xl border border-white/[.07] bg-white/[.03]">
          {d.days.map((day) => {
            const t = TREND[day.windTrend] ?? TREND.steady;
            return (
              <li key={day.date} className="flex gap-3 px-3.5 py-3" data-testid="discussion-day">
                <div className="w-12 shrink-0">
                  <div className="text-xs font-semibold">{day.label}</div>
                  <div className={`mt-0.5 flex items-center gap-1 text-[10px] ${t.tint}`}><t.Icon className="h-3 w-3" />{t.label}</div>
                </div>
                <div className="min-w-0 text-xs leading-relaxed">
                  <p className="text-white/70">{day.pattern}</p>
                  <p className="mt-0.5 text-white/90">{day.kiterTakeaway}</p>
                  <p className="mt-1 text-[10px] text-white/40">{day.flow ? `Flow from ${day.flow} · ` : ""}{day.confidence} confidence</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {d.watch.length > 0 && (
        <section aria-label="What to watch" className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/45">What to watch</h4>
          <ul className="flex flex-col gap-1.5 text-xs leading-snug">
            {d.watch.map((w, i) => <li key={i} className="rounded-xl bg-white/[.04] px-3 py-2"><span className="text-white/85">{w.what}</span><span className="text-white/45"> · {w.when}</span></li>)}
          </ul>
        </section>
      )}

      <section aria-label="Uncertainty" className="rounded-2xl border border-amber-300/15 bg-amber-300/[.05] p-3.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-200/80">How sure is this</h4>
        <p className="mt-1.5 text-xs leading-relaxed text-white/70">{d.uncertainty}</p>
      </section>

      <footer className="flex flex-col gap-2 text-[11px] leading-snug text-white/45">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/45">Sources</h4>
        <ul className="flex flex-col gap-1">
          {d.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-200/80 underline-offset-2 hover:underline">
                {s.name}<ExternalLink className="h-3 w-3" />
              </a>
              <span> · issued {issued(s.issued)}</span>
            </li>
          ))}
        </ul>
        {d.missing.length > 0 && <p>Not available today: {d.missing.map((id) => SOURCE_LABEL[id] ?? id).join(", ")}.</p>}
        <p>Written by AI ({d.model}) from the National Weather Service products above. It explains the pattern and isn't a forecast; check live wind before you go.</p>
        <a href="/feed.xml" className="inline-flex w-fit items-center gap-1 text-white/55 underline-offset-2 hover:underline"><Rss className="h-3 w-3" />Subscribe by RSS</a>
      </footer>
    </article>
  );
}
