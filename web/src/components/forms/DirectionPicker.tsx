import * as Slider from "@radix-ui/react-slider";
import clsx from "clsx";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { analyzeCoast, type CoastResult } from "../../lib/coast";
import { arcLabel, compass } from "../../lib/wind";
import { Button, Chip } from "../ui";
import { KIND, KIND_ORDER, runsOf } from "./coastSectors";
import { FieldHeader, pointerVerb, sliderRootClass, sliderThumbClass, Unit } from "./Field";

type Dir = { dirC?: number; dirW?: number };
type Coast =
  | { state: "idle" }
  | { state: "loading"; auto: boolean }
  | { state: "done"; result: CoastResult; applied: boolean; auto: boolean; at: string }
  | { state: "error"; msg: string; auto: boolean };
const IDLE: Coast = { state: "idle" };

/** A new arc picked straight from "any direction" (by the Centre slider or the compass) starts ±45° wide. */
const FIRST_WIDTH = 90;

/**
 * Which wind directions work at a spot: a centre and a width (FROM, degrees), drawn as the rideable arc on a
 * compass. Tap or drag the compass to aim the arc; the Centre and Width sliders fine-tune it from the keyboard
 * (Centre 0–355 step 5, Width 30–360 step 10, where 360 = any direction).
 *
 * With `lat`/`lon` it offers "Suggest from coastline": the coastline analysis rings the compass with onshore /
 * short-fetch / offshore sectors and sets the arc to the widest stretch of open water. `autoSuggest` runs it as
 * soon as the point is known (and again when it moves) and applies the result unless the rider has already set the
 * arc by hand.
 */
