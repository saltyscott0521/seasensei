import { memo, useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import { usePrimaryModel } from "../lib/data";
import { useAt, useNow } from "../lib/time";
import { AGREEMENT_WORDS, confidence } from "../lib/session";
import { COMPARE_MODELS, spreadAt, type Model, type ModelCompare, type Spot } from "../lib/wind";
import { DayNight, DrawIn, NowLine, Pill, RangeLines, SpeedGrid, TimeAxis, type Box } from "./charts/parts";
import { fmtWhen, HOUR, nightSpans, speedTicks, speedTop, timeAxis, useSvgId } from "./charts/scale";
import { useScrub } from "./charts/useScrub";
import { Chip, ConfidenceDots } from "./ui";
import { L, R, T, type Range } from "./ForecastChart";
import { useChartSize } from "./useChartSize";

const B = 24;

/**
 * SeaSensei and the raw models (HRRR, RRFS, NBM, ECMWF, GFS) on one axis. The shaded band is the spread between the
 * raw models (a free confidence signal); the rider's primary model is drawn bold and the others thin, and tapping a model's tile brings its line
 * forward instead. The cursor follows a scrub here, else the timeline's hour.
 */
export const ModelChart = memo(function ModelChart({ data, spot, range, tz, maxH = 560, minH = 250 }: { data: ModelCompare; spot: Spot; range: Range; tz: string; maxH?: number; minH?: number }) {
  const primary = usePrimaryModel();
  const at = useAt();
  const now = useNow();
  const [focus, setFocus] = useState<Model | null>(null);
  const lead = focus ?? primary;
  const [wrapRef, { w: W, h: H }] = useChartSize(minH, 0.62, maxH);
  const box: Box = useMemo(() => ({ l: L, r: W - R, t: T, b: H - B }), [W, H]);
  const ids = { clip: useSvgId("models"), desc: useSvgId("mdesc") };

  const idx = useMemo(() => {
    const from = range === "24h" ? now - 24 * HOUR : now - 6 * HOUR;
    const to = range === "24h" ? now + 3 * HOUR : range === "48h" ? now + 48 * HOUR : Infinity;
    const r = data.times.flatMap((t, i) => (t >= from && t <= to ? [i] : []));
    return r.length > 1 ? r : data.times.map((_, i) => i);
  }, [data, range, now]);

  const m = useMemo(() => {
    const t0 = data.times[idx[0]], t1 = data.times[idx[idx.length - 1]];
    const all = idx.flatMap((i) => COMPARE_MODELS.map((mm) => data.series[mm.key]?.[i]).filter((v): v is number => v != null));
    const top = speedTop(spot.max, all);
    const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const path = (key: string) => {
      let d = "", pen = false;
      for (const i of idx) {
        const v = data.series[key]?.[i];
        if (v == null) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(data.times[i]).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
      }
      return d;
    };
    const sp = idx.map((i) => ({ i, s: spreadAt(data, i) })).filter((p) => p.s);
    const band = sp.length > 1
      ? sp.map((p, k) => `${k ? "L" : "M"}${x(data.times[p.i]).toFixed(1)},${y(p.s!.max).toFixed(1)}`).join("")
        + sp.slice().reverse().map((p) => `L${x(data.times[p.i]).toFixed(1)},${y(p.s!.min).toFixed(1)}`).join("") + "Z"
      : "";
    return {
      t0, t1, top, x, y, band,
      paths: COMPARE_MODELS.filter((mm) => data.series[mm.key]).map((mm) => ({ ...mm, d: path(mm.key) })),
      ticks: speedTicks(top),
      axis: timeAxis(t0, t1, tz, x, W - L - R),
      nights: nightSpans(spot.lat, spot.lon, t0, t1),
    };
  }, [data, idx, spot, tz, W, H]);

  const times = useMemo(() => idx.map((i) => data.times[i]), [idx, data]);
  const tAtX = useCallback((px: number) => m.t0 + ((px - L) / (W - L - R)) * (m.t1 - m.t0), [m, W]);
  const noop = useCallback(() => {}, []);
  const scrub = useScrub(times, tAtX, noop, at ?? now);

  // The same rule as the session rows and the charts card (session.ts confidenceOf): label by level, show the spread.
  const ag = useMemo(() => confidence(data, now, now + 48 * HOUR), [data, now]);
  const ag7 = useMemo(() => confidence(data, now + 48 * HOUR, now + 7 * 24 * HOUR), [data, now]);

  const nearestI = (t: number) => idx.reduce((b, i) => (Math.abs(data.times[i] - t) < Math.abs(data.times[b] - t) ? i : b), idx[0]);
  const inRange = (t: number | null) => t != null && t >= m.t0 - HOUR / 2 && t <= m.t1 + HOUR / 2;
  const ct = scrub.t ?? (inRange(at) ? at : null);
  const cursor = ct != null ? nearestI(ct) : null;
  const shownI = cursor ?? nearestI(now);
  const sp = spreadAt(data, shownI);
  const nowX = now >= m.t0 && now <= m.t1 ? m.x(now) : null;

  const summary = `${ag ? `Over the next 48 hours: ${AGREEMENT_WORDS[ag.level].toLowerCase()}, a ${Math.round(ag.spread)} knot spread. ` : ""}`
    + `${fmtWhen(data.times[shownI], tz)}: ${m.paths.map((mm) => { const v = data.series[mm.key]?.[shownI]; return `${mm.label} ${v == null ? "no data" : Math.round(v)}`; }).join(", ")}.`;

  const chip = (a: NonNullable<typeof ag>, when: string) => (
    <Chip size="sm" icon={<ConfidenceDots level={a.level} aria-hidden />}>{when}: {AGREEMENT_WORDS[a.level].toLowerCase()} · {Math.round(a.spread)} kn spread</Chip>
  );
  const ordered = [...m.paths.filter((p) => p.id !== lead), ...m.paths.filter((p) => p.id === lead)]; // the lead model on top

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5 px-1">{ag && chip(ag, "Next 48 h")}{ag7 && chip(ag7, "Days 3–7")}</div>
      <div ref={wrapRef}>
        {W ? (
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Wind forecast by model" aria-describedby={ids.desc}
            aria-roledescription="chart" tabIndex={0} className="block cursor-crosshair touch-pan-y select-none rounded-sm"
            onMouseDown={(e) => e.preventDefault()} {...scrub.handlers} {...scrub.keys}>
            <DayNight nights={m.nights} x={m.x} box={box} />
            <SpeedGrid ticks={m.ticks} y={m.y} box={box} />
            <RangeLines y={m.y} min={spot.min} max={spot.max} box={box} />
            <TimeAxis rules={m.axis.rules} labels={m.axis.labels} box={box} labelY={H - 7} W={W} />
            <DrawIn id={ids.clip} drawKey={`models:${spot.id}`} W={W} H={H}>
              {m.band && <path d={m.band} className="fill-fg/[.09]" />}
              {ordered.map((p) => (
                <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeLinejoin="round" strokeLinecap="round"
                  strokeWidth={p.id === lead ? 2.75 : 1.25} strokeOpacity={p.id === lead ? 1 : 0.6} />
              ))}
            </DrawIn>
            {nowX != null && <NowLine x={nowX} box={box} tag={cursor == null} />}
            {cursor != null && (
              <g pointerEvents="none">
                <line x1={m.x(data.times[cursor])} x2={m.x(data.times[cursor])} y1={T - 2} y2={H - B} className="stroke-fg" strokeOpacity=".7" />
                {ordered.map((mm) => {
                  const v = data.series[mm.key]?.[cursor];
                  return v == null ? null : <circle key={mm.key} cx={m.x(data.times[cursor])} cy={m.y(v)} r={mm.id === lead ? 4.5 : 3}
                    fill={mm.color} strokeWidth="1.5" className="stroke-ink" />;
                })}
                <Pill x={m.x(data.times[cursor])} y={1} minX={2} maxX={W - 2}>
                  <tspan className="fill-fg" fontWeight="600">{fmtWhen(data.times[cursor], tz)}</tspan>
                  {sp ? ` · ${Math.round(sp.min)}–${Math.round(sp.max)} kn across models` : ""}
                </Pill>
              </g>
            )}
          </svg>
        ) : <div style={{ height: H }} />}
      </div>
      <p id={ids.desc} hidden>{summary}</p>

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {m.paths.map((mm) => {
          const v = data.series[mm.key]?.[shownI];
          const on = mm.id === lead;
          return (
            <button key={mm.key} type="button" aria-pressed={on} title={`Highlight ${mm.label}`}
              onClick={() => setFocus((f) => (f === mm.id || (f == null && mm.id === primary) ? null : mm.id))}
              className={clsx("min-w-0 rounded-md px-2 py-1.5 text-left ring-1 ring-inset transition-colors duration-150",
                on ? "bg-surface-3 ring-line-strong" : "bg-surface-2 ring-transparent hover:bg-surface-3")}>
              <span className="flex items-center gap-1.5 text-micro font-medium text-fg-2">
                <i aria-hidden className={clsx("size-2 shrink-0 rounded-full", !on && "opacity-70")} style={{ background: mm.color }} />{mm.label}
              </span>
              <span className={clsx("num block text-title font-semibold leading-tight", v == null ? "text-fg-3" : "text-fg")}>
                {v == null ? "—" : Math.round(v)}<span className="ml-0.5 text-micro font-normal text-fg-3">kn</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-micro text-fg-3">
        <span className="num">{fmtWhen(data.times[shownI], tz)}</span>
        {sp ? ` · spread ${Math.round(sp.min)}–${Math.round(sp.max)} kn` : ""} · HRRR ends at 48 h, RRFS at 84 h
      </p>
    </div>
  );
});
