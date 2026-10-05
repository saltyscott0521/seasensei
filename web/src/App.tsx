import { AnimatePresence, motion } from "motion/react";
import { Plus, Radio, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Drawer } from "vaul";
import { Toaster } from "sonner";
import { AddSpot } from "./components/AddSpot";
import { DiscussionDialog } from "./components/Discussion";
import { SpotDetail } from "./components/SpotDetail";
import { SpotList } from "./components/SpotList";
import { WindMap } from "./components/WindMap";
import { useSpots, useWindField } from "./lib/data";
import { Timeline } from "./components/Timeline";
import { areaStats, windGradient, fieldAt, type Bounds, type Spot } from "./lib/wind";

type View = { kind: "list" } | { kind: "spot"; id: string } | { kind: "add" };

const mq = window.matchMedia("(min-width: 768px)");
const useDesktop = () => useSyncExternalStore((l) => (mq.addEventListener("change", l), () => mq.removeEventListener("change", l)), () => mq.matches);

const SNAPS = ["172px", 0.56, 0.94] as const;
// Drawer is h-[96dvh] and Vaul translates it by (viewport − snap). Keep these in step with that.
const DRAWER_H = 0.96;
const TIMELINE_LIFT = 176;
// Legend sits at top 84px and is ~40px tall; header buttons end ~120px below the safe area.
const LEGEND_CLEAR = 132;

let viewportBox = { vh: 0, vw: 0, sat: 0 };
const readViewport = () => {
  const vh = window.innerHeight, vw = window.innerWidth;
  const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0;
  if (viewportBox.vh !== vh || viewportBox.vw !== vw || viewportBox.sat !== sat) viewportBox = { vh, vw, sat };
  return viewportBox;
};
const useViewport = () => useSyncExternalStore((l) => (window.addEventListener("resize", l), () => window.removeEventListener("resize", l)), readViewport);

function sheetTopPx(snap: number | string | null, vh: number) {
  const snapPx = typeof snap === "string" ? parseInt(snap, 10) : snap == null ? 172 : snap * vh;
  return (1 - DRAWER_H) * vh + (vh - snapPx);
}

