import clsx from "clsx";
import type { CSSProperties } from "react";
import type { Band } from "../../lib/layout";

/**
 * A faint cross-hair at the centre of the visible map band: the point the map padding centres on (so a selected
 * spot lands here) and roughly what the timeline's "in view" outlook summarises. It is confined to the band, so
 * it never paints over the panel, the sheet or the timeline. --cx / --cy are the centre's page coordinates.
 *
 * `drop` (adding a spot, before a pin is down): an accent reticle instead, marking where "Use map centre" drops the
 * pin, so a keyboard user can pan the map (arrow keys on the focused map) and see where the pin will land.
 */
export function ViewTarget({ band, drop = false }: { band: Band; drop?: boolean }) {
  const { top, right, bottom, left } = band;
  const w = right - left, h = bottom - top;
  if (h < 72 || w < 72) return null;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  // Follows the sheet with vaul's own easing when it snaps.
  const move = "absolute transition-[top,left,width,height] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";
  return (
    <div role="img" data-testid="view-target" data-drop={drop || undefined}
      aria-label={drop ? "Map centre. Use map centre drops the new spot's pin here." : "Map centre. The wind outlook summarises the map around this point."}
      className={clsx("pointer-events-none absolute inset-0 z-[1]", drop && "view-target-drop")} style={{ "--cx": `${cx}px`, "--cy": `${cy}px` } as CSSProperties}>
      {/* Hairlines that fade out toward the band's edges and leave a gap where they cross. */}
      <div className={`${move} view-target-v w-px`} style={{ left: cx, top, height: h }} />
      <div className={`${move} view-target-h h-px`} style={{ top: cy, left, width: w }} />
      <div className={`${move} size-0`} style={{ left: cx, top: cy }}>
        {drop
          ? <span className="absolute -left-3 -top-3 grid size-6 place-items-center rounded-full border-2 border-accent bg-accent-soft shadow-raised">
              <span className="size-1.5 rounded-full bg-accent" />
            </span>
          : <span className="absolute -left-1 -top-1 size-2 rounded-full border border-fg-3" />}
      </div>
    </div>
  );
}
