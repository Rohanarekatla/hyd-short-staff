# SurgeForce

Forecast-driven disaster staffing for Hyderabad (CipherCop 2026, Track 02). SurgeForce takes real ensemble rain forecasts and decides, before the rain, which officers, teams and volunteers go where, and when. Every move goes through a human commander.

See [RESEARCH.md](RESEARCH.md) for the country research (Japan, Korea, Singapore, Hong Kong, Taiwan, the US, Kerala), the ideas behind each feature, the demo script and judge Q&A.

## Run

Needs Node 21 or later. There are no npm dependencies.

```bash
npm start          # http://localhost:8520
npm test           # 6 tests, including a full plan on the real 2024 replay
npm run fetch-data # optional: refresh the OSM/DEM/OSRM/GloFAS snapshot in data/ (~2 min)
```

The data snapshot is committed, so replay mode works offline. Live mode needs internet. If the network drops, it falls back to the last good forecast.

## What it does

| Feature | Inspired by | Where |
|---|---|---|
| Probabilistic risk per police-station sector (P50/P80/P95) from a 122-member live ensemble, or the forecasts made 1–3 days before 31 Aug 2024 | ECMWF/NCEP ensembles | `lib/risk.js`, `lib/weather.js` |
| Counterpart pairing: dry city station, then dry district, then TSSP reserve; floors kept; pairs persist | Japan 対口支援 | `pairCounterparts` in `lib/planner.js` |
| Typed-team pre-positioning by min-cost flow (METs, DRF, fire crews, volunteers, NDRF on request) | Singapore PUB QRT, US EMAC | `allocate` in `lib/planner.js`, `lib/mcf.js` |
| Underpass closures 30 min before onset (51 real underpasses) | Korea after Osong 2023 | `plan` in `lib/planner.js` |
| Staged timeline (Watch / Prepare / Act), relief waves at 12 h | Japan timeline bousai, TEC-FORCE | `plan` in `lib/planner.js` |
| Citizen reports: triage in en/te/hi/ur, placed by area, de-duplicated, confirm sectors | Japan SOCDA | `lib/intake.js` |
| CAP 1.2 alerts for SACHET in 4 languages with area polygons | Korea multilingual alerts | `lib/cap.js` |
| Musi river: GloFAS discharge vs 1990–2023 percentiles, triggering bank evacuation | GloFAS | `musiLevels` in `lib/risk.js` |
| Replay verification against ERA5 observed rain | | `plan` in `lib/planner.js` |

## Data

**Real:** OpenStreetMap police stations (49), fire stations (8), underpasses (51) and the Musi; Copernicus DEM elevation for 434 one-km cells; OSRM road times; Open-Meteo ensemble, previous-runs and ERA5 archive; GloFAS discharge; team counts from the GHMC/HYDRAA 2025 plan.

**Synthetic, and labelled as such in the UI:** deployable officers per station (22% vacancy applied), team placement by zone, volunteer pools, district reserves, and simulated citizen reports.

## API

- `GET /api/plan?mode=replay|live&q=0.8&offline=<stationId>&noShow=0.3`
- `POST /api/reports {text, key}`, `POST /api/reports/simulate?key=`, `DELETE /api/reports?key=`
- `POST /api/approve {key, ids[], decision}`: appends to `data/audit.jsonl`
- `GET /api/cap?key=&id=`: CAP 1.2 XML

Map data © OpenStreetMap contributors (ODbL). Weather data from Open-Meteo (CC BY 4.0). Flood data from GloFAS / Copernicus. Elevation from the Copernicus DEM.
