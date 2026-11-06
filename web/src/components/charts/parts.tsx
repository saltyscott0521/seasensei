// SVG building blocks shared by the forecast, bar and model charts, so they read as one system:
// fg-3 10 px ticks on hairline grids, darker night, the rider's sessions in go, model handoffs, "now" in accent,
// a readout pill that follows the cursor, and a one-time draw-in.
import { motion, useReducedMotion } from "motion/react";
import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MODEL_INFO, type Model } from "../../lib/wind";
import { ease } from "../../lib/motion";
import { labelWidth, markDrawn, shouldDrawIn, type XLabel } from "./scale";

/** Plot box: left/right/top/bottom of the plotting area in CSS px. */
export type Box = { l: number; r: number; t: number; b: number };

/** Horizontal gridlines with their speed labels on the left. */
export const SpeedGrid = memo(function SpeedGrid({ ticks, y, box }: { ticks: number[]; y: (v: number) => number; box: Box }) {
  return (
    <g aria-hidden>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={box.l} x2={box.r} y1={y(v)} y2={y(v)} className={v === 0 ? "stroke-line-strong" : "stroke-line"} />
          <text x={box.l - 7} y={y(v) + 3.5} textAnchor="end" fontSize="10" className="num fill-fg-3">{v}</text>
        </g>
      ))}
    </g>
  );
});

/** Midnight rules through the plot and the time labels under it. */
export const TimeAxis = memo(function TimeAxis({ rules, labels, box, labelY, W }: {
  rules: number[]; labels: XLabel[]; box: Box; labelY: number; W: number;
}) {
  return (
    <g aria-hidden>
      {rules.map((x) => <line key={x} x1={x} x2={x} y1={box.t} y2={box.b} className="stroke-line-strong" />)}
      {labels.map((l) => {
        const half = labelWidth(l.text) / 2;
        if (l.x - half < 2 || l.x + half > W - 2) return null; // would be cut by the edge
        return (
          <text key={l.x} x={l.x} y={labelY} textAnchor="middle" fontSize="10"
            className={l.day ? "fill-fg-2 font-semibold" : "num fill-fg-3"}>{l.text}</text>
        );
      })}
    </g>
  );
});

/**
 * Day and night: a faint lift over the whole plot with the nights pressed back to ink, so the daily rhythm reads on
 * a glass panel and on the full-screen ink alike.
 */
export const DayNight = memo(function DayNight({ nights, x, box }: { nights: [number, number][]; x: (t: number) => number; box: Box }) {
  return (
    <g aria-hidden pointerEvents="none">
      <rect x={box.l} width={Math.max(0, box.r - box.l)} y={box.t} height={box.b - box.t} className="fill-fg/[.025]" />
      {nights.map(([a, b]) => (
        <rect key={a} x={x(a)} width={Math.max(0, x(b) - x(a))} y={box.t} height={box.b - box.t} className="fill-ink/50" data-night="" />
      ))}
    </g>
  );
});

/** The rider's daylight sessions: a go wash through the plot with a go ribbon on the baseline. */
export const Sessions = memo(function Sessions({ spans, x, box, base }: {
  spans: [number, number][]; x: (t: number) => number; box: Box; base: number;
}) {
  return (
    <g aria-hidden pointerEvents="none">
      {spans.map(([a, b]) => {
        const xa = x(a), w = Math.max(2, x(b) - xa);
        return (
          <g key={a} data-session="">
            <rect x={xa} width={w} y={box.t} height={box.b - box.t} className="fill-go/[.07]" />
            <rect x={xa} width={w} y={base - 1.5} height={3} rx={1.5} className="fill-go" />
          </g>
        );
      })}
    </g>
  );
});

/** The rider's speed range as two dashed hairlines. */
export function RangeLines({ y, min, max, box }: { y: (v: number) => number; min: number; max: number; box: Box }) {
  return (
    <g aria-hidden pointerEvents="none">
      {[min, max].map((v) => <line key={v} x1={box.l} x2={box.r} y1={y(v)} y2={y(v)} strokeDasharray="2 4" className="stroke-go/45" />)}
    </g>
  );
}

