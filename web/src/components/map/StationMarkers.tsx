import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect } from "react";
import { Marker } from "react-map-gl/maplibre";
import { duration, ease } from "../../lib/motion";
import { ago } from "../../lib/session";
import { compass, windColor, type LiveReading } from "../../lib/wind";
import { WindArrow } from "../bits";

/** A reading older than this reads as stale: NOAA PORTS reports every 6 min, airports about hourly. */
const staleAfter = (r: LiveReading) => (r.source === "airport" ? 90 : 30) * 60_000;

type Props = {
  readings: LiveReading[];
  /** Ids hidden because a spot marker (or a busier station) covers them. They stay in the DOM and keyboard order. */
  hidden: ReadonlySet<string>;
  /** "t:<id>" for stations outside the open map: out of the Tab order (see map/declutter useOffBand). */
  offBand: ReadonlySet<string>;
  open: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
  dim: boolean;
};

/**
 * Every live sensor as a small chip: the reading in knots and an arrow, no name (tap for name, gust and age).
 * Exactly one MapLibre Marker per reading; each button is named `${name}: ${n} knots from ${compass}, …`.
 */
export const StationMarkers = memo(function StationMarkers({ readings, hidden, offBand, open, onToggle, onClose, dim }: Props) {
  // Escape closes the open card, and only the card: capture phase + stopPropagation, so the spot view stays.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  return (
    <>
      {readings.map((r) => (
        <StationMarker key={r.id} r={r} open={open === r.id} hidden={hidden.has(r.id) && open !== r.id} dim={dim}
          offscreen={offBand.has(`t:${r.id}`) && open !== r.id} onToggle={onToggle} />
      ))}
    </>
  );
});

const StationMarker = memo(function StationMarker({ r, open, hidden, dim, offscreen, onToggle }: {
  r: LiveReading; open: boolean; hidden: boolean; dim: boolean; offscreen: boolean; onToggle: (id: string) => void;
}) {
  const n = Math.round(r.speed);
  const stale = Date.now() - r.t > staleAfter(r);
  const label = `${r.name}: ${n} knots from ${compass(r.dir)}${r.gust != null ? `, gusting ${Math.round(r.gust)}` : ""}, ${ago(r.t)}`;
  return (
    // No z-index: under the cross-hair and the spot markers. The open card lifts over everything but the controls.
    <Marker longitude={r.lon} latitude={r.lat} anchor="center" className={clsx(open && "z-[7]", dim && "pointer-events-none")}
      onClick={(e) => { e.originalEvent.stopPropagation(); onToggle(r.id); }}>
      <button type="button" aria-label={label} aria-expanded={open} tabIndex={dim || offscreen ? -1 : undefined}
        data-station={r.id} data-hidden={hidden || undefined}
        className={clsx(
          "group relative block cursor-pointer outline-none transition-opacity duration-(--dur-base) ease-ui starting:opacity-0 motion-reduce:transition-none",
          // Touch: a bigger invisible hit area; spot markers sit above it, so it never steals their taps.
          "before:absolute before:-inset-x-1.5 before:-inset-y-2.5 before:content-['']",
          hidden ? "pointer-events-none opacity-0 focus-visible:opacity-100" : dim ? "opacity-30" : stale && !open ? "opacity-60" : "opacity-100",
        )}>
        <span data-station-chip className={clsx(
          "flex h-5 items-center gap-0.5 rounded-full bg-ink/85 pl-1 pr-1.5 ring-1 outline-2 outline-offset-2 outline-transparent",
          "transition-[scale] duration-(--dur-fast) ease-ui group-hover:scale-110 group-focus-visible:outline-accent motion-reduce:transition-none",
          open ? "ring-accent" : "ring-line-strong",
        )}>
          <span style={{ color: windColor(r.speed) }} className="grid size-3 place-items-center">
            {r.speed > 0.5 ? <WindArrow dir={r.dir} size={11} /> : <span className="block size-1.5 rounded-full bg-current" />}
          </span>
          <span className="num text-micro font-semibold leading-none text-fg-2">{n}</span>
        </span>
        <AnimatePresence>
          {open && (
            <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4, transition: { duration: duration.fast } }}
              transition={{ duration: duration.base, ease }}
              className="glass absolute bottom-full left-1/2 mb-2 flex w-max max-w-[15rem] -translate-x-1/2 flex-col rounded-md px-3 py-2 text-left">
              <span className="text-label font-semibold leading-5 text-fg">{r.name}</span>
              <span className="num text-caption text-fg-2">
                <span className="font-semibold text-fg">{n} kn</span>{r.gust != null ? ` · gust ${Math.round(r.gust)}` : ""} · {compass(r.dir)}
              </span>
              <span className="text-micro text-fg-3">{r.source === "airport" ? "Airport · hourly" : "NOAA PORTS · every 6 min"} · {ago(r.t)}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </Marker>
  );
});
