import clsx from "clsx";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { fmtUntil, type MarineAlert } from "../../lib/alerts";
import { cardClass } from "../ui";

/**
 * National Weather Service alerts for the water (Small Craft Advisory, Special Marine Warning, rip currents, …) as
 * one quiet row at the top of the panel: the most serious alert's name and when it ends. Tap it to read the text
 * in place. Renders nothing when there are none. Neutral on purpose: colour is kept for wind and verdicts.
 *
 * It lives inside the panel / the phone sheet (everything outside the sheet is aria-hidden on phones).
 */
export function AlertBanner({ alerts, tz, onOpen }: {
  alerts: MarineAlert[];
  /** The spots' time zone, for "until Thu 10 AM". */
  tz: string;
  /** Called when the text is opened (phones raise the sheet so there is room to read). */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!alerts.length) return null;
  const [top, ...rest] = alerts;
  const until = (a: MarineAlert) => (a.ends != null ? fmtUntil(a.ends, tz) : "");
  const sub = [until(top), rest.length ? `+${rest.length} more` : top.area].filter(Boolean).join(" · ");
  return (
    <section aria-label="Weather alerts" data-testid="marine-alerts" className={clsx(cardClass({ padding: "none" }), "mb-3 overflow-hidden")}>
      <button type="button" aria-expanded={open} aria-controls={id}
        onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-offset-[-2px]">
        <TriangleAlert aria-hidden className="size-4 shrink-0 text-fg-2" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-label font-semibold text-fg">{top.event}</span>
          {sub && <span className="num block truncate text-caption text-fg-2">{sub}</span>}
        </span>
        <span className="sr-only">{open ? "Hide the alert text" : "Read the alert"}</span>
        <ChevronDown aria-hidden className={clsx("size-4 shrink-0 text-fg-3 transition-transform duration-200 ease-ui motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} className="space-y-4 border-t border-line px-3 pb-3 pt-3">
          {alerts.map((a) => (
            <article key={a.id} className="space-y-1.5">
              <h3 className="text-label font-semibold text-fg">{a.event}</h3>
              <p className="num text-caption text-fg-2">{[until(a), a.area].filter(Boolean).join(" · ")}</p>
              {a.headline && a.headline.toLowerCase() !== a.event.toLowerCase() && <p className="text-label text-fg">{sentence(a.headline)}</p>}
              {a.description && <p className="whitespace-pre-line text-label leading-relaxed text-fg-2">{a.description}</p>}
              {a.instruction && <p className="whitespace-pre-line text-label leading-relaxed text-fg-2">{a.instruction}</p>}
            </article>
          ))}
          <p className="text-micro text-fg-3">From the National Weather Service. Check the conditions yourself before you launch.</p>
        </div>
      )}
    </section>
  );
}

/** NWS writes its one-line summaries in capitals: sentence case reads calmer. Mixed-case text is left alone. */
function sentence(s: string) {
  if (s !== s.toUpperCase()) return s;
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1)
    .replace(/\b(est|edt|cst|cdt|am|pm)\b/g, (m) => m.toUpperCase())
    .replace(/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));
}
