import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useCalibration } from "../../lib/data";
import { MODEL_INFO, RAW_MODELS } from "../../lib/wind";

/**
 * "How sure is this?": one tappable line under the hero that opens a few plain sentences on what the range and the
 * chance words mean, and how the forecast has done over the last 30 days against the sensors (when the server has
 * scored it). Only shown for the SeaSensei forecast: a raw model has no range or chance to explain.
 */
export function HowSure() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const record = useTrackRecord();
  return (
    <div className="rounded-lg border border-line bg-surface-2">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3.5 text-left text-label font-medium text-fg-2 transition-colors duration-(--dur-fast) hover:text-fg focus-visible:outline-offset-[-2px] md:min-h-9">
        How sure is this?
        <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-3 transition-transform duration-(--dur-fast) motion-reduce:transition-none" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && (
        <div id={id} data-testid="how-sure" className="flex flex-col gap-2 border-t border-line px-3.5 py-3 text-caption leading-relaxed text-fg-2">
          <p><b className="font-semibold text-fg">The range</b> (say 14–19 kn) is where the wind lands about 8 times in 10. The single number is our best estimate inside it.</p>
          <p>
            <b className="font-semibold text-fg">Likely</b> means the wind reaches your minimum for the session at least 7 times in 10,{" "}
            <b className="font-semibold text-fg">Possible</b> 4 to 7 times, <b className="font-semibold text-fg">Unlikely</b> fewer.
          </p>
          <p>Ranges are tighter for today than for later in the week. A fresh reading from the spot's own station corrects the next few hours.</p>
          {record && <p data-testid="track-record" className="num text-fg">{record}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * "Last 30 days: off by 1.8 kn on average; HRRR alone 2.4." from the server's rolling score, or null until there is
 * one. The comparison is HRRR (the model most riders know), else the best raw model scored.
 */
function useTrackRecord(): string | null {
  const score = useCalibration().score;
  const mine = score?.models?.sensei;
  if (!score || !mine || !(mine.mae > 0) || !(mine.n > 0)) return null;
  const raw = RAW_MODELS.filter((m) => (score.models[m]?.mae ?? 0) > 0);
  const other = raw.includes("hrrr") ? "hrrr" : raw.sort((a, b) => score.models[a]!.mae - score.models[b]!.mae)[0];
  const days = Number.isFinite(score.days) && score.days > 0 ? Math.round(score.days) : 30;
  return `Last ${days} days: off by ${mine.mae.toFixed(1)} kn on average${other ? `; ${MODEL_INFO[other].label} alone ${score.models[other]!.mae.toFixed(1)}` : ""}.`;
}
