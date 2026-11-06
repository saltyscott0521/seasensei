import clsx from "clsx";
import { ArrowLeft, Compass, Gauge, Settings2 } from "lucide-react";
import { memo, type Ref } from "react";
import { arcLabel, type Spot } from "../../lib/wind";
import { IconButton } from "../ui";
import { dirChip } from "./format";

/**
 * Back, the spot's name (the view's h2, focused on open; it wraps rather than truncate), its range and directions as
 * plain facts (not chips: they aren't controls — the settings button is), and the settings toggle.
 * Coordinates live in the settings.
 */
export const SpotHeader = memo(function SpotHeader({ spot, onBack, editing, onToggleEditing, titleRef, settingsRef }: {
  spot: Spot; onBack: () => void; editing: boolean; onToggleEditing: () => void;
  titleRef?: Ref<HTMLHeadingElement>; settingsRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <header className="flex items-start gap-1.5">
      <IconButton aria-label="Back to spots" onClick={onBack} className="-ml-2 shrink-0"><ArrowLeft /></IconButton>
      <div className="min-w-0 flex-1 pt-[7px]">
        <h2 ref={titleRef} tabIndex={-1} id="spot-title" className="break-words text-heading font-semibold leading-[26px] tracking-tight text-fg outline-none">{spot.name}</h2>
        <SpotFacts spot={spot} className="mt-1" />
      </div>
      <IconButton ref={settingsRef} aria-label="Spot settings" pressed={editing} onClick={onToggleEditing} className="-mr-1 shrink-0"><Settings2 /></IconButton>
    </header>
  );
});

/** "15–30 kn · SW ±45°" with small glyphs: the rider's range and workable directions, as a quiet caption. */
export function SpotFacts({ spot, className }: { spot: Spot; className?: string }) {
  return (
    <p className={clsx("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-label text-fg-2", className)}>
      <span className="inline-flex items-center gap-1" title="Wind range you ride here">
        <Gauge aria-hidden className="size-3.5 text-fg-3" strokeWidth={2.25} />
        <span className="sr-only">Your range: </span><span className="num">{spot.min}–{spot.max} kn</span>
      </span>
      <span aria-hidden className="text-fg-3">·</span>
      <span className="inline-flex items-center gap-1" title={`Workable wind: ${arcLabel(spot)}`}>
        <Compass aria-hidden className="size-3.5 text-fg-3" strokeWidth={2.25} />
        <span>{dirChip(spot)}</span>
      </span>
    </p>
  );
}
