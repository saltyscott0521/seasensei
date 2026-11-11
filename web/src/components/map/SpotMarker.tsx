import clsx from "clsx";
import { ArrowUp, CalendarDays, Check, Clock3, Hourglass, Navigation2Off } from "lucide-react";
import { motion } from "motion/react";
import { memo } from "react";
import { Marker } from "react-map-gl/maplibre";
import { spring } from "../../lib/motion";
import { useSpotNow } from "../../lib/useSpotNow";
import { nearestHour, windColor, type Hour, type Spot } from "../../lib/wind";
import { WindArrow } from "../bits";
import { capitalise, markerState, TONE_BG, TONE_RING, TONE_TEXT, TONE_TIP, type MarkerGlyph } from "./markerState";

const EMPTY: Hour[] = [];

/** The glyph that pairs with the ring colour (none for "off" with nothing ahead: the plain ring says it). */
const GLYPH: Record<NonNullable<MarkerGlyph>, typeof Check> = {
  check: Check, clock: Clock3, calendar: CalendarDays, up: ArrowUp, offdir: Navigation2Off, short: Hourglass,
};

type Props = {
  spot: Spot;
  selected: boolean;
  /** Its card is hovered or focused in the list: ringed like the selected one and named. */
  highlighted: boolean;
  /** Add mode: the map is for dropping a pin, so markers fade back and let clicks through. */
  dim: boolean;
  /** Outside the open map (under the panel, the sheet or off screen): out of the Tab order until it is in view. */
  offscreen: boolean;
  /** The timeline's hour (null = now). */
  at: number | null;
  /** Show the name under the marker: there is room for it (see map/declutter). Selected or highlighted always show it. */
  labels: boolean;
  /** Its place on the board (0 = best): a better spot's marker stacks over a worse one's. */
  rank: number;
  onSelect: (s: Spot) => void;
};

/** Stacking by board rank (literal classes, so Tailwind sees them); ringed, hovered and focused markers go over all. */
const RANK_Z = ["z-[5]", "z-[4]", "z-[3]", "z-[2]"];

/**
 * A spot on the map: one compact pill with the wind for the shown hour (direction arrow + knots), ringed in the
 * verdict colour with a matching glyph, on a pointer at the spot (on a stem from it where a better spot's pill is in the
 * way, see map/declutter). The name sits by the point wherever it fits,
 * and with the verdict in words when selected, highlighted, hovered or focused. Exactly one MapLibre Marker and one
 * <button> per spot; the button is named `${name}, ${n} knots, ${verdict}`.
 */
