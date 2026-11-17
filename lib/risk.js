// WHEN comes from the forecast, WHERE comes from terrain and ground truth.
// Our backtest over the 2024 and 2025 monsoons (scripts/backtest.js) showed that 1-3 day global forecasts
// are skilful and reliable for "heavy rain somewhere in Hyderabad today" (ROC 0.81, Brier skill 0.19),
// but have no decision value for "heavy rain at this 25 km point" (ROC 0.71, negative economic value
// at most cost/loss ratios). So: the city-level ensemble sets the timing and severity of each future,
// and a sector's exposure comes from HAND terrain (where water collects) plus confirmed reports.
import { quantile } from './geo.js';

export const ASSUMPTIONS = {
  // severity triggers [1 h mm, 3 h mm, 24 h mm] at the worst city point. 24 h values are IMD's heavy /
  // very heavy / extremely heavy categories; 1 h values bracket GHMC's stated drain capacity of 12-20 mm/h.
  triggers: [[12, 30, 64.5], [20, 50, 115.6], [40, 80, 204.5]],
  stageM: [0, 1, 2.5, 4],   // HAND inundation stage (m above nearest drain) at severity 0..3
  musiKm: 0.6,              // within 600 m of the Musi = riverine
  hitShare: 0.38,           // on city heavy-rain days, 38% of city points got >= 30 mm (backtest)
  costLoss: 0.1,            // a wasted deployment costs 1/10 of a missed flood: act when P >= 0.1
  cityEventMm: 30,          // the event the backtest verified
};
export const RESOURCES = ['police', 'met', 'drf', 'fire', 'volunteers'];

// planning rates; editable and meant to be calibrated on GHMC 1070 complaint logs.
// f.flooded[s] = km2 of the sector under water at severity s (HAND <= stage)
export function needAt(f, s, musiLevel = 0) {
  const fl = s ? f.flooded[s] : 0, river = f.riverine ? Math.ceil(f.riverine * 0.25 * musiLevel) : 0;
  return {
    police: s ? 2 * f.underpasses + Math.ceil(fl * 1.5 + f.cells * 0.2 * s) : 0,   // closures, diversions, cordons
    met: s ? Math.ceil(fl * 0.6 + f.cells * 0.03 * s) : 0,                          // GHMC Monsoon Emergency Teams
    drf: (s >= 2 ? Math.ceil(fl * 0.25) : 0) + river,                               // HYDRAA DRF rescue teams
    fire: s === 3 ? 1 + (f.underpasses ? 1 : 0) : 0,                                // swift-water crews
    volunteers: f.riverine && (s >= 2 || musiLevel >= 2) ? 15 * Math.ceil(f.riverine / 4) : (s === 3 && fl >= 1 ? 10 : 0),
  };
}

export function severity(series, triggers = ASSUMPTIONS.triggers) {
  const pre = [0];
  series.forEach((v, i) => pre.push(pre[i] + v));
  return series.map((v, i) => {
    const r3 = pre[i + 1] - pre[Math.max(0, i - 2)], r24 = pre[i + 1] - pre[Math.max(0, i - 23)];
    let s = 0;
    triggers.forEach(([h1, h3, h24], k) => { if (v >= h1 || r3 >= h3 || r24 >= h24) s = k + 1; });
    return s;
  });
}

// worst city point each hour: the storm a member says Hyderabad gets, wherever it lands
export const cityMax = (series, nCity) => series[0].map((_, h) => Math.max(...series.slice(0, nCity).map((s) => s[h])));

// HAND (m) of the 250 m cell nearest to a point
export const handAt = (hand, pos) => hand.cells.reduce((b, c) => {
  const d = (c[0] - pos[0]) ** 2 + (c[1] - pos[1]) ** 2;
  return d < b.d ? { d, h: c[3] } : b;
}, { d: Infinity, h: 99 }).h;

