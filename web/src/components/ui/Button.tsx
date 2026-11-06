import clsx from "clsx";
import type { ComponentPropsWithRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  // Solid light button with ink text: the one obvious action in a view ("Save spot").
  // Disabled, it goes quiet (a hollow surface, faint text) rather than a half-lit slab louder than every live control.
  primary: "bg-fg text-ink hover:bg-fg/90 disabled:bg-surface-3 disabled:text-fg-3 disabled:ring-1 disabled:ring-inset disabled:ring-line",
  secondary: "bg-surface-2 text-fg ring-1 ring-inset ring-line hover:bg-surface-3 hover:ring-line-strong",
  ghost: "text-fg-2 hover:bg-surface-3 hover:text-fg",
  danger: "bg-strong/12 text-strong ring-1 ring-inset ring-strong/30 hover:bg-strong/20",
};
// md is 44 px everywhere (forms, sheet actions); sm is 32 px on desktop and still 44 px on phones.
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-caption [&_svg]:size-4 max-md:h-11 max-md:px-3.5 max-md:text-label",
  md: "h-11 gap-2 px-4 text-body [&_svg]:size-[18px]",
};

/**
 * The class string behind `Button`, for a `motion.button` or an `<a>` that should look like one.
 * @example <a href={url} className={buttonClass("secondary", "sm")}>Open in NWS</a>
 */
export const buttonClass = (variant: ButtonVariant = "secondary", size: ButtonSize = "md") =>
  clsx(
    "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150",
    "[&_svg]:shrink-0 disabled:pointer-events-none", variant !== "primary" && "disabled:opacity-50",
    VARIANT[variant], SIZE[size],
  );

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  /** `secondary` (default), `primary` for the main action, `ghost` for quiet ones, `danger` for destructive ones. */
  variant?: ButtonVariant;
  /** `md` 44 px (default) or `sm` 32 px (44 px on phones). */
  size?: ButtonSize;
};

/**
 * A text button (with an optional leading lucide icon). Defaults to `type="button"`.
 * @example <Button variant="primary" onClick={save}>Save spot</Button>
 * @example <Button size="sm" onClick={() => refetch()}><RotateCw /> Retry</Button>
 */
export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={clsx(buttonClass(variant, size), className)} />;
}
