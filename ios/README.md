# SeaSensei

A personal iPhone wind forecast for kiteboarding. SwiftUI, iOS 17+.

- Add spots by tapping a map, with the wind range you ride each one in.
- Per spot: the HRRR (NOAA's 3 km, hourly-updated model) forecast out to ~48 h:
  sustained wind and gusts in knots, direction, a chart, and the windows
  where the wind is in your range.
- Live wind from a NOAA Tides & Currents station, when the spot has one,
  shown next to what HRRR forecast for that hour. The three Tampa Bay spots
  (Fort De Soto, Skyway, Picnic Island) are loaded on first launch; Picnic
  Island reads station 8726607 (Old Port Tampa, on the Picnic Island pier).
- Forecast data comes from [Open-Meteo](https://open-meteo.com) (`models=gfs_hrrr`),
  so there's no API key or backend. HRRR covers the continental US only.

## Run it

```bash
cd ios
brew install xcodegen
xcodegen generate          # creates SeaSensei.xcodeproj (not committed)
open SeaSensei.xcodeproj
```

To run it on your phone, pick your Apple ID team under Signing & Capabilities.
A free account works; the app then expires after 7 days.

## Roadmap

1. Longer range past HRRR's horizon (NBM or ECMWF), shown as lower-confidence hours.
2. More live stations: airport ASOS (KSPG, KPIE) and NDBC, plus editing a spot's station.
3. Per-spot bias correction: log forecasts against observations and learn
   corrections by wind direction.
