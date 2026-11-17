// Two-stage plan (the structure of Rawls & Turnquist's pre-positioning model):
//   Stage 1, before the rain, from the city-level forecast: activate, pre-designate counterparts
//            (Japan's 2025 Nankai Trough pre-designation), stage typed teams forward in proportion to
//            terrain exposure (Singapore PUB QRT), close low-lying underpasses (Korea after Osong).
//   Stage 2, when a sector is confirmed (citizen report / field): activate its counterpart and commit
//            the staged teams. The response simulation (sim.js) measures what stage 1 buys.
import { km, nearest } from './geo.js';
import { areaOf } from './intake.js';
import { minCostFlow } from './mcf.js';
import { ASSUMPTIONS, assess, handAt, severity } from './risk.js';
import { DISTRICTS, LATTICE } from './weather.js';

// Real team counts (GHMC/HYDRAA 2025 monsoon plan: 150 METs x 12, 51 DRF x 15). Their placement by zone,
// police strength per station, volunteer pools and district reserves are synthetic: swap in duty rosters.
export const SUPPLY = {
  zones: [
    { name: 'Charminar zone', pos: [17.3616, 78.4747] }, { name: 'Khairatabad zone', pos: [17.4116, 78.4614] },
    { name: 'Secunderabad zone', pos: [17.4399, 78.4983] }, { name: 'Serilingampally zone', pos: [17.487, 78.33] },
    { name: 'Kukatpally zone', pos: [17.4849, 78.4138] }, { name: 'LB Nagar zone', pos: [17.3457, 78.5522] },
  ],
  metTeams: 150, metSize: 12, drfTeams: 51, drfSize: 15, fireCrews: 2, volunteersPerZone: 60,
  policeVacancy: 0.22, floor: 0.6, rainSlowdown: 1.5, maxPairMin: 60, shiftH: 12,
  districtPolice: 60, // deployable per neighbouring district for outside duty (synthetic)
  tssp: { name: 'TSSP reserve companies (on request)', pos: [17.438, 78.43], avail: 150, mobiliseMin: 120 },
  ndrf: { name: 'NDRF 10th Bn, Vijayawada (on request)', pos: [16.55, 80.79], teams: 4, size: 47, leadMin: 330 },
};

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const policeStrength = (name) => Math.round((12 + (hash(name) % 9)) * (1 - SUPPLY.policeVacancy));

// road minutes from any point to a sector: OSRM between nearest stations + local leg at 25 km/h, x rain slowdown
export const makeRoadMin = (base, slowdown = SUPPLY.rainSlowdown) => (pos, sectorId) => {
  const a = nearest(pos, base.stations, (s) => s.pos);
  return (base.travel[a][sectorId] + (km(pos, base.stations[a].pos) * 1.3 / 25) * 60) * slowdown;
};

// Japan-style counterpart pairing: each short sector gets one donor (more only if one is not enough).
// Donors are tried in tiers: tier 0 city station, tier 1 neighbouring district, tier 2 TSSP reserve.
// City donors keep a coverage floor; previous pairs are kept when still valid so officers know the ground.
// donors: [{ id, name, avail, dry, tier, ownNeed }], minutes(donorIdx, sectorIdx) incl. mobilisation
export function pairCounterparts(sectors, donors, minutes, { prev = new Map(), offline = new Set() } = {}) {
  const spare = donors.map((d) => (!d.dry || offline.has(d.id) ? 0
    : d.tier === 0 ? Math.max(0, d.avail - Math.max(d.ownNeed ?? 0, Math.ceil(SUPPLY.floor * d.avail))) : d.avail));
  const deficits = sectors.map((s, i) => ({ i, d: s.need.police - (offline.has(i) ? 0 : s.avail) }))
    .filter((x) => x.d > 0).sort((a, b) => (sectors[b.i].vulnerability ?? 0) - (sectors[a.i].vulnerability ?? 0) || b.d - a.d);
  const pairs = [], unmet = new Map();
  for (const { i, d } of deficits) {
    let left = d;
    while (left > 0) {
      const ok = donors.map((_, j) => j).filter((j) => spare[j] > 0 && j !== i && (donors[j].tier > 0 || minutes(j, i) <= SUPPLY.maxPairMin));
      if (!ok.length) break;
      const j = ok.includes(prev.get(i)) ? prev.get(i)
        : ok.sort((a, b) => donors[a].tier - donors[b].tier || minutes(a, i) - minutes(b, i))[0];
      const n = Math.min(left, spare[j]);
      pairs.push({ from: j, to: i, people: n, minutes: Math.round(minutes(j, i)), continuity: prev.get(i) === j, tier: donors[j].tier });
      spare[j] -= n; left -= n;
    }
    if (left > 0) unmet.set(i, left);
  }
  return { pairs, unmet };
}

