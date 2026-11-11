import clsx from "clsx";
import { useId } from "react";
import { fmtAge, type Freshness } from "../../lib/freshness";
import { fmtHour, fmtWeekday } from "../../lib/session";
import { MODEL_INFO, type Model } from "../../lib/wind";

export type StatusProps = {
  /** The wind field has loaded. */
  ready: boolean;
  /** The wind field request failed. */
  failed: boolean;
  /** The timeline's selected hour (ms), or null for now. */
  at: number | null;
  primary: Model;
  /** The rider's time zone (the timeline's). */
  tz: string;
  /** How old the forecast on screen is (lib/freshness.ts). Without it, the forecast is taken as current. */
  fresh?: Freshness;
};

type Tone = "now" | "forecast" | "loading" | "failed" | "stale";

/**
 * The agreed status copy. Named for the forecast the rider chose, never for the map's own model:
 * "Now · SeaSensei forecast", "Forecast · Sat 3 PM", "Loading wind…", "Wind field unavailable". When what is on screen
 * is older than a normal refresh (a saved board, no signal, a provider that isn't answering) it says how old instead
 * of "Now": "Updated 3 h ago · offline", "Updated 50 min ago · retrying", scrubbed "Sat 3 PM · updated 3 h ago".
 */
export function status({ ready, failed, at, primary, tz, fresh }: StatusProps): { text: string; tone: Tone } {
  if (fresh?.old && fresh.updatedAt != null) {
    const age = fmtAge(fresh.updatedAt);
    if (at != null) return { text: `${fmtWeekday(at, tz)} ${fmtHour(at, tz)} · updated ${age}`, tone: "stale" };
    const why = !fresh.online ? "offline" : fresh.trying;
    return { text: `Updated ${age}${why ? ` · ${why}` : ""}`, tone: "stale" };
  }
  if (ready) return at != null
    ? { text: `Forecast · ${fmtWeekday(at, tz)} ${fmtHour(at, tz)}`, tone: "forecast" }
    : { text: `Now · ${MODEL_INFO[primary].label} forecast`, tone: "now" };
  if (fresh && !fresh.online) return { text: "Offline", tone: "failed" };
  return failed ? { text: "Wind field unavailable", tone: "failed" } : { text: "Loading wind…", tone: "loading" };
}

/** The app mark (the same artwork as the home-screen icon), drawn inline so it needs no request and works offline. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden className={clsx("shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0b1a2e" /><stop offset="1" stopColor="#05080f" /></linearGradient>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#22d3ee" /><stop offset=".55" stopColor="#34d399" /><stop offset="1" stopColor="#a3e635" /></linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${id}bg)`} />
      <rect x="8" y="8" width="496" height="496" rx="104" fill="none" stroke="white" strokeOpacity=".1" strokeWidth="16" />
      <g fill="none" stroke={`url(#${id}g)`} strokeLinecap="round" strokeWidth="30">
        <path d="M96 214c46-40 92-40 138 0s92 40 138 0 46-20 46-20" />
        <path d="M96 290c46-40 92-40 138 0s92 40 138 0" opacity=".8" />
        <path d="M96 366c46-40 92-40 138 0s92 40 138 0" opacity=".5" />
      </g>
      <path d="M332 92c44 22 72 58 80 104h-80z" fill="#e6edf7" />
    </svg>
  );
}

const DOT: Record<Tone, string> = {
  now: "bg-accent",
  forecast: "bg-fg-2",
  loading: "bg-fg-3 animate-pulse",
  failed: "bg-strong",
  stale: "bg-fg-3", // a hollow-looking, quiet dot: not live
};

/** A status dot and the status text. The text sits alone in its span (tests match it by its exact start). */
export function StatusLine(props: StatusProps & { className?: string }) {
  const { text, tone } = status(props);
  return (
    <span className={clsx("flex min-w-0 items-center gap-1.5", props.className)}>
      <span className="relative flex size-1.5 shrink-0" aria-hidden>
        {/* A few soft pulses when "now" comes in, then a still dot (an endless ping keeps the page busy). */}
        {tone === "now" && <span className="halo absolute inset-0 rounded-full bg-accent" />}
        <span className={clsx("relative size-1.5 rounded-full", DOT[tone])} />
      </span>
      <span className="num truncate" data-status={tone}>{text}</span>
    </span>
  );
}

/** Phones: the one piece of top-left chrome — the mark, the name and the wind-field status. */
export function StatusPill({ hidden, ...props }: StatusProps & { hidden?: boolean }) {
  return (
    <div data-testid="status-pill" data-map-chrome
      className={clsx("glass pointer-events-auto flex h-[46px] max-w-[calc(100vw-96px)] items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-3.5",
        "transition-[opacity,visibility] duration-200 ease-ui", hidden && "invisible opacity-0")}>
      <BrandMark size={32} className="rounded-[9px]" />
      <div className="min-w-0 leading-tight">
        <div className="text-label font-semibold tracking-tight text-fg">SeaSensei</div>
        <StatusLine {...props} className="text-micro text-fg-2" />
      </div>
    </div>
  );
}

/** Desktop: the brand and status at the top of the docked panel. */
export function PanelBrand(props: StatusProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <BrandMark size={36} className="rounded-[10px]" />
      <div className="min-w-0 leading-tight">
        <h1 className="text-title font-semibold tracking-tight text-fg">SeaSensei</h1>
        <StatusLine {...props} className="mt-0.5 text-caption text-fg-2" />
      </div>
    </div>
  );
}
