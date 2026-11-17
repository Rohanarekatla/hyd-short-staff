// Monte Carlo + discrete-event simulation of the response, to measure what stage-1 staging buys.
// Each run: pick a forecast member (how bad and when), pick which sectors the storm actually hits
// (38% each, the backtested share), generate incidents from flooded terrain, then dispatch the nearest
// free team under two policies. Reactive = teams wait at zone depots; SurgeForce = teams staged per plan.
import { quantile } from './geo.js';
import { ASSUMPTIONS, cityMax, severity } from './risk.js';
import { makeRoadMin } from './planner.js';

function rng(seed) { // mulberry32: reproducible runs
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const poisson = (lambda, rand) => { let k = 0, p = Math.exp(-lambda), s = p; const u = rand(); while (u > s && k < 200) { k++; p *= lambda / k; s += p; } return k; };

const SERVICE_MIN = { met: 120, drf: 180 };
// incidents per km2 flooded (MET: waterlogging/pumping) and rescues (DRF) at severity >= 2; synthetic rates
const RATE = { met: 3, drf: 0.8 };

// Pregnolato et al. (2017, Transp. Res. D 55:67-81) depth-disruption function: max vehicle speed (km/h)
// vs standing water w (mm), 0 < w < 300; at 300 mm the road is impassable (air intake floods).
// Coefficients as quoted in follow-up literature; check against the paper's Eq. before publication.
export const speedAtDepth = (w) => (w >= 300 ? 0 : Math.max(0, 0.0009 * w * w - 0.5529 * w + 86.9448));
const ROAD_DEPTH_MM = [0, 50, 150, 250]; // typical water on flooded road links at severity 0..3 (assumption)
const FLOODED_SHARE = 0.3;               // share of a route that runs through flooded links (assumption)
export const travelFactor = (s) => {
  const v = speedAtDepth(ROAD_DEPTH_MM[s]);
  return (1 - FLOODED_SHARE) + FLOODED_SHARE * (v > 0 ? speedAtDepth(0) / v : 20);
};

export function simulate(base, forecast, p, { runs = 200, seed = 7, nCity = 9 } = {}) {
  const roadMin = makeRoadMin(base, 1);
  const rand = rng(seed);
  const unitsFor = (kind, staged) => {
    const units = [];
    p.depots[kind].forEach((d, di) => { if (!d.request) for (let i = 0; i < d.count; i++) units.push({ pos: d.pos, sector: null, depot: di }); });
    if (staged) { // move staged teams from their depot to the staging sector
      for (const m of p.teams[kind].moves) {
        if (p.depots[kind][m.depot].request) continue;
        for (let i = 0; i < m.teams; i++) {
          const u = units.find((x) => x.depot === m.depot && x.sector == null);
          if (u) { u.sector = m.sector; u.pos = p.sectors[m.sector].pos; }
        }
      }
    }
    return units;
  };
  const travel = (u, sector, s) => (u.sector === sector ? 5 : roadMin(u.pos, sector)) * travelFactor(s); // 5 min within the sector
  const out = { reactive: { met: [], drf: [] }, surgeforce: { met: [], drf: [] } };
  let events = 0;
  for (let r = 0; r < runs; r++) {
    const m = forecast.members[r % forecast.members.length];
    const sev = severity(cityMax(m.series, nCity)), hot = sev.map((s, h) => (s ? h : -1)).filter((h) => h >= 0);
    if (!hot.length) continue;
    events++;
    const peak = Math.max(...sev);
    const incidents = [];
    for (const s of p.sectors) {
      if (!s.confirmed && rand() > ASSUMPTIONS.hitShare) continue;
      for (const kind of ['met', 'drf']) {
        if (kind === 'drf' && peak < 2) continue;
        const n = poisson(s.flooded[peak] * RATE[kind] + (kind === 'met' ? s.lowUnderpasses * 0.5 : 0), rand);
        for (let i = 0; i < n; i++) {
          const h = hot[Math.floor(rand() * hot.length)];
          incidents.push({ kind, sector: s.id, t: h * 60 + rand() * 60, sev: sev[h] });
        }
      }
    }
    incidents.sort((a, b) => a.t - b.t);
    for (const [policy, staged] of [['reactive', false], ['surgeforce', true]]) {
      const fleets = { met: unitsFor('met', staged).map((u) => ({ ...u, free: 0 })), drf: unitsFor('drf', staged).map((u) => ({ ...u, free: 0 })) };
      for (const inc of incidents) {
        let best = null, bestT = Infinity;
        for (const u of fleets[inc.kind]) {
          const t = Math.max(0, u.free - inc.t) + travel(u, inc.sector, inc.sev);
          if (t < bestT) { bestT = t; best = u; }
        }
        if (!best) continue;
        out[policy][inc.kind].push(bestT);
        best.free = inc.t + bestT + SERVICE_MIN[inc.kind];
        best.sector = inc.sector; best.pos = p.sectors[inc.sector].pos;
      }
    }
  }
  const summary = (xs) => (xs.length ? { n: xs.length, median: Math.round(quantile(xs, 0.5)), p90: Math.round(quantile(xs, 0.9)),
    within30: +(xs.filter((x) => x <= 30).length / xs.length).toFixed(3) } : { n: 0 });
  const res = { runs, eventRuns: events, travelFactor: [1, 2, 3].map((s) => +travelFactor(s).toFixed(2)) };
  for (const policy of ['reactive', 'surgeforce']) res[policy] = { met: summary(out[policy].met), drf: summary(out[policy].drf) };
  return res;
}