export function DirectionPicker({ dirC, dirW, onChange, lat, lon, autoSuggest = false }: {
  dirC?: number; dirW?: number; onChange: (v: Dir) => void; lat?: number; lon?: number; autoSuggest?: boolean;
}) {
  const id = useId();
  const any = dirC == null || dirW == null || dirW >= 360;
  const c = dirC ?? 225, w = any ? 360 : dirW!;
  const touched = useRef(false);
  const [coast, setCoast] = useState<Coast>(IDLE);
  const req = useRef(0);
  const here = lat != null && lon != null;
  // The latest onChange without re-running the analysis effect when the parent re-renders.
  const change = useRef(onChange);
  change.current = onChange;

  const set = (patch: Dir) => { touched.current = true; onChange({ dirC: c, dirW: w, ...patch }); };
  const setCentre = (v: number) => set(any ? { dirC: v, dirW: FIRST_WIDTH } : { dirC: v });

  async function run(auto: boolean) {
    if (lat == null || lon == null) return;
    const token = ++req.current, point = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    setCoast({ state: "loading", auto });
    try {
      const result = await analyzeCoast(lat, lon);
      if (token !== req.current) return; // the pin moved on, or we unmounted
      const apply = !auto || !touched.current;
      const sug = result.suggestion;
      if (apply && sug) change.current(sug === "any" ? { dirC: undefined, dirW: 360 } : sug);
      setCoast({ state: "done", result, applied: apply && result.suggestion != null, auto, at: point });
    } catch (e) {
      if (token === req.current) setCoast({ state: "error", msg: (e as Error).message, auto });
    }
  }

  // A new point invalidates the last analysis; with autoSuggest, read the coast there after a short settle.
  const at = here ? `${lat!.toFixed(5)},${lon!.toFixed(5)}` : null;
  useEffect(() => {
    setCoast((s) => (s.state === "idle" ? s : IDLE));
    req.current++;
    if (!autoSuggest || at == null) return;
    const t = setTimeout(() => run(true), 250);
    return () => { clearTimeout(t); req.current++; };
  }, [at, autoSuggest]); // `run` reads this render's lat/lon, which `at` stands for

  const result = coast.state === "done" ? coast.result : undefined;
  const label = arcLabel(any ? undefined : { dirC: c, dirW: w });
  const [arcHead, arcSpan] = any ? [label, null] : [label.replace(/ \(.*\)$/, ""), label.match(/\((.*)\)/)?.[1]];

  return (
    <div role="group" aria-labelledby={id}>
      <FieldHeader id={id} title="Wind direction" value={<>{arcHead}{arcSpan && <Unit> · {arcSpan}</Unit>}</>} />
      <div className="mt-3 flex items-center gap-4">
        <Compass c={c} w={w} any={any} result={result} loading={coast.state === "loading"} onAim={setCentre} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <DirSlider label="Centre" min={0} max={355} step={5} value={c} quiet={any}
            display={<>{compass(c)} <Unit>{Math.round(c)}°</Unit></>} valueText={`${compass(c)}, ${Math.round(c)}°`} onChange={setCentre} />
          <DirSlider label="Width" min={30} max={360} step={10} value={w} fill
            display={any ? "Any" : `${Math.round(w)}°`} valueText={any ? "Any direction" : `${Math.round(w)}° wide`} onChange={(v) => set({ dirW: v })} />
        </div>
      </div>

      {here && (
        <div className="mt-4">
          <Button className="w-full" onClick={() => run(false)} disabled={coast.state === "loading"} aria-describedby={`${id}-coast`}>
            {coast.state === "loading" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Suggest from coastline
          </Button>
          {/* Always in the DOM (a live region must exist before it changes); each message brings its own top space. */}
          <div id={`${id}-coast`} role="status" aria-live="polite">
            {coast.state === "loading" && <p className="pt-2.5 text-caption text-fg-2">Reading the coastline…</p>}
            {coast.state === "error" && (
              <p className="flex items-start gap-2 pt-2.5 text-caption text-fg-2">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-soon" />
                {coast.auto ? "Couldn't read the coastline here. Try again, or set the arc yourself." : `Couldn't read map data: ${coast.msg}`}
              </p>
            )}
            {coast.state === "done" && <CoastSummary coast={coast} />}
          </div>
        </div>
      )}
      <p className="mt-3 text-caption text-fg-3">
        Directions are where the wind blows <em>from</em>. {pointerVerb()} or drag on the compass to aim the arc; hours outside it don't
        count as rideable.
      </p>
    </div>
  );
}

function CoastSummary({ coast }: { coast: Extract<Coast, { state: "done" }> }) {
  const { suggestion, fetch } = coast.result;
  const sectors = KIND_ORDER.map((k) => ({ k, runs: runsOf(fetch, k) })).filter((s) => s.runs.length);
  return (
    <div className="flex flex-col gap-2 pt-2.5">
      <p className="text-caption text-fg-2" data-testid="coast-summary" data-for={coast.at}>
        {suggestion === "any" ? "Open water in every direction, so no limit is needed."
          : suggestion ? `Clean water (3 km+) upwind from ${arcLabel(suggestion)}.`
          : "No direction has 3 km of open water upwind. Is the pin on land?"}
        {suggestion != null && coast.auto && (
          <span className="text-fg-3"> {coast.applied ? "Set automatically; adjust it if you know the spot." : "Your arc is kept; Suggest from coastline applies this one."}</span>
        )}
      </p>
      <ul aria-label="Coastline around the spot" className="flex flex-wrap gap-1.5">
        {sectors.map(({ k, runs }) => (
          <li key={k}>
            <Chip tone={KIND[k].tone} size="md" title={KIND[k].detail}>
              <span aria-hidden className={clsx("size-1.5 rounded-full", k === "open" ? "bg-go" : k === "limited" ? "bg-soon" : "bg-strong")} />
              {KIND[k].word} <span className="num font-normal opacity-80">{runs.join(", ")}</span>
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- The compass ---------- */

const V = 120, O = V / 2; // viewBox and centre
const R_DISC = 44, R_RING0 = 48.5, R_RING1 = 55;
const rad = (d: number) => (d * Math.PI) / 180;
const xy = (deg: number, r: number) => [+(O + r * Math.sin(rad(deg))).toFixed(2), +(O - r * Math.cos(rad(deg))).toFixed(2)] as const;
const pt = (deg: number, r: number) => xy(deg, r).join(" ");
const arcPath = (c: number, w: number, r: number) => `M${pt(c - w / 2, r)} A${r} ${r} 0 ${w > 180 ? 1 : 0} 1 ${pt(c + w / 2, r)}`;
const sector = (a0: number, a1: number, r0: number, r1: number) =>
  `M${pt(a0, r1)} A${r1} ${r1} 0 0 1 ${pt(a1, r1)} L${pt(a1, r0)} A${r0} ${r0} 0 0 0 ${pt(a0, r0)} Z`;
const SECTORS = Array.from({ length: 16 }, (_, i) => i * 22.5);

function Compass({ c, w, any, result, loading, onAim }: {
  c: number; w: number; any: boolean; result?: CoastResult; loading: boolean; onAim: (deg: number) => void;
}) {
  const dragging = useRef(false);
  const aim = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < r.width * 0.08) return; // too close to the centre to mean a direction
    const deg = ((Math.round(((Math.atan2(x, -y) * 180) / Math.PI) / 5) * 5) % 360 + 360) % 360;
    if (deg !== c || any) onAim(deg);
  };
  const coastWords = result
    ? KIND_ORDER.map((k) => ({ k, runs: runsOf(result.fetch, k) })).filter((s) => s.runs.length).map((s) => `${KIND[s.k].word} ${s.runs.join(", ")}`).join("; ")
    : "";
  return (
    <svg viewBox={`0 0 ${V} ${V}`} data-vaul-no-drag role="img"
      aria-label={`Rideable directions: ${arcLabel(any ? undefined : { dirC: c, dirW: w })}${coastWords ? `. ${coastWords}` : ""}`}
      className="size-33 shrink-0 cursor-pointer touch-none select-none max-[359px]:size-28"
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); aim(e); }}
      onPointerMove={(e) => dragging.current && aim(e)}
      onPointerUp={() => (dragging.current = false)} onPointerCancel={() => (dragging.current = false)}>
      {/* coastline ring: grey until the analysis has run, then onshore / short fetch / offshore per sector */}
      <g className={clsx(loading && "motion-safe:animate-pulse")}>
        {SECTORS.map((d, i) => {
          const f = result?.fetch[i];
          return (
            <path key={d} d={sector(d - 10.4, d + 10.4, R_RING0, R_RING1)}
              className={f ? KIND[f.kind].fill : "fill-line-strong"} fillOpacity={f ? (f.kind === "open" ? 0.6 : 0.9) : 1}>
              {f && <title>{`${compass(d)}: ${KIND[f.kind].word.toLowerCase()} (${KIND[f.kind].detail})`}</title>}
            </path>
          );
        })}
      </g>
      <circle cx={O} cy={O} r={R_DISC} className="fill-surface-2 stroke-line-strong" strokeWidth="0.75" />
      {/* the rideable arc */}
      {any
        ? <circle cx={O} cy={O} r={R_DISC - 1.5} className="fill-go stroke-go" fillOpacity="0.07" strokeOpacity="0.45" strokeWidth="2" />
        : <g>
            <path d={`M${O} ${O} L${arcPath(c, w, R_DISC - 1.5).slice(1)} Z`} className="fill-go" fillOpacity="0.16" />
            <path d={arcPath(c, w, R_DISC - 1.5)} fill="none" className="stroke-go" strokeWidth="3" strokeLinecap="round" />
          </g>}
      {SECTORS.map((d) => (
        <line key={d} x1={O} y1={O - R_DISC + 3} x2={O} y2={O - R_DISC + (d % 90 === 0 ? 8 : 5.5)} transform={`rotate(${d} ${O} ${O})`}
          className={d % 90 === 0 ? "stroke-fg-2" : "stroke-fg-3"} strokeWidth={d % 90 === 0 ? 1.2 : 0.7} strokeLinecap="round" />
      ))}
      {(["N", "E", "S", "W"] as const).map((l, i) => (
        <text key={l} x={O + 28 * Math.sin(rad(i * 90))} y={O - 28 * Math.cos(rad(i * 90))} textAnchor="middle" dominantBaseline="central"
          fontSize="10" fontWeight="600" className={l === "N" ? "fill-fg" : "fill-fg-3"}>{l}</text>
      ))}
      {/* the aim handle at the centre of the arc */}
      {!any && (
        <g>
          <line x1={O} y1={O} x2={O} y2={O - R_DISC + 9} transform={`rotate(${c} ${O} ${O})`} className="stroke-go" strokeOpacity="0.6" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={xy(c, R_DISC - 1.5)[0]} cy={xy(c, R_DISC - 1.5)[1]} r="4.5" className="fill-fg stroke-ink" strokeWidth="1.5" />
        </g>
      )}
      <circle cx={O} cy={O} r="2" className="fill-fg-3" />
    </svg>
  );
}

function DirSlider({ label, min, max, step, value, display, valueText, quiet, fill, onChange }: {
  label: string; min: number; max: number; step: number; value: number; display: ReactNode; valueText: string;
  quiet?: boolean; fill?: boolean; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="text-fg-2">{label}</span>
        <span className={clsx("num font-medium", quiet ? "text-fg-3" : "text-fg")}>{display}</span>
      </div>
      <Slider.Root data-vaul-no-drag className={clsx(sliderRootClass, "h-8")} min={min} max={max} step={step} value={[value]}
        onValueChange={([v]) => onChange(v)}>
        <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
          {fill && <Slider.Range className="absolute h-full rounded-full bg-go/70" />}
        </Slider.Track>
        <Slider.Thumb aria-label={label} aria-valuetext={valueText} className={clsx(sliderThumbClass, "size-5 before:-inset-3")} />
      </Slider.Root>
    </div>
  );
}
