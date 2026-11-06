import clsx from "clsx";
import { motion } from "motion/react";
import { ChevronRight, Compass, RotateCw } from "lucide-react";
import { memo } from "react";
import { useDiscussion } from "../../lib/data";
import { fmtDay, type Discussion } from "../../lib/discussion";
import { duration, ease } from "../../lib/motion";
import { Skeleton } from "../bits";
import { Button, cardClass, Chip } from "../ui";
import { DayStrip } from "./discussionBits";

/**
 * Today's wind discussion as a compact card after the spots: the regime, the headline and the week's trend.
 * The headline itself opens the full text (named "Read the full wind discussion"), and so does the footer row.
 */
export const DiscussionCard = memo(function DiscussionCard({ onOpen }: { onOpen: (date: string) => void }) {
  const q = useDiscussion();
  const d = q.data?.discussion;
  return (
    <section aria-label="Wind discussion" className={clsx(cardClass({ padding: "none" }), "overflow-hidden")}>
      <div className="flex h-11 items-center gap-2 px-3.5">
        <Compass aria-hidden className="size-4 text-fg-3" strokeWidth={2.25} />
        <h2 className="text-label font-semibold text-fg">Wind discussion</h2>
        <span className="ml-auto text-micro text-fg-3">{d ? fmtDay(d.date, { weekday: "short", month: "short", day: "numeric" }) : "Daily · AI"}</span>
      </div>
      {d ? <Summary d={d} onOpen={() => onOpen(d.date)} />
        : q.isError ? (
          <div className="flex items-center gap-3 px-3.5 pb-3.5">
            <p className="min-w-0 flex-1 text-label text-fg-2" data-testid="discussion-empty">Couldn't load today's discussion.</p>
            <Button size="sm" onClick={() => q.refetch()}><RotateCw /> Retry</Button>
          </div>
        )
        : q.data ? (
          <p className="px-3.5 pb-3.5 text-label leading-relaxed text-fg-2" data-testid="discussion-empty">
            {q.data.configured
              ? `Today's discussion publishes around ${q.data.publishHour}:00 ${q.data.timeZone === "America/New_York" ? "ET" : q.data.timeZone}. It reads the National Weather Service's discussions and explains what's steering the wind.`
              : "The daily wind discussion isn't switched on for this server yet."}
          </p>
        ) : <SummarySkeleton />}
    </section>
  );
});

function Summary({ d, onOpen }: { d: Discussion; onOpen: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.base, ease }}>
      {/* The summary opens the dialog too: a big, obvious target. */}
      <button type="button" onClick={onOpen} aria-label="Read the full wind discussion"
        className="block w-full cursor-pointer px-3.5 pb-3 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:outline-offset-[-2px]">
        <Chip size="sm">{d.regime}</Chip>
        <span className="mt-2 line-clamp-2 block text-body font-medium leading-snug tracking-[-0.01em] text-fg" data-testid="discussion-headline">{d.headline}</span>
      </button>
      <div className="px-2.5 pb-2.5"><DayStrip d={d} /></div>
      <button type="button" onClick={onOpen}
        className="flex h-11 w-full cursor-pointer items-center justify-between rounded-b-[inherit] border-t border-line px-3.5 text-label font-medium text-fg-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-fg focus-visible:outline-offset-[-2px]">
        Read the full discussion <ChevronRight aria-hidden className="size-4 text-fg-3" />
      </button>
    </motion.div>
  );
}

/** Same shape as the loaded card, so nothing below it moves when it arrives. */
function SummarySkeleton() {
  return (
    <div aria-busy="true">
      <div className="px-3.5 pb-3">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="mt-2.5 h-4 w-11/12" />
        <Skeleton className="mt-2 h-4 w-7/12" />
      </div>
      <div className="grid grid-cols-7 gap-0.5 px-2.5 pb-2.5">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1 py-1.5"><Skeleton className="h-3 w-6" /><Skeleton className="size-3.5" /><Skeleton className="h-3 w-7" /></div>
        ))}
      </div>
      <div className="h-11 border-t border-line" />
    </div>
  );
}
