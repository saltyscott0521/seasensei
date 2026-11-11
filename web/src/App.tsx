import { AnimatePresence, motion, useIsPresent } from "motion/react";
import {
  lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactNode,
} from "react";
import { Toaster } from "sonner";
import { SpotDetail } from "./components/SpotDetail";
import { SpotList } from "./components/SpotList";
import { Timeline } from "./components/Timeline";
import type { MapApi } from "./components/WindMap";
import { AlertBanner } from "./components/shell/AlertBanner";
import { MapActions, RailActions } from "./components/shell/MapActions";
import { Panel } from "./components/shell/Panel";
import { Sheet, sheetEscapes, type TimelinePlace } from "./components/shell/Sheet";
import { PanelBrand, status, StatusPill } from "./components/shell/Status";
import { UpdateBoundary } from "./components/shell/UpdateBoundary";
import { useHeight } from "./components/shell/useHeight";
import { useLayers } from "./components/shell/useLayers";
import { ViewTarget } from "./components/shell/ViewTarget";
import { useMarineAlerts } from "./lib/alerts";
import { useForecast, usePrimaryModel, useSpots, useWindField } from "./lib/data";
import {
  bandPadding, CHROME_TOP, desktopBand, DESKTOP_NAV_W, DOCK_EST, EDGE, panelWidth, phoneBand, PILL_H, RAIL_H, sheetSnaps,
  sheetTopPx, SNAP_FULL, SNAP_MID, SNAP_REST, TIMELINE_LIFT, timelineFloatsAt, useDesktop, useViewport, type SnapIndex,
} from "./lib/layout";
import { useFreshness } from "./lib/freshness";
import { duration, ease } from "./lib/motion";
import { AtProvider, onAtRequest, useHourNow } from "./lib/time";
import { areaStats, fieldAt, type Bounds, type Model, type Spot } from "./lib/wind";

// Off the first-paint path: the map (maplibre is most of the JavaScript; the panel or sheet paints without it), the
// add form (with its direction and station pickers) and the discussion dialog. Each sits under an UpdateBoundary,
// so a chunk that a deploy has since replaced shows "SeaSensei was updated — Reload" instead of blanking the app.
const loadWindMap = () => import("./components/WindMap");
const WindMap = lazy(() => loadWindMap().then((m) => ({ default: m.WindMap })));
const loadAddSpot = () => import("./components/AddSpot");
const AddSpot = lazy(() => loadAddSpot().then((m) => ({ default: m.AddSpot })));
const loadDiscussion = () => import("./components/Discussion");
const DiscussionDialog = lazy(() => loadDiscussion().then((m) => ({ default: m.DiscussionDialog })));

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const NO_HOURS = { hours: [] as number[], models: [] as Model[], area: [] as ReturnType<typeof areaStats>[] };
type LatLon = { lat: number; lon: number };

/** `document.body.dataset[key] === "1"`, live (the full-screen charts set `fullscreen` while they are open). */
function useBodyFlag(key: string) {
  return useSyncExternalStore((l) => {
    const mo = new MutationObserver(l);
    mo.observe(document.body, { attributes: true, attributeFilter: [`data-${key}`] });
    return () => mo.disconnect();
  }, () => document.body.dataset[key] === "1");
}

