import clsx from "clsx";
import { Bell, BellRing } from "lucide-react";
import { type CSSProperties } from "react";
import { useBriefingSettings } from "../../lib/briefingClient";
import { MapPopover } from "../shell/MapPopover";
import { IconButton } from "../ui/IconButton";
import { BriefingPanel } from "./BriefingPanel";

type BellProps = { open: boolean; onToggle: () => void; panelId: string };

/**
 * The morning briefing's bell, outside the board: on phones a round glass button beside the status pill (top-left map
 * chrome, so the sheet never carries it); on desktop in the panel's header, by the brand. It opens `BriefingPopover`.
 * Lit (accent, ringing) while the briefing is on.
 *
 * Phones: vaul aria-hides everything outside the sheet, this bell too, so the sheet carries `BriefingEntry`, its way in
 * for keyboards and screen readers. Both open the same popover, which is portalled to <body> after the sheet has
 * hidden its siblings, so it is never aria-hidden itself.
 */
export function BriefingBell({ open, onToggle, panelId, variant, hidden }: BellProps & { variant: "map" | "panel"; hidden?: boolean }) {
  const s = useBriefingSettings();
  const icon = s.on ? <BellRing /> : <Bell />;
  if (variant === "panel") {
    return (
      <IconButton aria-label="Morning briefing" size="sm" aria-expanded={open} aria-controls={open ? panelId : undefined} data-briefing-bell
        onClick={onToggle} className={clsx("shrink-0", s.on && "text-accent hover:text-accent")}>
        {icon}
      </IconButton>
    );
  }
  return (
    <button type="button" aria-label="Morning briefing" aria-expanded={open} aria-controls={open ? panelId : undefined}
      data-briefing-bell data-testid="briefing-bell" data-map-chrome onClick={onToggle}
      className={clsx("glass pointer-events-auto grid size-[46px] shrink-0 place-items-center rounded-lg transition-[opacity,visibility,color] duration-200 ease-ui [&_svg]:size-5",
        open || s.on ? "text-accent" : "text-fg-2 hover:text-fg", hidden && "invisible opacity-0")}>
      {icon}
    </button>
  );
}

/** Phones, inside the sheet: the bell's twin for keyboards and screen readers. Out of sight until it has keyboard focus. */
export function BriefingEntry({ open, onToggle, panelId }: BellProps) {
  return (
    <button type="button" aria-expanded={open} aria-controls={open ? panelId : undefined} data-briefing-bell onClick={onToggle}
      className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-3 focus-visible:top-1.5 focus-visible:z-30 focus-visible:rounded-full focus-visible:bg-surface-3 focus-visible:px-3 focus-visible:py-1 focus-visible:text-caption focus-visible:text-fg">
      Morning briefing
    </button>
  );
}

/** The briefing's settings in the shared map popover (`shell/MapPopover.tsx`). */
export function BriefingPopover({ open, onClose, panelId, style }: { open: boolean; onClose: () => void; panelId: string; style: CSSProperties }) {
  return (
    <MapPopover open={open} onClose={onClose} style={style} toggleAttr="data-briefing-bell" closeLabel="Close briefing settings" data-briefing-popover>
      {(titleId) => <BriefingPanel id={panelId} titleId={titleId} />}
    </MapPopover>
  );
}
