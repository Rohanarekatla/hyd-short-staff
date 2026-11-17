# SurgeForce: team overview

**Live demo:** https://rohanarekatla.github.io/hyd-short-staff/ · **Code:** https://github.com/Rohanarekatla/hyd-short-staff

## In one paragraph

SurgeForce is our CipherCop 2026 Track 02 entry: an AI command centre that decides, before a storm hits Hyderabad, which police, GHMC Monsoon Emergency Teams, HYDRAA rescue teams and volunteers should move where, and when, with a human commander approving every move. We started from how the best systems in the world work: Japan pairs each struggling area with one supporting area and plans by a "timeline", Korea closes underpasses before they flood after 14 people died at Osong, and Singapore pre-positions crews where rain is predicted. Then we measured what AI weather forecasts can actually do for Hyderabad. Our backtest of the 2024 and 2025 monsoons showed they reliably predict *when* heavy rain hits the city (ROC 0.81) but not *where* inside it. So SurgeForce uses a 173-member forecast ensemble, including ECMWF's machine-learned AIFS model, to decide when to mobilise. It uses a terrain model built from elevation data and OpenStreetMap drains, plus AI-read citizen reports, to decide where. An optimiser stages teams and pre-assigns counterpart stations, and a Monte Carlo simulation shows this raises rescues reached within 30 minutes from 83% to 96%. An on-device AI reads WhatsApp-style reports in English, Telugu, Hindi and Urdu. It scored 91% accuracy on held-out messages, against 13% for keyword rules, and when it confirms flooding in an area the plan re-solves instantly. An AI agent (Claude, or a local Llama model so police data never leaves the building) answers the commander's questions by calling the planner's tools, so every number it states is grounded.

## Where AI does the work

| Stage | AI used | Evidence |
|---|---|---|
| **When**: will Hyderabad get heavy rain? | 173-member forecast ensemble, including 51 members from ECMWF's machine-learned AIFS model | Backtest of 2 monsoons: ROC 0.81, positive decision value |
| **Where**: which areas flood? | Terrain model (HAND, as in NOAA's flood maps) on 7,021 cells of 250 m, plus AI-read citizen reports | Point forecasts have negative value, so we don't use them for "where" |
| **Reading reports** | Multilingual embedding AI (multilingual-e5) in the browser, no API key, no data leaves the device | 91% vs 13% accuracy; misses 2 of 20 life-threatening reports vs 17 of 20 for keywords |
| **Deciding moves** | Min-cost-flow optimiser, Japan-style counterpart matching, cost–loss decision theory | Supply, floors and safety rules covered by 10 automated tests |
| **Proving it helps** | Monte Carlo + discrete-event simulation with flood-depth road slowdowns | Rescues within 30 min: 83% → 96% |
| **Talking to the commander** | AI agent with 8 planner tools: Claude Opus 5.5, or local Llama 3.1 via Ollama | Every tool call is shown; it cannot approve or send anything |

## Who does what in the demo (5 minutes)

1. **Hook:** "We measured it. AI forecasts can tell Hyderabad *when*, but not *where*. So we built staffing around that."
2. **Evidence tab:** backtest table, value curve, simulation result, AI triage vs keywords.
3. **Map:** terrain shows where water collects. Click Uppal for its playbook.
4. **Reports tab:** type a Telugu message ("Uppal లో నీటిలో చిక్కుకుపోయాం, త్వరగా రండి"). The AI flags a rescue, Uppal turns red, and its counterparts activate.
5. **AI Assistant:** ask "What changes if Uppal is confirmed flooded?" and show the tool calls.
6. **Close:** every number is grounded, every move needs human sign-off, and it runs on free public data and on-device AI.

## What's real and what's assumed

- **Real:** forecasts, terrain, OSM stations, underpasses and nalas, road times, river discharge, and the GHMC/HYDRAA 2025 team counts.
- **Assumed** (labelled in the app): officers per station, team locations within each zone, incident rates, and simulated citizen reports. These are what we'd replace with department data.

## Running it

- **Online:** open the live demo link. The on-device AI downloads once (about 120 MB) and is then cached.
- **Locally:** `npm start`, then open http://localhost:8520.
- **Local AI agent:**

  ```bash
  OLLAMA_ORIGINS=http://localhost:8520,https://rohanarekatla.github.io ollama serve
  ```

  Then pick "Local model" in the AI Assistant tab.
- **Claude agent:** paste an Anthropic API key in the AI Assistant tab. It stays in that browser tab only.
