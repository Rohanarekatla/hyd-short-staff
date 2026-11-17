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

## What makes it realistic

1. **The forecasts are real.** Live mode pulls 122 ensemble members (NCEP GEFS, ECMWF ENS and DWD ICON-EPS). Replay uses what six global models **actually predicted 1–3 days before** 31 Aug 2024 (Open-Meteo Previous Runs API). Totals ranged from 20 to 336 mm: that spread is real uncertainty the commander faced.
2. **Plan to a quantile, not the average.** At P80 the plan covers 4 in 5 forecast futures. The P50, P80 and P95 buttons show the cost of caution in officers and teams.
3. **Real geography**: OSM police and fire stations, underpasses and the Musi; Copernicus DEM elevation per km²; OSRM road times; GloFAS Musi discharge against its 34-year climatology. In the replay, the Musi reached 490 m³/s against a 99th percentile of 118.
4. **It checks itself.** Replay compares flagged sectors with what ERA5 says actually fell.
5. **It escalates the way it would in real life.** In the 2024 replay the storm covered all of Telangana: every city station and all 7 neighbouring districts were wet. So the counterpart tier fell through to TSSP reserve companies. At P95, even the reserve runs 6 officers short and 56 fire crews are missing: the plan shows exactly where the state should ask for NDRF, which takes about 5.5 h to arrive.

## More ideas (roadmap, in priority order)

1. **TSDPS gauge nowcast**: replace the 25 km forecast with 1,044 real gauges for the next 0–3 h (like Taiwan Civil IoT).
2. **Citizen asset registry** (the Kerala lesson): pre-register boats, tractors, JCBs and trained swimmers, and dispatch them like teams.
3. **Reservoir release coupling**: pull Himayat Sagar and Osman Sagar gate-opening plans from HMWSSB into the Musi-bank evacuation timing.
4. **Pre-signed mutual-aid agreements** (EMAC-style): district-to-district MoUs on cost and liability, so a counterpart request is one click.
5. **Navigation warnings** (Korea): push underpass closures to Google Maps / Mappls traffic layers.
6. **Learn the rates**: fit the people-per-cell planning rates on GHMC 1070 complaint logs from past monsoons.
7. **WhatsApp bot**: officers accept or decline orders. Declines re-solve the plan, closing the no-show loop.

## Five-minute demo

1. **Hook (30 s)**: "On 31 Aug 2024 the models disagreed fivefold about Hyderabad's rain. Who should have moved, and when?"
2. **Fan chart (45 s)**: 18 real forecasts and what actually fell. Switch P50 → P80 → P95: sectors go from 10 to 49 (all of them), and the officers needed from outside go from 0 to 42 to 156.
3. **Timeline (90 s)**: Watch, then a CAP alert in 4 languages 6 h ahead, then per-sector bundles: officers from the counterpart, METs, DRF, and underpass closures 30 min before onset. Approve a stage.
4. **Counterparts (45 s)**: show that districts were wet too, so the plan escalates to TSSP. On P50 the dry districts lend instead.
5. **Ground truth (45 s)**: send a Telugu WhatsApp report, "Amberpet లో మమ్మల్ని కాపాడండి". The sector turns confirmed and the plan re-solves.
6. **Close (30 s)**: every move has a human sign-off and an audit line. It runs on free public data today.

## Questions judges will ask

| Question | Answer |
|---|---|
| Where do rosters come from? | Station strength is synthetic and labelled so. The supply interface is one function: replace it with the CCTNS / HRMS duty roster. |
| A 25 km forecast for a city? | Yes, which is exactly why we plan on probabilities and quantiles, not a single map. TSDPS gauges are roadmap item 1. |
| Isn't the severity model made up? | The triggers are IMD's rain categories and GHMC's stated drain capacity. The rates are editable assumptions, shown in the UI, and meant to be calibrated on 1070 logs. |
| Why counterparts, not optimal many-to-many? | Japan learned in Noto that ten small groups who don't know the ground underperform. One donor per sector is reviewable, keeps command lines, and persists. |
| What if the AI is wrong? | Nothing moves without sign-off; CAP status stays "Exercise" until approved; life-threatening reports always route to a human. |
