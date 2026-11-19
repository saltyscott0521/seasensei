import clsx from "clsx";
import { Bell, BellRing, Sun } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useBriefingSettings } from "../../lib/briefingClient";
import { fmtClock, sunTimes } from "../../lib/session";
import { useDesktop } from "../../lib/layout";
import { useNow } from "../../lib/time";
import { ModelPicker, Skeleton } from "../bits";
import { IconButton } from "../ui/IconButton";
import { BriefingPanel } from "./BriefingPanel";

const dates = new Map<string, Intl.DateTimeFormat>();
const fmtDate = (t: number, tz: string) => {
  let f = dates.get(tz);
  if (!f) dates.set(tz, (f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })));
  return f.format(t);
};

/** Where the sun times come from with no spots yet: the middle of Tampa Bay. */
export const TAMPA_BAY_CENTRE = { lat: 27.76, lon: -82.63 };

/**
 * The board's title row: "Today", the date and the region's daylight (sunrise–sunset at the first spot), and the
 * forecast model picker (the list view's only "Forecast model" select), and the bell that opens the morning briefing. Phones keep it to two lines (≤ 52 px, so two
 * spots fit the resting sheet): the picker shows just the lead model, and its plain-language caption moves to the spot
 * charts. Desktop shows the chain and the caption.
 */
export function TodayHeader({ at, tz, notice }: {
  at: { lat: number; lon: number }; tz: string | null;
  /** A row under the header (the undo after a delete) that comes straight after the heading in the Tab order. */
  notice?: ReactNode;
}) {
  const now = useNow();
  const desktop = useDesktop();
  const { sunrise, sunset } = sunTimes(at.lat, at.lon, now);
  const daylight = sunset > sunrise;
  const briefing = useBriefingSettings();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-0.5 px-1">
      <h2 className="text-heading font-semibold leading-7 tracking-[-0.02em] text-fg">Today</h2>
      {notice && <div className="col-span-3 row-start-4 mt-3 md:mt-2">{notice}</div>}
      <ModelPicker compact={!desktop} className="col-start-2 row-start-1"
        captionClass={desktop ? "col-span-3 row-start-3 mt-1 text-caption text-fg-3" : "sr-only"} />
      {/* 36 px, pulled into the 28 px title row so the phone header stays two lines */}
      <IconButton aria-label="Morning briefing" size="sm" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)} className={clsx("col-start-3 row-start-1 -my-1 -mr-1.5", briefing.on && "text-accent hover:text-accent")}>
        {briefing.on ? <BellRing /> : <Bell />}
      </IconButton>
      {/* full width under the title row, so the daylight never truncates beside the picker */}
      <div className="col-span-3 row-start-2 flex h-[18px] min-w-0 items-center gap-1.5 whitespace-nowrap text-caption text-fg-3">
        {tz == null ? <Skeleton className="h-3 w-44" /> : <>
        <span className="text-fg-2">{fmtDate(now, tz)}</span>
        {daylight && <>
          <span aria-hidden>·</span>
          <Sun aria-hidden className="size-3.5 shrink-0 text-soon/80" strokeWidth={2.25} />
          <span className="sr-only">Daylight</span>
          <span className="num truncate">{fmtClock(sunrise, tz)} – {fmtClock(sunset, tz)}</span>
        </>}
        </>}
      </div>
      {/* after the bell in the Tab order */}
      {open && <div className="col-span-3 row-start-5"><BriefingPanel id={panelId} /></div>}
    </header>
  );
}