export const SpotMarker = memo(function SpotMarker({ spot, selected, highlighted, dim, offscreen, at, labels, rank, onSelect }: Props) {
  const live = useSpotNow(spot);
  const hours = live.fc.data?.hours ?? EMPTY;
  const hour = at != null ? nearestHour(hours, at) : null;
  const shown = at != null ? hour : live.now;
  const state = markerState(spot, shown, { at, hour, pill: live.pill, sessions: live.sessions });
  const n = shown ? Math.round(shown.speed) : null;
  const Glyph = state.glyph ? GLYPH[state.glyph] : null;
  const name = n != null ? `${spot.name}, ${n} knots, ${state.word}` : spot.name;
  const ringed = selected || highlighted;
  const showName = ringed || labels;
  // Solid badge: the state is happening (or the hour is that). Hollow: the right colour, not yet (on later today), or
  // a neutral note (next session another day).
  const badge = state.tone === "off"
    ? "bg-ink text-fg-2 ring-[1.5px] ring-off"
    : state.hollow ? "bg-ink text-go ring-[1.5px] ring-go" : clsx("text-ink ring-2 ring-ink", TONE_BG[state.tone]);

  return (
    <Marker longitude={spot.lon} latitude={spot.lat} anchor="bottom"
      // Spots sit over the cross-hair (z 1) and the station chips, a better-ranked spot over a worse one, and the
      // selected (or highlighted, hovered, focused) one over them all. The map's controls (z 10) stay on top.
      className={clsx(ringed ? "z-[6]" : clsx(RANK_Z[rank] ?? "z-1", "hover:z-[6] focus-within:z-[6]"), dim && "pointer-events-none")}
      onClick={(e) => { e.originalEvent.stopPropagation(); onSelect(spot); }}>
      {/* The button stays on the point for the keyboard; only what you see takes a pointer (the pill, which the
          declutter may nudge aside or lift, and the name), so a tap opens the pill under it. */}
      <button type="button" aria-label={name} aria-current={selected || undefined} tabIndex={dim || offscreen ? -1 : undefined}
        data-spot-marker={spot.id} data-tone={state.tone} data-glyph={state.glyph ?? undefined} data-selected={selected || undefined}
        data-highlighted={highlighted || undefined}
        className={clsx(
          "group pointer-events-none relative flex flex-col items-center outline-none transition-opacity duration-(--dur-base) [-webkit-tap-highlight-color:transparent]",
          dim && "opacity-40",
        )}>
        <motion.span className="relative flex flex-col items-center" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          {/* A stem from the point up to a pill lifted clear of a busier neighbour (declutter scales it; 0 tall otherwise). */}
          <span data-marker-stem aria-hidden className={clsx("absolute bottom-[6px] left-1/2 -ml-px h-px w-0.5 origin-bottom scale-y-0", TONE_BG[state.tone])} />
          <span data-marker-pill
            className={clsx(
              "relative flex h-7 items-center gap-1 rounded-full bg-ink/90 py-0.5 pl-0.5 pr-2 shadow-raised ring-2",
              // the hit area: a taller touch target (≈ 40px) without widening it, so neighbours never steal each other's taps
              !dim && "pointer-events-auto cursor-pointer before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']",
              "origin-bottom transition-[scale,outline-color] duration-(--dur-fast) ease-ui motion-reduce:transition-none",
              // Selection (and keyboard focus, and a hovered list card) is an accent ring outside the verdict ring,
              // with a hairline of map between.
              "outline-2 outline-offset-4 group-hover:scale-105 group-focus-visible:outline-accent",
              selected ? "scale-110 outline-accent group-hover:scale-110" : highlighted ? "scale-105 outline-accent" : "outline-transparent",
              // On later today: the go ring, softened (hollow); on now: the full go ring.
              state.hollow ? "ring-go/55" : TONE_RING[state.tone],
            )}>
            <span className="grid size-6 place-items-center rounded-full"
              style={n != null ? { background: windColor(shown!.speed, 0.2), color: windColor(shown!.speed) } : undefined}>
              {shown
                ? <WindArrow dir={shown.dir} size={13} />
                : <span className="size-1.5 animate-pulse rounded-full bg-fg-3" />}
            </span>
            <span className="num text-label font-semibold leading-none tracking-tight text-fg">{n ?? "–"}</span>
            {Glyph && (
              <span aria-hidden className={clsx("absolute -right-1.5 -top-1.5 isolate grid size-3.5 place-items-center rounded-full", badge)}>
                {state.pulse && <span className={clsx("halo absolute inset-0 -z-10 rounded-full", TONE_BG[state.tone])} />}
                <Glyph className="size-2.5" strokeWidth={3.25} />
              </span>
            )}
          </span>
          {/* The pointer: its tip is the spot's exact location (the marker's anchor). */}
          <span aria-hidden className={clsx("-mt-px h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent", TONE_TIP[state.tone])} />
        </motion.span>
        <span data-marker-label aria-hidden
          className={clsx(
            "absolute left-1/2 top-full mt-1 flex -translate-x-1/2 flex-col items-center whitespace-nowrap rounded-sm bg-ink/85 px-1.5 py-0.5 shadow-raised ring-1 ring-line",
            !dim && "pointer-events-auto cursor-pointer",
            "transition-[opacity,visibility] duration-(--dur-fast) ease-ui",
            showName ? "visible opacity-100" : "invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100",
          )}>
          <span className="text-caption font-semibold leading-4 text-fg">{spot.name}</span>
          {shown && (
            <span className={clsx("text-micro leading-4 font-medium", TONE_TEXT[state.tone], ringed ? "block" : "hidden group-hover:block group-focus-visible:block")}>
              {capitalise(state.word)}
            </span>
          )}
        </span>
      </button>
    </Marker>
  );
});
