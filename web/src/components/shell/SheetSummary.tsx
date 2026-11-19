import { ChevronUp } from "lucide-react";
import { useSpots } from "../../lib/data";
import { useRankedSpots, type RankedSpot } from "../../lib/useSpotNow";
import { Skeleton } from "../bits";
import { VerdictPill } from "../ui";

/**
 * The sheet lowered to just its handle: the day's answer in one line, the board's own top line (the best spot and
 * when, from the same ranking the board uses): "Fort De Soto · On at 1 PM", "No session today · Next: Sat 11 AM ·
 * Skyway", "No session this week · best Tue 13 kn". With a spot open, that spot's verdict. A tap raises the sheet.
 */
export function SheetSummary({ spotId, adding, onOpen }: { spotId: string | null; adding: boolean; onOpen: () => void }) {
  const spots = useSpots();
  const ranked = useRankedSpots();
  const settled = ranked.every((r) => r.status !== "pending");
  const row: RankedSpot | undefined = spotId ? ranked.find((r) => r.spot.id === spotId) : settled ? ranked[0] : undefined;
  const v = row?.verdict;

  let body, text: string;
  if (adding) text = "Adding a spot";
  else if (!spots.length) text = "Add a spot to see when it's on";
  else if (!row || (!v && row.status === "pending")) text = "Loading your spots";
  else if (!v) text = `${row.spot.name} · No forecast`;
  else if (spotId || v.state === "on" || v.state === "today") text = `${row.spot.name} · ${v.label}`;
  else if (v.state === "upcoming") text = `No session today · ${v.label} · ${row.spot.name}`;
  else text = ["No session this week", v.detail].filter(Boolean).join(" · ");

  if (adding) body = <b className="truncate font-semibold">Adding a spot</b>;
  else if (!spots.length) body = <b className="truncate font-semibold">Add a spot to see when it's on</b>;
  else if (!row || (!v && row.status === "pending")) body = <Skeleton className="h-4 w-48" />;
  else if (!v) body = <b className="truncate font-semibold">{row.spot.name} · <span className="font-normal text-fg-2">No forecast</span></b>;
  else if (spotId || v.state === "on" || v.state === "today") {
    body = <>
      <b className="min-w-0 truncate font-semibold">{row.spot.name}</b>
      <span aria-hidden className="text-fg-3">·</span>
      <VerdictPill state={v.state} label={v.label} size="sm" className="shrink-0" />
    </>;
  } else if (v.state === "upcoming") {
    body = <>
      <b className="shrink-0 font-semibold">No session today</b>
      <span aria-hidden className="text-fg-3">·</span>
      <VerdictPill state="upcoming" label={v.label} size="sm" className="shrink-0" />
      <span className="min-w-0 truncate text-fg-3"><span aria-hidden>· </span>{row.spot.name}</span>
    </>;
  } else {
    body = <>
      <b className="shrink-0 font-semibold">No session this week</b>
      {v.detail && <span className="min-w-0 truncate text-fg-2"><span aria-hidden>· </span>{v.detail}</span>}
    </>;
  }

  return (
    <button type="button" data-testid="sheet-summary" onClick={onOpen} aria-label={`${text}. Show your spots`}
      className="flex h-10 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-label text-fg transition-colors duration-150 hover:bg-surface-3">
      <span className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap">{body}</span>
      <ChevronUp aria-hidden className="size-4 shrink-0 text-fg-3" />
    </button>
  );
}
