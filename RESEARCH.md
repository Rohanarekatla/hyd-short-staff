# SurgeForce: research, ideas and pitch

CipherCop 2026, Track 02 (AI disaster response). The problem: when a storm is coming, decide **who goes where, and when**, before the first distress call.

## Why this is not the usual hackathon entry

Most teams will build a flood-risk map, a chatbot or a dashboard. Those show where things are bad. None of them answers the commander's real question at T-24 h: *which 12 officers from which station leave at 20:04 for which underpass?* SurgeForce answers that question with real data and real forecast uncertainty, then hands a human a signed-off, timed order list.

## What the leading countries do, and what we took

| Country / system | What they do | What SurgeForce copies |
|---|---|---|
| **Japan: counterpart support (対口支援)** | After 2011, each hard-hit municipality is paired with **one** supporting government, borrowed from China's 2008 Sichuan "pairing assistance". MIC made it national in 2018. After Noto 2024, 63 municipalities sent staff to 18 towns, but many were unfamiliar with the ground ([Journal of Social Safety Science](https://www.jstage.jst.go.jp/article/jisss/39/0/39_51/_article/-char/en), [Japan Times](https://www.japantimes.co.jp/news/2022/01/17/national/disaster-officials-dispatched/), [Asia News Network](https://asianews.network/japan-seeks-to-improve-post-quake-support-system/)) | **Counterpart pairing**: each short station gets one donor, not ten. Pairs persist across re-plans so officers learn the ground. Tiers: dry city station, then dry neighbouring district, then state reserve. |
| **Japan: timeline disaster prevention (タイムライン防災)** | Pre-agreed "when, who, what" actions keyed to hours before landfall, adopted after Hurricane Sandy ([MLIT](https://www.mlit.go.jp/river/bousai/bousai-portal/en/prepare04/index.html), [PIARC](https://disaster-management.piarc.org/en/preparedness-business-continuity-planning/timeline-planning)) | **Staged timeline**: Watch (>24 h), Prepare (6–24 h), Act (<6 h). Every action has a departure time computed back from onset minus road time. |
| **Japan: SOCDA chatbot (NIED, on LINE)** | Residents report damage in chat; AI extracts and maps it for municipal HQs ([LY Corp](https://www.lycorp.co.jp/en/sustainability/csr/article/005/), [Weathernews](https://jp.weathernews.com/wp-content/uploads/2019/10/20191016_2.pdf)) | **Citizen intake** for WhatsApp/1070 in English, Telugu, Hindi and Urdu. A confirmed rescue report overrides the forecast for that sector. |
| **Japan: TEC-FORCE rotation** | MLIT rotates staff one at a time; Kanto alone sent 909 people cumulatively to Noto ([MLIT Chubu](https://www.cbr.mlit.go.jp/saigai/NEWS/MAIN/240101noto/03tec/hakenjoukyou20240107.pdf)) | **Relief waves** at 12 h (fatigue cap). |
| **South Korea: underpass barriers after Osong (14 dead, 2023)** | Automatic barriers with water sensors; Mapo-gu uses AI to predict underpass flooding. Gyeonggi is fitting 221 underpasses ([Asiae](https://www.asiae.co.kr/en/article/2024071716484243724), [Gyeonggi](https://www.asiae.co.kr/en/article/2024061907160177658)) | **Underpass guard**: 51 real Hyderabad underpasses from OSM. Each at-risk one gets a closure order 30 min before onset. Hyderabad has no barriers, so we post officers. Balkampet RUB drowning shows the need. |
| **South Korea: multilingual alerts** | English added to disaster alerts; Emergency Ready App in 5 languages ([Korea Times](https://koreatimes.co.kr/www/nation/2025/01/113_369702.html)) | **CAP 1.2 alerts for SACHET** in English, Telugu, Hindi and **Urdu** (Telangana's second official language) |
| **Singapore: PUB Quick Response Teams** | Rain prediction says where heavy rain falls, so crews deploy **ahead** of it; 1,200+ drain sensors ([GovInsider](https://govinsider.asia/inclusive-gov/pub-yeo-keng-soon-hazel-khoo-exclusive-how-singapore-is-predicting-floods/), [PUB](https://www.pub.gov.sg/Resources/News-Room/PressReleases/2022/12/Building-Singapore-Flood-Resilience-in-a-Changing-Climate)) | **Pre-positioning** of GHMC Monsoon Emergency Teams and HYDRAA DRF to sectors before onset (min-cost flow) |
| **Hong Kong: DSD Emergency Control Centre** | 100+ teams pre-inspect 220 flooding blackspots before and during black rain ([Standard](https://www.thestandard.com.hk/news/article/306492/Heavy-rain-causes-six-floods-across-HK-DSD-deploys-100-response-teams)) | Teams sent to low-lying cells, with severity tied to rain intensity |
| **Taiwan: Civil IoT** | 2,469 flood sensors plus 158k CCTVs feeding the national disaster centre ([SCJ](https://www.scj.go.jp/ja/int/kaisai/jizoku2023/pdf/presentation-11.pdf)) | Roadmap: plug in TSDPS's 1,044 AWS gauges for ground truth |
| **USA: EMAC + FEMA resource typing** | Mutual aid between states with pre-agreed liability and pay; **Mission Ready Packages** are typed teams, sourced nearest-first ([EMAC](https://www.emacweb.org/index.php/mission-ready-packages)) | **Typed teams** (MET × 12, DRF × 15, NDRF × 47 with a 5.5 h lead time) instead of loose head-counts |
| **Kerala 2018: fishermen** | 669 country boats rescued about 65,000 people ([Business Standard](https://www.business-standard.com/amp/article/pti-stories/65-000-people-rescued-by-fishermen-during-floods-118082600554_1.html)) | Roadmap: a **citizen asset registry** (boats, tractors, swimmers), for example Hussain Sagar boat operators |
| **Bangladesh CPP** | 76,000 volunteers; cyclone deaths down more than 100-fold | Volunteers only on low-risk tasks, with a modelled no-show rate |

## The Hyderabad facts we build on

- **Drains**: GHMC says its storm drains handle about 2 cm/h; other reports say 1.2 cm/h ([TNM](https://www.thenewsminute.com/amp/story/telangana/hyds-municipal-body-begins-desilting-drains-ahead-rains-too-little-too-late-102474), [NIH Roorkee](https://nihroorkee.gov.in/studies_2014-2025/18-Evaluation%20of%20urban%20storm%20water%20network%20in%20Hyderabad%20city%20using%20SWMM_RVRamana.pdf)). Our level 1 and level 2 triggers are 12 and 20 mm/h.
- **Teams (2025)**: 150 Monsoon Emergency Teams × 12 and 51 HYDRAA DRF teams × 15, at 141 waterlogging points ([Siasat](https://www.siasat.com/ghmc-hydraa-to-deploy-130-monsoon-emergency-teams-to-tackle-waterlogging-3231799/amp), [The Week](https://www.theweek.in/wire-updates/national/2025/07/23/mes26-tl-ld-rains.html)).
- **13 Oct 2020**: about 192 mm at Begumpet, the worst October rain in a century, with 50 deaths statewide ([Deccan Chronicle](https://deccanchronicle.com/nation/current-affairs/151020/hyderabad-deluge-19-killed-as-heaviest-october-rain-in-a-century-maro.html)).
- **Gauges**: TSDPS runs 1,044 AWS statewide and planned 166 inside GHMC ([Hans India](https://assets.thehansindia.com/posts/index/Telangana/2018-07-14/166-Automatic-Weather-Stations-to-be-set-up-in-Hyderabad/398061)). There is no public live feed yet, which is a data ask for the organisers.
- **Police**: state vacancies above 20% for a decade, so we apply 22% to every station's strength.

## Round 2: we measured the forecasts, and it changed the design

Before trusting forecasts with staffing, we backtested them. Over the full 2024 and 2025 monsoons (June–October), we compared what six global models forecast 1–3 days ahead (18 members) with ERA5, at 9 points across the city ([scripts/backtest.js](scripts/backtest.js)).

| Question | Events | Brier skill | ROC area | Economic value at C/L = 0.1 |
|---|---|---|---|---|
| Heavy rain (≥ 30 mm/day) **anywhere in Hyderabad** today? (when) | 15 / 306 days | **0.19** | **0.81** | **0.30** |
| Heavy rain **at this 25 km point**? (where) | 51 / 2,754 | 0.01 | 0.71 | **−0.17** |

- **The city-level forecast is reliable.** Days forecast at 25% verified at 27%; days forecast at 48% verified at 43%.
- **The point-level forecast is worse than useless for deciding where.** Its economic value is negative at most cost ratios ([Richardson's cost-loss model](https://www.ecmwf.int/sites/default/files/elibrary/2014/17333-decisions-decisions.pdf)).
- **Calibration didn't help yet.** We tried an EMOS-style logistic calibration ([Scheuerer 2014](https://arxiv.org/pdf/1302.0893); Wilks & Hamill). With only 15 events, it did not beat the raw ensemble on held-out seasons, so the app uses the raw probability. The fit re-runs each season as events accumulate.
- **Rain is local.** On city heavy-rain days, only 38% of points got ≥ 30 mm.

**Design consequence: forecast for WHEN, terrain and reports for WHERE.** This is a two-stage plan, the structure of [Rawls & Turnquist (2010)](https://ideas.repec.org/a/eee/transb/v44y2010i4p521-534.html)'s pre-positioning model:

1. **Stage 1, before the rain.** The city-level probability triggers activation when it reaches C/L.
   - Teams stage forward in proportion to terrain exposure. Each sector's expected need is its if-hit need × the 38% hit share.
   - Every exposed station gets a pre-designated counterpart, as Japan began doing for the Nankai Trough in 2025.
   - Low-lying underpasses close.
2. **Stage 2, when a citizen report confirms a sector.** Its counterpart activates, staged teams commit to it, and it gets an immediate CAP alert.

### New technologies in the build

| Technology | What it does here | Source |
|---|---|---|
| **HAND terrain model** | Height Above Nearest Drainage on a 250 m grid (7,021 cells), from SRTM-based Terrarium tiles and 260 OSM nalas/streams. D8 flow routing to a drain or a closed depression; inundation by stage at severity 1/2/3. Replaces the crude "low-lying" flag. | [NOAA HAND factsheet](https://www.weather.gov/media/owp/operations/HAND_factsheet.pdf), [GRASS r.hand](https://grass.osgeo.org/grass84/manuals/addons/r.hand.html) |
| **Cost–loss decision rule** | The header sets the ratio of false-alarm cost to miss cost (1:20 to 1:3). The system acts when P ≥ C/L and plans to the (1 − C/L) quantile. Replaces the arbitrary P80. | [Richardson 2000 / ECMWF](https://www.ecmwf.int/sites/default/files/elibrary/2014/17333-decisions-decisions.pdf) |
| **Forecast verification** | Brier skill, ROC area, reliability diagram and relative economic value, shown live in the Evidence tab | [ensembleMOS](https://cran.rstudio.com/web/packages/ensembleMOS/refman/ensembleMOS.html) |
| **Depth–disruption travel** | Vehicle speed falls with standing water (0–300 mm; impassable at 30 cm). Travel ×1.12 / 1.78 / 5.95 at severity 1/2/3. | Pregnolato et al. 2017, Transp. Res. D 55:67–81 ([as used in the Wuhan study](https://www.frontiersin.org/articles/10.3389/fenvs.2022.1056854)) |
| **Monte Carlo + discrete-event response simulation** | 134 storms drawn from the real forecast members, random hit sectors, terrain-driven incidents, nearest-free-team dispatch | [WSC 2005](https://www.informs-sim.org/wsc05papers/104.pdf) |
| **Claude copilot** | Writes situation reports from the plan's facts in English, Telugu, Hindi or Urdu (Claude Opus 5.5, optional; template fallback) | `lib/copilot.js` |

**Result:** in the replay, staging by terrain exposure lifts rescues reached within 30 minutes from **83% to 96%**, and cuts the 90th-percentile rescue response from **43 to 30 minutes** against teams waiting at zone depots. Incident rates are synthetic, so read this as the size of the effect, not a field number.

### How this compares to what Indian cities run

- **[Mumbai iFLOWS](https://pib.gov.in/PressReleasePage.aspx?PRID=1631096)** (MoES, 2020) and **Chennai C-FLOWS**: inundation forecasts up to 72 h, with a decision-support module.
- **[Bengaluru KSNDMC](https://ksndmc.org/Content/Documents/General/Urban%20Flood%20Monitoring.pdf)**: 100 telemetric rain gauges and drain water-level sensors at 15-minute intervals, with yellow/orange/red alerts. Reporting says it is "good for rescue, not prevention" ([Citizen Matters](https://citizenmatters.in/?p=87431)).
- **[Google urban flash-flood forecasting](https://research.google/blog/protecting-cities-with-ai-driven-flash-flood-forecasting/)** (March 2026): trained on 2.6 million floods extracted from news by Gemini ("Groundsource"), on about 20 km² cells, up to 24 h ahead.

None of these decides **who moves where, and when**. SurgeForce sits on top of them: any of these risk feeds can replace the forecast input.

## What makes it realistic

1. **Real forecasts.** Live mode uses 122 ensemble members. Replay uses what models actually predicted 1–3 days before 31 Aug 2024.
2. **Measured skill.** It uses the forecast only where the backtest shows value.
3. **Real geography.** OSM stations, underpasses, nalas and the Musi; SRTM-based terrain; OSRM roads; GloFAS discharge against its 34-year climatology. The Musi reached 490 m³/s in the replay, against a 99th percentile of 118.
4. **It escalates realistically.** In the 2024 statewide storm, all 7 neighbouring districts were wet too. Counterparts fall through to the TSSP reserve, and DRF needs an NDRF request with a 5.5 h lead time.

## More ideas (roadmap, in priority order)

1. **Hyderabad "Groundsource"**: use Claude to extract flood locations and dates from ten years of Telangana Today, Deccan Chronicle and Siasat archives, as Google did with Gemini. That gives the local ground truth needed to validate HAND exposure and to learn "where".
2. **Radar nowcasting**: IMD's Hyderabad Doppler radar plus an open nowcasting model ([NowcastNet, Nature 2023](https://www.nature.com/articles/s41586-023-06184-4)) for the 0–3 h "where" that global models can't give.
3. **TSDPS gauges and drain sensors**: 1,044 AWS statewide plus KSNDMC-style water-level sensors in the nalas, to confirm sectors automatically (stage 2 without waiting for a citizen).
4. **Citizen asset registry** (Kerala 2018: 669 fishing boats rescued about 65,000 people): pre-register boats, tractors and swimmers as typed teams.
5. **Reservoir release coupling**: Himayat Sagar and Osman Sagar gate plans from HMWSSB into the Musi-bank timing.
6. **Pre-signed mutual-aid MoUs** (EMAC-style), so activating a counterpart is one click.
7. **Navigation warnings** (Korea): push underpass closures to map apps.
8. **WhatsApp bot for officers**: accepting or declining orders closes the no-show loop.

## Five-minute demo

1. **Hook (30 s)**: "We measured it. Global forecasts can tell Hyderabad *when*, but not *where*. So we built staffing around that."
2. **Evidence tab (60 s)**: the backtest table and value curve (green city line above zero, red point line below), then the simulation: 83% → 96% of rescues within 30 minutes.
3. **Map (45 s)**: HAND terrain shows where water collects, with nalas and underpasses. Click Uppal for its playbook: what it gets if hit, what's staged now, and who its counterpart is.
4. **Cost–loss (30 s)**: switch 1:20 → 1:3 and watch staging and counterparts shrink. "The commander sets how much a false alarm costs; the maths does the rest."
5. **Stage 2 (60 s)**: send a Telugu report, "Uppal లో మమ్మల్ని కాపాడండి". Uppal turns red, its counterpart activates, a confirmed-area CAP alert appears, and the timeline updates. Approve.
6. **Copilot and close (45 s)**: generate the sitrep in Telugu. "Every number came from the plan; every move has a human sign-off."

## Questions judges will ask

| Question | Answer |
|---|---|
| Where do rosters come from? | Station strength is synthetic and labelled so. The supply interface is one function: replace it with the CCTNS / HRMS duty roster. |
| A 25 km forecast for a city? | We measured exactly that: it has value for *when* (ROC 0.81) and none for *where*. So *where* comes from HAND terrain and citizen reports, and radar/gauges are the roadmap. |
| Isn't the severity model made up? | The triggers are IMD's rain categories and GHMC's stated drain capacity. The rates are editable assumptions, shown in the UI, and meant to be calibrated on 1070 logs. |
| Why counterparts, not optimal many-to-many? | Japan learned in Noto that ten small groups who don't know the ground underperform. One donor per sector is reviewable, keeps command lines, and persists. |
| Why not just train an ML flood model? | With 15 heavy-rain days in two seasons, a fitted calibration already overfit. We show the evidence instead of claiming accuracy; the Groundsource roadmap item builds the labels a real model needs. |
| What if the AI is wrong? | Nothing moves without sign-off; CAP status stays "Exercise" until approved; life-threatening reports always route to a human. |
