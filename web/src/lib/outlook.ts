// Shape of POST /api/outlook (see server/outlook.mjs OUTLOOK_SCHEMA).
export type Verdict = "go" | "maybe" | "no";
export type Outlook = {
  headline: string;
  bestBet: { date: string; spot: string; window: string; why: string } | null;
  days: {
    date: string; summary: string; rating: Verdict; confidence: "high" | "medium" | "low";
    spots: { name: string; verdict: Verdict; window: string; wind: string; note: string }[];
  }[];
  timeZone: string; generatedAt: string; model: string; cached?: boolean;
};
