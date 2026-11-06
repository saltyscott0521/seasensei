import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { MapPinPlus, RadioTower, X } from "lucide-react";
import { duration, ease } from "../../lib/motion";

type Props = {
  adding: boolean;
  onAdd: () => void;
  onCancelAdd: () => void;
  showStations: boolean;
  onToggleStations: () => void;
  /** Warm the add form's code before it is needed (hover / focus / touch). */
  onPrefetchAdd?: () => void;
  /** Phones: fade the group out (the raised sheet covers it). */
  hidden?: boolean;
};

// Pressed (a toggle that is on, or add mode): accent text on the accent tint. Unpressed: quiet fg-2. Only one set
// is ever applied, so the two text colours never fight in the cascade.
const PRESSED = "bg-accent-soft text-accent";
const RESTING = "text-fg-2 hover:bg-surface-3 hover:text-fg";

/** Add a spot ↔ Cancel: a map pin with a plus (never the zoom's bare "+"), crossfading to an X while adding. */
function AddIcon({ adding }: { adding: boolean }) {
  return (
    <span aria-hidden className="grid place-items-center">
      <AnimatePresence initial={false}>
        <motion.span key={adding ? "x" : "add"} className="col-start-1 row-start-1 grid place-items-center"
          initial={{ opacity: 0, scale: 0.6, rotate: adding ? -90 : 0 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: duration.fast, ease }}>
          {adding ? <X /> : <MapPinPlus />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Phones: the top of the right-hand control rail — Add a spot, then Show live stations — as one glass group of
 * 44px buttons. MapLibre's Find my location continues the rail underneath (styles/map.css). There are no zoom
 * buttons on phones: pinch zooms.
 */
export function RailActions({ adding, onAdd, onCancelAdd, showStations, onToggleStations, onPrefetchAdd, hidden }: Props) {
  const cell = "relative grid size-11 place-items-center transition-colors duration-150 focus-visible:outline-offset-[-2px] [&_svg]:size-5";
  return (
    <div data-testid="control-rail" data-map-chrome
      className={clsx("glass pointer-events-auto flex flex-col rounded-md transition-[opacity,visibility] duration-200 ease-ui", hidden && "invisible opacity-0")}>
      <button type="button" onClick={adding ? onCancelAdd : onAdd} onPointerEnter={onPrefetchAdd} onFocus={onPrefetchAdd}
        aria-label={adding ? "Cancel adding a spot" : "Add a spot"} className={clsx(cell, "rounded-t-[13px]", adding ? PRESSED : RESTING)}>
        <AddIcon adding={adding} />
      </button>
      <button type="button" onClick={onToggleStations} aria-pressed={showStations} aria-label="Show live stations"
        className={clsx(cell, "rounded-b-[13px] border-t border-line", showStations ? PRESSED : RESTING)}>
        <RadioTower aria-hidden />
      </button>
    </div>
  );
}

/**
 * Desktop: a small glass group at the map's top right. Labelled buttons — the names stay "Add a spot" /
 * "Show live stations" and each contains its visible label.
 */
export function MapActions({ adding, onAdd, onCancelAdd, showStations, onToggleStations, onPrefetchAdd }: Props) {
  const cell = "relative inline-flex h-10 items-center gap-2 px-3.5 text-label font-medium transition-colors duration-150 focus-visible:outline-offset-[-2px] [&_svg]:size-[18px]";
  return (
    <div data-map-chrome className="glass pointer-events-auto flex rounded-md">
      <button type="button" onClick={adding ? onCancelAdd : onAdd} onPointerEnter={onPrefetchAdd} onFocus={onPrefetchAdd}
        aria-label={adding ? "Cancel adding a spot" : "Add a spot"} title={adding ? "Cancel adding a spot (Esc)" : "Add a spot"}
        className={clsx(cell, "rounded-l-[13px]", adding ? PRESSED : RESTING)}>
        <AddIcon adding={adding} />
        <span>{adding ? "Cancel" : "Add a spot"}</span>
      </button>
      <button type="button" onClick={onToggleStations} aria-pressed={showStations} aria-label="Show live stations"
        title={showStations ? "Hide live stations" : "Show live stations"}
        className={clsx(cell, "rounded-r-[13px] border-l border-line", showStations ? PRESSED : RESTING)}>
        <RadioTower aria-hidden />
        <span>Stations</span>
      </button>
    </div>
  );
}
