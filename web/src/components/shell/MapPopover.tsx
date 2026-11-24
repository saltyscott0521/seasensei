import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { duration, ease } from "../../lib/motion";
import { IconButton } from "../ui/IconButton";

/**
 * A small non-modal popover over the map (never in the sheet's scroll): under the top chrome on phones, beside the panel
 * on desktop (`style` places it). Used by the morning briefing and the app settings. Escape, the close button or a press
 * outside closes it (a press on anything carrying `toggleAttr`, its own buttons, is left to them); focus moves in on open
 * and back to what opened it on close. Portalled to <body>, so vaul never aria-hides it on phones.
 */
export function MapPopover({ open, onClose, style, toggleAttr, closeLabel, children, ...rest }: {
  open: boolean; onClose: () => void; style: CSSProperties; toggleAttr: string; closeLabel: string;
  children: (titleId: string) => ReactNode; [data: `data-${string}`]: unknown;
}) {
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
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest?.(`[${toggleAttr}]`)) return;
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
  }, [open, toggleAttr]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} role="dialog" aria-labelledby={titleId} tabIndex={-1} {...rest}
          initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: duration.fast, ease }} style={style}
          className="fixed z-40 max-h-[calc(100dvh-96px)] overflow-y-auto overscroll-contain rounded-lg border border-line-strong bg-surface-1-solid shadow-float outline-none">
          <div className="absolute right-1.5 top-1.5">
            <IconButton aria-label={closeLabel} size="sm" variant="ghost" onClick={onClose}><X /></IconButton>
          </div>
          {children(titleId)}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
