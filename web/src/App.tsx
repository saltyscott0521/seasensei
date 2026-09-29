import { AnimatePresence, motion } from "motion/react";
import { Plus, Radio, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Drawer } from "vaul";
import { Toaster } from "sonner";
import { AddSpot } from "./components/AddSpot";
import { SpotDetail } from "./components/SpotDetail";
import { SpotList } from "./components/SpotList";
import { WindMap } from "./components/WindMap";
import { useSpots, useWindGrid } from "./lib/data";
import type { Bounds, Spot } from "./lib/wind";

type View = { kind: "list" } | { kind: "spot"; id: string } | { kind: "add" };

const mq = window.matchMedia("(min-width: 768px)");
const useDesktop = () => useSyncExternalStore((l) => (mq.addEventListener("change", l), () => mq.removeEventListener("change", l)), () => mq.matches);

const SNAPS = ["172px", 0.56, 0.94] as const;

export default function App() {
  const spots = useSpots();
  const desktop = useDesktop();
  const [view, setView] = useState<View>({ kind: "list" });
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [snap, setSnap] = useState<number | string | null>(SNAPS[0]);
  const grid = useWindGrid(bounds);
  const [showStations, setShowStations] = useState(true);

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

  const hrrrTime = grid.data?.time ? new Date(grid.data.time + "Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  const panel = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={view.kind === "spot" ? view.id : view.kind}
        initial={{ opacity: 0, x: view.kind === "list" ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: view.kind === "list" ? 24 : -24 }}
        transition={{ type: "spring", stiffness: 380, damping: 34 }}>
        {view.kind === "list" && <SpotList onSelect={select} />}
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
        onBounds={setBounds} grid={grid.data?.grid} padding={padding} showStations={showStations} />

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
              {hrrrTime ? `HRRR wind · ${hrrrTime}` : grid.isError ? "Wind field unavailable" : "Loading wind field…"}
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
              <div className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-white/25" />
              <div className={`safe-b flex-1 px-4 pt-2 ${snap === SNAPS[2] ? "overflow-y-auto" : "overflow-hidden"}`}>{panel}</div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}

      <Toaster theme="dark" position={desktop ? "bottom-right" : "top-center"} toastOptions={{ className: "!bg-slate-900/90 !backdrop-blur !border-white/10" }} />
    </div>
  );
}

function Legend({ desktop }: { desktop: boolean }) {
  return (
    <div className={`glass pointer-events-none absolute rounded-xl px-2.5 py-2 ${desktop ? "bottom-4 left-[432px]" : "left-3 top-[84px]"}`}
      style={desktop ? undefined : { marginTop: "env(safe-area-inset-top)" }}>
      <div className="h-1.5 w-32 rounded-full"
        style={{ background: "linear-gradient(90deg,#465a8c,#388cdc 20%,#22d3ee 32%,#34d399 42%,#a3e635 55%,#facc15 67%,#fb7124 80%,#ec4899)" }} />
      <div className="num mt-1 flex w-32 justify-between text-[9px] text-white/50"><span>0</span><span>10</span><span>20</span><span>30</span><span>40 kn</span></div>
    </div>
  );
}
