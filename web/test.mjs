import assert from "node:assert/strict";
import { compass, parseForecast, parseObservation, rideableWindows, nearestHour } from "./lib.js";

assert.equal(compass(0), "N"); assert.equal(compass(359), "N"); assert.equal(compass(90), "E"); assert.equal(compass(-90), "W");

const f = parseForecast({ timezone: "America/New_York", hourly: {
  time: [0, 3600, 7200], wind_speed_10m: [10, null, 20], wind_gusts_10m: [15, 1, 25], wind_direction_10m: [90, 90, 180] } });
assert.equal(f.hours.length, 2); assert.equal(f.hours[1].t, 7200000);

const o = parseObservation({ metadata: { name: "Old Port Tampa" }, data: [
  { t: "2026-09-28 12:00", s: "10.5", d: "45", g: "14" }, { t: "2026-09-28 12:06", s: "11.0", d: "50.0", g: "15.2" }] });
assert.equal(o.speed, 11); assert.equal(o.gust, 15.2); assert.equal(o.t, Date.UTC(2026, 8, 28, 12, 6));
assert.throws(() => parseObservation({ error: { message: "No data" } }), /No data/);
assert.throws(() => parseObservation({ data: [] }), /no wind reading/);

const hrs = [5, 16, 20, 40, 18].map((speed, i) => ({ t: i * 3600e3, speed, gust: speed, dir: 0 }));
assert.deepEqual(rideableWindows(hrs, 15, 30), [{ start: 3600e3, end: 7200e3 }, { start: 14400e3, end: 14400e3 }]);
assert.equal(nearestHour(hrs, 3.4 * 3600e3).t, 3 * 3600e3);
console.log("ok");
