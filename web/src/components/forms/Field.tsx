import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * The title row of a form control: a 13 px label on the left and the current value on the right.
 * Not a heading on purpose: the label names a `role="group"` (via `id`), and the spot name must stay the only
 * heading that contains it.
 * @example <FieldHeader id={id} title="Wind range" value={<>15–30 <Unit>kn</Unit></>} />
 */
export function FieldHeader({ id, title, value, className }: { id?: string; title: ReactNode; value?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex min-h-6 items-baseline justify-between gap-3", className)}>
      <p id={id} className="text-label font-semibold text-fg">{title}</p>
      {value != null && <p className="num min-w-0 truncate text-right text-label font-medium text-fg">{value}</p>}
    </div>
  );
}

/** "Tap" on touch screens, "Click" with a mouse or trackpad, for instructions such as "Tap the map to drop a pin". */
export const pointerVerb = () => (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "Tap" : "Click");

/** A unit or aside after a value, one step quieter. */
export const Unit = ({ children }: { children: ReactNode }) => <span className="font-normal text-fg-3">{children}</span>;

/**
 * Radix slider parts in the night-sea style; add a desktop height to the root (h-9) and a size to the thumb (size-6).
 * The root is 44 px tall on phones (Radix moves the nearest thumb from a press anywhere on it) and thumbs get an
 * invisible halo 20 px wider than they are (44 px for a 24 px thumb). No outline-none:
 * thumbs are role="slider", so they get the global accent focus ring. data-vaul-no-drag on the root stops the phone
 * sheet from taking a horizontal drag as a sheet drag.
 */
export const sliderRootClass = "relative flex w-full touch-none select-none items-center max-md:h-11 data-[disabled]:opacity-50";
export const sliderThumbClass = clsx(
  "relative block cursor-grab rounded-full bg-fg shadow-raised ring-1 ring-ink/20",
  "transition-transform duration-150 ease-ui hover:scale-105 active:scale-110 active:cursor-grabbing",
  "motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
  "before:absolute before:rounded-full data-[disabled]:cursor-default", // + a halo, e.g. before:-inset-2.5
);
/** Thumb half-width in px: Radix keeps thumbs inside the track, offsetting them by up to this much. */
export const THUMB_HALF = 12;

/**
 * Where a value sits horizontally on a Radix slider, matching its thumbs exactly (Radix pulls the thumb in by up
 * to half its width at the ends). Use it for tick labels and range masks.
 */
export const thumbLeft = (value: number, min: number, max: number) => {
  const p = ((value - min) / (max - min)) * 100;
  return `calc(${p}% + ${(THUMB_HALF * (1 - p / 50)).toFixed(2)}px)`;
};
