import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Crosshair, LocateFixed, MapPin, RadioTower, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import { spotStore, useObservation, useStations } from "../lib/data";
import { useDesktop } from "../lib/layout";
import { NEARBY_WARN_KM } from "../lib/session";
import { duration, ease, spring, stagger } from "../lib/motion";
import { nearestStations, type Spot } from "../lib/wind";
import { DirectionPicker, RangeSlider, StationPicker } from "./controls";
import { pointerVerb } from "./forms/Field";
import { Button, IconButton } from "./ui";

type Pin = { lat: number; lon: number };

/**
 * A station is pre-picked only when it is at the spot (its readings then show as "Live"); anything further starts on
 * Auto, which uses the nearest live sensor within 16 km and says "Nearby sensor".
 */
const STATION_KM = NEARBY_WARN_KM;

/** "27.6401° N, 82.7393° W": the pin to the precision it is saved at (about 10 m). */
const fmtPin = ({ lat, lon }: Pin) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;

/**
 * The add-a-spot flow, in the panel / sheet while the map is in pin mode.
 * 1. No pin yet: one prompt, "Tap (Click) the map to drop a pin", and two ways that need no pointer on the map:
 *    "Use map centre" (where the cross-hair is) and "Use my location". They live here, in the panel or the sheet,
 *    because on phones everything outside the sheet is hidden from screen readers.
 * 2. Pinned: the coordinates (drag the pin, tap the map again, or re-centre / re-locate it), a name, the wind range
 *    (15–30 kn), the direction arc (read from the coastline straight away), the live-wind source (a NOAA station at
 *    the spot, within 8 km, else Auto), and "Save spot", which stays in reach at the bottom.
 * `onMovePin`, if the shell passes it, adds a "Move" button that hands the map back (e.g. lowers the phone sheet).
 * `onUseCentre` drops (or moves) the pin at the centre of the visible map; `onPinAt` at a given point.
 */
