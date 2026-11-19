import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellRing, X } from "lucide-react";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useBriefingSettings } from "../../lib/briefingClient";
import { duration, ease } from "../../lib/motion";
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

/**
 * The briefing's settings as a small non-modal popover over the map (never in the sheet's scroll): under the top chrome
 * on phones, beside the panel on desktop (`style` places it). Escape, the close button or a tap outside closes it;
 * focus moves in on open and back to what opened it on close.
 */
export function BriefingPopover({ open, onClose, panelId, style }: { open: boolean; onClose: () => void; panelId: string; style: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    let restore = true;
    // Capture phase + stopPropagation: Escape closes the popover only, not the view under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeFn.current();
    };
    // A press anywhere else closes it (the bells toggle it themselves); focus stays where that press put it.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest?.("[data-briefing-bell]")) return;
      restore = false;
      closeFn.current();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      if (restore && opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-briefing-popover
          initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: duration.fast, ease }} style={style}
          className="fixed z-40 max-h-[calc(100dvh-96px)] overflow-y-auto overscroll-contain rounded-lg border border-line-strong bg-surface-1-solid shadow-float outline-none">
          <div className="absolute right-1.5 top-1.5">
            <IconButton aria-label="Close briefing settings" size="sm" variant="ghost" onClick={onClose}><X /></IconButton>
          </div>
          <BriefingPanel id={panelId} titleId={titleId} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
