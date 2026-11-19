# AGENTS.md: context for AI assistants working on SurgeForce

Read this before changing anything. It explains what the project is, why it is built this way, where everything lives, and the rules that must not be broken. Human-facing docs: [README.md](README.md) (run and features), [IDEAS.md](IDEAS.md) (roadmap: next features, government data sources, asks), [OVERVIEW.md](OVERVIEW.md) (team pitch), [RESEARCH.md](RESEARCH.md) (sources, demo script, judge Q&A).

## 1. What this is

SurgeForce is a hackathon entry for **CipherCop 2026 (Telangana Police), Track 02: disaster staffing**. It is an AI command centre for **Hyderabad floods** that decides, *before* the rain, which police officers, GHMC Monsoon Emergency Teams (METs), HYDRAA Disaster Response Force (DRF) teams, fire crews and volunteers should move where, and when. **A human commander approves every move.**

- Live: https://rohanarekatla.github.io/hyd-short-staff/ (GitHub Pages, static)
- Repo: https://github.com/Rohanarekatla/hyd-short-staff (branch `main`)
- Demo scenario: replay of the **31 Aug – 2 Sep 2024** Telangana extreme-rain event using the forecasts as they were issued 1–3 days ahead. Live mode pulls today's forecasts.

## 2. The core idea (do not undermine it)

**Forecasts tell us WHEN. Terrain and citizen reports tell us WHERE.**

This was measured, not assumed. `scripts/backtest.js` over the 2024 and 2025 monsoons showed:

| Question | ROC | Brier skill | Economic value (C/L 0.1) |
|---|---|---|---|
| ≥ 30 mm *somewhere in the city* today | 0.813 | 0.19 | +0.30 (useful) |
| ≥ 30 mm *at this point* | 0.715 | 0.013 | −0.17 (worse than nothing) |

On city heavy-rain days only 38% of points got ≥ 30 mm (`hitShare = 0.38`). EMOS/logistic calibration overfit (≈15 events), so the **raw ensemble** is used; this is documented honestly. Never reintroduce point forecasts for "where".

## 3. How it works (two-stage plan, Rawls & Turnquist structure)

