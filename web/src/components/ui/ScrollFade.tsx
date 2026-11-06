import clsx from "clsx";

/**
 * A soft fade where a scrolling panel's content meets its bottom edge, so a card is never cut off mid-line by a hard
 * edge (desktop panel; the phone sheet runs past the screen, so it has none). Render it last, as a sibling after the
 * view's content, which should end with 40 px of room (md:pb-10): at the very end it then lies over empty space.
 * Sticky offsets count from inside the scroller's padding, so it reaches 20 px further down, over the desktop panel's
 * bottom padding (pb-5), where scrolled content also shows.
 */
export function ScrollFade({ className }: { className?: string }) {
  return (
    <div aria-hidden className={clsx("pointer-events-none sticky bottom-[-20px] z-10 -mt-10 hidden h-10 md:block",
      "bg-linear-to-t from-surface-1 from-30% to-transparent", className)} />
  );
}
