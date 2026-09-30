// Publishing: write today's discussion once, on schedule, and retry sensibly when something upstream is down.
import Anthropic from "@anthropic-ai/sdk";
import { configured, generateDiscussion, todayET } from "./discussion.mjs";
import * as store from "./store.mjs";

export const PUBLISH_HOUR = Number(process.env.DISCUSSION_HOUR ?? 6); // local hour in the region's time zone
const TZ = process.env.DISCUSSION_TZ ?? "America/New_York";
const CHECK_MS = Number(process.env.DISCUSSION_CHECK_MS ?? 10 * 60_000);
const RETRY_MS = Number(process.env.DISCUSSION_RETRY_MS ?? 30 * 60_000);
const BOOT_MS = Number(process.env.DISCUSSION_BOOT_DELAY_MS ?? 5_000);
const MAX_TRIES = 6; // per day; a stuck day costs at most this many calls

let inflight = null;
let state = { day: "", tries: 0, retryAt: 0, lastError: null };

const hourInTz = (now) => Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now));

/** Explains an upstream failure without leaking anything from the request. */
export function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "the Anthropic API key was rejected";
  if (e instanceof Anthropic.RateLimitError) return "the Anthropic API is rate limiting us";
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}`;
  return e?.message ?? "unknown error";
}

/**
 * Writes today's discussion unless it already exists (or `force`). Concurrent callers share one call.
 * Resolves { status: "exists" | "published", discussion }; rejects when generation fails.
 */
export function publish({ force = false, now = new Date() } = {}) {
  const date = todayET(now);
  const have = store.get(date);
  if (have && !force) return Promise.resolve({ status: "exists", discussion: have });
  if (!configured()) return Promise.reject(new Error("ANTHROPIC_API_KEY is not set"));
  inflight ??= (async () => {
    const { discussion, inputs } = await generateDiscussion({ now });
    store.put(discussion, inputs);
    console.log(`[discussion] published ${discussion.date}: ${discussion.drivers.length} drivers, ${discussion.usage.input} in / ${discussion.usage.output} out tokens (${discussion.model})`);
    return { status: "published", discussion };
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Due when it's past the publish hour and today has no discussion yet. */
async function tick(now = new Date()) {
  const day = todayET(now);
  if (state.day !== day) state = { day, tries: 0, retryAt: 0, lastError: null };
  if (hourInTz(now) < PUBLISH_HOUR || store.get(day) || inflight) return;
  if (state.tries >= MAX_TRIES || now.getTime() < state.retryAt) return;
  state.tries++;
  try { await publish({ now }); state.lastError = null; }
  catch (e) {
    state.lastError = describeError(e);
    state.retryAt = now.getTime() + RETRY_MS * (e instanceof Anthropic.AuthenticationError ? 4 : 1);
    console.error(`[discussion] attempt ${state.tries}/${MAX_TRIES} failed: ${state.lastError}`);
  }
}

/** Starts the scheduler. The first check runs shortly after boot, which is also the catch-up after a redeploy. */
export function startScheduler() {
  if (!configured()) return;
  setTimeout(() => tick(), BOOT_MS).unref();
  setInterval(() => tick(), CHECK_MS).unref();
}

export const status = () => ({ configured: configured(), publishHour: PUBLISH_HOUR, timeZone: TZ, lastError: state.lastError });