// typed teams to sectors: min-cost flow where serving a sector earns a reward scaled by its exposure
export function allocate(depots, sectors, kind, minutes) {
  const S = 0, T = 1, D = 2, X = 2 + depots.length;
  const arcs = [];
  depots.forEach((d, a) => {
    arcs.push({ from: S, to: D + a, cap: d.count, cost: 0 });
    sectors.forEach((s, b) => {
      if (s.need[kind] > 0) arcs.push({ from: D + a, to: X + b, cap: 1e6, cost: minutes(d, s) + (d.extraCost ?? 0), depot: a, sector: b });
    });
  });
  sectors.forEach((s, b) => {
    const reward = s.confirmed ? 3 : 0.5 + (s.hitP ?? 0) + (s.vulnerability ?? 0) / 10;
    if (s.need[kind] > 0) arcs.push({ from: X + b, to: T, cap: s.need[kind], cost: -1000 * reward });
  });
  const { flows } = minCostFlow(X + sectors.length, arcs, S, T);
  const moves = flows.filter((f) => f.depot != null)
    .map((f) => ({ kind, depot: f.depot, sector: f.sector, teams: f.flow, minutes: Math.round(minutes(depots[f.depot], sectors[f.sector])) }));
  const got = new Map();
  moves.forEach((m) => got.set(m.sector, (got.get(m.sector) ?? 0) + m.teams));
  const unmet = sectors.map((s, b) => Math.max(0, s.need[kind] - (got.get(b) ?? 0)));
  return { moves, unmet, got };
}

const addMin = (t0, min) => new Date(Date.parse(`${t0}:00Z`) + min * 60e3).toISOString().slice(0, 16);
const stageOf = (lead) => (lead >= 24 * 60 ? 'Watch' : lead >= 6 * 60 ? 'Prepare' : 'Act');
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function buildDepots(base, noShow = 0) {
  const zoneDepots = (per) => SUPPLY.zones.map((z, i) => ({ ...z, count: Math.floor(per / 6) + (i < per % 6 ? 1 : 0) }));
  return {
    met: zoneDepots(SUPPLY.metTeams),
    drf: [...zoneDepots(SUPPLY.drfTeams), { ...SUPPLY.ndrf, count: SUPPLY.ndrf.teams, extraCost: 300, request: true }],
    fire: base.fire.map((f) => ({ name: f.name, pos: f.pos, count: SUPPLY.fireCrews })),
    volunteers: SUPPLY.zones.map((z) => ({ name: `${z.name} volunteer hub`, pos: z.pos, count: Math.floor(SUPPLY.volunteersPerZone * (1 - noShow)) })),
  };
}