export function AddSpot({ pin, onCancel, onSaved, onMovePin, onUseCentre, onPinAt }: {
  pin: Pin | null; onCancel: () => void; onSaved: (s: Spot) => void; onMovePin?: () => void;
  onUseCentre?: () => void; onPinAt?: (p: Pin) => void;
}) {
  const desktop = useDesktop();
  const tap = pointerVerb();
  const geo = useGeolocate(onPinAt);
  // A pin placed from a button (not the map) moves focus on: the Name field on desktop (it takes focus as it mounts),
  // the pin's coordinates on phones (no keyboard popping up uninvited). The button itself is gone by then.
  const focusPin = useRef(false);
  const coordsRef = useCallback((el: HTMLParagraphElement | null) => {
    if (el && focusPin.current && !desktop) { focusPin.current = false; el.focus({ preventScroll: true }); }
  }, [desktop]);
  const byButton = (fn: () => void) => () => { if (!pin) focusPin.current = true; fn(); };
  const centre = onUseCentre && byButton(onUseCentre);
  const locate = geo.supported && onPinAt ? byButton(geo.locate) : undefined;
  const [name, setName] = useState("");
  const [range, setRange] = useState<[number, number]>([15, 30]);
  const [station, setStation] = useState<string | undefined>();
  const [dir, setDir] = useState<{ dirC?: number; dirW?: number }>({});
  const stationChosen = useRef(false);
  const stations = useStations();
  const nameId = useId(), hintId = useId(), titleId = useId();
  // Phones: once the first pin is down (and the sheet has risen), the Name field is the next thing to do. Bring it up
  // out from under the sticky Save dock, where a short phone's sheet would otherwise leave it.
  const nameRef = useRef<HTMLInputElement>(null), dockRef = useRef<HTMLDivElement>(null);
  const pinned = !!pin;
  useEffect(() => (pinned && !desktop ? revealAboveDock(nameRef, dockRef) : undefined), [pinned, desktop]);

  // Until the rider picks one, the source follows the pin: the nearest NOAA station if it's at the spot, else Auto …
  useEffect(() => {
    if (!pin || !stations.data || stationChosen.current) return;
    const n = nearestStations(stations.data, pin.lat, pin.lon, 1)[0];
    setStation(n && n.km < STATION_KM ? n.id : undefined);
  }, [pin?.lat, pin?.lon, stations.data]); // the pin's coordinates, not the object: a re-render isn't a move
  // … and a pre-picked station that doesn't report wind gives way to Auto.
  const picked = useObservation(stationChosen.current ? undefined : station);
  useEffect(() => { if (picked.isError && !stationChosen.current) setStation(undefined); }, [picked.isError]);

  const trimmed = name.trim();
  function save() {
    if (!pin || !trimmed) return;
    const s = spotStore.add({
      name: trimmed, lat: +pin.lat.toFixed(4), lon: +pin.lon.toFixed(4), min: range[0], max: range[1],
      ...(station ? { station } : {}), ...(dir.dirW != null && dir.dirW < 360 ? dir : {}),
    });
    toast.success(`${s.name} added`);
    onSaved(s);
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-heading font-semibold tracking-tight text-fg">New spot</h2>
        <IconButton aria-label="Cancel" onClick={onCancel}><X /></IconButton>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {!pin ? (
          <motion.div key="drop" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: duration.fast, ease } }} transition={spring}>
            <div className="rounded-lg border border-dashed border-line-strong bg-surface-2 p-3">
              <div className="flex items-center gap-3">
                <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <span aria-hidden className="halo absolute inset-0 rounded-full bg-accent/25" />
                  <MapPin aria-hidden className="relative size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-label font-medium text-fg">{tap} the map to drop a pin</p>
                  <p className="mt-0.5 text-caption text-fg-3">Zoom in close to where you launch{centre || locate ? ", or:" : "."}</p>
                </div>
              </div>
              {(centre || locate) && (
                <div className="mt-3 flex flex-wrap gap-2 pl-[52px]">
                  {centre && <Button size="sm" onClick={centre}><Crosshair /> Use map centre</Button>}
                  {locate && <Button size="sm" onClick={locate} disabled={geo.busy}><LocateFixed className={geo.busy ? "motion-safe:animate-pulse" : undefined} /> {geo.busy ? "Finding you…" : "Use my location"}</Button>}
                </div>
              )}
              <GeoNote text={geo.error} />
            </div>
            {/* What the app does for you next, so the defaults aren't a surprise. */}
            <ul aria-label="Then" className="mt-4 flex flex-col gap-2.5 px-1 text-caption text-fg-2">
              <Then icon={<Sparkles />}>The coastline sets which wind directions work there.</Then>
              <Then icon={<RadioTower />}>The nearest live wind sensor gives the reading for now.</Then>
              <Then icon={<SlidersHorizontal />}>Adjust anything before you save, or later.</Then>
            </ul>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: duration.fast, ease } }} transition={{ duration: duration.base, ease }}
            className="flex flex-col">
            <Step i={0}>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <MapPin aria-hidden className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p ref={coordsRef} tabIndex={-1} className="num rounded-sm text-label font-medium text-fg outline-none" aria-live="polite" data-testid="pin-coords">
                    <span className="sr-only">Pin at </span>{fmtPin(pin)}
                  </p>
                  <p className="text-caption text-fg-3">Drag the pin or {tap.toLowerCase()} the map to move it</p>
                </div>
                {onMovePin && <Button size="sm" variant="ghost" onClick={onMovePin}>Move</Button>}
              </div>
              {(centre || locate) && (
                <div className="mt-1.5 flex flex-wrap gap-x-1 px-1">
                  {centre && <Button size="sm" variant="ghost" onClick={centre} aria-label="Move pin to map centre"><Crosshair /> Map centre</Button>}
                  {locate && <Button size="sm" variant="ghost" onClick={locate} disabled={geo.busy} aria-label="Move pin to my location"><LocateFixed /> {geo.busy ? "Finding you…" : "My location"}</Button>}
                </div>
              )}
              <GeoNote text={geo.error} />
            </Step>

            <Step i={1} className="mt-5">
              <label htmlFor={nameId} className="mb-2 block text-label font-semibold text-fg">Name</label>
              <input ref={nameRef} id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Davis Islands"
                autoFocus={desktop} maxLength={40} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
                aria-describedby={trimmed ? undefined : hintId}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  // First Escape just leaves the field; it must not reach the app's "close this view" (and lose the pin).
                  if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.blur(); }
                }}
                className="h-12 w-full rounded-md bg-surface-2 px-3.5 text-base text-fg ring-1 ring-inset ring-line transition-colors duration-150 placeholder:text-fg-3 hover:ring-line-strong focus:bg-surface-3 focus:ring-line-strong md:h-11 md:text-body" />
            </Step>

            <Step i={2} className="mt-6 border-t border-line pt-5">
              <RangeSlider value={range} onChange={setRange} />
            </Step>
            <Step i={3} className="mt-5 border-t border-line pt-5">
              <DirectionPicker dirC={dir.dirC} dirW={dir.dirW} lat={pin.lat} lon={pin.lon} onChange={setDir} autoSuggest />
            </Step>
            <Step i={4} className="mt-5 border-t border-line pt-5">
              <StationPicker lat={pin.lat} lon={pin.lon} value={station} onChange={(id) => { stationChosen.current = true; setStation(id); }} />
            </Step>

            {/* Stays in reach while the form scrolls under it: a dock in the panel's own colour, edge to edge (it reaches
                into the scroller's side padding), with a full-width fade above and a shadow that fills the scroller's
                bottom padding (a shadow is ink overflow: no sideways scroll). Sticky stops at that padding. */}
            <div ref={dockRef} className={clsx("sticky bottom-0 z-10 -mx-5 mt-6 bg-surface-1-solid px-5 pb-2 pt-1 max-md:-mx-4 max-md:px-4",
              "shadow-[0_24px_0_0_var(--color-surface-1-solid)]",
              "before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-linear-to-t before:from-surface-1-solid before:to-transparent")}>
              <Button variant="primary" className="w-full" onClick={save} disabled={!trimmed} aria-describedby={trimmed ? undefined : hintId}>
                Save spot
              </Button>
              <p id={hintId} className="mt-2 text-center text-caption text-fg-3" hidden={!!trimmed}>Add a name to save</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * Once the sheet has stopped moving (the dock rides its visible bottom edge), scroll the field up above the sticky
 * dock and its fade if it sits under them. The sheet's scroller reaches below the screen at the lower snaps, so
 * scrollIntoView would think the field already visible: measure against the dock instead. Returns a cancel.
 */
