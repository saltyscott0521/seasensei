import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Compass, Eye, ExternalLink, Rss, ShieldQuestion, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useDiscussion, useDiscussionIndex } from "../lib/data";
import { SOURCE_LABEL, fmtDay, type Discussion } from "../lib/discussion";
import { duration, ease, spring } from "../lib/motion";
import { Skeleton } from "./bits";
import { Chip, ConfidenceDots, IconButton } from "./ui";
import { KIND, TREND } from "./home/discussionBits";

export { DiscussionCard } from "./home/DiscussionCard";

const issued = (iso: string) => new Intl.DateTimeFormat([], { weekday: "short", hour: "numeric", minute: "2-digit" }).format(Date.parse(iso));
const CONF = { high: "high", medium: "mid", low: "low" } as const;

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
      className={clsx("group absolute inset-y-0 z-10 hidden w-3 cursor-ew-resize touch-none rounded-full md:block", side === "right" ? "-right-1.5" : "-left-1.5")}>
      <span className="absolute inset-y-10 left-1/2 w-1 -translate-x-1/2 rounded-full bg-transparent transition-colors duration-(--dur-fast) group-hover:bg-line-strong group-focus-visible:bg-accent/70 group-active:bg-accent/70" />
    </div>
  );
}

const FOCUSABLE = "a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function DiscussionDialog({ date, onDate, onClose }: { date: string | null; onDate: (d: string) => void; onClose: () => void }) {
  const q = useDiscussion(date);
  const index = useDiscussionIndex(date != null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const d = q.data?.discussion;
  const [width, setWidth] = useDialogWidth();
  const open = date != null;
  // The latest onClose without re-running the effect below: App passes a new arrow on every render, and re-running
  // it would pull focus back to Close whenever the app re-renders.
  const closeFn = useRef(onClose);
  closeFn.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    // The article takes focus (it is there while the text loads), so arrows, Page Down and Space read it from the top,
    // and Space can't close the dialog by landing on Close.
    (scrollRef.current ?? closeRef.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // Capture phase + stopPropagation: Escape closes the dialog only, not the panel view under it.
      if (e.key === "Escape") { e.stopPropagation(); closeFn.current(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      // Keep Tab inside the dialog.
      const els = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1], cur = document.activeElement;
      if (!dialogRef.current.contains(cur)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true }); // back to what opened it
    };
  }, [open]);

  // Another day starts at the top.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [date]);

  const dates = (index.data?.items ?? []).map((i) => i.date); // newest first
  const at = d ? dates.indexOf(d.date) : -1;
  const newer = at > 0 ? dates[at - 1] : null, older = at >= 0 && at < dates.length - 1 ? dates[at + 1] : null;

  // Portalled to <body> so it sits above the phone bottom sheet, which is itself portalled there.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.base, ease }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/75 md:items-center md:p-6" onClick={onClose}>
          <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="discussion-title"
            initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0, transition: { duration: duration.fast, ease } }} transition={spring}
            onClick={(e) => e.stopPropagation()} style={{ "--dw": `${width}px` } as CSSProperties}
            className="relative flex max-h-[92dvh] w-full flex-col rounded-t-sheet border border-b-0 border-line-strong bg-ink shadow-float md:w-[var(--dw)] md:max-w-[calc(100vw-3rem)] md:rounded-xl md:border-b">
            <ResizeEdge side="left" width={width} onWidth={setWidth} />
            <ResizeEdge side="right" width={width} onWidth={setWidth} />
            <div className="safe-b flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit] bg-surface-2">
              <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2 md:pl-5">
                <Compass aria-hidden className="hidden size-4 shrink-0 text-fg-3 sm:block" strokeWidth={2.25} />
                {/* Under 380 px the date controls need the row: the title stays for screen readers (it names the dialog
                    and its article), never shown cut to "Wind di…" */}
                <h2 id="discussion-title" className="min-w-0 flex-1 truncate text-label font-semibold text-fg max-[380px]:sr-only">Wind discussion</h2>
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  {/* aria-disabled, not disabled: at the end of the archive the pressed button keeps focus (a disabled one drops it to <body>) */}
                  <IconButton size="sm" aria-label="Older discussion" aria-disabled={!older} onClick={() => older && onDate(older)}><ChevronLeft /></IconButton>
                  {dates.length > 0 ? (
                    <select aria-label="Discussion date" value={d?.date ?? date} onChange={(e) => onDate(e.target.value)}
                      className="num h-9 max-w-[7.5rem] cursor-pointer appearance-none rounded-full bg-surface-2 px-3 text-center text-caption font-medium text-fg-2 ring-1 ring-inset ring-line transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-fg max-md:h-11">
                      {dates.map((x) => <option key={x} value={x} className="bg-ink text-fg">{fmtDay(x, { weekday: "short", month: "short", day: "numeric" })}</option>)}
                    </select>
                  ) : <span className="px-2 text-caption text-fg-3">{fmtDay(date, { weekday: "short", month: "short", day: "numeric" })}</span>}
                  <IconButton size="sm" aria-label="Newer discussion" aria-disabled={!newer} onClick={() => newer && onDate(newer)}><ChevronRight /></IconButton>
                  <span aria-hidden className="mx-1.5 h-5 w-px bg-line" />
                  <IconButton ref={closeRef} aria-label="Close" onClick={onClose} className="max-md:size-11"><X /></IconButton>
                </div>
              </div>
              <div ref={scrollRef} tabIndex={0} role="region" aria-labelledby="discussion-title"
                className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-5 focus-visible:outline-offset-[-2px] md:px-7 md:pt-7">
                {d ? <Full key={d.date} d={d} />
                  : q.isError ? <p className="py-10 text-center text-body text-fg-2">Couldn't load this discussion.</p>
                  : q.data ? <p className="py-10 text-center text-body text-fg-2" data-testid="discussion-missing">No discussion was published for {fmtDay(date, { weekday: "long", month: "long", day: "numeric" })}.</p>
                  : <FullSkeleton />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** A section title: caption, semibold, sentence case. */
function H({ children, icon }: { children: string; icon?: ReactNode }) {
  return <h4 className="flex items-center gap-1.5 text-caption font-semibold text-fg-2">{icon}{children}</h4>;
}

function Full({ d }: { d: Discussion }) {
  const byId = new Map(d.sources.map((s) => [s.id, s]));
  const odd = d.drivers.length % 2 === 1;
  return (
    <motion.article initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.base, ease }}
      className="@container mx-auto flex max-w-[52rem] flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Chip size="sm">{d.regime}</Chip>
          <span className="text-micro text-fg-3">{fmtDay(d.date, { weekday: "long", month: "long", day: "numeric" })}</span>
        </div>
        <h3 className="text-balance md:max-w-[32ch] text-headline font-semibold tracking-[-0.02em] text-fg">{d.headline}</h3>
        <p className="max-w-[62ch] text-body leading-relaxed text-fg-2 md:text-[16px] md:leading-[26px]">{d.bottomLine}</p>
        <p className="text-micro text-fg-3">{d.region} · written {issued(d.generatedAt)}</p>
      </header>

      <section aria-label="What's driving the wind" className="flex flex-col gap-3">
        <H>What's driving the wind</H>
        <div className="grid gap-3 @min-[34rem]:grid-cols-2">
          {d.drivers.map((x, i) => {
            const k = KIND[x.kind] ?? KIND.other;
            return (
              <div key={i} data-testid="discussion-driver"
                className={clsx("flex flex-col rounded-lg border border-line bg-surface-2 p-4", odd && i === 0 && "@min-[34rem]:col-span-2")}>
                <div className="flex items-center gap-2">
                  <span aria-hidden className={clsx("grid size-6 shrink-0 place-items-center rounded-full bg-surface-3", k.tone)}><k.Icon className="size-3.5" strokeWidth={2.25} /></span>
                  <span className={clsx("text-caption font-semibold", k.tone)}>{k.label}</span>
                  <span className="ml-auto min-w-0 truncate pl-2 text-micro text-fg-3">{x.timing}</span>
                </div>
                <h5 className="mt-3 text-body font-semibold leading-snug text-fg">{x.title}</h5>
                <p className="mt-1.5 max-w-[62ch] text-label leading-relaxed text-fg-2">{x.detail}</p>
                <p className="mt-3 max-w-[62ch] border-l-2 border-line-strong pl-3 text-label leading-relaxed text-fg">
                  <span className="font-semibold">On the water: </span>{x.windImpact}
                </p>
                <p className="mt-auto flex flex-wrap items-center gap-1 pt-3 text-micro text-fg-3">
                  <span className="mr-0.5">From</span>
                  {x.sources.map((id) => <span key={id} className="rounded-full bg-surface-3 px-2 py-0.5 text-fg-2">{SOURCE_LABEL[id] ?? byId.get(id)?.name ?? id}</span>)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Day by day" className="flex flex-col gap-3">
        <H>Day by day</H>
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-2">
          {d.days.map((day) => {
            const t = TREND[day.windTrend] ?? TREND.steady;
            return (
              <li key={day.date} className="flex gap-4 px-4 py-3.5" data-testid="discussion-day">
                <div className="w-[4.75rem] shrink-0">
                  <div className="text-label font-semibold text-fg">{day.label}</div>
                  <div className={clsx("mt-1 flex items-center gap-1 text-micro font-medium", t.tone)}><t.Icon aria-hidden className="size-3.5" strokeWidth={2.25} />{t.label}</div>
                </div>
                <div className="min-w-0 max-w-[62ch] flex-1">
                  <p className="text-label leading-relaxed text-fg">{day.kiterTakeaway}</p>
                  <p className="mt-1 text-label leading-relaxed text-fg-2">{day.pattern}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-fg-3">
                    {day.flow && <span>Flow from {day.flow}</span>}
                    <ConfidenceDots level={CONF[day.confidence] ?? "mid"} label={`${day.confidence[0]?.toUpperCase() ?? ""}${day.confidence.slice(1)} confidence`} showLabel />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {d.watch.length > 0 && (
        <section aria-label="What to watch" className="flex flex-col gap-3">
          <H icon={<Eye aria-hidden className="size-3.5 text-fg-3" strokeWidth={2.25} />}>What to watch</H>
          <ul className="flex flex-col gap-2">
            {d.watch.map((w, i) => (
              <li key={i} className="flex flex-col gap-0.5 rounded-md border border-line bg-surface-2 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="text-label text-fg">{w.what}</span>
                <span className="shrink-0 text-caption text-fg-3">{w.when}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Uncertainty" className="rounded-lg border border-soon/20 bg-soon/[.06] p-4">
        <H icon={<ShieldQuestion aria-hidden className="size-3.5 text-soon" strokeWidth={2.25} />}>How sure is this</H>
        <p className="mt-2 max-w-[62ch] text-label leading-relaxed text-fg-2">{d.uncertainty}</p>
      </section>

      <footer className="flex flex-col gap-3 border-t border-line pt-6 text-caption leading-relaxed text-fg-3">
        <H>Sources</H>
        <ul className="flex flex-col gap-1.5">
          {d.sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-accent underline-offset-2 hover:underline">
                {s.name}<ExternalLink aria-hidden className="size-3 shrink-0" />
              </a>
              <span> · issued {issued(s.issued)}</span>
            </li>
          ))}
        </ul>
        {d.missing.length > 0 && <p>Not available today: {d.missing.map((id) => SOURCE_LABEL[id] ?? id).join(", ")}.</p>}
        <p className="max-w-[62ch]">Written by AI ({d.model}) from the National Weather Service products above. It explains the pattern and isn't a forecast; check live wind before you go.</p>
        <a href="/feed.xml" className="inline-flex w-fit items-center gap-1.5 rounded-sm text-fg-2 underline-offset-2 hover:text-fg hover:underline"><Rss aria-hidden className="size-3.5" />Subscribe by RSS</a>
      </footer>
    </motion.article>
  );
}

/** Same rhythm as the article, so the content doesn't jump when it lands. */
function FullSkeleton() {
  return (
    <div className="mx-auto flex max-w-[52rem] flex-col gap-3" aria-busy="true">
      <Skeleton className="h-5 w-36 rounded-full" />
      <Skeleton className="h-7 w-11/12" />
      <Skeleton className="h-7 w-7/12" />
      <Skeleton className="mt-1 h-16" />
      <Skeleton className="mt-6 h-40 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
