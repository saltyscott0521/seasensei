import clsx from "clsx";
import { useMemo, useState } from "react";
import { composeBriefing, nextAt } from "../../lib/briefing";
import {
  BRIEFING_MAX_SPOTS, BriefingError, deviceTimeZone, pushSupport, setBriefing, turnOff, turnOn, useBriefingSettings, type BriefingSettings,
} from "../../lib/briefingClient";
import { usePrimaryModel, useSpots } from "../../lib/data";
import { fmtClock, fmtDay } from "../../lib/session";
import { useNow } from "../../lib/time";
import { useRankedSpots } from "../../lib/useSpotNow";
import { Segmented } from "../ui/Segmented";

const MODES: [BriefingSettings["mode"], string][] = [["daily", "Every morning"], ["windy", "Only when it's on"]];

/**
 * The morning briefing's settings, opened from the bell in the Today header (so it lives inside the phone sheet, where
 * it stays reachable): on/off, the time (in this device's zone), every morning or only when it's on, and what the next
 * one would say, written by the same engine the server sends it with. Permission is asked only on the switch's tap.
 */
export function BriefingPanel({ id }: { id: string }) {
  const s = useBriefingSettings();
  const spots = useSpots();
  const model = usePrimaryModel();
  const support = useMemo(pushSupport, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true); setError(null);
    try { await (s.on ? turnOff() : turnOn(spots, model, s)); }
    catch (e) { setError(e instanceof BriefingError ? e.message : "Something went wrong. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-3 rounded-lg border border-line bg-surface-2 px-4 py-3 md:mt-2">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${id}-h`} className="text-label font-semibold text-fg">Morning briefing</h3>
        {support === "ok" && <Switch on={s.on} busy={busy} onClick={toggle} label="Send me a morning briefing" />}
      </div>
      {support === "ios-install" ? (
        <p className="mt-1.5 text-caption text-fg-2">On iPhone, add SeaSensei to your Home Screen first (Share → Add to Home Screen), then turn this on.</p>
      ) : support === "unsupported" ? (
        <p className="mt-1.5 text-caption text-fg-2">This browser can't show notifications from SeaSensei, so the morning briefing isn't available here.</p>
      ) : (
        <>
          <p className="mt-0.5 text-caption text-fg-3">Where and when today, as a notification each morning.</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-2 text-caption font-medium text-fg-2">
              Time
              <input type="time" aria-label="Briefing time" value={s.time} required step={60}
                onChange={(e) => { if (/^\d\d:\d\d$/.test(e.target.value)) setBriefing({ time: e.target.value }); }}
                className="num h-8 rounded-sm bg-ink/40 px-2 text-label text-fg ring-1 ring-inset ring-line transition-colors duration-150 hover:ring-line-strong max-md:h-11 [color-scheme:dark]" />
            </label>
            <Segmented id="briefing-mode" label="When to send" value={s.mode} onChange={(mode) => setBriefing({ mode })} options={MODES} />
          </div>
          {spots.length > BRIEFING_MAX_SPOTS && <p className="mt-2 text-caption text-fg-3">Covers your first {BRIEFING_MAX_SPOTS} spots.</p>}
          <Preview settings={s} />
        </>
      )}
      {error && <p role="alert" className="mt-2 text-caption text-fg-2">{error}</p>}
    </section>
  );
}

/** A small on/off switch (role=switch). Neutral when off, the accent when on (selection, not data). */
function Switch({ on, busy, onClick, label }: { on: boolean; busy: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} aria-busy={busy || undefined} disabled={busy} onClick={onClick}
      className={clsx("relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 ring-1 ring-inset transition-colors duration-150",
        "before:absolute before:-inset-2.5 disabled:cursor-default disabled:opacity-60",
        on ? "bg-accent-soft ring-accent/50" : "bg-surface-3 ring-line-strong")}>
      <span aria-hidden className={clsx("size-5 rounded-full shadow-raised transition-transform duration-150 ease-ui", on ? "translate-x-4 bg-accent" : "translate-x-0 bg-fg-3")} />
    </button>
  );
}

/** What the next briefing would say from the forecasts on the board now ("Fri 7:00 AM · Fort De Soto · On at 1 PM"). */
function Preview({ settings }: { settings: BriefingSettings }) {
  const ranked = useRankedSpots();
  const now = useNow();
  const at = nextAt(settings.time, deviceTimeZone(), now);
  const b = useMemo(() => composeBriefing(ranked.map((r) => r.spot), ranked.map((r) => r.forecast), at), [ranked, at]);
  if (!b) return null;
  const tz = deviceTimeZone();
  const silent = settings.mode === "windy" && !b.on;
  return (
    <p className="mt-3 border-t border-line pt-2.5 text-caption text-fg-3">
      <span className="num text-fg-2">{fmtDay(at, tz, now)} {fmtClock(at, tz)}</span>
      {" · "}
      {silent ? "Nothing would be sent: no session that day." : <><span className="text-fg-2">{b.title}</span>{" · "}{b.body.split("\n")[0]}</>}
    </p>
  );
}