function revealAboveDock(field: RefObject<HTMLElement | null>, dock: RefObject<HTMLElement | null>) {
  let raf = 0, frames = 0, still = 0, last = NaN;
  const tick = () => {
    const f = field.current, d = dock.current, out = ++frames > 120; // ~2 s at most
    if (!f || !d) { if (!out) raf = requestAnimationFrame(tick); return; } // the form fades in after the prompt fades out
    const top = d.getBoundingClientRect().top;
    still = Math.abs(top - last) < 0.5 ? still + 1 : 0;
    last = top;
    if (still < 4 && !out) { raf = requestAnimationFrame(tick); return; }
    let scroller = f.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const over = f.getBoundingClientRect().bottom - (Math.min(top, window.innerHeight) - 24);
    if (scroller && over > 0) scroller.scrollBy({ top: over, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** A form section that settles in just after the one above it (opacity + 6 px, 30 ms apart). */
function Step({ i, className, children }: { i: number; className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: stagger(i) }}>
      {children}
    </motion.div>
  );
}

function Then({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden className="mt-px text-fg-3 [&_svg]:size-4">{icon}</span>
      {children}
    </li>
  );
}

/** "Use my location": the browser's position, or a plain sentence when it can't (denied, unavailable, slow). */
function useGeolocate(onPinAt?: (p: Pin) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
  const locate = () => {
    if (!supported || !onPinAt) return;
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); onPinAt({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      (e) => {
        setBusy(false);
        setError(e.code === e.PERMISSION_DENIED
          ? "Location is turned off for this site. Allow it in your browser's settings, or place the pin on the map."
          : "Couldn't find your location just now. Try again, or place the pin on the map.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };
  return { supported, busy, error, locate };
}

/** Why "Use my location" didn't work, said where the button is (and announced). */
function GeoNote({ text }: { text: string | null }) {
  return <p role="status" className={clsx("text-caption text-fg-2", text && "mt-2.5")}>{text}</p>;
}
