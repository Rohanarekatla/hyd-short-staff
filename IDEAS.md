# SurgeForce: ideas, roadmap and data sources

This is our idea submission and roadmap for CipherCop 2026, Track 02. It lists what is already built, the ideas we will build next, the government data each one needs, and what we would ask the government for. Research done on 19 Nov 2026; sources are linked inline. Anything not yet built is marked as an idea.

**The one-line pitch:** SurgeForce already tells Hyderabad *when* a flood is coming and *where* to stage people. The next step is to show *where the water goes*, *why each spot floods*, and *who is responsible for fixing it*, so the city gets better after every storm instead of flooding in the same places every year.

## 1. Already built (live today)

Live: https://rohanarekatla.github.io/hyd-short-staff/. Details in [README.md](README.md) and [OVERVIEW.md](OVERVIEW.md).

- **When:** 173-member weather forecast ensemble, including ECMWF's machine-learned AIFS. Backtest of 2 monsoons: ROC 0.81 for "heavy rain somewhere in the city".
- **Where:** terrain model (HAND) on 7,021 cells of 250 m, plus citizen reports read by on-device AI (91% vs 13% for keyword rules, in English, Telugu, Hindi and Urdu).
- **Plan:** min-cost-flow staging of teams, Japan-style counterpart stations, underpass closures (Korea), relief rotations, CAP alerts in 4 languages, human approval on every action.
- **Proof:** simulation shows rescues reached within 30 minutes rising from 83% to 96%.
- **AI assistant:** Claude or a local Llama model answers the commander only by calling the planner's tools.
- **3D command map:** terrain, flood-prone ground as columns, station exposure, counterparts, underpasses.

## 2. The problem we are solving next

