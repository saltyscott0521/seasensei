import clsx from "clsx";
import { useCallback, useId, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent, type ReactNode, type Ref } from "react";
import { Drawer } from "vaul";
import { SNAP_FULL, SNAP_HANDLE, SNAP_MID, SNAP_NAMES, SNAP_REST, type SnapIndex } from "../../lib/layout";

/** Where the timeline goes: floating above the sheet, kept but faded out (full sheet, or no room), or not at all (adding). */
export type TimelinePlace = "float" | "hidden" | "none";

const POSITION = ["Lowered to the day's answer, the map open", "Showing the top of your spots", "Half open", "Full screen"] as const;

/**
 * Escape key presses the sheet has seen. The sheet is a Radix dialog, which takes Escape on the document in the capture
 * phase, before anything inside gets it; it only marks the event (and stops Radix dismissing), and App's window
 * listener closes the top layer once the event has come through untouched — so a focused chart clearing its cursor,
 * or a text field, keeps its own Escape (they stop it on the way), just as on desktop.
 */
export const sheetEscapes = new WeakSet<Event>();

/**
 * Phones: the bottom sheet. Four snaps — handle (the grabber and a one-line answer, `summary`, nearly all map), rest
 * (the Today board's header and two spots), mid and full. At handle and rest a drag anywhere moves the sheet; at mid and
 * full the content scrolls and the sheet moves from its top band. The grabber is a real button that steps up through
 * the snaps (full goes back to rest), for taps, keyboards and screen readers; its arrow keys move one snap up or down.
 *
 * Vaul aria-hides everything outside the sheet, so whatever must stay reachable on phones (the timeline,
 * the panel, the app's name and the wind-field status for screen readers) renders in here.
 *
 * The glass is a layer of its own behind the content, not the sheet element: a backdrop-filter on an ancestor
 * would leave the floating timeline (a descendant) nothing to blur. At mid and full the surface goes solid —
 * re-blurring a moving map under most of the screen is the most expensive thing a phone GPU does here, and a
 * sheet of text reads best on an opaque ground.
 */
