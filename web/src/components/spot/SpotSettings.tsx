import { Check, ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { spotStore } from "../../lib/data";
import { fmtKm, NEARBY_MAX_KM, NO_STATION, ownStation, type NowSource, type Sensor } from "../../lib/session";
import type { Spot } from "../../lib/wind";
import { DirectionPicker, RangeSlider, StationPicker } from "../controls";
import { Button, buttonClass } from "../ui";
import { undoDelete, type Deleted } from "../home/undoDelete";
import { fmtCoords } from "./format";

/**
 * Inline settings: name, wind range, direction arc, where the live wind comes from, the location, and a two-tap
 * delete. Every change saves as you make it. Escape (handled by SpotDetail) or Done closes it.
 */
export function SpotSettings({ spot, onDeleted, onDone, source, sensor }: {
  spot: Spot; onDeleted: () => void; onDone: () => void; source: NowSource; sensor: Sensor | null;
}) {
  const nameId = useId();
  const [name, setName] = useState(spot.name);
  // Follow renames from elsewhere, but don't fight the field while it's being edited.
  useEffect(() => { setName((n) => (n.trim() === spot.name ? n : spot.name)); }, [spot.name]);
  const fine = typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="text-label font-semibold text-fg">Settings</h3>
        <span className="flex items-center gap-1 text-caption text-fg-3"><Check aria-hidden className="size-3.5" />Changes save as you go</span>
      </div>

      <Row>
        <label htmlFor={nameId} className="mb-2 block text-caption font-medium text-fg-2">Name</label>
        <input id={nameId} value={name} maxLength={60} autoComplete="off" spellCheck={false}
          onChange={(e) => {
            setName(e.target.value);
            const t = e.target.value.trim();
            if (t && t !== spot.name) spotStore.update(spot.id, { name: t });
          }}
          onBlur={() => { if (!name.trim()) setName(spot.name); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="h-11 w-full rounded-sm bg-ink/40 px-3 text-body text-fg ring-1 ring-inset ring-line transition-colors duration-150 placeholder:text-fg-3 hover:ring-line-strong" />
      </Row>

      <Row><RangeSlider value={[spot.min, spot.max]} onChange={([min, max]) => spotStore.update(spot.id, { min, max })} /></Row>

      <Row><DirectionPicker dirC={spot.dirC} dirW={spot.dirW} lat={spot.lat} lon={spot.lon} onChange={(v) => spotStore.update(spot.id, v)} /></Row>

      <Row>
        <StationPicker lat={spot.lat} lon={spot.lon} value={spot.station} onChange={(station) => spotStore.update(spot.id, { station })} />
        <p className="mt-2.5 text-caption text-fg-3">{stationNote(spot, source, sensor)}</p>
      </Row>

      <Row>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption font-medium text-fg-2">Location</p>
            <p className="num mt-0.5 select-all text-label text-fg">{fmtCoords(spot.lat, spot.lon)}</p>
          </div>
          <a href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}`} target="_blank" rel="noreferrer"
            className={buttonClass("ghost", "sm")}>Open in Maps<ExternalLink /></a>
        </div>
      </Row>

      <div className="flex items-center gap-2 p-4">
        <DeleteButton spot={spot} onDeleted={onDeleted} verb={fine ? "Click" : "Tap"} />
        <Button variant="primary" size="sm" className="ml-auto max-md:px-5" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="border-b border-line px-4 py-4 last:border-b-0">{children}</div>;
}

/** What "now" will be, in words, for the current station choice. */
function stationNote(spot: Spot, source: NowSource, sensor: Sensor | null) {
  if (spot.station === NO_STATION) return "Forecast only: the spot ignores live sensors, even nearby ones.";
  if (ownStation(spot)) {
    return source === "station" && sensor ? `Now comes from ${sensor.name}${sensor.km != null ? `, ${fmtKm(sensor.km)} away` : ""}.`
      : "This station has no fresh reading, so the spot shows the forecast for now.";
  }
  return source === "nearby" && sensor
    ? `Automatic: the nearest live sensor within ${NEARBY_MAX_KM} km, ${sensor.name}${sensor.km != null ? ` (${fmtKm(sensor.km)})` : ""}. Pick one above to fix it, or forecast only.`
    : `Automatic: no live sensor within ${NEARBY_MAX_KM} km, so the spot shows the forecast.`;
}

/** Two taps to delete (armed for 3 s), so a stray tap can't lose a spot; the toast and the board can still bring it back. */
function DeleteButton({ spot, onDeleted, verb }: { spot: Spot; onDeleted: () => void; verb: string }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button variant="danger" size="sm" aria-live="polite"
      className={armed ? "!bg-strong !text-ink !ring-strong" : undefined}
      onClick={() => {
        if (!armed) { setArmed(true); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(false), 3000); return; }
        const deleted: Deleted = { spot, index: spotStore.remove(spot.id) };
        // The toast for pointers (long enough to reach; its Undo works from any view), and a row on the board, one Tab
        // from where focus lands. Either one restores it, once.
        deleted.toastId = toast(`Deleted ${spot.name}`, { duration: 12_000, action: { label: "Undo", onClick: () => undoDelete.restore(deleted) } });
        undoDelete.remember(deleted);
        onDeleted();
      }}>
      <Trash2 />{armed ? `${verb} again to delete` : "Delete spot"}
    </Button>
  );
}
