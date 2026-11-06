import clsx from "clsx";
import { CloudLightning, Compass, Feather, Gauge, Layers, Minus, Tornado, Triangle, TrendingDown, TrendingUp, Wind, Zap } from "lucide-react";
import type { ComponentType } from "react";
import { fmtDay, type Discussion, type Kind, type Trend } from "../../lib/discussion";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

// Colour is data: driver kinds and trends stay neutral ink, except what matters to a rider's day —
// building wind (go), unsettled skies and storms (soon), tropical systems (strong). Always with an icon and a word.
export const KIND: Record<Kind, { label: string; Icon: Icon; tone: string }> = {
  front: { label: "Front", Icon: Triangle, tone: "text-fg-2" },
  pressure: { label: "Pressure", Icon: Gauge, tone: "text-fg-2" },
  tropical: { label: "Tropical", Icon: Tornado, tone: "text-strong" },
  storms: { label: "Storms", Icon: CloudLightning, tone: "text-soon" },
  "sea-breeze": { label: "Sea breeze", Icon: Wind, tone: "text-fg-2" },
  "upper-level": { label: "Upper level", Icon: Layers, tone: "text-fg-2" },
  other: { label: "Other", Icon: Compass, tone: "text-fg-2" },
};

export const TREND: Record<Trend, { label: string; Icon: Icon; tone: string }> = {
  building: { label: "Building", Icon: TrendingUp, tone: "text-go" },
  steady: { label: "Steady", Icon: Minus, tone: "text-fg-2" },
  easing: { label: "Easing", Icon: TrendingDown, tone: "text-fg-3" },
  light: { label: "Light", Icon: Feather, tone: "text-fg-3" },
  unsettled: { label: "Unsettled", Icon: Zap, tone: "text-soon" },
};

/** "2026-09-29" for now in a time zone (the discussion's days are calendar dates in its region). */
export const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(Date.now());

/** The week as seven small columns: day, trend icon, flow. A list named "Day by day" (tests count its items). */
export function DayStrip({ d }: { d: Discussion }) {
  const today = todayIn(d.timeZone || "America/New_York");
  return (
    <ul className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${d.days.length}, minmax(0, 1fr))` }} aria-label="Day by day">
      {d.days.map((day) => {
        const t = TREND[day.windTrend] ?? TREND.steady;
        const isToday = day.date === today;
        return (
          <li key={day.date} title={`${fmtDay(day.date, { weekday: "long" })}: ${t.label}${day.flow ? `, from ${day.flow}` : ""}`}
            className={clsx("flex min-w-0 flex-col items-center gap-1 rounded-sm py-1.5", isToday && "bg-surface-3")}>
            <span className={clsx("text-micro font-semibold", isToday ? "text-fg" : "text-fg-2")}>{day.label}</span>
            <t.Icon aria-hidden className={clsx("size-3.5", t.tone)} strokeWidth={2.25} />
            <span className="max-w-full truncate text-micro text-fg-3">{day.flow || "var"}</span>
            <span className="sr-only">{t.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
