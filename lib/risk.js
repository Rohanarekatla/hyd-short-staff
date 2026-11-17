// Turns an ensemble of rain forecasts into, per police-station sector: probability of each severity,
// onset and duration, and the staff needed at a chosen planning quantile (P80 = plan for 4 in 5 futures).
import { nearest, quantile } from './geo.js';

export const ASSUMPTIONS = {
  // severity triggers [1 h mm, 3 h mm, 24 h mm]. 24 h values are IMD's heavy / very heavy / extremely heavy
  // categories; 1 h values bracket GHMC's stated storm-drain capacity of 12-20 mm/h.
  triggers: [[12, 30, 64.5], [20, 50, 115.6], [40, 80, 204.5]],
  depLowM: -8,      // a cell 8 m or more below its 2 km neighbourhood collects water (lowest ~15% of the city)
  musiKm: 0.6,      // cells within 600 m of the Musi are riverine
  planQuantile: 0.8,
  // a sector is expected to flood once (1 - planQuantile) of forecasts agree: planning at P80 means
  // acting on anything at least 1 in 5 forecasts shows, which is what makes this probabilistic, not average-case
};

// planning rates per unit of exposure; editable, and meant to be calibrated on GHMC complaint logs
export function needAt(f, s, musiLevel) {
  const river = f.riverine ? Math.ceil(f.riverine * 0.25 * musiLevel) : 0;
  return {
    police: s ? 2 * f.underpasses + Math.ceil((f.low * 0.75 + f.cells * 0.25) * s) : 0, // closures, diversions, cordons
    met: s ? Math.ceil(f.low * 0.15 * s + f.cells * 0.03 * s) : 0,                     // GHMC Monsoon Emergency Teams
    drf: (s >= 2 ? Math.ceil(f.low * 0.08 * (s - 1)) : 0) + river,                     // HYDRAA DRF rescue teams
    fire: s === 3 ? 1 + (f.underpasses ? 1 : 0) : 0,                                   // swift-water crews
    volunteers: f.riverine && (s >= 2 || musiLevel >= 2) ? 15 * Math.ceil(f.riverine / 4) : (s === 3 && f.low >= 2 ? 10 : 0),
  };
}
export const RESOURCES = ['police', 'met', 'drf', 'fire', 'volunteers'];

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

export function sectorFeatures(base) {
  return base.stations.map((st, i) => {
    const cells = base.cells.filter((c) => c.sector === i);
    return {
      id: i, name: st.name, pos: st.pos, cells: cells.length,
      low: cells.filter((c) => c.dep <= ASSUMPTIONS.depLowM).length,
      riverine: cells.filter((c) => c.musiKm <= ASSUMPTIONS.musiKm).length,
      underpasses: base.underpasses.filter((u) => u.sector === i).length,
      point: nearest(st.pos, base.points ?? []),
    };
  });
}

// musi level per hour: 0 normal, 1 above the 1990-2023 95th percentile, 2 above the 99th
export function musiLevels(forecast, thresholds) {
  const byDay = new Map((forecast.musi?.time ?? []).map((d, i) => [d, forecast.musi.discharge[i] ?? 0]));
  return forecast.times.map((t) => {
    const q = byDay.get(t.slice(0, 10)) ?? 0;
    return q >= thresholds.p99 ? 2 : q >= thresholds.p95 ? 1 : 0;
  });
}

export function assess(base, forecast, { q = ASSUMPTIONS.planQuantile, confirmed = new Set() } = {}) {
  const feats = sectorFeatures({ ...base, points: forecast.points });
  const musi = musiLevels(forecast, base.musiThresholds);
  const H = forecast.times.length, M = forecast.members.length;
  const sev = forecast.members.map((m) => m.series.map((s) => severity(s)));  // [member][point][hour]
  return feats.map((f) => {
    const runs = sev.map((pts) => (confirmed.has(f.id) ? pts[f.point].map((s) => Math.max(s, 2)) : pts[f.point]));
    const frac = (k) => runs.filter((r) => Math.max(...r) >= k).length / M;
    const byHour = Array.from({ length: H }, (_, h) => runs.filter((r) => r[h] >= 1).length / M);
    const hot = byHour.map((p, h) => (p >= 1 - q - 1e-9 || (musi[h] >= 2 && f.riverine) ? h : -1)).filter((h) => h >= 0);
    const peaks = runs.map((r) => RESOURCES.reduce((o, k) => {
      o[k] = Math.max(0, ...r.map((s, h) => needAt(f, s, f.riverine ? musi[h] : 0)[k]));
      return o;
    }, {}));
    const need = Object.fromEntries(RESOURCES.map((k) => [k, Math.ceil(quantile(peaks.map((p) => p[k]), q))]));
    if (!hot.length && RESOURCES.some((k) => need[k])) hot.push(byHour.indexOf(Math.max(...byHour))); // need without a clear hour: use the likeliest
    const rain24 = forecast.members.map((m) => Math.max(...m.series[f.point].map((_, h, s) =>
      s.slice(Math.max(0, h - 23), h + 1).reduce((a, b) => a + b, 0))));
    return {
      ...f, need, p1: frac(1), p2: frac(2), p3: frac(3), confirmed: confirmed.has(f.id),
      onset: hot.length ? hot[0] : null, end: hot.length ? hot.at(-1) : null,
      peakRain24: { p50: +quantile(rain24, 0.5).toFixed(0), p90: +quantile(rain24, 0.9).toFixed(0) },
    };
  });
}
