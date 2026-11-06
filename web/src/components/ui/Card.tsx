import clsx from "clsx";
import type { ComponentPropsWithRef } from "react";

export type CardPadding = "none" | "sm" | "md";

const PAD: Record<CardPadding, string> = { none: "", sm: "p-3", md: "p-3.5" };

/**
 * The class string behind `Card`, for a `motion.button` / `motion.div` or a `<section>` that must keep its tag.
 * `interactive` adds hover/press feedback and a full-width left-aligned button reset; `selected` raises it.
 * @example <motion.button layout className={cardClass({ interactive: true })} onClick={open}>…</motion.button>
 */
export const cardClass = ({ interactive = false, selected = false, go = false, padding = "md" }: { interactive?: boolean; selected?: boolean; go?: boolean; padding?: CardPadding } = {}) =>
  clsx(
    "rounded-lg border",
    // `go`: a faint go wash and edge, for the card that carries a rideable answer (the board's best spot)
    go ? "border-go/30 bg-go/[.05]" : selected ? "border-line-strong bg-surface-3" : "border-line bg-surface-2",
    interactive && "block w-full cursor-pointer text-left transition-colors duration-150 active:bg-surface-3 disabled:cursor-default disabled:opacity-50",
    interactive && (go ? "hover:border-go/45 hover:bg-go/[.08]" : "hover:border-line-strong hover:bg-surface-3"),
    PAD[padding],
  );

type Common = {
  /** Inner padding: `md` 14 px (default), `sm` 12 px, `none` for edge-to-edge content such as a chart. */
  padding?: CardPadding;
  /** Raised look for the chosen card in a list. */
  selected?: boolean;
};
export type CardProps =
  | (Common & { interactive?: false } & ComponentPropsWithRef<"div">)
  | (Common & { interactive: true } & ComponentPropsWithRef<"button">);

/**
 * A flat card inside a panel: surface-2 fill, hairline border, 18 px radius. Never glass (no glass on glass).
 * With `interactive` it renders a `<button type="button">` whose accessible name is its text, so a heading inside
 * it names the button (the spot list relies on that).
 * @example <Card><SectionHeader title="Sessions" />…</Card>
 * @example <Card interactive onClick={() => onSelect(spot)}><h3>{spot.name}</h3>…</Card>
 */
export function Card(props: CardProps) {
  if (props.interactive) {
    const { interactive: _i, padding, selected, className, type = "button", ...rest } = props;
    return <button {...rest} type={type} className={clsx(cardClass({ interactive: true, selected, padding }), className)} />;
  }
  const { interactive: _i, padding, selected, className, ...rest } = props;
  return <div {...rest} className={clsx(cardClass({ selected, padding }), className)} />;
}
