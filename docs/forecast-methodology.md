# The SeaSensei forecast: method and evidence

The SeaSensei forecast is the app's default. It is built in the browser from five public weather models and a small
calibration file the server learns from Tampa Bay's wind sensors. This page says what it does, why, and how well each step
tested. Code: `web/src/lib/sensei.ts` (browser), `web/server/calibrate.mjs`, `observe.mjs`, `blend.mjs`, `archive.mjs` (server).

## What it does

1. **Reads the wind over the water, not the land.** HRRR and ECMWF are requested for the nearest *sea* grid cell
   (`cell_selection=sea`); RRFS, NBM and GFS on their default cell. Two Open-Meteo requests per spot.
2. **Tunes each model to the spot's own sensor, when it has one.** A quantile map (raw speed → speed the sensor actually
   reads, at 0, 4, 8, 12, 16, 20, 25, 35 kn) per station and model, clamped to ±40 % and ±6 kn. A spot without its own
   sensor uses the models untuned: borrowed maps made things worse (below).
3. **Blends the models by recent skill.** Weights ∝ 1 / (average miss)⁴ for the hour's lead (≤ 12 h, ≤ 36 h, ≤ 72 h,
   beyond). A model with no value at an hour drops out and the rest share its weight, so there are no hard handoffs.
   Direction is a weighted circular mean.
4. **Bends toward what the sensor reads now.** With a reading ≤ 30 min old from the spot's own station, the difference
   between sensor and forecast is added to the coming hours, fading as `exp(−hours / 2)` over 6 h.
5. **Gives a range and a chance.** The range is the 10th–90th percentile of past misses on windy daylight hours, widened
   where the models disagree. The chance of a session is the chance each hour clears the spot's minimum, from a normal
   curve centred on the middle of the range; shown as Likely (≥ 70 %), Possible (40–69 %) or Unlikely.
6. **Keeps learning.** Every hour the server saves station observations and pairs each settled hour with the archived
   model runs that forecast it, updating the maps, misses and gust factors as decaying averages (about a 30-day memory).
   Learned values take over from the starting ones gradually (share = n / (n + 300) paired hours). Frozen sensors teach
   nothing. A rolling 30-day score of the blend against each raw model is published with the calibration.

## Evidence

Data: 17 stations (NOAA CO-OPS, airports, two buoys), Nov 2024 – Nov 2026, against archived HRRR forecasts; sea-cell and
other-model forecasts for the last year at 7 stations. Fit on the first year, scored on the second where the data allows;
sea-cell numbers are cross-validated in alternating four-week blocks within one year. "Kiteable" = daylight hours with
12 kn or more observed. Average miss in knots, water and shore sensors, same-day forecast:

| Forecast | All hours | Kiteable hours | Bias, kiteable | Session days caught | Session calls that were right |
|---|---|---|---|---|---|
| HRRR, land cell (the app before) | 1.84 | 2.61 | −1.39 | 50 % | 83 % |
| HRRR, sea cell | 1.70 | 2.26 | −0.02 | 72 % | 77 % |
| + tuned to the sensor | 1.56 | 2.16 | −0.11 | 73 % | 79 % |
| + sensor reading, 1 h ahead | 1.37 | 1.76 | +0.07 | 84 % | 89 % |
| + sensor reading, 3 h ahead | 1.49 | 2.00 | | | |
| + sensor reading, 6 h ahead | 1.55 | 2.14 | | | |

- **The sea cell is the big step.** It removes the 1.4 kn under-read in kiteable hours and catches 72 % of session days
  instead of 50 %. At the one open-water sensor HRRR's miss fell from 3.1 to 1.7 kn.
- **The live sensor is the second.** One hour ahead it cuts the kiteable miss by about a fifth; by six hours it has faded.
- **Tuning to a sensor is a small gain, and only at that sensor.** Applied to a different station, even 0.5 km away, a
  borrowed map was worse than no map every time. The maps learn the sensor's exposure, not the place.
- **A neighbour's reading doesn't help.** Using a sensor up to 8 km away for step 4 was worse than not using one.
- **Blending pays as the forecast ages.** Same-day, tuned HRRR alone edged the blend (1.58 vs 1.66); with a day-old HRRR
  the blend won clearly (1.93 vs 2.30). Sharper weights (fourth power) were best or equal at both ends.
- **Ranges** from windy-hour misses cover 68–80 % of outcomes in the 10–18 kn band (target 80 %) and are 5–6.5 kn wide.
- **Chances** centred on the forecast were over-confident ("Likely" came true about 60 % of the time); centred on the
  middle of the range every bin lands within about 10 points.

## What it can't claim yet

- Sea-cell results are one year, same-day only, cross-validated within that year.
- ECMWF, GFS, NBM and RRFS start with thin or borrowed history (the bulk download hit Open-Meteo's free quota); their
  weights are learned from the live archive from now on.
- The blend was tested same-day at five sensors, without RRFS; the lead-time buckets are untested.
- Nothing measures the miss at an actual launch: only one sensor stands in open water. Sheltered launches may read lower
  than the sea cell says.
- HRRR's newest run reads about 0.7 kn lighter than its own day-ahead forecast; one map per model splits the difference.

Details and reproducible scripts for these numbers were produced in the build session (`science/v1/RESULTS.md`); the
live 30-day score at `/api/calibration` is the running check on all of the above.
