import type { Fetch } from "../../lib/coast";
import { compass } from "../../lib/wind";

export type Kind = Fetch["kind"];

/** How each kind of upwind fetch reads to a kiter, and its verdict colour (always shown with the word). */
export const KIND: Record<Kind, { word: string; detail: string; tone: "go" | "soon" | "strong"; fill: string }> = {
  open: { word: "Onshore", detail: "3 km+ of open water upwind", tone: "go", fill: "fill-go" },
  limited: { word: "Short fetch", detail: "1–3 km of water upwind", tone: "soon", fill: "fill-soon" },
  land: { word: "Offshore", detail: "land within 1 km upwind", tone: "strong", fill: "fill-strong" },
};
export const KIND_ORDER: Kind[] = ["open", "limited", "land"];

/**
 * Contiguous runs of bearings of one kind, going round the compass (NNW → N → NNE is one run).
 * Returns compass labels such as ["SW–NW", "E"].
 */
export function runsOf(fetch: Fetch[], kind: Kind): string[] {
  const n = fetch.length;
  const on = fetch.map((f) => f.kind === kind);
  if (!on.some(Boolean)) return [];
  if (on.every(Boolean)) return ["all round"];
  const out: string[] = [];
  for (let s = 0; s < n; s++) {
    if (!on[s] || on[(s + n - 1) % n]) continue; // start only where a run begins
    let len = 0;
    while (len < n && on[(s + len) % n]) len++;
    const a = fetch[s].dir, b = fetch[(s + len - 1) % n].dir;
    out.push(len === 1 ? compass(a) : `${compass(a)}–${compass(b)}`);
  }
  return out;
}
