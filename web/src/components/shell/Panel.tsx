import clsx from "clsx";
import { motion } from "motion/react";
import type { ReactNode, Ref } from "react";
import { duration, ease } from "../../lib/motion";

/**
 * Desktop: the docked glass panel down the left of the map, full height with 16px margins. The brand and status
 * sit in a fixed header; the view below scrolls on its own (scroll position is reset per view by App).
 * It stays an <aside> (the tests and the screen-reader landmark both rely on it).
 */
export function Panel({ header, children, scrollRef, onScroll, scrolled }: {
  header: ReactNode;
  children: ReactNode;
  scrollRef: Ref<HTMLDivElement>;
  onScroll: () => void;
  /** The content is scrolled: show a hairline under the header. */
  scrolled: boolean;
}) {
  return (
    <motion.aside aria-label="Spots" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: duration.slow, ease }}
      className="glass absolute bottom-4 left-4 top-4 z-10 flex w-[420px] flex-col rounded-xl min-[1440px]:w-[440px]">
      <header className={clsx("shrink-0 border-b px-5 pb-4 pt-5 transition-colors duration-200", scrolled ? "border-line" : "border-transparent")}>
        {header}
      </header>
      <div ref={scrollRef} onScroll={onScroll} data-panel-scroll
        className="panel-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-xl px-5 pb-5 pt-4">
        {children}
      </div>
    </motion.aside>
  );
}
