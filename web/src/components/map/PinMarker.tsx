import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Marker, type MarkerDragEvent } from "react-map-gl/maplibre";
import { duration, ease, spring } from "../../lib/motion";

type LatLon = { lat: number; lon: number };

/**
 * The new spot's pin (add mode): an accent map pin whose tip is the launch point, with a ground shadow and a soft
 * pulse. It drops in where you tap, and you can drag it to fine-tune; letting go reports the new point through
 * `onPin`. `drop` changes on every tap, so a new tap replays the drop and a drag doesn't.
 */
export function PinMarker({ pin, drop, onPin }: { pin: LatLon; drop: number; onPin: (p: LatLon) => void }) {
  const [dragging, setDragging] = useState(false);
  const [moved, setMoved] = useState(false);
  const end = (e: MarkerDragEvent) => {
    setDragging(false);
    setMoved(true);
    onPin({ lat: e.lngLat.lat, lon: e.lngLat.lng });
  };
  return (
    <Marker longitude={pin.lon} latitude={pin.lat} anchor="bottom" draggable className="z-[7]"
      onDragStart={() => setDragging(true)} onDragEnd={end}
      onClick={(e) => e.originalEvent.stopPropagation()}>
      <div role="img" aria-label="New spot pin. Drag it to adjust." data-pin
        className={clsx("relative flex cursor-grab flex-col items-center touch-none select-none", dragging && "cursor-grabbing")}>
        {/* Ground shadow and pulse at the exact point (the tip) */}
        <span aria-hidden className={clsx("absolute -bottom-1 h-2 rounded-[50%] bg-ink/70 blur-[2px] transition-[width,opacity] duration-(--dur-fast)", dragging ? "w-3 opacity-50" : "w-5 opacity-90")} />
        {!dragging && <span aria-hidden className="halo absolute -bottom-2 size-4 rounded-full border-2 border-accent" />}
        <motion.div key={drop} initial={{ y: -28, opacity: 0 }} animate={{ y: dragging ? -8 : 0, opacity: 1, scale: dragging ? 1.06 : 1 }} transition={spring}
          className="origin-bottom drop-shadow-[0_6px_10px_rgb(0_0_0/0.55)]">
          <svg width="30" height="40" viewBox="0 0 30 40" aria-hidden>
            <path d="M15 1.25C7.4 1.25 1.25 7.3 1.25 14.85c0 9.6 11.9 22.1 12.85 23.1a1.25 1.25 0 0 0 1.8 0c.95-1 12.85-13.5 12.85-23.1C28.75 7.3 22.6 1.25 15 1.25Z"
              className="fill-accent stroke-ink" strokeWidth="1.5" />
            <circle cx="15" cy="14.5" r="5.25" className="fill-ink" />
            <circle cx="15" cy="14.5" r="2.5" className="fill-fg" />
          </svg>
        </motion.div>
        <AnimatePresence>
          {!moved && !dragging && (
            <motion.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.5, duration: duration.base, ease } }}
              exit={{ opacity: 0, transition: { duration: duration.fast } }}
              className="pointer-events-none absolute left-1/2 top-full mt-2.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink/85 px-2 py-0.5 text-micro font-medium text-fg-2 shadow-raised ring-1 ring-line">
              Drag to adjust
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Marker>
  );
}
