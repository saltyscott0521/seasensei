// Cloudflare R2 (S3 API), signed with aws4fetch: the store behind the forecast-run archive, the station
// observations and the learning state. Off unless R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY and R2_BUCKET are set.
import zlib from "node:zlib";
import { promisify } from "node:util";
import { AwsClient } from "aws4fetch";

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);

export const configured = () => !!(process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  && (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID));

let client = null;
function call(pathAndQuery, init = {}, timeout = 60_000) {
  client ??= new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  const endpoint = (process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, "");
  return client.fetch(`${endpoint}/${process.env.R2_BUCKET}${pathAndQuery}`, { ...init, signal: AbortSignal.timeout(timeout) });
}

export async function put(key, body, type = "application/gzip") {
  const r = await call(`/${key}`, { method: "PUT", body, headers: { "Content-Type": type } });
  if (!r.ok) throw new Error(`R2 PUT ${key} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

/** The object's bytes, or null when it doesn't exist. Any other failure throws. */
export async function get(key) {
  const r = await call(`/${key}`);
  if (r.status === 404) { await r.arrayBuffer().catch(() => {}); return null; }
  if (!r.ok) throw new Error(`R2 GET ${key} → HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Every key under a prefix (ListObjectsV2, following continuation tokens). */
export async function list(prefix) {
  const keys = [];
  let token = null;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ "list-type": "2", prefix });
    if (token) q.set("continuation-token", token);
    const r = await call(`?${q}`);
    if (!r.ok) throw new Error(`R2 LIST ${prefix} → HTTP ${r.status}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] : null;
    if (!token) break;
  }
  return keys;
}

export const putJsonGz = async (key, doc) => { const body = await gzip(JSON.stringify(doc)); await put(key, body); return body.length; };
/** A gzipped JSON object: the parsed document, or null when it doesn't exist. A corrupt object throws. */
export const getJsonGz = async (key) => { const b = await get(key); return b ? JSON.parse((await gunzip(b)).toString()) : null; };
