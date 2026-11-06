import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { memo, type ReactNode } from "react";
import { fmtKm } from "../../lib/session";
import { scoreForecast, type Hour, type Obs } from "../../lib/wind";
import { Skeleton } from "../bits";
import { SectionHeader } from "../ui";

/** "How did the forecast do here over the last day?": bias and average miss against the nearest NOAA sensor. */
export const Accuracy = memo(function Accuracy({ hours, obs, loading, refName, km }: {
  /** The forecast's last 24 h (windowFor(hours, "24h")). */
  hours?: Hour[]; obs?: Obs[]; loading: boolean; refName?: string; km?: number;
}) {
  return (
    <section aria-labelledby="accuracy-h" className="flex flex-col gap-2">
      <SectionHeader id="accuracy-h" title="Forecast check" aside="Last 24 h" />
      <Body hours={hours} obs={obs} loading={loading} refName={refName} km={km} />
    </section>
  );
});

function Body({ hours, obs, loading, refName, km }: { hours?: Hour[]; obs?: Obs[]; loading: boolean; refName?: string; km?: number }) {
  if (loading) return <Skeleton className="h-[66px] rounded-lg" />;
  if (!refName) return <Note>No NOAA sensor within 25 km, so there's nothing to check the forecast against here.</Note>;
  const sc = hours && obs ? scoreForecast(hours, obs) : null;
  if (!sc) return <Note>Not enough recent readings from {refName} to score the forecast.</Note>;
  const b = sc.bias, off = Math.abs(b);
  // Neutral ink: a model running a knot or two low is a calibration note, not a verdict (verdict colours mean ride/don't).
  const Icon = off < 1 ? Check : b < 0 ? ArrowDown : ArrowUp;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
      <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-fg-2"><Icon className="size-4" strokeWidth={2.25} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-label font-semibold text-fg">
          {off < 1 ? "Forecast has been on the money" : `Model ran ${off.toFixed(1)} kn ${b < 0 ? "low" : "high"}`}
          {off >= 1 && <span className="font-normal text-fg-2"> · expect {b < 0 ? "a bit more" : "a bit less"} wind than forecast</span>}
        </p>
        <p className="num mt-0.5 text-caption text-fg-3">
          Avg miss {sc.mae.toFixed(1)} kn · direction {Math.round(sc.dirErr)}° off · {sc.n} h vs {refName}{km != null ? ` (${fmtKm(km)})` : ""}
        </p>
      </div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-line bg-surface-2 px-3.5 py-3 text-caption text-fg-3">{children}</p>;
}