export default function App() {
  const spots = useSpots();
  const desktop = useDesktop();
  const { vh, vw, sat } = useViewport();
  const [view, setView] = useState<View>({ kind: "list" });
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [snap, setSnap] = useState<number | string | null>(SNAPS[0]);
  // Floating the timeline on a short phone (or a raised sheet) runs it through the legend.
  // Then it rides inside the sheet instead, where it stays reachable.
  const timelineFloats = sheetTopPx(snap, vh) >= LEGEND_CLEAR + sat + TIMELINE_LIFT;
  // The wind discussion dialog; `?discussion=YYYY-MM-DD` is its permalink (the RSS feed links to it).
  const [discussion, setDiscussion] = useState<string | null>(() => {
    const d = new URLSearchParams(location.search).get("discussion");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  });
  useEffect(() => {
    const url = new URL(location.href);
    if (discussion) url.searchParams.set("discussion", discussion); else url.searchParams.delete("discussion");
    if (url.href !== location.href) history.replaceState(null, "", url);
  }, [discussion]);
  const field = useWindField(bounds);
  const [showStations, setShowStations] = useState(true);
  const [tIndex, setTIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Hours from the current one forward; index 0 = now.
  const timeline = useMemo(() => {
    const f = field.data;
    if (!f) return { hours: [] as number[], models: [] as ("hrrr" | "nbm")[], area: [] as ReturnType<typeof areaStats>[] };
    const start = Math.floor(Date.now() / 3600e3) * 3600e3;
    const idx = f.times.map((t, i) => [t, i] as const).filter(([t]) => t >= start);
    return { hours: idx.map(([t]) => t), models: idx.map(([, i]) => f.models[i]), area: idx.map(([, i]) => areaStats(f, i)) };
  }, [field.data]);
  const at = tIndex > 0 ? timeline.hours[tIndex] ?? null : null;
  // "Wind" means at least what your lightest-wind spot needs.
  const threshold = spots.length ? Math.min(...spots.map((s) => s.min)) : 15;
  const grid = useMemo(() => (field.data ? fieldAt(field.data, at ?? Date.now()).grid : undefined), [field.data, at]);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const spot = view.kind === "spot" ? spots.find((s) => s.id === view.id) : undefined;
  useEffect(() => { if (view.kind === "spot" && !spot) setView({ kind: "list" }); }, [view, spot]);

  const select = useCallback((s: Spot) => { setView({ kind: "spot", id: s.id }); setPin(null); if (!desktop) setSnap(SNAPS[1]); }, [desktop]);
  const back = useCallback(() => { setView({ kind: "list" }); setPin(null); }, []);
  const startAdd = () => { setView({ kind: "add" }); setPin(null); if (!desktop) setSnap(SNAPS[0]); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back]);

  // Keep flyTo targets clear of the panel/sheet.
  const padding = useMemo(() => desktop
    ? { top: 90, bottom: 40, left: 440, right: 60 }
    : { top: 110, bottom: Math.round(window.innerHeight * 0.5), left: 30, right: 30 }, [desktop]);


  const timelineEl = (
    <Timeline hours={timeline.hours} models={timeline.models} area={timeline.area} threshold={threshold}
      index={Math.min(tIndex, Math.max(0, timeline.hours.length - 1))}
      onIndex={setTIndex} playing={playing} onPlaying={setPlaying} tz={tz} />
  );

  const panel = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={view.kind === "spot" ? view.id : view.kind}
        initial={{ opacity: 0, x: view.kind === "list" ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: view.kind === "list" ? 24 : -24 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}>
        {view.kind === "list" && <SpotList onSelect={select} onOpenDiscussion={setDiscussion} />}
        {view.kind === "spot" && spot && <SpotDetail spot={spot} onBack={back} />}
        {view.kind === "add" && <AddSpot pin={pin} onCancel={back} onSaved={select} />}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div className="fixed inset-0 overflow-hidden">
      <WindMap spots={spots} selectedId={view.kind === "spot" ? view.id : null} onSelect={select}
        addMode={view.kind === "add"} pin={pin}
        onPin={(p) => { setPin(p); if (!desktop) setSnap(SNAPS[2]); }}
        onBounds={setBounds} grid={grid} padding={padding} showStations={showStations} at={at}
        controlPosition={desktop ? "bottom-right" : "top-right"} />

      {view.kind !== "add" && (
        <ViewTarget desktop={desktop} vh={vh} vw={vw} sat={sat} sheetTop={sheetTopPx(snap, vh)} timelineFloats={timelineFloats} />
      )}

      {/* vignette so glass UI reads over the map */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />

      {/* Header */}
      <header className="safe-t pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-3 md:px-4">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="glass pointer-events-auto flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-3.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-500/30">
            <Waves className="h-5 w-5" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">SeaSensei</div>
            <div className="flex items-center gap-1.5 text-[11px] text-white/50">
              <span className="relative flex h-1.5 w-1.5"><span className="ping-soft absolute inset-0 rounded-full bg-emerald-400" /><span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>
              {field.data ? (at ? `Forecast · ${new Intl.DateTimeFormat([], { weekday: "short", hour: "numeric" }).format(at)}` : "Live wind · HRRR field")
                : field.isError ? "Wind field unavailable" : "Loading wind field…"}
            </div>
          </div>
        </motion.div>
        <div className="pointer-events-auto flex flex-col gap-2">
        <motion.button initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.05, type: "spring", stiffness: 300, damping: 26 }}
          whileTap={{ scale: 0.92 }} onClick={view.kind === "add" ? back : startAdd} aria-label={view.kind === "add" ? "Cancel adding a spot" : "Add a spot"}
          className="glass grid h-[52px] w-[52px] place-items-center rounded-2xl">
          <motion.span animate={{ rotate: view.kind === "add" ? 45 : 0 }}><Plus className="h-6 w-6" /></motion.span>
        </motion.button>
          <motion.button initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 26 }}
            whileTap={{ scale: 0.92 }} onClick={() => setShowStations((v) => !v)} aria-pressed={showStations} aria-label="Show live stations"
            className={`glass grid h-[52px] w-[52px] place-items-center rounded-2xl transition-colors ${showStations ? "!bg-cyan-400/20 text-cyan-200" : "text-white/60"}`}>
            <Radio className="h-5 w-5" />
          </motion.button>
        </div>
      </header>

      <AnimatePresence>
        {view.kind === "add" && !pin && (
          <motion.div initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}
            className="glass pointer-events-none absolute left-1/2 top-[84px] -translate-x-1/2 rounded-full px-4 py-2 text-sm text-cyan-100 md:top-[90px]"
            style={{ marginTop: "env(safe-area-inset-top)" }}>
            Tap the map to drop a pin
          </motion.div>
        )}
      </AnimatePresence>

      <Legend desktop={desktop} />

      {desktop && (
        <div className="absolute bottom-4 left-[432px] right-[64px] z-10 max-w-[680px]">{timelineEl}</div>
      )}

      {desktop ? (
        <motion.aside initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 28, delay: 0.1 }}
          className="glass absolute bottom-4 left-4 top-[88px] w-[400px] overflow-y-auto rounded-3xl p-4 no-scrollbar">
          {panel}
        </motion.aside>
      ) : (
        <Drawer.Root open modal={false} dismissible={false} snapPoints={[...SNAPS]} activeSnapPoint={snap} setActiveSnapPoint={setSnap}>
          <Drawer.Portal>
            <Drawer.Content aria-describedby={undefined}
              className="glass fixed inset-x-0 bottom-0 z-20 flex h-[96dvh] flex-col rounded-t-[28px] border-b-0 outline-none">
              <Drawer.Title className="sr-only">Spots</Drawer.Title>
              {/* Inside the sheet on purpose: the sheet marks everything outside it aria-hidden, which
                  would hide the timeline from screen readers. Riding on its top edge keeps it reachable. */}
              {snap !== SNAPS[2] && timelineFloats && <div className="absolute inset-x-3 -top-[176px]">{timelineEl}</div>}
              <div className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-white/25" />
              <div className={`safe-b flex-1 px-4 pt-2 ${snap === SNAPS[2] ? "overflow-y-auto" : "overflow-hidden"}`}>
                {snap !== SNAPS[2] && !timelineFloats && <div className="mb-3">{timelineEl}</div>}
                {panel}
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}

      <DiscussionDialog date={discussion} onDate={setDiscussion} onClose={() => setDiscussion(null)} />

      <Toaster theme="dark" position={desktop ? "bottom-right" : "top-center"} toastOptions={{ className: "!bg-slate-900/90 !backdrop-blur !border-white/10" }} />
    </div>
  );
}

