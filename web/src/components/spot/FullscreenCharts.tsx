import { motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { duration, ease } from "../../lib/motion";
import type { Confidence } from "../../lib/session";
import { compass, windColor, type Spot } from "../../lib/wind";
import type { Range } from "../ForecastChart";
import { IconButton } from "../ui";
import { ChartHeader, type ChartView } from "./ChartCard";
import { Dotted } from "./Dotted";
import { SpotFacts } from "./SpotHeader";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The charts as a full-screen dialog (portal to body), on opaque ink (nothing to blur behind it). Escape, the close
 * button and the back gesture (it is a history entry, see useSubLayer) close it without leaving the spot; Tab stays
 * inside. Keep the header compact: at 1280×800 the line chart and the bars below it must both fit.
 */
export function FullscreenCharts({ spot, view, setView, range, setRange, shown, when, confidence, onClose, children }: {
  spot: Spot; view: ChartView; setView: (v: ChartView) => void; range: Range; setRange: (r: Range) => void;
  shown: { speed: number; gust: number; dir: number } | null; when: string; confidence: Confidence | null; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Capture phase + stopPropagation, so App's Escape (back to the list) doesn't fire too. Pass a stable onClose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || active === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !ref.current.contains(active))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  // While it covers the screen the map's wind particles needn't run (the shell pauses them on this flag).
  useEffect(() => {
    document.body.dataset.fullscreen = "1";
    return () => { delete document.body.dataset.fullscreen; };
  }, []);

  return createPortal(
    <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${spot.name} wind charts`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.base, ease }}
      className="fixed inset-0 z-[60] flex flex-col bg-ink text-fg outline-none">
      <div className="safe-t flex flex-col gap-2 px-4 pb-2 md:px-8">
        <div className="flex items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate text-title font-semibold tracking-tight md:flex-none md:text-heading">{spot.name}</h2>
          <SpotFacts spot={spot} className="hidden flex-1 md:flex" />
          <IconButton aria-label="Close full-screen chart" variant="tonal" onClick={onClose}><X /></IconButton>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <ChartHeader view={view} setView={setView} range={range} setRange={setRange} confidence={confidence} idSuffix="-x" layout="bar" />
          {shown && (
            <p className="num flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-label text-fg-2">
              <span className="text-headline font-semibold tracking-tight" style={{ color: windColor(shown.speed) }}>{Math.round(shown.speed)}</span>
              <span className="text-caption text-fg-3">kn</span>
              <span className="whitespace-nowrap">gust {Math.round(shown.gust)} · from {compass(shown.dir)}</span>
              <span className="basis-full text-caption text-fg-3 md:basis-auto"><Dotted text={when} /></span>
            </p>
          )}
        </div>
      </div>
      <div className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 overflow-y-auto px-4 pb-6 md:px-8">
        {children}
      </div>
    </motion.div>, document.body);
}
