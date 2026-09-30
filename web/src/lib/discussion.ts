// Shape of GET /api/discussion (see server/discussion.mjs SCHEMA; the server adds sources, usage and dates).
export type Kind = "front" | "pressure" | "tropical" | "storms" | "sea-breeze" | "upper-level" | "other";
export type Trend = "building" | "steady" | "easing" | "light" | "unsettled";
export type Source = { id: string; name: string; issued: string; url: string };

export type Discussion = {
  date: string; // YYYY-MM-DD in the region's time zone
  generatedAt: string;
  region: string;
  timeZone: string;
  model: string;
  headline: string;
  bottomLine: string;
  regime: string;
  drivers: { kind: Kind; title: string; detail: string; timing: string; windImpact: string; sources: string[] }[];
  days: { date: string; label: string; pattern: string; windTrend: Trend; flow: string; kiterTakeaway: string; confidence: "high" | "medium" | "low" }[];
  watch: { what: string; when: string }[];
  uncertainty: string;
  sources: Source[];
  missing: string[];
};

export type DiscussionResponse = { discussion: Discussion | null; configured: boolean; publishHour: number; timeZone: string };
export type DiscussionIndex = { items: { date: string; headline: string; regime: string; generatedAt: string }[]; configured: boolean };

export const SOURCE_LABEL: Record<string, string> = {
  AFD: "NWS Tampa Bay", WPC_SHORT: "WPC short range", WPC_EXT: "WPC extended", CWF: "Marine forecast",
  NHC: "NHC outlook", ALERTS: "Active alerts", MODEL: "Model check",
};

/** "2026-09-29" as a calendar day, whatever the viewer's zone. */
export const fmtDay = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat([], { timeZone: "UTC", ...opts }).format(Date.parse(date + "T12:00:00Z"));