/** Sits in the open part of the map: the mini chart summarises the wind around this point. */
function ViewTarget({ desktop, vh, vw, sat, sheetTop, timelineFloats }: {
  desktop: boolean; vh: number; vw: number; sat: number; sheetTop: number; timelineFloats: boolean;
}) {
  const top = desktop ? 96 : LEGEND_CLEAR + sat + 8;
  const bottomEdge = desktop ? vh - 190 : (timelineFloats ? sheetTop - TIMELINE_LIFT : sheetTop) - 10;
  const left = desktop ? 448 : 12;
  const right = desktop ? vw - 72 : vw - 12;
  if (bottomEdge - top < 72 || right - left < 72) return null;
  return (
    <div className="pointer-events-none absolute z-[5]" style={{ top, left, width: right - left, height: bottomEdge - top }}>
      <div role="img" aria-label="Map centre. The wind chart summarises the area around this point." data-testid="view-target"
        className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute left-0 top-0 h-2.5 w-2.5 border-l-2 border-t-2 border-white/90" />
        <span className="absolute right-0 top-0 h-2.5 w-2.5 border-r-2 border-t-2 border-white/90" />
        <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-white/90" />
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-white/90" />
        <span className="absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 bg-white/80" />
        <span className="absolute left-1/2 top-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2 bg-white/80" />
        <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_6px_white]" />
      </div>
    </div>
  );
}

function Legend({ desktop }: { desktop: boolean }) {
  return (
    <div className={`glass pointer-events-none absolute rounded-xl px-2.5 py-2 ${desktop ? "right-[84px] top-[18px]" : "left-3 top-[84px]"}`}
      style={desktop ? undefined : { marginTop: "env(safe-area-inset-top)" }}>
      <div className="h-1.5 w-32 rounded-full"
        style={{ background: windGradient() }} />
      <div className="num relative mt-1 h-3 w-32 text-[9px] text-white/50">{[0, 10, 20, 30, 40].map((v) => <span key={v} className="absolute -translate-x-1/2" style={{ left: `${(v / 45) * 100}%` }}>{v === 40 ? "40+" : v}</span>)}</div>
    </div>
  );
}