export function plan(base, hand, forecast, opts = {}) {
  const { costLoss = ASSUMPTIONS.costLoss, confirmed = new Set(), offline = new Set(), noShow = 0, prev = new Map() } = opts;
  const { city, sectors } = assess(base, hand, forecast, { costLoss, confirmed });
  const avail = base.stations.map((s) => policeStrength(s.name));
  sectors.forEach((s) => { s.avail = offline.has(s.id) ? 0 : avail[s.id]; });
  const t0 = forecast.times[0];
  const roadMin = makeRoadMin(base);
  const depots = buildDepots(base, noShow);
  const minutes = (d, s) => (d.leadMin ?? roadMin(d.pos, s.id));

  // ---- counterparts: pre-designated for every exposed sector, activated for confirmed ones ----
  const vulns = sectors.map((s) => s.vulnerability).sort((a, b) => a - b);
  const medianVuln = vulns[Math.floor(vulns.length / 2)];
  const dryAt = (pt) => forecast.members.filter((m) => Math.max(...severity(m.series[pt])) >= 1).length / forecast.members.length < costLoss - 1e-9;
  const donors = [
    ...sectors.map((s) => ({ id: s.id, name: s.name, pos: s.pos, avail: s.avail, ownNeed: s.need.police,
      dry: !s.confirmed && s.vulnerability <= medianVuln, tier: 0 })),
    ...DISTRICTS.map((d, k) => ({ id: `d${k}`, name: d.name, pos: d.pos, avail: Math.round(SUPPLY.districtPolice * (1 - SUPPLY.policeVacancy)),
      dry: forecast.points.length > LATTICE.length + k && dryAt(LATTICE.length + k), tier: 1, mobiliseMin: 60 })),
    { id: 'tssp', ...SUPPLY.tssp, dry: true, tier: 2 },
  ];
  const pairMin = (j, i) => {
    const d = donors[j];
    return d.tier === 0 ? base.travel[j][i] * SUPPLY.rainSlowdown : d.mobiliseMin + (km(d.pos, sectors[i].pos) * 1.35 / 40) * 60 * SUPPLY.rainSlowdown;
  };
  // a donor may be designated beyond what it can serve at once: only ~38% of exposed sectors are hit on a heavy day
  const overbook = donors.map((d) => ({ ...d, avail: Math.floor(d.avail / ASSUMPTIONS.hitShare) }));
  const exposedNeed = sectors.map((s) => ({ ...s, need: { police: city.onset == null && !s.confirmed ? 0 : s.needIfHit.police } }));
  const designated = pairCounterparts(exposedNeed, overbook, pairMin, { prev, offline });
  const activeNeed = sectors.map((s) => ({ ...s, need: { police: s.confirmed ? s.needIfHit.police : 0 } }));
  const active = pairCounterparts(activeNeed, donors, pairMin, { prev: new Map(designated.pairs.map((p) => [p.to, p.from])), offline });

  // ---- stage 1: stage typed teams to the exposure-weighted expected need (min-cost flow) ----
  const teams = Object.fromEntries(Object.entries(depots).map(([k, ds]) => [k, allocate(ds, sectors, k, minutes)]));

  // ---- timeline ----
  const actions = [];
  const push = (a) => {
    const at = Math.max(0, a.atMin);
    actions.push({ ...a, atMin: at, at: addMin(t0, at), onsetAt: a.onsetMin == null ? null : addMin(t0, a.onsetMin),
      late: a.atMin < 0 ? -Math.round(a.atMin) : 0, stage: a.onsetMin == null ? 'Prepare' : stageOf(a.onsetMin - at) });
  };
  const onsetMin = (s) => (s.onset ?? 0) * 60;
  const cityOn = city.onset != null ? city.onset * 60 : null;
  if (cityOn != null) {
    push({ id: 'standby', kind: 'standby', atMin: 0, onsetMin: cityOn,
      title: `Activate EOC: ${Math.round(city.p1 * 100)}% of forecasts bring flood-level rain (threshold ${Math.round(costLoss * 100)}%)`,
      detail: `Cancel leave city-wide; notify ${designated.pairs.length} pre-designated counterparts; first onset ${addMin(t0, cityOn)}. `
        + 'Where in the city is not forecastable (backtest), so teams stage by terrain exposure.' });
  }
  for (const p of active.pairs) {
    const s = sectors[p.to];
    push({ id: `pair-${p.from}-${p.to}`, kind: 'counterpart', sector: p.to, from: p.from, people: p.people, tier: p.tier,
      atMin: 0, onsetMin: 0, short: `${p.people} officers from ${donors[p.from].name} (${p.minutes} min)`,
      title: `${donors[p.from].name} → ${s.name}: ${p.people} officers`,
      detail: `Counterpart activated: flooding confirmed. ${p.minutes} min in rain.` });
  }
  const label = { met: 'Monsoon Emergency Team', drf: 'DRF rescue team', fire: 'swift-water crew', volunteers: 'trained volunteers' };
  for (const [kind, { moves }] of Object.entries(teams)) {
    for (const m of moves) {
      const d = depots[kind][m.depot], s = sectors[m.sector];
      const unit = kind === 'volunteers' ? `${m.teams} ${label[kind]}` : `${m.teams} × ${label[kind]}`;
      push({ id: `${kind}-${m.depot}-${m.sector}`, kind, sector: m.sector, teams: m.teams, request: !!d.request,
        atMin: onsetMin(s) - m.minutes - 60, onsetMin: onsetMin(s),
        short: `${d.request ? 'REQUEST ' : ''}${s.confirmed ? 'Commit' : 'Stage'} ${unit} from ${d.name} (${m.minutes} min)`,
        title: `${d.request ? 'REQUEST ' : ''}${unit} → ${s.name}`, detail: `From ${d.name}; ${m.minutes} min.` });
    }
  }
  const underpassHand = base.underpasses.map((u) => handAt(hand, u.pos));
  for (const u of base.underpasses) {
    const s = sectors[u.sector], low = underpassHand[u.id] <= ASSUMPTIONS.stageM[2];
    if (s.onset == null || !(low || s.confirmed || city.p2 >= costLoss)) continue;
    push({ id: `close-${u.id}`, kind: 'underpass', sector: u.sector, pos: u.pos, atMin: onsetMin(s) - 30, onsetMin: onsetMin(s),
      short: `Close ${u.name}${low ? ' (low ground)' : ''}`, title: `Close ${u.name} (${s.name})`,
      detail: 'Barricade both ends, 2 officers until all-clear. Underpasses kill: Osong 2023, Balkampet RUB.' });
  }
  if (cityOn != null) {
    const top = [...sectors].sort((a, b) => b.vulnerability - a.vulnerability).slice(0, 12);
    push({ id: 'cap-city', kind: 'alert', sectors: top.map((s) => s.id), atMin: cityOn - 360, onsetMin: cityOn,
      title: 'SACHET CAP alert: city-wide, naming the 12 most exposed areas (en, te, hi, ur)',
      detail: [...new Set(top.map((s) => areaOf(s.name)))].join(', ') });
    if (city.end - city.onset + 1 > SUPPLY.shiftH) {
      push({ id: 'relief', kind: 'relief', atMin: cityOn + SUPPLY.shiftH * 60, onsetMin: null,
        title: 'Relief wave: rotate all deployed staff', detail: `Event spans ${city.end - city.onset + 1} h; nobody works past 12 h (TEC-FORCE rotation).` });
    }
  }
  const conf = sectors.filter((s) => s.confirmed);
  if (conf.length) {
    push({ id: 'cap-confirmed', kind: 'alert', sectors: conf.map((s) => s.id), atMin: 0, onsetMin: 0,
      title: `SACHET CAP alert: flooding confirmed in ${conf.length} area${conf.length > 1 ? 's' : ''}`, detail: conf.map((s) => areaOf(s.name)).join(', ') });
  }
  if (forecast.musi) {
    const th = base.musiThresholds;
    forecast.musi.time.forEach((d, i) => {
      const qd = forecast.musi.discharge[i], offset = (Date.parse(`${d}T00:00Z`) - Date.parse(`${t0}:00Z`)) / 60e3;
      if (qd >= th.p99 && offset >= -24 * 60) {
        push({ id: `musi-${d}`, kind: 'musi', atMin: offset - 180, onsetMin: offset,
          title: `Musi at ${Math.round(qd)} m³/s on ${d}: evacuate river-bank cells`,
          detail: `GloFAS vs 1990-2023 99th percentile ${Math.round(th.p99)} m³/s. Coordinate Himayat/Osman Sagar releases with HMWSSB.` });
      }
    });
  }
  actions.sort((a, b) => a.atMin - b.atMin || a.kind.localeCompare(b.kind));

  // ---- stage 2 playbook: what each sector gets the moment it is confirmed ----
  const playbook = sectors.map((s) => ({ id: s.id, ifHit: s.needIfHit,
    stagedHere: Object.fromEntries(Object.keys(depots).map((k) => [k, teams[k].got.get(s.id) ?? 0])),
    counterpart: designated.pairs.filter((p) => p.to === s.id).map((p) => ({ donor: donors[p.from].name, people: p.people, minutes: p.minutes, tier: p.tier })) }));

  let verification = null;
  if (forecast.observed) {
    verification = { days: city.outlook.map((o) => {
      const obs = Math.max(...forecast.observed.slice(0, LATTICE.length).map((s) => forecast.times.reduce((a, t, h) => a + (t.startsWith(o.day) ? s[h] : 0), 0)));
      return { day: o.day, p: o.p, observedMaxMm: +obs.toFixed(0), event: obs >= ASSUMPTIONS.cityEventMm };
    }) };
  }
  const metrics = {
    members: forecast.members.length, cityP: city.p1, cityP2: city.p2, exposed: sectors.filter((s) => s.onset != null).length, confirmed: conf.length,
    designated: designated.pairs.length, activePairs: active.pairs.length, policeShort: sum([...active.unmet.values()]),
    ...Object.fromEntries(Object.entries(teams).map(([k, t]) => [k, { need: sum(sectors.map((s) => s.need[k])), sent: sum(t.moves.map((m) => m.teams)), unmet: sum(t.unmet) }])),
    underpassesClosed: actions.filter((a) => a.kind === 'underpass').length,
    lateActions: actions.filter((a) => a.late).length,
  };
  return { t0, city, sectors, avail, donors, designated: designated.pairs, pairs: active.pairs, policeUnmet: [...active.unmet],
    teams, depots, actions, metrics, verification, playbook, underpassHand };
}