export function Sheet({ snaps, index, onIndex, timeline, place, children, scrollRef, onScroll, floatRef, status, summary, briefing }: {
  snaps: readonly (string | number)[];
  index: SnapIndex;
  onIndex: (i: SnapIndex) => void;
  timeline: ReactNode;
  place: TimelinePlace;
  children: ReactNode;
  scrollRef: Ref<HTMLDivElement>;
  onScroll: () => void;
  /** The floating timeline's wrapper, so App can measure the card. */
  floatRef: Ref<HTMLDivElement>;
  /** Read out politely to screen readers (the map's status is outside the sheet, so aria-hidden). */
  status: string;
  /** The one line shown at the handle snap (a button that raises the sheet). */
  summary: ReactNode;
  /** The morning briefing's way in for keyboards and screen readers (the bell on the map is aria-hidden by vaul). */
  briefing?: ReactNode;
}) {
  const full = index === SNAP_FULL;
  const low = index <= SNAP_REST; // handle or rest: the whole sheet is a handle, its content doesn't scroll
  const handle = index === SNAP_HANDLE;
  const descId = useId();
  const setActive = useCallback((v: number | string | null) => {
    const i = snaps.indexOf(v as never);
    if (i >= 0) onIndex(i as SnapIndex);
  }, [snaps, onIndex]);

  const scroller = useRef<HTMLDivElement | null>(null);
  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    if (typeof scrollRef === "function") scrollRef(el);
    else if (scrollRef) (scrollRef as MutableRefObject<HTMLDivElement | null>).current = el;
  }, [scrollRef]);

  // A drag that starts on the grabber ends in a click; only a tap (or a key) should step the snap.
  const down = useRef(0), travel = useRef(0);
  const onDown = (e: PointerEvent) => { down.current = e.clientY; travel.current = 0; };
  const onUp = (e: PointerEvent) => { travel.current = Math.abs(e.clientY - down.current); };
  const step = (e: MouseEvent) => {
    if (e.detail > 0 && travel.current > 6) return;
    onIndex(full ? SNAP_REST : ((index + 1) as SnapIndex));
  };
  const onKey = (e: KeyboardEvent) => {
    const to = e.key === "ArrowUp" ? index + 1 : e.key === "ArrowDown" ? index - 1 : -1;
    if (to < SNAP_HANDLE || to > SNAP_FULL) return;
    e.preventDefault();
    onIndex(to as SnapIndex);
  };

  // Keyboard or screen-reader focus on something below the visible part of the sheet raises it, so you can see
  // where you are. Only focus that shows a ring (:focus-visible): a tap focuses what it lands on too, and that
  // must not resize the sheet under the finger (nor may the app's own focus moves after a tap).
  const onFocus = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (full || !t.matches(":focus-visible")) return;
    if (t.getBoundingClientRect().bottom > window.innerHeight - 8) onIndex(SNAP_FULL);
  };

  // At rest the content can't scroll (drags move the sheet), so any scroll there came from focus, a screen
  // reader's cursor or find-in-page bringing something below the fold into view: raise the sheet so it is seen.
  // Settling back at rest always starts from the top, so the rest view is the board's header and first spots.
  const handleScroll = () => {
    const el = scroller.current;
    if (el && low && el.scrollTop > 0) onIndex(SNAP_FULL);
    onScroll();
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (low && el && el.scrollTop > 0) el.scrollTop = 0;
  }, [low]);

  return (
    <Drawer.Root open modal={false} dismissible={false} snapPoints={snaps as (string | number)[]} activeSnapPoint={snaps[index]} setActiveSnapPoint={setActive}>
      <Drawer.Portal>
        <Drawer.Content aria-describedby={undefined} data-snap={SNAP_NAMES[index]}
          onEscapeKeyDown={(e) => { e.preventDefault(); sheetEscapes.add(e); }}
          className="fixed inset-x-0 bottom-0 z-20 flex h-[96dvh] flex-col rounded-t-sheet outline-none">
          {/* The surface: glass at rest, solid once raised. Behind everything else in the sheet. */}
          <div aria-hidden data-sheet-surface={low ? "glass" : "solid"}
            className={clsx("pointer-events-none absolute inset-0 -z-10 rounded-t-sheet border-b-0", low ? "glass" : "sheet-solid")} />
          <Drawer.Title className="sr-only">Spots</Drawer.Title>
          <h1 className="sr-only">SeaSensei</h1>
          <p role="status" className="sr-only">{status}</p>
          {briefing}
          {/* Riding on the sheet's top edge at every snap (inside it on purpose: everything outside is aria-hidden), never
              in the sheet's content. Dragging on it scrubs the week, never the sheet. Kept mounted, faded out, where there
              is no room for it (the full sheet, a short phone's mid): it comes back as the sheet goes down. */}
          {(place === "float" || place === "hidden") && (
            <div ref={floatRef} data-vaul-no-drag data-floating-timeline
              className={clsx("absolute inset-x-3 bottom-full mb-2 transition-[opacity,visibility] duration-200 ease-ui",
                place === "hidden" && "pointer-events-none invisible opacity-0")}>
              {timeline}
            </div>
          )}
          <div className="flex shrink-0 justify-center pt-1">
            {/* pointerout is stopped here: vaul releases the drag on any pointerout, and a quick first move can leave
                this small target before the pointer capture vaul asked for has taken hold. */}
            <button type="button" aria-label={full ? "Collapse spots" : "Expand spots"} aria-expanded={!low}
              aria-describedby={descId} onClick={step} onKeyDown={onKey} onPointerDown={onDown} onPointerUp={onUp}
              onPointerOut={(e) => e.stopPropagation()}
              className="group relative grid h-8 w-24 cursor-grab place-items-center rounded-full before:absolute before:-inset-x-1 before:-bottom-1 before:-top-2 active:cursor-grabbing">
              <span aria-hidden className="h-[5px] w-9 rounded-full bg-line-strong transition-colors duration-150 group-hover:bg-fg-3" />
            </button>
            <span id={descId} className="sr-only">{POSITION[index]}{index === SNAP_MID ? "; expand again for full screen" : ""}; arrow keys move it up or down</span>
          </div>
          {/* Just the handle: the day's answer in one line, over the top of the content (which fades out under it). A
              tap raises the sheet to rest. Kept mounted, so it fades rather than pops. */}
          <div data-sheet-summary={handle || undefined} inert={!handle} aria-hidden={handle ? undefined : true}
            className={clsx("absolute inset-x-2 top-9 z-10 transition-opacity duration-200 ease-ui motion-reduce:transition-none",
              handle ? "opacity-100" : "pointer-events-none opacity-0")}>
            {summary}
          </div>
          <div ref={setScroller} onScroll={handleScroll} onFocus={onFocus} data-vaul-no-drag={!low ? "" : undefined}
            className={clsx("sheet-scroll relative min-h-0 flex-1 px-4 pt-1 transition-opacity duration-200 ease-ui motion-reduce:transition-none",
              low ? "overflow-hidden" : "overflow-y-auto overscroll-contain", handle && "opacity-0")}>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