Hyderabad floods in the same places every year. GHMC and partner bodies flagged nearly 1,000 waterlogging hotspots ahead of the 2026 monsoon, about 550 inside GHMC limits, and "most of these hotspots are routinely identified every year" ([Telangana Today](https://telanganatoday.com/nearly-1000-waterlogging-hotspots-identified-across-hyderabad-ahead-of-monsoon)). The causes are known but not visible to the people who must act:

- **Choked and encroached nalas.** A joint survey found that removing about 12,000 encroachments would address 80% of the city's inundation, yet nala widening is stuck at about 10% ([Hyderabad Mail](https://m.hyderabadmail.com/article/hyderabad-nala-expansion-works-stall-10-percent/31477)). Illegal construction has narrowed some nalas by 50% ([Newsmeter](https://newsmeter.in/hyderabad/prajavani-how-illegal-constructions-have-reduced-width-of-nalas-by-50-in-hyderabad-749800)). The 2002 Kirloskar plan to widen 71 nalas was called impractical because it meant demolishing about 28,000 buildings ([Deccan Chronicle](https://www.deccanchronicle.com/nation/current-affairs/150318/hyderabad-wider-nalas-a-pipe-dream.html)).
- **Lakes that breach.** In October 2020 the Gurram Cheruvu (Balapur lake) bund broke around 1 am and water up to 10 feet rushed into Hafiz Baba Nagar. Officials found the lake had no outflow channel, and encroachment of the lake bed had been reported the year before ([Telangana Today](https://telanganatoday.com/hyderabad-rains-rumours-of-breach-in-gurram-cheruvu-led-to-panic), [The News Minute](https://www.thenewsminute.com/amp/story/telangana/thankful-we-are-alive-hafiz-baba-nagar-residents-recount-horror-hyderabad-floods-135934)).
- **The drain map is not public.** GHMC maintains about 1,302 km of storm drains and about 1.3 lakh catch pits and is only now mapping them in GIS with drone base maps ([Siasat](https://www.siasat.com/ghmc-to-map-stormwater-drains-using-gis-tech-to-tackle-hyderabad-flooding-3259110), [Telangana Today](https://telanganatoday.com/18-sndp-works-taken-up-to-revamp-storm-water-drains-in-hyderabad)).
- **Complaints get closed without fixes.** Residents report drainage complaints closed without physical verification ([Hans India](https://www.thehansindia.com/amp/news/cities/hyderabad/hyderabad-ghmc-flooded-with-public-grievances-697459)).

## 3. The ideas

Six groups: A drainage, B accountability, C sensors, D government data, E response, F computer vision. Each idea lists what it does, why it matters, the data it uses, and how hard it is. **Effort:** S = days with data we already have, M = a few weeks, L = needs a government data agreement or hardware.

### A. Drainage intelligence: know where the water goes

**A1. Follow the Water (effort S, top priority)**
Click any spot on the map: SurgeForce draws the path rainwater takes downhill to the nearest nala and on to the Musi, and highlights the whole area uphill that drains into that spot (its catchment). It also marks **dead-end ground**: low cells whose water reaches no drain at all, so it ponds there. Those are the places that suffer first and longest.
- *Why:* after a flood, an officer can trace it back (for example, "the water here comes from these colonies through this nala") and before a flood, staff can be sent to the right drain, not just the flooded street.
- *Data:* we already compute the steepest-descent flow direction for every 250 m cell in `scripts/fetch-hand.js` (D8); we only need to keep it and add flow accumulation. No new data.

**A2. Bottleneck Finder (effort S–M)**
Find every point where a nala passes under a road (a likely culvert), on low ground, with a large area draining into it. Rank them by how much land and how many people sit upstream. Then check them against the official TRAC Telangana flooding-points map: matches are the chokepoints to clear before the monsoon.
- *Why:* gives GHMC's 47-bottleneck programme ([Deccan Chronicle](https://www.deccanchronicle.com/nation/current-affairs/150318/hyderabad-wider-nalas-a-pipe-dream.html)) a data-driven priority list.
- *Data:* OSM roads and nalas, our flow accumulation, the TRAC flooding-points file on [OpenCity](https://data.opencity.in/dataset/flooding-locations-in-hyderabad), and the [Hyderabad nalas layer](https://data.opencity.in/dataset/hyderabad-canals-drains-and-tanks-lakes/resource/hyderabad-nalas).

**A3. Lake Breach Watch (effort M)**
For every lake, show who lives downstream and how fast water would reach them if the bund failed, using the same flow paths as A1. Flag lakes with no mapped outflow channel (the Gurram Cheruvu failure mode). During heavy rain, raise a "watch this bund" alert for lakes already near full, with pre-written evacuation messages for the downstream colonies.
- *Data:* HMDA lake boundaries ([lakes.hmda.gov.in](https://lakes.hmda.gov.in/)), OSM water bodies, our terrain, rain forecasts. Later: lake water-spread from Sentinel-2/Sentinel-1 satellite images, and HYDRAA's 900 lake CCTV cameras ([Telangana Today](https://telanganatoday.com/hydraa-installs-900-cctv-cameras-to-prevent-lake-encroachments)).

**A4. Drain digital twin (effort L)**
When GHMC's GIS drain map is released, load it into a hydraulic model (EPA SWMM, as the National Institute of Hydrology did for GHMC Zone XII, [NIH](https://nihroorkee.gov.in/studies_2014-2025/18-Evaluation%20of%20urban%20storm%20water%20network%20in%20Hyderabad%20city%20using%20SWMM_RVRamana.pdf)) and replace our terrain approximation with real pipe capacities. Every forecast then becomes "these drains will overflow at 9 pm".

### B. Accountability: from "it flooded" to "who fixes it"

Inspired by Bengaluru engineer Gaurav Sen's AI app, which uses a dashcam, GPS and AI vision to find potholes, matches each one to the responsible contractor from about 2,900 government contracts, and prepares the complaint ([Business Today](https://www.businesstoday.in/technology/artificial-intelligence/story/bengaluru-engineer-builds-ai-system-that-detects-potholes-and-prepares-complaints-549579-2026-08-17)).

**B1. Encroachment Detector (effort M)**
Overlay building footprints on the legal no-build buffers: 30 m (lakes ≥ 10 ha) or 9 m (smaller lakes) from the full tank level line, and 9 m or 2 m from nalas wider or narrower than 10 m ([Deccan Chronicle explainer](https://www.deccanchronicle.com/southern-states/telangana/hydraa-demolitions-all-you-want-to-know-about-ftl-buffer-zone-1819329)). Anything inside, *especially upstream of a known flooding point (A1/A2)*, becomes a ranked list with a ready-to-file HYDRAA complaint: location, satellite image, buffer rule broken, and which flooded colony it affects.
- *Caveat:* only 765 of 3,532 lakes had final boundary notifications as of Sept 2024 ([1acre](https://1acre.in/map-layers/telangana/lakes)); preliminary boundaries are labelled as such. A human verifies before anything is filed.
- *Data:* HMDA lake boundaries, OSM or open building footprints, our nala layer.

**B2. Photo to depth to complaint (effort M)**
A citizen or officer sends a photo of a flooded street. AI estimates the water depth from cars, people and kerbs in the frame (published methods reach about 8–11 cm error: [FloodVision](https://arxiv.org/abs/2509.04772), [DeepFlood](https://arxiv.org/pdf/2007.06749)), places it on the map, confirms the sector in SurgeForce, and pre-fills a complaint for GHMC's **MyCURE** app (which replaced My GHMC, [Telangana Today](https://telanganatoday.com/ghmc-launches-mycure-app-for-faster-civic-grievance-redressal)) or the GHMC drain WhatsApp line. The person approves before sending; there is no public MyCURE API.

**B3. Blocked-drain tracker with an escalation clock (effort M)**
Every blocked drain or catch-pit report gets a GPS pin, a photo and a timer tied to the rain forecast: "rain expected in 18 h, clear this by then". Not cleared in time: it escalates to the zonal office. Closing it needs an after-photo at the same spot, so complaints cannot be closed on paper.

**B4. After-Flood Accountability Report (effort S–M)**
After every event, SurgeForce compares where flooding was predicted with where it was reported (and, later, seen by satellite, D3), and for each flooded spot lists the likely cause: the bottleneck (A2), encroachment (B1), breached lake (A3) or unreported blocked drain (B3). This builds a year-on-year evidence trail for fixing the same 550 hotspots instead of re-listing them.

### C. Every camera and phone is a flood sensor

**C1. WhatsApp flood bot and public live map (effort M)**
Residents report floods to a WhatsApp number in any of our 4 languages; our on-device AI already classifies the text. Reports appear on a public map after verification. This is the model of Jakarta's PetaBencana, used by millions, verified by government agencies and even used by NASA to calibrate satellite flood maps ([PetaBencana](https://info.petabencana.id/?p=1044), [ITU](https://www.itu.int/hub/2022/08/crowdsourcing-helps-mitigate-disasters/)).

**C2. CCTV waterlogging detection (effort L, strongest police angle)**
Hyderabad has lakhs of police and community CCTV cameras feeding the command centres (98,321 geo-tagged cameras in Rachakonda's Malkajgiri zone alone, [Telangana Today](https://telanganatoday.com/hyderabad-total-of-1460-surveillance-new-cameras-added-to-malkajgiri-zone)), and Hyderabad Police are rolling out an AI platform over CCTV, drones and IoT sensors ([Deccan Chronicle](https://www.deccanchronicle.com/southern-states/telangana/hyderabad-police-to-roll-out-ai-command-centres-1976309)). Run a small water-detection model on the cameras that overlook the known hotspots and underpasses: the first camera to see water confirms the sector in SurgeForce automatically, with no one having to call it in. Privacy: only a water/no-water signal leaves the camera system, no faces or plates.

**C3. Patrol dashcam spotting (effort M)**
Patrol vehicles already drive every road. A phone or dashcam app flags waterlogged stretches, open manholes and fallen trees with GPS. Karnataka has asked police to use Hoysala patrol dashcams to find potholes ([Deccan Herald](https://www.deccanherald.com/india/karnataka/bengaluru/govt-asks-police-to-assess-road-damage-hoysala-dash-cams-to-identify-potholes-3161115)); the same idea for floods.

**C4. Low-cost water-level sensors at the hotspots (effort L)**
Put ultrasonic water-level sensors (a few thousand rupees each) at the worst underpasses and nala chokepoints. Bengaluru runs 100 automatic rain gauges and 25 water-level sensors on storm drains for its flood forecasting ([PreventionWeb](https://www.preventionweb.net/news/indian-cities-prepare-floods-predictive-technology)). SurgeForce would close underpasses on measured water, not just forecasts.

### D. Plug into official government data

**D1. Official alerts on our timeline (effort S)**
Show NDMA SACHET alerts (IMD and others) beside our own forecast so commanders see one picture and judges can compare SurgeForce with official warnings. The public RSS feed of CAP 1.2 alerts is live ([feed](https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml), checked 19 Nov 2026). It does not allow direct browser requests, so a scheduled GitHub Action saves a copy to the site every 10–15 minutes.

**D2. Telangana's 1,044 automatic weather stations (effort L, data agreement)**
TSDPS/TGDPS runs 1,044 automatic weather stations reporting hourly over GSM, about 78 in Hyderabad ([NCMRWF](https://www.ncmrwf.gov.in/Reports-eng/Technical_Report_QC_Rain_TSDPS_AWS_UPAL_SAHA_Final.pdf)). Live access would let SurgeForce confirm where rain is actually falling block by block, verify every forecast, and trigger stage 2 before the first citizen report. Only a 2018 archive is public ([AIKosh](https://aikosh.indiaai.gov.in/home/datasets/details/telangana_daily_weather_data_2018.html)).

**D3. Satellite flood maps after every event (effort M)**
Free Sentinel-1 radar images see through cloud and at night. A change-detection pipeline (as used for Mumbai and Delhi in recent studies, [ISPRS](https://isprs-annals.copernicus.org/articles/X-G-2025/847/2025/isprs-annals-X-G-2025-847-2025.pdf), [Esri India](https://www.esri.in/en-in/esri-news/publications/arcindia-news/research-paper/flood-mapping-and-change-detection-of-delhi--2023)) maps what actually flooded, so we can score and improve the terrain model and feed B4. Urban radar has known errors from buildings; we label it as supporting evidence.

**D4. IMD forecasts and warnings (effort S)**
IMD's official API gives 7-day city forecasts and current weather under IMD's terms ([IMD API](https://api.imd.gov.in/public/api_reference.html)); district nowcast warnings are only available through map layers ([Thejesh GN](https://thejeshgn.com/2024/09/11/simple-imd-alerts/)).

**D5. Connect to TGiCCC (effort L)**
The Telangana Integrated Command and Control Centre is already linking IMD data to traffic systems, public address and message boards ([Deccan Chronicle](https://www.deccanchronicle.com/southern-states/telangana/tgiccc-imd-hold-coordination-meet-1882203)). SurgeForce's approved actions and CAP alerts could go straight to those boards and speakers.

### E. Smarter response on the day

**E1. Flood-aware routing (effort M)**
Re-route teams and ambulances around roads that are flooded or closed (closed underpasses, confirmed sectors, CCTV-confirmed water), instead of today's single road-time table. Uses OSRM with flooded road segments removed.

**E2. Protect the most vulnerable first (effort S–M)**
Add hospitals, schools, anganwadi centres and health centres (Telangana open data has their locations, [OSM wiki list](https://wiki.openstreetmap.org/wiki/Open_Geospatial_Data_from_Government_of_Telangana)) and population density to the exposure score, so a low-lying anganwadi or dialysis centre gets teams before an empty plot.

**E3. A plan that learns from every storm (effort M)**
After each event, use the confirmed reports, sensors and satellite map to re-fit the numbers SurgeForce currently assumes (the 38% hit share, terrain flooding thresholds, incident rates). The system gets more accurate every monsoon, and every change is logged.

### F. Computer vision: let cameras see the flood

Computer vision (CV) turns cameras the city already has (police CCTV, traffic cameras, patrol dashcams, drones, phones, satellites) into flood sensors. Every CV idea below follows one rule: **process on the camera or edge server and send out only a flood signal (water yes/no, depth, blockage), never faces or number plates.** A human confirms before any action.

**F1. CCTV waterlogging detection with depth (effort L, extends C2)**
Point a water-segmentation model at the cameras that overlook the ~550 hotspots and 51 underpasses. It marks water on the road and estimates depth using road markings or car tyres as rulers. This is proven in research: Mask R-CNN on CCTV flood footage ([EGU24-3747](https://meetingorganizer.copernicus.org/EGU24/EGU24-3747.html)), waterline-to-depth from traffic cameras calibrated on road markings ([EGU25-10710](https://meetingorganizer.copernicus.org/EGU25/EGU25-10710.html)), tyre-based depth from traffic surveillance ([Inderscience](https://www.inderscience.com/info/inarticle.php?artid=148887)), and an island-wide video system in Taiwan that finds and maps flooding automatically ([Lo et al.](https://bohrium.dp.tech/paper/arxiv/2103.05927)). Floods often peak at night, so we use low-light models ([MDPI Water](https://mdpi.com/2073-4441/17/5/707)). *In SurgeForce:* the first camera to see water confirms the sector (stage 2) and depth above 30 cm at an underpass triggers its closure automatically, pending approval.

**F2. Blocked culvert and trash-screen detection (effort M)**
Fixed cameras at the chokepoints from A2 classify each culvert or trash screen as clear or blocked, so crews clear it *before* the rain. Research reached about 85% with a plain image classifier and about 94% with a detect-then-classify pipeline on culverts ([Wollongong, arXiv 2105.03232](https://arxiv.org/abs/2105.03232)), and close to 90% on CCTV of trash screens ([University of Bath](https://www.eurekalert.org/news-releases/1060746)). Feeds the B3 escalation clock: "blocked for 6 h, rain in 12 h, escalate".

**F3. Pre-monsoon street audit from dashcam and street imagery (effort M, extends C3)**
Run detectors on patrol dashcam video and open street-level imagery to find catch pits, manholes, garbage heaps next to drains, silt on roads and open manholes, and pin each one on the map with a photo. Mapillary already detects manholes as a map feature and offers an API ([Mapillary blog](https://blog.mapillary.com/update/2019/01/23/updating-maps-with-cameras-42-new-point-features.html)); its coverage in Hyderabad is patchy, so our own patrol dashcams fill the gaps. The result is a before-monsoon checklist per ward, and a check that the 1.3 lakh catch pits are actually clear.

**F4. Drone nala survey (effort M)**
Drones fly each major nala before the monsoon. Segmentation models flag garbage, silt banks, weeds, collapsed walls and new structures inside the nala buffer, measured in metres of channel lost. GHMC is already producing drone base maps for its drain GIS ([Siasat](https://www.siasat.com/ghmc-to-map-stormwater-drains-using-gis-tech-to-tackle-hyderabad-flooding-3259110)). Output: a ranked "clear this stretch first" list tied to A2 bottlenecks and B1 encroachments.

**F5. Drone search and rescue after a flood (effort M)**
During and after a flood, drones map which roads and buildings are under water and find people and vehicles on rooftops or stranded. Models trained on open post-flood drone datasets such as FloodNet (Hurricane Harvey, pixel-level labels for flooded roads and buildings, [arXiv](https://arxiv.org/pdf/2012.02951)) and RescueNet, plus standard person and vehicle detectors. Each detection becomes a geo-tagged rescue task in SurgeForce, routed to the nearest DRF team (E1).

**F6. Satellite and drone change detection for encroachments (effort M, extends B1)**
Compare images of the same lake or nala from different dates and flag new construction inside the full-tank-level buffer, so HYDRAA gets an alert when building starts, not after the bund breaks. Free Sentinel-2 imagery (10 m) is enough for lake water spread but too coarse for single buildings; building-level change needs high-resolution or drone imagery.

**F7. Camera-read water gauges (effort S–M, alternative to C4)**
Paint a water-level scale on the wall of each critical underpass and lake bund, and point a cheap camera or existing CCTV at it. CV reads the water level from the scale every minute: a calibrated, maintenance-light sensor without electronics in the water. Feeds underpass closures and A3 Lake Breach Watch. (Our idea; the reading step is standard detection plus OCR.)

**F8. Citizen photo intelligence (effort M, extends B2)**
One photo from a citizen can carry several signals: water depth (B2), an open manhole, a live wire in water, a fallen tree, a blocked drain. A multi-label classifier tags each and routes it: live wire to the electricity department and HUMAN_ONLY triage, open manhole to GHMC with an urgent flag. Same "AI may escalate, never downgrade" rule as our text triage.

**F9. Satellite flood maps (effort M, see D3)**
Sentinel-1 radar flood mapping is itself a CV problem (change detection and segmentation on radar images); we would use it to score the terrain model after each event.

## 4. Priorities

| Order | Idea | Why first |
|---|---|---|
| 1 | A1 Follow the Water | Uses data we already have; answers "where does water go and where do we suffer" |
| 2 | A2 Bottleneck Finder | Turns A1 into a fix-list; validated against the official flooding-points map |
| 3 | D1 Official alerts | Easy, shows we integrate with government systems |
| 4 | B1 Encroachment Detector | The "who is responsible" idea, unique, police and HYDRAA relevant |
| 5 | B2 Photo to depth | Memorable demo, extends our existing AI |
| 6 | C1 WhatsApp bot | Scales citizen reporting |
| Then | A3, B3, B4, D3, E1–E3 | Build on the above |
| Then (CV) | F2, F3, F7, F8 | Cheap cameras and existing dashcams; strong demo value |
| With government | A4, C2/F1, C4, D2, D5, F4, F5 | Need data access, cameras, drones or hardware |

## 5. What we would ask the government for

1. **GHMC:** the storm-drain GIS (lines, culverts, catch pits, capacities) as it is completed, and the annual waterlogging-point list with severity grades.
2. **TSDPS/TGDPS:** read access to live hourly data from the Hyderabad automatic weather stations.
3. **Telangana Police / TGiCCC:** a water/no-water signal from cameras at hotspots and underpasses, and a channel to push approved alerts to message boards and public address.
4. **HMDA / HYDRAA:** final lake boundary and buffer layers in GIS format, and a complaint intake we can file to.
5. **GHMC MyCURE:** an API to file and track complaints with photo and location.

## 6. Data source summary

| Source | What | Access | Used by |
|---|---|---|---|
| Open-Meteo (ensembles, previous runs, ERA5) | Forecasts and observed rain | Open, free | Built |
| AWS Terrarium elevation, OSM | Terrain, nalas, roads, stations, underpasses | Open | Built, A1, A2, E1 |
| GloFAS | Musi discharge | Open | Built |
| OSRM | Road times | Open | Built, E1 |
| NDMA SACHET RSS | Official CAP alerts | Open RSS, no browser CORS | D1 |
| TRAC flooding points, Hyderabad nalas (OpenCity) | Official inundation points, nala map | Open download (KML) | A2, B4 |
| HMDA lakes portal | Lake boundaries and buffers | Public portal | A3, B1 |
| IMD API | City forecast, current weather | Terms apply | D4 |
| Sentinel-1/2 (Copernicus) | Satellite flood and lake extent | Open | A3, D3 |
| Telangana open data | Health centres, anganwadis, admin boundaries | Open | E2 |
| TSDPS AWS (1,044 stations) | Hourly rain | Needs agreement | D2 |
| GHMC storm-drain GIS | Drain network | Not yet public | A4 |
| Police/TGiCCC CCTV | Camera feeds | Needs agreement | C2 |
| GHMC MyCURE | Complaints | App only, no public API | B2, B3 |

Not useful for us: Bhuvan/NRSC has no Hyderabad urban flood layer ([NRSC 2020 floods](https://www.nrsc.gov.in/nrscnew/2020_Floods.php)); Google Flood Hub covers rivers, behind a waitlist ([Google](https://developers.google.com/flood-forecasting)).

## 7. Indian benchmarks

Mumbai has iFLOWS (alerts 6–72 h ahead, flood atlas), Chennai has C-FLOWS (ward-level flood warnings), and Bengaluru has 100 rain gauges and 25 drain water-level sensors ([PreventionWeb](https://www.preventionweb.net/news/indian-cities-prepare-floods-predictive-technology)). Hyderabad has no equivalent public system. SurgeForce adds what none of them do: staffing decisions with human approval, and an accountability loop that ties each flooded spot to its cause.
