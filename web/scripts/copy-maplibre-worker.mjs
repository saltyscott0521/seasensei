// MapLibre 6 locates its worker next to its own module (import.meta.url). Once
// Vite bundles maplibre, that file isn't there, so ship the worker (and the
// shared chunk it imports) as static files and point setWorkerUrl at them.
import { cpSync, mkdirSync, readFileSync } from "node:fs";
const v = JSON.parse(readFileSync("node_modules/maplibre-gl/package.json", "utf8")).version;
const out = `public/maplibre/${v}`;
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) cpSync(`node_modules/maplibre-gl/dist/${f}`, `${out}/${f}`);
console.log(`maplibre worker ${v} -> ${out}`);
