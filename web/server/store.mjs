// The archive: one JSON file per day under DATA_DIR/discussions, plus the sources each one was written from
// under DATA_DIR/inputs. Writes are atomic (temp file + rename) so a crash can't leave half a discussion.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = () => path.resolve(process.env.DATA_DIR ?? path.join(here, "..", "data"));
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const read = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
};

export function put(discussion, inputs) {
  if (!isDate(discussion.date)) throw new Error("bad date");
  if (inputs) writeAtomic(path.join(root(), "inputs", `${discussion.date}.json`), inputs);
  writeAtomic(path.join(root(), "discussions", `${discussion.date}.json`), discussion); // last, so it only appears when complete
}

export const get = (date) => (isDate(date) ? read(path.join(root(), "discussions", `${date}.json`)) : null);

/** Newest first: [{ date, headline, regime, generatedAt }]. */
export function list(limit = 60) {
  let names = [];
  try { names = fs.readdirSync(path.join(root(), "discussions")); } catch { return []; }
  return names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort().reverse().slice(0, limit)
    .map((n) => read(path.join(root(), "discussions", n)))
    .filter(Boolean)
    .map(({ date, headline, regime, generatedAt }) => ({ date, headline, regime, generatedAt }));
}

export const latest = () => { const [first] = list(1); return first ? get(first.date) : null; };
