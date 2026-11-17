// Real forecasts. Live: 122-member multi-model ensemble (NCEP GEFS 31, ECMWF ENS 51, DWD ICON-EPS 40).
// Replay: what each global model actually forecast 1, 2 and 3 days ahead of a past event
// (Open-Meteo Previous Runs API), plus ERA5 observed rain and GloFAS Musi discharge.
// Shape: { times[], points[], members: [{ name, series: [pointIdx][hour] }], observed?, musi }
import { readFile, writeFile } from 'node:fs/promises';

// 3 x 3 lattice over the city; global ensembles are ~25 km, so finer points add no information
export const LATTICE = [17.33, 17.42, 17.51].flatMap((lat) => [78.33, 78.45, 78.57].map((lon) => [lat, lon]));
// district police HQs around Hyderabad: outside counterparts when the whole city is under the same storm
export const DISTRICTS = [
  { name: 'Sangareddy district police', pos: [17.6247, 78.0866] }, { name: 'Vikarabad district police', pos: [17.3381, 77.9044] },
  { name: 'Medak district police', pos: [18.0453, 78.2608] }, { name: 'Siddipet police commissionerate', pos: [18.1018, 78.852] },
  { name: 'Yadadri Bhuvanagiri district police', pos: [17.5106, 78.8889] }, { name: 'Nalgonda district police', pos: [17.0575, 79.2671] },
  { name: 'Mahabubnagar district police', pos: [16.7488, 78.0035] },
];
export const POINTS = [...LATTICE, ...DISTRICTS.map((d) => d.pos)];
export const MUSI_POINT = [17.37, 78.48];
export const EVENTS = [
  { id: '2024-09-01', label: '31 Aug – 2 Sep 2024 · extreme rain across Telangana', start: '2024-08-31', end: '2024-09-02' },
];
const REPLAY_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless', 'gem_seamless', 'cma_grapes_global'];
const ENSEMBLES = 'gfs025,ecmwf_ifs025,icon_seamless_eps';
const lats = POINTS.map((p) => p[0]).join(','), lons = POINTS.map((p) => p[1]).join(',');
const UA = { 'User-Agent': 'surgeforce-hackathon/0.2' };

export async function getJSON(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const asList = (d) => (Array.isArray(d) ? d : [d]);

async function musiDischarge(get, range) {
  const d = await get(`https://flood-api.open-meteo.com/v1/flood?latitude=${MUSI_POINT[0]}&longitude=${MUSI_POINT[1]}`
    + `&daily=river_discharge,river_discharge_median,river_discharge_max&${range}`);
  return { time: d.daily.time, discharge: d.daily.river_discharge, median: d.daily.river_discharge_median, max: d.daily.river_discharge_max };
}

export async function fetchReplay(ev, get = getJSON) {
  const range = `start_date=${ev.start}&end_date=${ev.end}`;
  const members = [];
  let times;
  for (const model of REPLAY_MODELS) {
    try {
      const vars = [1, 2, 3].map((d) => `precipitation_previous_day${d}`).join(',');
      const pts = asList(await get(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}`
        + `&hourly=${vars}&models=${model}&timezone=Asia%2FKolkata&${range}`));
      times = pts[0].hourly.time;
      for (const d of [1, 2, 3]) {
        const series = pts.map((p) => p.hourly[`precipitation_previous_day${d}`]);
        if (series.every((s) => s.every((v) => v == null))) continue;
        members.push({ name: `${model} · ${d} day${d > 1 ? 's' : ''} ahead`, series: series.map((s) => s.map((v) => v ?? 0)) });
      }
    } catch (e) { console.warn(`skip ${model}: ${e.message}`); }
  }
  const obs = asList(await get(`https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}`
    + `&hourly=precipitation&timezone=Asia%2FKolkata&${range}`));
  let musi = null;
  try { musi = await musiDischarge(get, range); } catch (e) { console.warn(`musi: ${e.message}`); }
  return { mode: 'replay', event: ev, times, points: POINTS, members,
    observed: obs.map((p) => p.hourly.precipitation.map((v) => v ?? 0)), musi };
}

export async function fetchLive(get = getJSON) {
  const pts = asList(await get(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lats}&longitude=${lons}`
    + `&hourly=precipitation&models=${ENSEMBLES}&forecast_days=4&timezone=Asia%2FKolkata`));
  const all = pts[0].hourly.time;
  const nowIst = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 13); // IST hour, matches API's local times
  const from = Math.max(0, all.findIndex((t) => t.slice(0, 13) >= nowIst));
  const keys = Object.keys(pts[0].hourly).filter((k) => k.startsWith('precipitation'));
  const members = keys.map((k) => ({
    name: k.replace('precipitation_', '').replace('precipitation', 'control') || k,
    series: pts.map((p) => p.hourly[k].slice(from, from + 72).map((v) => v ?? 0)),
  }));
  let musi = null;
  try { musi = await musiDischarge(get, 'forecast_days=7'); } catch (e) { console.warn(`musi: ${e.message}`); }
  return { mode: 'live', issuedAt: new Date().toISOString(), times: all.slice(from, from + 72), points: POINTS, members, musi };
}

// live data is cached 30 min in memory; the last good copy on disk keeps the demo up if the network drops
const CACHE_FILE = new URL('../data/live-cache.json', import.meta.url);
let live = null;
export async function liveForecast() {
  if (live && Date.now() - live.at < 30 * 60e3) return live.data;
  try {
    const data = await fetchLive();
    live = { at: Date.now(), data };
    writeFile(CACHE_FILE, JSON.stringify(data)).catch(() => {});
    return data;
  } catch (e) {
    const data = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
    return { ...data, stale: `live fetch failed (${e.message.slice(0, 80)}); showing forecast issued ${data.issuedAt}` };
  }
}

export async function replayForecast(id) {
  return JSON.parse(await readFile(new URL(`../data/replay/${id}.json`, import.meta.url), 'utf8'));
}