export default function App() {
  const spots = useSpots();
  const desktop = useDesktop();
  const { vh, vw, sat, sab } = useViewport();
  const { layers, get, push, replace, close } = useLayers();
  const { view, discussion } = layers;
  const adding = view.kind === "add";
  const [pin, setPin] = useState<LatLon | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [showStations, setShowStations] = useState(true);
  // The timeline's chosen hour, as a time (null = now). Not an index: the hour list is rebuilt from "now" whenever the
  // field refetches or the hour turns, and an index would quietly slide to a later hour.
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // Anything in the app may ask the one clock for another hour (a day in the board's week); the shell owns it.
  useEffect(() => onAtRequest((t) => { setPlaying(false); setSelectedAt(t); }), []);
  // A spot card hovered or focused in the list: its marker is ringed and named on the map.
  const [hoverId, setHoverId] = useState<string | null>(null);

  // ── Phone sheet snap, kept as an index (the rest snap's px value follows the viewport) ──
  const [snap, setSnap] = useState<SnapIndex>(() => (view.kind === "spot" ? SNAP_MID : SNAP_REST));
  // Opening a spot raises the sheet to mid, adding drops it to rest, and coming back to the list restores the
  // height it had. Adjusted while rendering, so the map's fly-to padding already knows where the sheet is
  // going, whether the change came from a tap or from the back button.
  const [seen, setSeen] = useState({ kind: view.kind, listSnap: SNAP_REST as SnapIndex });
  if (seen.kind !== view.kind) {
    const listSnap = seen.kind === "list" ? snap : seen.listSnap;
    setSeen({ kind: view.kind, listSnap });
    if (!desktop) setSnap(view.kind === "spot" ? SNAP_MID : view.kind === "add" ? SNAP_REST : listSnap);
    if (seen.kind === "add") setPin(null); // leaving the add form, however it closed, takes its pin away
    if (view.kind !== "list") setHoverId(null); // the card you pointed at has gone
  }

  // ── Wind field and the timeline (index 0 = now) ──
  const field = useWindField(bounds);
  const primary = usePrimaryModel();
  // Times read in the spots' own zone (the forecast says which), not the device's: a rider checking Tampa Bay from
  // elsewhere sees the same hours as the spot cards. The first spot's forecast is shared with its card.
  const tz = useForecast(spots[0]).data?.timeZone ?? TZ;
  const hourNow = useHourNow(); // "now" moves on with the clock, whether or not the data changed
  const timeline = useMemo(() => {
    const f = field.data;
    if (!f) return NO_HOURS;
    const idx = f.times.map((t, i) => [t, i] as const).filter(([t]) => t >= hourNow);
    return { hours: idx.map(([t]) => t), models: idx.map(([, i]) => f.models[i]), area: idx.map(([, i]) => areaStats(f, i)) };
  }, [field.data, hourNow]);
  // The chosen hour while it is still ahead of us; once it has passed, the timeline is back at now.
  if (selectedAt != null && timeline.hours.length && selectedAt <= timeline.hours[0]) setSelectedAt(null);
  const index = useMemo(() => {
    const hs = timeline.hours;
    if (selectedAt == null || hs.length < 2) return 0;
    const i = hs.indexOf(selectedAt);
    if (i >= 0) return i;
    let best = 0; // the field's hours changed under it: the nearest one
    for (let j = 1; j < hs.length; j++) if (Math.abs(hs[j] - selectedAt) < Math.abs(hs[best] - selectedAt)) best = j;
    return best;
  }, [timeline.hours, selectedAt]);
  const hoursRef = useRef(timeline.hours);
  hoursRef.current = timeline.hours;
  // The Timeline works in indices (keys, playback); stable, so its memo and its playback interval hold.
  const onIndex = useCallback((i: number) => setSelectedAt(i <= 0 ? null : hoursRef.current[i] ?? null), []);
  // The thumb, its label and the status line follow the finger at once (urgent); the map, the cards, the spot detail
  // and the charts follow a deferred copy, so React skips hours in between instead of holding the thumb back.
  const urgentAt = index > 0 ? timeline.hours[index] ?? null : null;
  const at = useDeferredValue(urgentAt);
  // "Wind" means at least what your lightest-wind spot needs.
  const threshold = useMemo(() => (spots.length ? Math.min(...spots.map((s) => s.min)) : 15), [spots]);
  const grid = useMemo(() => (field.data ? fieldAt(field.data, at ?? Date.now()).grid : undefined), [field.data, at]);

  // ── Layout: the visible map band, from the live chrome ──
  const snaps = useMemo(() => sheetSnaps(vh, sab), [vh, sab]);
  const sheetTop = sheetTopPx(snaps[snap], vh);
  const [floatRef, cardH] = useHeight<HTMLDivElement>();
  const [dockRef, dockH] = useHeight<HTMLDivElement>();
  // Room the floating timeline takes: its measured card, but never less than the agreed lift.
  const lift = Math.max(TIMELINE_LIFT, cardH ? cardH + 8 : 0);
  const place: TimelinePlace = adding ? "none" : snap === SNAP_FULL ? "hidden" : timelineFloatsAt(sheetTop, sat, lift) ? "float" : "inline";
  const b = desktop
    ? desktopBand({ vw, vh, dockH: adding ? 0 : dockH || DOCK_EST })
    : phoneBand({ vw, sat, sheetTop, timelineTop: place === "float" ? sheetTop - lift : null });
  const band = useMemo(() => b, [b.top, b.right, b.bottom, b.left]); // eslint-disable-line react-hooks/exhaustive-deps
  const padding = useMemo(() => bandPadding(band, vw, vh), [band, vw, vh]);
  // Phones: a raised sheet would cut through the rail, then the status pill; fade them out instead.
  const railHidden = !desktop && sheetTop < sat + CHROME_TOP + RAIL_H + 8;
  const pillHidden = !desktop && sheetTop < sat + CHROME_TOP + PILL_H + 8;
  const bandX = (band.left + band.right) / 2, bandY = (band.top + band.bottom) / 2;

  // ── What covers the map: then the particles (and the live halos) stop, instead of animating unseen under glass ──
  const fullscreen = useBodyFlag("fullscreen");
  const mapCovered = (!desktop && snap === SNAP_FULL) || discussion != null || fullscreen;

  // ── What's open, backed by history: back closes the top layer; ?spot= / ?add=1 / ?discussion= deep-link ──
  const spot = view.kind === "spot" ? spots.find((s) => s.id === view.id) : undefined;
  useEffect(() => {
    // Deleted (its settings are already on the way back through their own entry), or a stale link: in place.
    if (view.kind === "spot" && !spot) replace({ ...get(), view: { kind: "list" } }, true);
  }, [view, spot, get, replace]);

  const select = useCallback((s: Spot) => {
    setPin(null);
    const next = { view: { kind: "spot", id: s.id } as const, discussion: null };
    (get().view.kind === "list" ? push : replace)(next);
  }, [get, push, replace]);
  const startAdd = useCallback(() => {
    setPin(null);
    setPlaying(false);
    const next = { view: { kind: "add" } as const, discussion: null };
    (get().view.kind === "list" ? push : replace)(next);
  }, [get, push, replace]);
  const openDiscussion = useCallback((date: string) => push({ ...get(), discussion: date }), [get, push]);
  const showDiscussion = useCallback((date: string) => replace({ ...get(), discussion: date }), [get, replace]);
  // A dropped (or dragged) pin raises the sheet to mid, not full, so the pin stays in view above the form.
  const onPin = useCallback((p: LatLon) => { setPin(p); if (!desktop) setSnap((s) => (s === SNAP_FULL ? s : SNAP_MID)); }, [desktop]);
  const movePin = useCallback(() => setSnap(SNAP_REST), []);
  // Without a pointer on the map: drop the pin where the cross-hair is (the middle of the open map) …
  const mapApi = useRef<MapApi | null>(null);
  const centre = useRef({ x: bandX, y: bandY });
  centre.current = { x: bandX, y: bandY };
  const pinAtCentre = useCallback(() => {
    let frames = 0;
    const drop = () => {
      if (get().view.kind !== "add") return;
      const p = mapApi.current?.pointAt(centre.current.x, centre.current.y);
      if (p) onPin(p);
      else if (frames++ < 600) requestAnimationFrame(drop); // the map is still loading: drop it once it's there
    };
    drop();
  }, [onPin, get]);
  // … or at a point found another way (the device's location), brought into view. A location that arrives after the
  // form has closed (cancelled while the phone was still looking) is dropped: no pin, no raised sheet, no fly-away.
  const pinAt = useCallback((p: LatLon) => {
    if (get().view.kind !== "add") return;
    onPin(p);
    requestAnimationFrame(() => mapApi.current?.reveal(p)); // once the sheet's new height is in the map padding
  }, [onPin, get]);
  const toggleStations = useCallback(() => setShowStations((v) => !v), []);
  const prefetchAdd = useCallback(() => { void loadAddSpot().catch(() => {}); }, []); // a failure shows when it's used

  // Escape closes the top layer. Dialogs, settings and station cards listen in the capture phase and stop it first.
  // In a text field the first Escape just leaves the field, so a half-typed spot name isn't thrown away.
  const onEscape = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.matches?.("input, textarea, select, [contenteditable='true']")) { t.blur(); return; }
    close();
  }, [close]);
  useEffect(() => {
    // On phones the sheet (a Radix dialog) sees every Escape first and marks it (sheetEscapes); whatever inside stops it
    // on the way (a chart clearing its cursor) keeps it from reaching here, as on desktop.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && (!e.defaultPrevented || sheetEscapes.has(e))) onEscape(e); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);

  // The discussion dialog and the add form load on first use, both prefetched when idle (which also puts them in the
  // service worker's cache, so a deploy later can't take them away); the dialog then stays mounted to animate out.
  const [dialogUsed, setDialogUsed] = useState(discussion != null);
  if (discussion != null && !dialogUsed) setDialogUsed(true);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1500));
    idle(() => { void loadDiscussion().catch(() => {}); void loadAddSpot().catch(() => {}); });
  }, []);

  // ── The panel: one view at a time, crossfading in place ──
  const viewKey = view.kind === "spot" ? `spot:${view.id}` : view.kind;
  const scrollRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const lastSpot = useRef<string | null>(null);
  if (spot) lastSpot.current = spot.name;
  const [scrolled, setScrolled] = useState(false);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.dataset.view === "list") listScroll.current = el.scrollTop;
    setScrolled(el.scrollTop > 2);
  }, []);

  // On a view change the list comes back where you left it and other views start at the top; focus moves to
  // the new view's heading, or back to the spot you came from, for keyboard and screen-reader users.
  const shownKey = useRef(viewKey); // the first view is left alone (and StrictMode's re-run is a no-op)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.dataset.view = view.kind;
    if (shownKey.current === viewKey) return;
    shownKey.current = viewKey;
    if (!el) return;
    el.scrollTop = view.kind === "list" ? listScroll.current : 0;
    setScrolled(el.scrollTop > 2);
    let raf = 0, tries = 0;
    const focus = () => {
      const root = el.querySelector<HTMLElement>(`[data-view="${CSS.escape(viewKey)}"]`);
      let target: HTMLElement | null | undefined = null;
      if (root && view.kind === "list" && lastSpot.current) {
        target = [...root.querySelectorAll<HTMLElement>("button")].find((x) => x.querySelector("h3")?.textContent === lastSpot.current);
      }
      target ??= root?.querySelector<HTMLElement>("h2");
      if (!target) { if (tries++ < 60) raf = requestAnimationFrame(focus); return; }
      if (!target.matches("button, a[href], input, select, textarea, [tabindex]")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    };
    raf = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(raf);
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const panel = useMemo(() => (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div key={viewKey} data-view={viewKey}
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: duration.base, ease } }}
        exit={{ opacity: 0, transition: { duration: duration.fast, ease: [0.4, 0, 1, 1] } }}>
        <Pane>
          {view.kind === "list" && <SpotList onSelect={select} onOpenDiscussion={openDiscussion} onAdd={startAdd} onHover={setHoverId} />}
          {view.kind === "spot" && spot && <SpotDetail spot={spot} onBack={close} />}
          {view.kind === "add" && (
            <UpdateBoundary>
              <Suspense fallback={<div className="h-40" aria-busy="true" />}>
                <AddSpot pin={pin} onCancel={close} onSaved={select} onMovePin={desktop ? undefined : movePin}
                  onUseCentre={pinAtCentre} onPinAt={pinAt} />
              </Suspense>
            </UpdateBoundary>
          )}
        </Pane>
      </motion.div>
    </AnimatePresence>
  ), [viewKey, view.kind, spot, pin, select, openDiscussion, close, startAdd, desktop, movePin, pinAtCentre, pinAt]);

  // Marine alerts in force (NWS): one quiet row above the view, in the panel and in the sheet. Not over the add form.
  const alerts = useMarineAlerts(spots);
  const raiseForAlert = useCallback(() => setSnap((s) => (s === SNAP_REST ? SNAP_MID : s)), []);
  const alertEl = useMemo(() => (adding || !alerts.length ? null : <AlertBanner alerts={alerts} tz={tz} onOpen={raiseForAlert} />), [adding, alerts, tz, raiseForAlert]);

  const timelineEl = useMemo(() => (
    <Timeline hours={timeline.hours} models={timeline.models} area={timeline.area} threshold={threshold}
      index={index} onIndex={onIndex} playing={playing} onPlaying={setPlaying} tz={tz}
      failed={field.isError} onRetry={field.refetch} compact={place === "inline"} primary={primary} />
  ), [timeline, threshold, index, onIndex, playing, tz, field.isError, field.refetch, place, primary]);

  const map = useMemo(() => (
    <UpdateBoundary variant="quiet">
      <Suspense fallback={<div className="absolute inset-0 bg-ink" />}>
        <WindMap spots={spots} selectedId={view.kind === "spot" ? view.id : null} highlightId={hoverId} onSelect={select}
          addMode={adding} pin={pin} onPin={onPin} onBounds={setBounds} grid={grid} padding={padding}
          showStations={showStations} at={at} paused={mapCovered} apiRef={mapApi}
          controlPosition={desktop ? "bottom-right" : "top-right"} zoomControls={desktop} />
      </Suspense>
    </UpdateBoundary>
  ), [spots, view, hoverId, select, adding, pin, onPin, grid, padding, showStations, at, mapCovered, desktop]);

  // The status. The pill and the panel header follow the thumb. Phones' screen readers (the pill sits outside the
  // sheet, so it is aria-hidden) hear it from inside the sheet, but only when its kind changes (loading, now, a
  // forecast hour, unavailable), never once per hour of a scrub or playback.
  const fresh = useFreshness();
  const statusProps = { ready: !!field.data, failed: field.isError, at: urgentAt, primary, tz, fresh };
  const st = status(statusProps);
  const [said, setSaid] = useState({ tone: st.tone, text: "" });
  if (said.tone !== st.tone) setSaid({ tone: st.tone, text: st.text });

  const actions = { adding, onAdd: startAdd, onCancelAdd: close, showStations, onToggleStations: toggleStations, onPrefetchAdd: prefetchAdd };

  // Desktop timeline dock: centred on the open map, up to 760px wide, clear of the locate / zoom column.
  const dockLo = EDGE + panelWidth(vw) + EDGE, dockHi = vw - EDGE - DESKTOP_NAV_W;
  const dockW = Math.max(0, Math.min(760, dockHi - dockLo));
  const dockLeft = Math.min(Math.max(bandX - dockW / 2, dockLo), dockHi - dockW);

  return (
    <AtProvider at={at}>
      <div className="fixed inset-0 overflow-hidden bg-ink" data-rail={railHidden ? "hidden" : undefined} data-map-covered={mapCovered || undefined}
        style={{ "--map-inset-bottom": `${Math.max(0, Math.round(vh - band.bottom))}px` } as CSSProperties}>
        {/* Desktop chrome comes first in the DOM (it is z-indexed above the map), so Tab starts in the panel and the
            timeline rather than walking every map marker first. */}
        {desktop && (
          <>
            <Panel header={<PanelBrand {...statusProps} />} scrollRef={scrollRef} onScroll={onScroll} scrolled={scrolled}>{alertEl}{panel}</Panel>
            {!adding && <div ref={dockRef} className="absolute bottom-4 z-10" style={{ left: dockLeft, width: dockW }}>{timelineEl}</div>}
            <div className="absolute right-4 top-4 z-10">
              <MapActions {...actions} />
            </div>
          </>
        )}

        {/* The map is its own stacking context, so marker z-indexes never lift a marker over the chrome. The
            cross-hair sits on the map but under the markers; while adding, it marks where "Use map centre" drops the pin. */}
        <div className="absolute inset-0 isolate">
          {(!adding || !pin) && <ViewTarget band={band} drop={adding} />}
          {map}
        </div>

        {!desktop && (
          <>
            {/* A soft shade under the status bar and the top chrome, so both read over any map. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-ink/70 to-transparent" style={{ height: sat + 104 }} />
            {/* The full sheet leaves a sliver of map too thin to hold a marker whole: dim it rather than slice them. */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-ink/80 transition-opacity duration-300 ease-ui motion-reduce:transition-none"
              style={{ height: Math.max(0, sheetTop) + 32, opacity: snap === SNAP_FULL ? 1 : 0 }} />
            <div className="pointer-events-none absolute inset-x-3 flex items-start justify-between gap-3" style={{ top: sat + CHROME_TOP }}>
              <StatusPill {...statusProps} hidden={pillHidden} />
              <RailActions {...actions} hidden={railHidden} />
            </div>
          </>
        )}

        {!desktop && (
          <Sheet snaps={snaps} index={snap} onIndex={setSnap} timeline={timelineEl} place={place}
            scrollRef={scrollRef} onScroll={onScroll} floatRef={floatRef} status={said.text}>
            {alertEl}
            {panel}
          </Sheet>
        )}

        {dialogUsed && (
          <UpdateBoundary variant="overlay" open={discussion != null} onClose={close}>
            <Suspense fallback={null}>
              <DiscussionDialog date={discussion} onDate={showDiscussion} onClose={close} />
            </Suspense>
          </UpdateBoundary>
        )}

        {/* Desktop: at the top of the open map. Phones: just above the sheet (or the timeline), by the thumb. */}
        <Toaster theme="dark" position={desktop ? "top-center" : "bottom-center"} gap={8}
          offset={desktop ? { top: EDGE } : { bottom: Math.round(vh - band.bottom + 8) }}
          mobileOffset={{ bottom: Math.round(vh - band.bottom + 8), left: 12, right: 12 }}
          style={{
            ...(desktop ? { left: bandX } : {}),
            "--normal-bg": "var(--color-surface-1)", "--normal-border": "var(--color-line-strong)",
            "--normal-text": "var(--color-fg)", "--border-radius": "var(--radius-md)",
          } as CSSProperties}
          toastOptions={{ className: "!font-sans !text-label backdrop-blur-[16px] shadow-float" }} />
      </div>
    </AtProvider>
  );
}

/** A view in the panel. While it fades out under the next one it is inert: not focusable, not read out twice. */
function Pane({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  return <div inert={!present} aria-hidden={present ? undefined : true}>{children}</div>;
}
