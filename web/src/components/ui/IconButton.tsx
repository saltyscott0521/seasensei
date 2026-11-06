import clsx from "clsx";
import type { ComponentPropsWithRef, ReactNode } from "react";

export type IconButtonVariant = "ghost" | "tonal" | "glass";
export type IconButtonSize = "sm" | "md";

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: "text-fg-2 hover:bg-surface-3 hover:text-fg",
  tonal: "bg-surface-2 text-fg-2 ring-1 ring-inset ring-line hover:bg-surface-3 hover:text-fg",
  // Floating chrome over the map only (never inside a glass panel: no glass on glass).
  glass: "glass text-fg-2 hover:text-fg",
};
const PRESSED = "bg-accent-soft text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent-soft hover:text-accent";

// Visual 36 / 40 px (32+ on desktop). On phones an invisible ::before grows the hit area to 44 px without
// changing layout; pseudo-elements hit-test as the button, so taps on the halo still land.
const SIZE: Record<IconButtonSize, string> = {
  sm: "size-9 [&_svg]:size-4 max-md:before:-inset-1",
  md: "size-10 [&_svg]:size-5 max-md:before:-inset-0.5",
};

/**
 * The class string behind `IconButton`, for a `motion.button` or a link styled the same way.
 * @example <motion.button whileTap={{ scale: 0.94 }} aria-label="Close" className={iconButtonClass("ghost")}><X /></motion.button>
 */
export const iconButtonClass = (variant: IconButtonVariant = "ghost", size: IconButtonSize = "md", pressed = false) =>
  clsx(
    "relative inline-grid shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150",
    "before:absolute before:rounded-full [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-40",
    // aria-disabled (focus stays put, e.g. on an archive arrow that just reached the end): looks disabled, stays focusable
    "aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-fg-2",
    SIZE[size], pressed ? clsx(variant === "glass" && "glass", PRESSED) : VARIANT[variant],
  );

export type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "aria-label" | "children"> & {
  /** Required: an icon button has no text, so this is its name (tests and screen readers use it). */
  "aria-label": string;
  /** The icon, e.g. a lucide `<X />`. It is sized for you (16 px in `sm`, 20 px in `md`) and hidden from screen readers. */
  children: ReactNode;
  /** `ghost` (default) for in-panel actions, `tonal` for a quiet filled button, `glass` for map chrome. */
  variant?: IconButtonVariant;
  /** `sm` 36 px or `md` 40 px visual (default). Both are 44 px to the thumb on phones. */
  size?: IconButtonSize;
  /** Makes it a toggle: sets `aria-pressed` and shows the accent "on" state. Leave undefined for a plain button. */
  pressed?: boolean;
};

/**
 * A round, icon-only button with a required accessible name and a phone-sized hit area.
 * @example <IconButton aria-label="Back to spots" onClick={onBack}><ArrowLeft /></IconButton>
 * @example <IconButton aria-label="Show live stations" variant="glass" pressed={on} onClick={toggle}><RadioTower /></IconButton>
 */
export function IconButton({ variant = "ghost", size = "md", pressed, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} aria-pressed={pressed} className={clsx(iconButtonClass(variant, size, !!pressed), className)}>
      <span aria-hidden className="contents">{children}</span>
    </button>
  );
}
