import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import { sample, windColor, type WindGrid } from "../lib/wind";

/**
 * Animated wind streamlines over the map (the "earth.nullschool" look).
 * Particles live in lng/lat, are advected in screen space each frame by the
 * bilinearly-sampled HRRR field, and leave fading trails. Panning clears the
 * trails so they never smear across the basemap.
 */
export function WindParticles({ grid }: { grid: WindGrid | undefined }) {
  const { current: mapRef } = useMap();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef(grid);
  gridRef.current = grid;

  useEffect(() => {
    const map = mapRef?.getMap();
    const canvas = canvasRef.current;
    if (!map || !canvas) return;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, w = 0, h = 0, dpr = 1;
    type P = { lng: number; lat: number; age: number; life: number };
    let ps: P[] = [];

    const spawn = (p?: P): P => {
      const pt = map.unproject([Math.random() * w, Math.random() * h]);
      const q = p ?? ({} as P);
      q.lng = pt.lng; q.lat = pt.lat; q.age = 0; q.life = 40 + Math.random() * 80;
      return q;
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(Math.min(2200, (w * h) / (reduced ? 2400 : 700)));
      ps = Array.from({ length: target }, () => spawn());
      ctx.clearRect(0, 0, w, h);
    };
    const clear = () => ctx.clearRect(0, 0, w, h);
    const reseed = () => { ps.forEach((p) => spawn(p)); clear(); };

    const tick = () => {
      const g = gridRef.current;
      if (!g) return;
      // fade previous frame → trails
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.075)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.25;
      ctx.lineCap = "round";
      const k = reduced ? 0.06 : 0.16; // px per knot per frame
      for (const p of ps) {
        const a = map.project([p.lng, p.lat]);
        const s = sample(g, p.lat, p.lng);
        const bx = a.x + s.u * k, by = a.y - s.v * k;
        if (++p.age > p.life || bx < -5 || by < -5 || bx > w + 5 || by > h + 5) { spawn(p); continue; }
        ctx.strokeStyle = windColor(s.speed, Math.min(1, p.age / 12) * 0.85);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke();
        const next = map.unproject([bx, by]);
        p.lng = next.lng; p.lat = next.lat;
      }
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!document.hidden) tick();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    map.on("move", clear);
    map.on("moveend", reseed);
    raf = requestAnimationFrame(frame);
    // Dev-only: lets a test harness step frames while the tab is hidden (rAF is paused then).
    if (import.meta.env.DEV) (window as any).__wind = { step: (n: number) => { for (let i = 0; i < n; i++) tick(); }, count: () => ps.length };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.off("move", clear);
      map.off("moveend", reseed);
    };
  }, [mapRef]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
