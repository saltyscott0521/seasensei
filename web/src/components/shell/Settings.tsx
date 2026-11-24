import clsx from "clsx";
import { Check, Settings2 } from "lucide-react";
import { type CSSProperties } from "react";
import { WIND_SCALE_IDS, WIND_SCALES, windGradient } from "../../lib/wind";
import { chooseWindScale, useWindScale } from "../../lib/windScale";
import { IconButton } from "../ui/IconButton";
import { MapPopover } from "./MapPopover";

type ButtonProps = { open: boolean; onToggle: () => void; panelId: string };
const LABEL = "App settings";

/**
 * The app settings' gear, beside the briefing's bell: on phones a round glass button in the top-left map chrome, on
 * desktop in the panel's header. Like the bell, phones get `SettingsEntry` inside the sheet for keyboards and screen
 * readers (vaul aria-hides the map chrome).
 */
export function SettingsButton({ open, onToggle, panelId, variant, hidden }: ButtonProps & { variant: "map" | "panel"; hidden?: boolean }) {
  if (variant === "panel") {
    return (
      <IconButton aria-label={LABEL} size="sm" aria-expanded={open} aria-controls={open ? panelId : undefined} data-settings-button
        onClick={onToggle} className={clsx("shrink-0", open && "text-accent hover:text-accent")}>
        <Settings2 />
      </IconButton>
    );
  }
  return (
    <button type="button" aria-label={LABEL} aria-expanded={open} aria-controls={open ? panelId : undefined}
      data-settings-button data-testid="settings-button" data-map-chrome onClick={onToggle}
      className={clsx("glass pointer-events-auto grid size-[46px] shrink-0 place-items-center rounded-lg transition-[opacity,visibility,color] duration-200 ease-ui [&_svg]:size-5",
        open ? "text-accent" : "text-fg-2 hover:text-fg", hidden && "invisible opacity-0")}>
      <Settings2 />
    </button>
  );
}

/** Phones, inside the sheet: the gear's twin for keyboards and screen readers. Out of sight until it has keyboard focus. */
export function SettingsEntry({ open, onToggle, panelId }: ButtonProps) {
  return (
    <button type="button" aria-expanded={open} aria-controls={open ? panelId : undefined} data-settings-button onClick={onToggle}
      className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:right-3 focus-visible:top-1.5 focus-visible:z-30 focus-visible:rounded-full focus-visible:bg-surface-3 focus-visible:px-3 focus-visible:py-1 focus-visible:text-caption focus-visible:text-fg">
      {LABEL}
    </button>
  );
}

export function SettingsPopover({ open, onClose, panelId, style }: { open: boolean; onClose: () => void; panelId: string; style: CSSProperties }) {
  return (
    <MapPopover open={open} onClose={onClose} style={style} toggleAttr="data-settings-button" closeLabel="Close app settings" data-settings-popover>
      {(titleId) => <SettingsPanel id={panelId} titleId={titleId} />}
    </MapPopover>
  );
}

/** What the app looks like, for this device: for now, the wind colour scale (lib/windScale.ts). The whole app follows a pick at once. */
function SettingsPanel({ id, titleId }: { id: string; titleId: string }) {
  const scale = useWindScale();
  return (
    <section id={id} aria-labelledby={titleId} className="px-4 pb-4 pt-3">
      <h3 id={titleId} className="pr-10 text-label font-semibold text-fg">Settings</h3>
      <fieldset className="mt-3">
        <legend className="text-caption font-medium text-fg-2">Wind colours</legend>
        <p className="text-caption text-fg-3">For the map, the timeline, the charts and the cards.</p>
        <div className="mt-2.5 grid gap-2">
          {WIND_SCALE_IDS.map((k) => {
            const on = scale === k;
            return (
              <label key={k} className={clsx("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 ring-1 ring-inset transition-colors duration-150 max-md:py-3 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent",
                on ? "bg-accent-soft ring-accent/40" : "bg-surface-2 ring-line hover:ring-line-strong")}>
                <input type="radio" name="wind-scale" value={k} checked={on} onChange={() => chooseWindScale(k)} className="sr-only" />
                <span className="min-w-0 flex-1">
                  <span className="block text-label font-medium text-fg">{WIND_SCALES[k].label}</span>
                  <span className="block truncate text-micro text-fg-3">{WIND_SCALES[k].note}</span>
                  <i aria-hidden className="mt-1.5 block h-2 rounded-full" style={{ background: windGradient("90deg", k) }} />
                </span>
                <span aria-hidden className={clsx("grid size-5 shrink-0 place-items-center rounded-full ring-1 ring-inset [&_svg]:size-3.5",
                  on ? "bg-accent text-ink ring-accent" : "ring-line-strong text-transparent")}><Check strokeWidth={3} /></span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
