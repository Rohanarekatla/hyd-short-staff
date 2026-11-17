// Backtest: how good were the forecasts SurgeForce uses, over two full monsoons (Jun-Oct 2024 and 2025)?
// For every day and city point: what 6 global models forecast 1-3 days ahead (18 members) vs ERA5.
// Fits the calibration with leave-one-season-out validation and writes data/calibration.json.
// Run: npm run backtest   (needs internet, ~1 minute)
import { writeFile } from 'node:fs/promises';
import { brier, economicValue, features, fitLogistic, predict, reliability, rocArea } from '../lib/calibrate.js';
import { getJSON, LATTICE } from '../lib/weather.js';

const SEASONS = [2024, 2025];
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless', 'gem_seamless', 'cma_grapes_global'];
const THRESHOLDS = [30, 64.5]; // mm/day: drains overwhelmed for hours; IMD "heavy rain"
const lats = LATTICE.map((p) => p[0]).join(','), lons = LATTICE.map((p) => p[1]).join(',');
const list = (d) => (Array.isArray(d) ? d : [d]);

function daily(times, values) { // hourly IST -> daily totals; null if any hour missing
  const out = new Map();
  times.forEach((t, i) => {
    const d = t.slice(0, 10), v = values[i];
    const cur = out.get(d) ?? { s: 0, ok: true, n: 0 };
    if (v == null) cur.ok = false; else cur.s += v;
    cur.n++;
    out.set(d, cur);
  });
  return new Map([...out].map(([d, c]) => [d, c.ok && c.n === 24 ? +c.s.toFixed(1) : null]));
}

const samples = []; // { season, day, point, members: [18 totals], obs }
for (const year of SEASONS) {
  const range = `start_date=${year}-06-01&end_date=${year}-10-31&timezone=Asia%2FKolkata`;
  console.log(`season ${year}: ERA5`);
  const obs = list(await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&hourly=precipitation&${range}`))
    .map((p) => daily(p.hourly.time, p.hourly.precipitation));
  const members = []; // [member][point] Map(day -> total)
  for (const model of MODELS) {
    console.log(`season ${year}: ${model}`);
    const vars = [1, 2, 3].map((d) => `precipitation_previous_day${d}`).join(',');
    const pts = list(await getJSON(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${vars}&models=${model}&${range}`));
    for (const d of [1, 2, 3]) members.push(pts.map((p) => daily(p.hourly.time, p.hourly[`precipitation_previous_day${d}`])));
  }
  for (const day of obs[0].keys()) {
    LATTICE.forEach((_, pt) => {
      const o = obs[pt].get(day), m = members.map((mm) => mm[pt].get(day));
      if (o != null && m.filter((v) => v != null).length >= 9) samples.push({ season: year, day, point: pt, members: m, obs: o });
    });
  }
}
console.log(`${samples.length} day-point samples`);
await writeFile(new URL('../data/backtest-samples.json', import.meta.url), JSON.stringify(samples));

// Two framings. "point": will heavy rain hit this 25 km point? (the WHERE question)
// "city": will heavy rain hit anywhere in Hyderabad today? (the WHETHER question). Same forecasts.
const byDay = new Map();
samples.forEach((s) => { const k = `${s.season}|${s.day}`; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(s); });
const citySamples = [...byDay.values()].filter((d) => d.length === LATTICE.length).map((d) => ({
  season: d[0].season, day: d[0].day, obs: Math.max(...d.map((s) => s.obs)), hitShare: (T) => d.filter((s) => s.obs >= T).length / d.length,
  members: d[0].members.map((_, m) => (d.every((s) => s.members[m] != null) ? Math.max(...d.map((s) => s.members[m])) : null)),
}));

function evaluate(rows, T) {
  const X = rows.map((s) => features(s.members, T)), y = rows.map((s) => (s.obs >= T ? 1 : 0));
  const folds = SEASONS.map((test) => {
    const tr = rows.map((_, i) => i).filter((i) => rows[i].season !== test), te = rows.map((_, i) => i).filter((i) => rows[i].season === test);
    const w = fitLogistic(tr.map((i) => X[i]), tr.map((i) => y[i]), 2);
    const base = tr.reduce((a, i) => a + y[i], 0) / tr.length;
    const yt = te.map((i) => y[i]);
    return { test, n: yt.length, events: yt.filter(Boolean).length, yt, raw: te.map((i) => X[i][1]), cal: te.map((i) => predict(w, X[i])), clim: yt.map(() => base) };
  });
  const pool = (k) => folds.flatMap((f) => f[k]);
  const raw = pool('raw'), cal = pool('cal'), yt = pool('yt'), clim = pool('clim');
  const bClim = brier(clim, yt);
  return {
    n: yt.length, events: yt.filter(Boolean).length, eventRate: +(y.reduce((a, b) => a + b, 0) / y.length).toFixed(4),
    folds: folds.map((f) => ({ test: f.test, n: f.n, events: f.events })),
    brierClim: +bClim.toFixed(5), brierRaw: +brier(raw, yt).toFixed(5), brierCal: +brier(cal, yt).toFixed(5),
    brierSkillRaw: +(1 - brier(raw, yt) / bClim).toFixed(3), brierSkillCal: +(1 - brier(cal, yt) / bClim).toFixed(3),
    rocRaw: +rocArea(raw, yt).toFixed(3), rocCal: +rocArea(cal, yt).toFixed(3),
    reliabilityRaw: reliability(raw, yt, 5), reliabilityCal: reliability(cal, yt, 5),
    value: Array.from({ length: 19 }, (_, i) => +(0.05 * (i + 1)).toFixed(2))
      .map((a) => ({ costLoss: a, raw: +economicValue(raw, yt, a).toFixed(3), calibrated: +economicValue(cal, yt, a).toFixed(3) })),
    weights: fitLogistic(X, y, 2).map((v) => +v.toFixed(5)), // production fit on both seasons
  };
}

const result = { built: new Date().toISOString(), seasons: SEASONS, models: MODELS, point: {}, city: {} };
for (const T of THRESHOLDS) {
  result.point[T] = evaluate(samples, T);
  result.city[T] = evaluate(citySamples, T);
  const ev = citySamples.filter((d) => d.obs >= T);
  result.city[T].shareOfCityHitOnEventDays = ev.length ? +(ev.reduce((a, d) => a + d.hitShare(T), 0) / ev.length).toFixed(3) : null;
  for (const k of ['point', 'city']) {
    const r = result[k][T];
    console.log(`${k.padEnd(5)} >= ${T} mm/day: ${r.events}/${r.n} events; Brier skill raw ${r.brierSkillRaw} -> cal ${r.brierSkillCal}; ROC ${r.rocRaw} -> ${r.rocCal}`);
  }
  console.log(`  on city event days, share of city points that got >= ${T}: ${result.city[T].shareOfCityHitOnEventDays}`);
}
await writeFile(new URL('../data/calibration.json', import.meta.url), JSON.stringify(result));
console.log('wrote data/calibration.json');