/** "Now": an accent hairline with a small accent tag on the top edge (the tag steps aside while a readout is up). */
export function NowLine({ x, box, tagY = 3, tag = true }: { x: number; box: Box; tagY?: number; tag?: boolean }) {
  return (
    <g aria-hidden pointerEvents="none">
      <line x1={x} x2={x} y1={box.t - 2} y2={box.b} className="stroke-accent" strokeOpacity=".75" />
      {tag && (
        <>
          <rect x={x - 15} y={tagY} width={30} height={15} rx={4} className="fill-accent" />
          <text x={x} y={tagY + 11} textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing=".04em" className="fill-ink">NOW</text>
        </>
      )}
    </g>
  );
}

/**
 * Where the forecast hands from one model to the next (HRRR → RRFS → NBM): a dashed line in the model's colour with
 * its name. With `confidence`, the NBM tail is labelled "NBM · lower confidence" (and the sharper model before the
 * first handoff is named too).
 */
export function Handoffs({ hand, box, W, labelY, confidence }: {
  hand: { t: number; x: number; from: Model; to: Model }[]; box: Box; W: number; labelY: number; confidence?: boolean;
}) {
  return (
    <>
      {hand.map((d, k) => {
        const to = MODEL_INFO[d.to], text = to.label + (confidence && d.to === "nbm" ? " · lower confidence" : "");
        const right = box.r - d.x > labelWidth(text) + 8; // room after the line, else put the label before it
        return (
          <g key={d.t} pointerEvents="none" data-handoff={to.label}>
            <line x1={d.x} x2={d.x} y1={box.t - 2} y2={box.b} stroke={to.color} strokeOpacity=".6" strokeDasharray="3 3" />
            {confidence && k === 0 && right && d.x - box.l > 40 && (
              <text x={d.x - 5} y={labelY} textAnchor="end" fontSize="10" fontWeight="600" className="fill-fg-3">{MODEL_INFO[d.from].label}</text>
            )}
            <text x={right ? d.x + 5 : d.x - 5} y={labelY} textAnchor={right ? "start" : "end"} fontSize="10" fontWeight="600"
              fill={to.color}>{text}</text>
          </g>
        );
      })}
    </>
  );
}

/** Diagonal hatch for forecast hours from the NBM blend (lower confidence). */
export function HatchDef({ id }: { id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2.5" className="stroke-fg/[.07]" />
    </pattern>
  );
}

/**
 * The cursor readout: a small dark pill centred over x, kept inside [minX, maxX]. Its width follows the text,
 * measured after render and written straight to the DOM, so it costs no extra React render per scrub step.
 */
export function Pill({ x, y, minX, maxX, children }: { x: number; y: number; minX: number; maxX: number; children: ReactNode }) {
  const g = useRef<SVGGElement>(null);
  const text = useRef<SVGTextElement>(null);
  const rect = useRef<SVGRectElement>(null);
  const measured = useRef({ text: "", w: 0 });
  useLayoutEffect(() => {
    const el = text.current;
    if (!el) return;
    const m = measured.current;
    if (el.textContent !== m.text) { // measure (a layout read) only when the words change, not on every step
      m.text = el.textContent ?? "";
      m.w = el.getComputedTextLength() + 18;
      rect.current?.setAttribute("width", String(m.w));
      el.setAttribute("x", String(m.w / 2));
    }
    const left = Math.min(Math.max(x - m.w / 2, minX), maxX - m.w);
    g.current?.setAttribute("transform", `translate(${left.toFixed(1)} ${y})`);
  });
  return (
    <g ref={g} pointerEvents="none" transform={`translate(${x} ${y})`}>
      <rect ref={rect} height={20} rx={6} className="fill-ink/90 stroke-line-strong" />
      <text ref={text} y={13.5} textAnchor="middle" fontSize="11" className="num fill-fg-2">{children}</text>
    </g>
  );
}

/**
 * Wraps the data series and reveals them left to right once, the first time this chart (by `drawKey`) shows in
 * this visit. A range switch, refetch or scrub never replays it, and reduced motion skips it. Transform only.
 */
export function DrawIn({ id, drawKey, W, H, children }: { id: string; drawKey: string; W: number; H: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [play, setPlay] = useState(() => shouldDrawIn(drawKey));
  useLayoutEffect(() => markDrawn(drawKey), [drawKey]);
  if (!play || reduce) return <g>{children}</g>;
  return (
    <>
      <defs>
        <clipPath id={id}>
          <motion.rect x={0} y={0} width={W} height={H} style={{ originX: 0 }}
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease }}
            onAnimationComplete={() => setPlay(false)} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{children}</g>
    </>
  );
}