export function sectorFeatures(base, hand) {
  const handCells = hand.cells.map(([lat, lon, elev, h, sector, drain]) => ({ lat, lon, h, sector, drain }));
  const km2 = hand.cellKm ** 2;
  return base.stations.map((st, i) => {
    const mine = handCells.filter((c) => c.sector === i);
    const ups = base.underpasses.filter((u) => u.sector === i);
    return {
      id: i, name: st.name, pos: st.pos,
      cells: base.cells.filter((c) => c.sector === i).length,                       // km2 served
      flooded: ASSUMPTIONS.stageM.map((m) => +(mine.filter((c) => c.h <= m).length * km2).toFixed(2)),
      riverine: base.cells.filter((c) => c.sector === i && c.musiKm <= ASSUMPTIONS.musiKm).length,
      underpasses: ups.length,
      lowUnderpasses: ups.filter((u) => handAt(hand, u.pos) <= ASSUMPTIONS.stageM[2]).length,
    };
  });
}

export function musiLevels(forecast, thresholds) {
  const byDay = new Map((forecast.musi?.time ?? []).map((d, i) => [d, forecast.musi.discharge[i] ?? 0]));
  return forecast.times.map((t) => {
    const q = byDay.get(t.slice(0, 10)) ?? 0;
    return q >= thresholds.p99 ? 2 : q >= thresholds.p95 ? 1 : 0;
  });
}

// city outlook per calendar day: share of members giving >= 30 mm at the worst city point (backtested event)
export function cityOutlook(forecast, nCity, mm = ASSUMPTIONS.cityEventMm) {
  const days = [...new Set(forecast.times.map((t) => t.slice(0, 10)))];
  return days.map((d) => {
    const hrs = forecast.times.map((t, h) => (t.startsWith(d) ? h : -1)).filter((h) => h >= 0);
    const totals = forecast.members.map((m) => Math.max(...m.series.slice(0, nCity).map((s) => hrs.reduce((a, h) => a + s[h], 0))));
    return { day: d, hours: hrs.length, p: +(totals.filter((v) => v >= mm).length / totals.length).toFixed(3),
      p50: +quantile(totals, 0.5).toFixed(0), p90: +quantile(totals, 0.9).toFixed(0) };
  });
}

export function assess(base, hand, forecast, { costLoss = ASSUMPTIONS.costLoss, confirmed = new Set(), nCity = 9 } = {}) {
  const q = 1 - costLoss; // acting when P >= C/L is the same as planning for the (1 - C/L) quantile
  const feats = sectorFeatures(base, hand);
  const musi = musiLevels(forecast, base.musiThresholds);
  const M = forecast.members.length, H = forecast.times.length;
  const sev = forecast.members.map((m) => severity(cityMax(m.series, nCity)));
  const frac = (k) => sev.filter((r) => Math.max(...r) >= k).length / M;
  const byHour = Array.from({ length: H }, (_, h) => sev.filter((r) => r[h] >= 1).length / M);
  const hot = byHour.map((p, h) => (p >= costLoss - 1e-9 ? h : -1)).filter((h) => h >= 0);
  const city = {
    p1: frac(1), p2: frac(2), p3: frac(3), q, costLoss,
    onset: hot.length ? hot[0] : null, end: hot.length ? hot.at(-1) : null, byHour,
    outlook: cityOutlook(forecast, nCity),
  };
  const sectors = feats.map((f) => {
    const isConf = confirmed.has(f.id);
    const peaks = sev.map((r) => RESOURCES.reduce((o, k) => {
      o[k] = Math.max(0, ...r.map((s, h) => needAt(f, isConf ? Math.max(s, 2) : s, f.riverine ? musi[h] : 0)[k]));
      return o;
    }, {}));
    const needIfHit = Object.fromEntries(RESOURCES.map((k) => [k, Math.ceil(quantile(peaks.map((p) => p[k]), q))]));
    // river-bank need comes from GloFAS discharge, which is not a "maybe it lands here" rain event
    const musiNeed = f.riverine && musi.some((m) => m >= 2);
    const hitP = isConf ? 1 : city.p1 * ASSUMPTIONS.hitShare;
    const expected = Object.fromEntries(RESOURCES.map((k) => [k,
      isConf || (musiNeed && (k === 'drf' || k === 'volunteers')) ? needIfHit[k] : Math.ceil(needIfHit[k] * ASSUMPTIONS.hitShare)]));
    return { ...f, confirmed: isConf, hitP, needIfHit, need: expected, musiNeed,
      onset: isConf ? 0 : city.onset, end: city.end, vulnerability: f.flooded[2] + f.lowUnderpasses + f.riverine * 0.5 };
  });
  return { city, sectors, musi };
}
