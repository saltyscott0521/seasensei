import { motion } from "motion/react";
import { MapPin, Plus, Trash2, Undo2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { useSpots } from "../lib/data";
import { spring, stagger } from "../lib/motion";
import { useRankedSpots, type RankedSpot } from "../lib/useSpotNow";
import type { Spot } from "../lib/wind";
import { pointerVerb } from "./forms/Field";
import { DiscussionCard } from "./home/DiscussionCard";
import { SpotCard } from "./home/SpotCard";
import { TAMPA_BAY_CENTRE, TodayHeader } from "./home/TodayHeader";
import { undoDelete, useLastDeleted } from "./home/undoDelete";
import { Button } from "./ui/Button";
import { ScrollFade } from "./ui/ScrollFade";

// The entrance plays once per app load; coming back from a spot shouldn't replay it.
let entered = false;
const TAMPA_BAY_TZ = "America/New_York";
const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
// The undo offer lasts until the board goes away (a spot opens, adding starts). Forgotten a tick after unmounting,
// so StrictMode's unmount-remount in development doesn't drop it.
let forgetTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Home: the Today board. "Today" with the date and daylight, your spots ranked by their verdict (the top one carries
 * the day's answer), then the wind discussion.
 */
export const SpotList = memo(function SpotList({ onSelect, onOpenDiscussion, onAdd, onHover }: {
  onSelect: (s: Spot) => void; onOpenDiscussion: (date: string) => void;
  /** Starts adding a spot. Also reachable from the map's + button; this one lives in the panel/sheet, so it works
   *  for keyboard and screen-reader users on phones (the sheet hides everything outside it from them). */
  onAdd?: () => void;
  /** A card is pointed at or focused (its spot's id), or no longer (null): the map lights that spot's marker. */
  onHover?: (id: string | null) => void;
}) {
  const spots = useSpots();
  const ranked = useRankedSpots();
  const deleted = useLastDeleted();
  const first = useRef(!entered);
  useEffect(() => { entered = true; }, []);
  useEffect(() => {
    clearTimeout(forgetTimer);
    return () => { forgetTimer = setTimeout(undoDelete.forget, 0); };
  }, []);
  // Leaving the board with a card still hovered or focused: let the marker go too.
  useEffect(() => () => onHover?.(null), [onHover]);

  // Rank once every forecast has answered; until then keep your own order, so cards don't shuffle as each one lands.
  const settled = ranked.every((r) => r.status !== "pending");
  const rows = useMemo(() => (settled ? ranked : spots.map((s) => ranked.find((r) => r.spot.id === s.id)!).filter(Boolean)), [settled, ranked, spots]);
  // The spots' own zone once a forecast is in (Tampa Bay's with no spots, this device's if every forecast failed);
  // null while loading, so the header never shows one zone's sunrise and then flips to another's.
  const tz = rows.find((r) => r.forecast)?.forecast?.timeZone ?? (!spots.length ? TAMPA_BAY_TZ : settled ? DEVICE_TZ : null);

  return (
    <>
      <div className="flex flex-col gap-3 pb-1 md:gap-4 md:pb-10">
        <TodayHeader at={spots[0] ?? TAMPA_BAY_CENTRE} tz={tz} notice={deleted && <UndoRow spot={deleted.spot} />} />

        {spots.length === 0 ? <Empty /> : (
          // The top card's answer tab rides 10 px above it, inside this gap.
          <ol aria-label="Your spots, best first" className="mt-1 flex flex-col gap-2 md:mt-0">
            {rows.map((r, i) => (
              <Row key={r.spot.id} row={r} i={i} best={i === 0 && settled && !!r.verdict && !!r.forecast}
                animate={first.current} onSelect={onSelect} onHover={onHover} />
            ))}
          </ol>
        )}
        {onAdd && (
          <Button variant={spots.length ? "ghost" : "secondary"} size="sm" onClick={onAdd} className="self-start -mt-1">
            <Plus /> New spot
          </Button>
        )}

        <DiscussionCard onOpen={onOpenDiscussion} />
      </div>
      <ScrollFade />
    </>
  );
});

function Row({ row, i, best, animate, onSelect, onHover }: {
  row: RankedSpot; i: number; best: boolean; animate: boolean; onSelect: (s: Spot) => void; onHover?: (id: string | null) => void;
}) {
  return (
    // Only a change of rank re-measures (and animates) the row: the panel scrolls, and measuring on every render
    // would animate cards whenever the board re-renders after a scroll.
    <motion.li layout="position" layoutDependency={i} transition={spring}
      initial={animate ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0, transition: { ...spring, delay: animate ? stagger(i) : 0 } }}>
      <SpotCard row={row} onSelect={onSelect} best={best} onHover={onHover} />
    </motion.li>
  );
}

/**
 * "Deleted Skyway · Undo", right under the heading that focus lands on after a delete, so a keyboard or screen-reader
 * user reaches it with one Tab (the toast says the same for pointers). Gone once the board is left.
 */
/** Put the spot back, and focus its card (the Undo button that had focus is gone with the row). */
function undo(id: string) {
  undoDelete.undo();
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-spot-card="${CSS.escape(id)}"]`)?.focus());
}

function UndoRow({ spot }: { spot: Spot }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="undo-row"
      className="flex min-h-11 items-center gap-2.5 rounded-lg border border-line bg-surface-2 py-1 pl-3.5 pr-1.5">
      <Trash2 aria-hidden className="size-4 shrink-0 text-fg-3" />
      <p className="min-w-0 flex-1 text-label text-fg-2">Deleted <span className="font-semibold text-fg">{spot.name}</span></p>
      <Button size="sm" variant="ghost" onClick={() => undo(spot.id)} aria-label={`Undo deleting ${spot.name}`} className="text-accent! hover:text-accent!">
        <Undo2 /> Undo
      </Button>
    </motion.div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-8 text-center">
      <span aria-hidden className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent"><MapPin className="size-5" strokeWidth={2.25} /></span>
      <p className="max-w-[17rem] text-balance text-label leading-relaxed text-fg-2">
        <b className="mb-0.5 block text-body font-semibold text-fg">No spots yet.</b> {pointerVerb()} <kbd className="mx-0.5 inline-grid size-5 place-items-center rounded-[6px] bg-surface-3 font-sans text-caption font-semibold text-fg ring-1 ring-inset ring-line-strong">+</kbd> and drop a pin where you launch.
      </p>
    </div>
  );
}
