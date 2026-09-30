// The daily wind discussion: Claude Sonnet reads the day's National Weather Service discussions and writes
// an editorial on the regional drivers (fronts, pressure, tropical systems, storms, sea breeze), not a
// restatement of the numeric forecast. Grounding comes from the sources bundle; the server, not the model,
// attaches the source list, and any driver that cites a source it wasn't given is dropped.
import Anthropic from "@anthropic-ai/sdk";
import { REGION, gatherSources } from "./sources.mjs";

export const MODEL = "claude-sonnet-5-5";

export const KINDS = ["front", "pressure", "tropical", "storms", "sea-breeze", "upper-level", "other"];
export const TRENDS = ["building", "steady", "easing", "light", "unsettled"];

/* ---------------- prompt ---------------- */

const SYSTEM = `You are the forecaster behind SeaSensei's daily wind discussion for kiteboarders around Tampa Bay and the west-central Florida Gulf coast. Your job is the why, not the numbers: the large-scale weather that decides whether wind shows up this week. That means fronts and their timing, where the high- and low-pressure centres sit and how strong the gradient between them is, tropical systems, thunderstorm and sea-breeze regimes, and upper-level troughs and ridges.

You are given the latest National Weather Service products, each in a <source id="…"> block. They are your only evidence.

Rules
1. Ground every claim in the sources. If they disagree, say so. Never invent a system, a storm name, a date or a timing that isn't in them. If something a rider would want to know isn't covered, say it isn't covered (in "uncertainty") instead of filling the gap.
2. Synthesise; do not transcribe. Don't restate the forecast tables or paste sentences from the sources. Explain the mechanism: what is driving the wind, when the pattern changes, what would change the call.
3. No numbers for wind. Never quote wind speeds, gusts, pressures, probabilities or model values anywhere in your answer. Describe strength in words (light, moderate, fresh, strong, gale-force). Dates, times, days of the week, compass directions and the names of features are fine.
4. Take a kiteboarder's view. Say what each pattern means on the water: direction relative to the coast (the Gulf beaches face west, so easterly wind is offshore and westerly is onshore), steady versus gusty and storm-disrupted, the afternoon sea-breeze build, post-frontal north or northeast pushes. Mention lightning and squall risk whenever storms are part of the picture.
5. Include a driver only if it changes the wind or the riding here. Leave out "nothing to see" cards (for example a tropical card when nothing tropical matters) and distant systems with no link to this coast.
6. Cite. Each driver lists the ids of the sources it rests on, using only the ids you were given.
7. Write like a good forecaster: plain, confident where the sources agree and honest where they don't. No hype, no emoji. If little is happening, say so.

Who you are writing for
Riders here use three spots, and they need about 15 knots of sustained wind or more to ride (comfortable up to roughly 30). Fort De Soto sits at the mouth of Tampa Bay on the Gulf side; Skyway is in the lower bay near the Sunshine Skyway bridge; Picnic Island is in the upper bay by Tampa. Where wind direction matters, reason from that geography (open Gulf fetch versus sheltered bay water, onshore versus offshore) and say what a pattern means for the Gulf-side spot versus the bay spots. Do not name a wind speed; say plainly whether a pattern is likely to reach "enough to ride" (light, marginal, rideable, strong). Don't invent spot details beyond this.

When sources disagree or an older passage contradicts newer text, prefer the most recently issued and the most local product (the coastal waters forecast and the Tampa Bay discussion over national text for local wind), and say when a passage looks stale rather than presenting it as a live disagreement.

Field notes
- "days" covers today and the next days the sources support, at most seven, one entry per calendar day, in order.
- "kiterTakeaway" should say whether the day is likely light, marginal, rideable or strong for riding, and where (Gulf side versus bay), in words.
- "windTrend" is the change in wind for that day compared with the day before (building, steady, easing), "light" for a light-wind day, or "unsettled" when storms or a front make it unreliable.
- "flow" is the prevailing wind direction in compass words (e.g. "NE", "E–SE", or "" if variable).
- "watch" lists specific things that could change the outlook, with when they will be clear.`;

const STR = (description) => ({ type: "string", description });
export const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["headline", "bottomLine", "regime", "drivers", "days", "watch", "uncertainty"],
  properties: {
    headline: STR("One sentence, editorial: what the week's pattern means for wind"),
    bottomLine: STR("Two to four sentences for a rider deciding how to plan the week; no numbers"),
    regime: STR("A short name for the pattern, e.g. 'Front-driven northeasterly surge' or 'Humid onshore flow'"),
    drivers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "title", "detail", "timing", "windImpact", "sources"],
        properties: {
          kind: { type: "string", enum: KINDS },
          title: STR("A few words naming the feature, e.g. 'Cold front sagging south'"),
          detail: STR("What it is and why it matters, in two or three sentences"),
          timing: STR("When it arrives, peaks or clears, in words"),
          windImpact: STR("What it does to wind on the water, in words (direction, steadiness, strength as a word)"),
          sources: { type: "array", items: { type: "string" }, description: "Ids of the sources this rests on" },
        },
      },
    },
    days: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["date", "label", "pattern", "windTrend", "flow", "kiterTakeaway", "confidence"],
        properties: {
          date: { type: "string", format: "date" },
          label: STR("Short weekday name, e.g. 'Thu'"),
          pattern: STR("One sentence on the weather pattern that day"),
          windTrend: { type: "string", enum: TRENDS },
          flow: STR("Prevailing wind direction in compass words, or ''"),
          kiterTakeaway: STR("One sentence on what it means for riding, in words"),
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    watch: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["what", "when"],
        properties: { what: STR("Something that could change the outlook"), when: STR("When it will be clearer") },
      },
    },
    uncertainty: STR("Where the sources disagree or run out, and how much to trust the back half of the week"),
  },
};

