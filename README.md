# SurgeForce

AI command centre for flood staffing in Hyderabad (CipherCop 2026, Track 02). It decides, before the rain, which officers, teams and volunteers go where, and when, with a human commander approving every move.

**Live demo:** https://rohanarekatla.github.io/hyd-short-staff/ · **Team overview:** [OVERVIEW.md](OVERVIEW.md) · **Research:** [RESEARCH.md](RESEARCH.md) · **Ideas and roadmap:** [IDEAS.md](IDEAS.md) · **For AI assistants:** [AGENTS.md](AGENTS.md)

Where AI does the work:

- **When:** a 173-member ensemble, including ECMWF's machine-learned AIFS model. Backtesting showed it predicts *when* heavy rain hits the city (ROC 0.81).
- **Where:** a HAND terrain model plus citizen reports read by on-device AI. The forecasts have no value for *where*, so they aren't used for it.
- **Reading reports:** multilingual embeddings in the browser. 91% accuracy on held-out English, Telugu, Hindi and Urdu messages, vs 13% for keyword rules.
- **Optimisation and proof:** an optimiser and a Monte Carlo simulation (rescues within 30 minutes go from 83% to 96%).
- **Talking to the commander:** an agent (Claude Opus 5.5, or local Llama 3.1) that answers only by calling the planner's tools.

## Ideas and roadmap

Next we show *where the water goes*, *why each spot floods* and *who must fix it*. Full list with data sources and effort in [IDEAS.md](IDEAS.md). Top picks:

1. **Follow the Water:** click any spot to trace where its rain flows and what drains into it; mark dead-end ground where water ponds.
2. **Bottleneck Finder:** nala-under-road chokepoints on low ground, checked against the official TRAC flooding-points map.
3. **Official alerts:** NDMA SACHET (IMD) alerts on our timeline.
4. **Encroachment Detector:** buildings inside lake and nala buffers, upstream of flooding, with a ready-to-file HYDRAA complaint.
5. **Photo to depth:** AI reads water depth from a citizen photo and pre-fills a GHMC MyCURE complaint.
6. **WhatsApp flood bot, CCTV water detection, patrol dashcams, hotspot sensors, satellite flood maps, flood-aware routing.**

## Run

Everything runs in the browser, so any static host works (it is deployed on GitHub Pages). Locally it needs Node 21 or later and nothing installed:

```bash
npm start          # http://localhost:8520 (static server; all logic runs in the browser)
npm test           # 10 tests, including the full two-stage plan and simulation on the real 2024 replay
npm run fetch-data # optional: refresh the OSM/DEM/OSRM/GloFAS snapshot in data/ (~2 min)
npm run fetch-hand # optional: rebuild the 250 m HAND terrain grid (~1 min)
npm run backtest   # optional: re-run the 2024-2025 forecast backtest (~1 min)
npm install && npm run eval:intake   # re-run the AI triage evaluation (downloads the model once)
npm run agent -- "What if Uppal floods?"   # ask the agent from the terminal (needs `ollama serve`, or --claude with ANTHROPIC_API_KEY)
```

The data snapshot is committed, so replay mode works offline. Live mode fetches the forecast from the browser. The AI agent needs one of two providers:

- **Local:** run `OLLAMA_ORIGINS=http://localhost:8520,https://rohanarekatla.github.io ollama serve` with `llama3.1` pulled.
- **Claude:** paste an Anthropic API key in the AI Assistant tab. It stays in that tab.

## What it does

| Feature | Inspired by | Where |
|---|---|---|
| Backtest of 2 monsoons: Brier skill, ROC, reliability, economic value; city vs point | Richardson, EMOS literature | `scripts/backtest.js`, `lib/calibrate.js` |
| City-level probability (when) from a 173-member live ensemble, or the forecasts made 1–3 days before 31 Aug 2024 | ECMWF/NCEP ensembles | `lib/risk.js`, `lib/weather.js` |
| HAND terrain exposure (where) on a 250 m grid with OSM nalas | NOAA National Water Model | `scripts/fetch-hand.js`, `lib/risk.js` |
| Cost–loss decision rule: act when P ≥ C/L | Richardson 2000 | `lib/risk.js` |
| Monte Carlo + discrete-event response simulation with depth–disruption travel | Pregnolato 2017 | `lib/sim.js` |
| On-device AI triage of citizen reports (multilingual-e5, Transformers.js) | CrisisTransformers, SOCDA | `lib/ai/intake-ai.js`, `scripts/eval-intake.js` |
| EOC agent with 8 planner tools (Claude or local Llama via Ollama) | DORA benchmark | `lib/ai/agent.js`, `scripts/agent-demo.js` |
| Counterparts pre-designated before the rain, activated on confirmation; tiers city → district → TSSP; floors kept | Japan 対口支援, 2025 Nankai Trough pre-designation | `pairCounterparts` in `lib/planner.js` |
| Typed-team pre-positioning by min-cost flow (METs, DRF, fire crews, volunteers, NDRF on request) | Singapore PUB QRT, US EMAC | `allocate` in `lib/planner.js`, `lib/mcf.js` |
| Underpass closures 30 min before onset (51 real underpasses) | Korea after Osong 2023 | `plan` in `lib/planner.js` |
| Staged timeline (Watch / Prepare / Act), relief waves at 12 h | Japan timeline bousai, TEC-FORCE | `plan` in `lib/planner.js` |
| Citizen reports: triage in en/te/hi/ur, placed by area, de-duplicated, confirm sectors | Japan SOCDA | `lib/intake.js` |
| CAP 1.2 alerts for SACHET in 4 languages with area polygons | Korea multilingual alerts | `lib/cap.js` |
| Musi river: GloFAS discharge vs 1990–2023 percentiles, triggering bank evacuation | GloFAS | `musiLevels` in `lib/risk.js` |
| Replay verification against ERA5 observed rain | | `plan` in `lib/planner.js` |

## Data

**Real:** OpenStreetMap police stations (49), fire stations (8), underpasses (51) and the Musi; Copernicus DEM elevation for 434 one-km cells; SRTM-based Terrarium elevation for 7,021 cells of 250 m; 260 OSM nalas/streams; OSRM road times; Open-Meteo ensemble, previous-runs and ERA5 archive; GloFAS discharge; team counts from the GHMC/HYDRAA 2025 plan.

**Synthetic, and labelled as such in the UI:** deployable officers per station (22% vacancy applied), team placement by zone, volunteer pools, district reserves, incident rates in the simulation, and simulated citizen reports.

## Code layout

`index.html` and `app/` hold the UI, `lib/` the planner and AI (shared by browser and tests), `data/` the real-data snapshot, `scripts/` the data, backtest and eval builders, and `test/` the 10 tests.

Approvals are stored in the browser (`localStorage`, key `surgeforce-audit`); there is no backend.

Map data © OpenStreetMap contributors (ODbL). Weather data from Open-Meteo (CC BY 4.0). Flood data from GloFAS / Copernicus. Elevation from the Copernicus DEM and Mapzen/AWS Terrarium tiles (SRTM and others).
