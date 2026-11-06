import * as Slider from "@radix-ui/react-slider";
import clsx from "clsx";
import { useId } from "react";
import { windColor, windGradient } from "../../lib/wind";
import { FieldHeader, sliderRootClass, sliderThumbClass, thumbLeft, Unit } from "./Field";

const MIN = 5, MAX = 45;
const TICKS = [5, 15, 25, 35, 45];

/**
 * The spot's wind range in knots: two thumbs on the wind-speed scale. The chosen band shows in full colour, the
 * rest is dimmed, and each thumb carries the colour of its speed. Thumbs are "Minimum knots" / "Maximum knots"
 * and announce "15 knots".
 */
export function RangeSlider({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  const id = useId();
  const [lo, hi] = value;
  return (
    <div role="group" aria-labelledby={id}>
      <FieldHeader id={id} title="Wind range" value={<>{lo}–{hi} <Unit>kn</Unit></>} />
      <Slider.Root data-vaul-no-drag className={clsx(sliderRootClass, "h-9")} min={MIN} max={MAX} step={1}
        minStepsBetweenThumbs={2} value={value} onValueChange={(v) => onChange([v[0], v[1]])}>
        <Slider.Track className="relative h-2 grow overflow-hidden rounded-full" style={{ background: windGradient() }}>
          {/* Dim what's outside the range; edges line up with the thumbs (see thumbLeft). */}
          <span aria-hidden className="absolute inset-y-0 left-0 bg-ink/70" style={{ width: thumbLeft(lo, MIN, MAX) }} />
          <span aria-hidden className="absolute inset-y-0 right-0 bg-ink/70" style={{ left: thumbLeft(hi, MIN, MAX) }} />
        </Slider.Track>
        {[lo, hi].map((v, i) => (
          <Slider.Thumb key={i} aria-label={i ? "Maximum knots" : "Minimum knots"} aria-valuetext={`${v} knots`} className={clsx(sliderThumbClass, "size-6 before:-inset-2.5")}>
            <span aria-hidden className="absolute inset-[7px] rounded-full ring-1 ring-ink/25" style={{ background: windColor(v) }} />
          </Slider.Thumb>
        ))}
      </Slider.Root>
      <div aria-hidden className="num relative h-4 text-micro text-fg-3 max-md:-mt-1">
        {TICKS.map((k) => (
          <span key={k} className="absolute top-0 -translate-x-1/2" style={{ left: thumbLeft(k, MIN, MAX) }}>{k}</span>
        ))}
      </div>
    </div>
  );
}