1. **Forecast (when):** 173-member ensemble from Open-Meteo: `gfs025`, `ecmwf_ifs025`, `icon_seamless_eps`, `ecmwf_aifs025_ensemble` (ECMWF's machine-learned AIFS). Replay uses Previous Runs API for 6 models. City probability of flood-level rain → **cost–loss rule: act when P ≥ C/L** (default C/L = 0.1, UI offers 1:20, 1:10, 1:5, 1:3).
2. **Terrain (where):** HAND (Height Above Nearest Drainage, as in NOAA's National Water Model) on 7,021 cells of 250 m, computed with D8 routing from Terrarium elevation tiles and 260 OSM nalas. Severity triggers `[1 h, 3 h, 24 h mm]` = `[12,30,64.5]`, `[20,50,115.6]`, `[40,80,204.5]` (IMD categories; GHMC drain capacity 12–20 mm/h). Ground with HAND ≤ 1 / 2.5 / 4 m floods at severity 1 / 2 / 3.
3. **Stage 1, before rain:** activate the EOC, **pre-designate counterpart stations** (Japan's 対口支援 / taiko shien, 2025 Nankai Trough pre-designation; overbooked ÷ hitShare; tiers city → district police → TSSP state reserve), stage typed teams by **min-cost flow** weighted by terrain exposure (Singapore PUB quick-response teams), **close low-lying underpasses** 30 min before onset (Korea after the 2023 Osong disaster, 14 deaths), CAP alerts, relief waves at 12 h (Japan TEC-FORCE). NDRF (Vijayawada, ~5.5 h lead) only on request when local DRF runs out.
4. **Stage 2, on confirmation:** a citizen report classified as rescue/medical in a sector marks it confirmed → its counterpart activates and staged teams commit. The plan re-solves instantly.
5. **Proof:** Monte Carlo + discrete-event simulation with Pregnolato (2017) depth–speed disruption (`v = 0.0009w² − 0.5529w + 86.9448` km/h, impassable at 300 mm). Rescues reached within 30 min: **83% (teams at depots) → 96% (staged)**.

## 4. Where AI is used (and where it deliberately is not)

| Component | AI | Evidence / file |
|---|---|---|
| When | Ensemble incl. ECMWF AIFS (ML weather model) | Backtest above; `lib/weather.js`, `lib/risk.js` |
| Reading citizen reports | `Xenova/multilingual-e5-small` (q8) via Transformers.js **in the browser**, nearest-prototype classifier (8 examples for each of 5 categories across 4 languages, top-k=3 mean cosine; anything else falls back to `unclassified`) | Held-out 32 messages: **90.6% vs 12.5%** keyword rules; misses 2/20 vs 17/20 life-threatening. `lib/ai/intake-ai.js`, `scripts/eval-intake.js`, `data/intake-eval.json` |
| Commander assistant | Agent with 8 tools: Claude Opus 5.5 (`claude-opus-5-5`, Anthropic SDK 1.3.0 in browser) or local Llama 3.1 via Ollama `/api/chat` | `lib/ai/agent.js`, `scripts/agent-demo.js` |
| Moving teams | **Not AI**: exact min-cost flow (successive shortest paths) so every move is explainable and auditable | `lib/mcf.js`, `lib/planner.js` |

Agent tools: `get_situation`, `get_area`, `what_if_flooded`, `what_if_threshold`, `what_if_offline`, `simulate_response`, `list_reports`, `draft_public_alert`. Design follows the DORA benchmark (NeurIPS 2026): few single-purpose tools, argument repair (`list()` accepts `"['a']"` strings from small models), every tool call shown in the UI.

Report categories: `rescue_needed`, `medical`, `power_hazard`, `road_blocked`, `info_request`, `unclassified`. `HUMAN_ONLY` = rescue, medical, power hazard, unclassified. `CONFIRMS` = rescue, medical.

## 5. Non-negotiable rules

1. **AI may escalate, never downgrade.** If keyword rules say a report is life-threatening (`HUMAN_ONLY`) and the AI guesses a non-human-only category, the rule wins (`triage` in `lib/intake.js`). Covered by a test.
2. **The agent cannot approve, dispatch or send.** It drafts and recommends; the commander clicks Approve. Every number it states must come from a tool result (system prompt in `SYSTEM()`). Answers ≤ 120 words, in en/te/hi/ur.
3. **Human approval on every action.** Approvals are stored in browser `localStorage` key `surgeforce-audit` with who/when.
4. **Real data, synthetic labelled.** Never present synthetic values as real. Synthetic: officers per station (`policeStrength`, 22% vacancy), team placement by zone, volunteer pools (60/zone), district reserves (60), simulation incident rates (MET 3, DRF 0.8 per km²), simulated citizen reports.
5. **Police data stays local.** Triage runs on-device; the agent can run fully on local Ollama. Never send user data to third parties. The Claude API key is pasted by the user and kept only in the tab.
6. **Fully static.** All logic runs in the browser so GitHub Pages works. `server.js` only serves `index.html`, `app/`, `lib/`, `data/` (never `node_modules`, `scripts`, `test`). No backend APIs.
7. **Zero runtime npm dependencies in the browser path.** Libraries come from CDNs with **exact pinned versions at least two weeks old**: MapLibre GL `4.7.1` (unpkg), `@huggingface/transformers@4.3.2` and `@anthropic-ai/sdk@1.3.0` (jsdelivr). Node ≥ 21 (uses `Map.groupBy`).
8. **Commits:** the owner commits and pushes under his own git identity. No `Co-Authored-By` or "Generated with" trailers. Commit/push only when asked.

## 6. File map

```
index.html            UI shell: header controls, KPI strip, 3D map + overlays, side panel tabs, boot screen
app/app.js            All browser logic: state, MapLibre 3D map, rainfall chart, KPIs, panels, approvals,
                      on-device AI loading, agent calls, event wiring
app/style.css         Dark glass "command centre" theme (Inter + JetBrains Mono), responsive < 1100 px
server.js             Static file server for local dev (port 8520)
lib/geo.js            km, nearest, kmToLine, hull, quantile
lib/mcf.js            minCostFlow(nodeCount, arcs, source, sink): successive shortest paths (Bellman-Ford)
lib/weather.js        LATTICE (3x3 city points), DISTRICTS (7 HQs), EVENTS, fetchReplay, fetchLive (Open-Meteo)
lib/risk.js           ASSUMPTIONS, severity, HAND lookup, sector features, Musi levels (GloFAS), cityOutlook, assess
lib/planner.js        SUPPLY (team counts), pairCounterparts, allocate (MCF), buildDepots, plan() -> full plan
lib/sim.js            simulate(): Monte Carlo + discrete-event response, speedAtDepth, travelFactor
lib/calibrate.js      logistic fit, Brier, reliability, ROC (Mann-Whitney), Richardson economic value
lib/intake.js         keyword classify, areaOf, triage (placement, dedupe, AI merge rule), simulatedFeed
lib/cap.js            CAP 1.2 alert XML (status Exercise), ALERT_TEXT in en/te/hi/ur
lib/copilot.js        facts() and templateSitrep(): fallback situation report without an AI provider
lib/ai/intake-ai.js   MODEL, EXAMPLES, makeClassifier, transformersEmbedder
lib/ai/agent.js       TOOLS, SYSTEM, makeTools(ctx), runAgent({provider, question, ctx, lang})
scripts/fetch-data.js OSM (Overpass, with mirror fallback), DEM, OSRM table, GloFAS, replay -> data/
scripts/fetch-hand.js Terrarium PNG decoder + D8 HAND on 250 m grid -> data/hand.json
scripts/backtest.js   2024-2025 point vs city evaluation -> data/calibration.json, backtest-samples.json
scripts/eval-intake.js AI vs keyword triage on test/fixtures/intake-eval.json -> data/intake-eval.json
scripts/agent-demo.js CLI agent (Ollama default, --claude with ANTHROPIC_API_KEY)
data/base.json        49 police stations, 8 fire stations, 51 underpasses, Musi, 434 1-km cells, OSRM travel, Musi thresholds
data/hand.json        columns [lat, lon, elev, hand, sector, drain, pit], 7,021 cells, waterways
data/replay/2024-09-01.json  the replay forecast (members, observed ERA5, Musi discharge)
test/surgeforce.test.js      10 tests (node --test); fixtures in test/fixtures/
```

## 7. Key data shapes

- `plan(base, hand, forecast, opts)` with `opts = { costLoss, confirmed:Set<sectorId>, offline:Set<stationId>, noShow, prev:Map }` returns `{ t0, city:{p1,p2,onset,costLoss,outlook[]}, sectors[], avail, donors[], designated[], pairs[], policeUnmet, teams, depots, actions[], metrics, verification, playbook, underpassHand }`.
- Sector ids equal station indexes in `base.stations`. Positions are `[lat, lon]` everywhere in data; MapLibre needs `[lon, lat]` (converted in `app/app.js`).
- Each action: `{ id, kind, stage:'Watch'|'Prepare'|'Act', at, atMin, onsetAt, title, detail, sectors[], late, request }`. Kinds include standby, counterpart, underpass, alert, relief, musi, and team kinds (met, drf, fire, volunteers); the timeline bundles a sector's team moves into one `bundle` card.
- Pair: `{ from: donorIndex, to: sectorId, people, minutes, tier: 0 city | 1 district | 2 state }`.

## 8. The UI (3D map legend)

- **Blue columns:** 250 m HAND cells; darker/taller = lower ground (≤ 1 m, 1–2.5 m, 2.5–4 m). Heights scale with the probability that drains overflow. **Red towers** = sector confirmed flooded.
- **Station blocks:** height = exposure (vulnerability). Green = covered locally, amber = has a counterpart, red = confirmed hit. Click → playbook popup.
- **Dots:** underpasses; red = closure planned, grey = safe.
- **Lines:** counterpart links; dashed = pre-designated standby, solid = active; colour = tier (green city, purple district, amber state). Glowing line = Musi.
- **Rainfall chart:** city-average 72 h cumulative rain; band = 10–90% of members, line = median, white = ERA5 observed; hover for values.
- Tabs: Timeline (approve actions), Counterparts, Teams, Reports (type a citizen message), Alerts (CAP XML), Evidence (backtest, value/reliability charts, simulation, AI eval), AI Assistant, Method.

## 9. Run, test, deploy

```bash
npm start                    # http://localhost:8520
npm test                     # must stay green (10 tests)
npm run agent -- "What if Uppal floods?"
OLLAMA_ORIGINS=http://localhost:8520,https://rohanarekatla.github.io ollama serve   # local agent; needs llama3.1
```

Deploy = push `main`; GitHub Pages serves the repo root (`.nojekyll` present). Pages caches assets for 10 minutes: bump the `?v=` query on `app/style.css` and `app/app.js` in `index.html` on each UI deploy. The first visit downloads the e5 model (~120 MB, then cached).

## 10. Known gaps and good next steps

- The Claude agent path is implemented but untested end-to-end (no API key during development). The Llama path is verified.
- Only one replay event (2024-09-01); earlier years lack previous-runs data for most models.
- Synthetic rosters (section 5.4) should be replaced with GHMC/police duty rosters and 1070 complaint logs.
- Roadmap and data sources for next features are in [IDEAS.md](IDEAS.md). Top pick: "Follow the Water" (keep the D8 `down` array already computed in `scripts/fetch-hand.js`, add flow accumulation, trace paths on click).

## 11. When you change things

- Keep changes small and in the existing structure (`lib/` is shared by browser and tests; keep it browser-safe, no Node-only APIs outside `scripts/`).
- Run `npm test` and load the app in a browser; check the console is clean.
- If you touch numbers shown to judges (backtest, eval, simulation), regenerate them with the scripts rather than editing JSON by hand, and update README/OVERVIEW.
- Ground any new claim in data or a cited source; label anything assumed.