/* ---------------- checks ---------------- */

// Wind speeds, gusts and pressures are the "number forecast" this discussion must not repeat.
const LEAKS = [
  /\b\d+(?:\.\d+)?\s*(?:[-–]|to)?\s*(?:\d+(?:\.\d+)?)?\s*(?:kts?|kn|knots?|mph|m\/s|km\/h|kph)\b/i,
  /\b\d{3,4}(?:\.\d+)?\s*(?:hpa|mb|mbar|millibars?)\b/i,
  /\b(?:winds?|gusts?)\s+(?:of\s+|to\s+|up to\s+|near\s+|around\s+|as high as\s+)?\d/i,
];

function strings(o, out = []) {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) o.forEach((v) => strings(v, out));
  else if (o && typeof o === "object") Object.values(o).forEach((v) => strings(v, out));
  return out;
}

/** Quoted wind/pressure numbers found anywhere in the draft (empty when clean). */
export function numericLeaks(draft) {
  const hits = [];
  for (const s of strings(draft)) for (const re of LEAKS) { const m = s.match(re); if (m) hits.push(m[0]); }
  return hits;
}

const dateKey = (ms, tz = REGION.timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
export const todayET = (now = new Date()) => dateKey(now.getTime());

/** Structural clean-up the API's schema can't do: known citations only, sane dates, enough content. */
export function tidy(draft, docs, date) {
  if (!draft || typeof draft.headline !== "string" || !draft.headline.trim()) throw new Error("discussion came back malformed");
  const known = new Set(docs.map((d) => d.id));
  const drivers = (draft.drivers ?? [])
    .map((d) => ({ ...d, sources: [...new Set((d.sources ?? []).filter((id) => known.has(id)))] }))
    .filter((d) => d.sources.length && d.title?.trim() && d.detail?.trim());
  if (!drivers.length) throw new Error("no driver cited the sources; not publishing");

  const last = dateKey(Date.parse(date + "T12:00:00Z") + 7 * 86400e3, "UTC");
  const seen = new Set();
  const days = (draft.days ?? [])
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date >= date && d.date <= last && !seen.has(d.date) && seen.add(d.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (days.length < 3) throw new Error("the discussion covered fewer than three days; not publishing");
  return { ...draft, drivers, days, watch: draft.watch ?? [] };
}

/* ---------------- Claude ---------------- */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function userPrompt({ docs, missing }, now) {
  const when = new Intl.DateTimeFormat("en-US", { timeZone: REGION.timeZone, dateStyle: "full", timeStyle: "short" }).format(now);
  const head = `Write today's wind discussion for ${REGION.name}. It is ${when} (${REGION.timeZone}); today's date is ${todayET(now)}.`;
  const gaps = missing.length ? `\n\nThese sources could not be retrieved today, so don't rely on them or guess at them: ${missing.join(", ")}.` : "";
  const blocks = docs.map((d) => `<source id="${d.id}" name="${esc(d.name)}" issued="${d.issued}">\n${d.text}\n</source>`).join("\n\n");
  return `${head}${gaps}\n\n${blocks}`;
}

let client = null;
export const configured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

async function ask(prompt) {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    // If a safety classifier ever declines, Anthropic re-runs it on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("the model declined to write the discussion");
  if (response.stop_reason === "max_tokens") throw new Error("the discussion was cut off");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { draft: JSON.parse(text), response };
}

/**
 * Gathers the sources, writes the discussion, and returns { discussion, inputs }.
 * `inputs` is what the model was shown, kept beside the archive so a published call can be audited later.
 */
export async function generateDiscussion({ now = new Date() } = {}) {
  const bundle = await gatherSources();
  const date = todayET(now);
  let prompt = userPrompt(bundle, now), usage = { input: 0, output: 0 }, response, draft;

  for (let attempt = 0; attempt < 2; attempt++) {
    ({ draft, response } = await ask(prompt));
    usage = { input: usage.input + response.usage.input_tokens, output: usage.output + response.usage.output_tokens };
    const leaks = numericLeaks(draft);
    if (!leaks.length) break;
    if (attempt === 1) throw new Error(`the draft kept quoting wind numbers (${leaks.slice(0, 3).join("; ")}); not publishing`);
    prompt += `\n\nYour previous draft quoted numbers (${leaks.slice(0, 5).join("; ")}). Write it again with no wind speeds, gusts or pressure values anywhere; use words for strength.`;
  }

  const tidied = tidy(draft, bundle.docs, date);
  const discussion = {
    date,
    generatedAt: new Date(now).toISOString(),
    region: REGION.name,
    timeZone: REGION.timeZone,
    model: response.model,
    ...tidied,
    sources: bundle.docs.map(({ id, name, issued, url }) => ({ id, name, issued, url })),
    missing: bundle.missing,
    usage,
  };
  return { discussion, inputs: { date, docs: bundle.docs, missing: bundle.missing } };
}
