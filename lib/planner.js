// From risk to a signed-off plan: counterpart pairing for police (Japan's taiko shien), pre-positioning of
// typed teams by min-cost flow (Singapore PUB / US EMAC mission-ready packages), underpass closures
// (Korea after Osong), and a staged timeline of who moves where and when (Japan's timeline bousai).
import { km, nearest } from './geo.js';
import { minCostFlow } from './mcf.js';
import { ASSUMPTIONS, assess, severity } from './risk.js';
import { DISTRICTS, LATTICE } from './weather.js';
import { areaOf } from './intake.js';

// Real team counts (GHMC/HYDRAA 2025 monsoon plan: 150 METs x 12, 51 DRF x 15). Their placement by zone,
// police strength per station and volunteer pools are synthetic: swap in duty rosters when available.
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

// Japan-style counterpart pairing: each short sector gets one donor (more only if one is not enough).
// Donors are tried in tiers: a dry city station, then a dry neighbouring district, then the TSSP reserve.
// City donors keep a coverage floor; last plan's pairs are kept when still valid so officers know the ground.
// donors: [{ id, name, avail, dry, tier, ownNeed }], minutes(donorIdx, sectorIdx) incl. mobilisation
export function pairCounterparts(sectors, donors, minutes, { prev = new Map(), offline = new Set() } = {}) {
  const spare = donors.map((d) => (!d.dry || offline.has(d.id) ? 0
    : d.tier === 0 ? Math.max(0, d.avail - Math.max(d.ownNeed, Math.ceil(SUPPLY.floor * d.avail))) : d.avail));
  const deficits = sectors.map((s, i) => ({ i, d: s.need.police - (offline.has(i) ? 0 : s.avail) }))
    .filter((x) => x.d > 0).sort((a, b) => sectors[b.i].p2 - sectors[a.i].p2 || b.d - a.d);
  const pairs = [], unmet = new Map();
  for (const { i, d } of deficits) {
    let left = d;
    while (left > 0) {
      const ok = donors.map((_, j) => j).filter((j) => spare[j] > 0 && (donors[j].tier > 0 || minutes(j, i) <= SUPPLY.maxPairMin));
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

// typed teams to sectors: min-cost flow where serving a sector earns a reward scaled by its risk
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
    if (s.need[kind] > 0) arcs.push({ from: X + b, to: T, cap: s.need[kind], cost: -1000 * (0.2 + s.p2 + 0.5 * s.p1) });
  });
  const { flows } = minCostFlow(X + sectors.length, arcs, S, T);
  const moves = flows.filter((f) => f.depot != null)
    .map((f) => ({ kind, depot: f.depot, sector: f.sector, teams: f.flow, minutes: Math.round(minutes(depots[f.depot], sectors[f.sector])) }));
  const got = new Map();
  moves.forEach((m) => got.set(m.sector, (got.get(m.sector) ?? 0) + m.teams));
  const unmet = sectors.map((s, b) => Math.max(0, s.need[kind] - (got.get(b) ?? 0)));
  return { moves, unmet };
}

const addMin = (t0, min) => new Date(Date.parse(`${t0}:00Z`) + min * 60e3).toISOString().slice(0, 16);
const stageOf = (lead) => (lead >= 24 * 60 ? 'Watch' : lead >= 6 * 60 ? 'Prepare' : 'Act');

export function plan(base, forecast, opts = {}) {
  const { q, confirmed = new Set(), offline = new Set(), noShow = 0, prev = new Map() } = opts;
  const sectors = assess(base, forecast, { q, confirmed });
  const avail = base.stations.map((s) => policeStrength(s.name));
  sectors.forEach((s) => { s.avail = avail[s.id]; });
  const t0 = forecast.times[0];
  const slow = SUPPLY.rainSlowdown;
  // road minutes from any point: OSRM between nearest stations + local leg at 25 km/h
  const roadMin = (pos, sector) => {
    const a = nearest(pos, base.stations, (s) => s.pos);
    return (base.travel[a][sector.id] + (km(pos, base.stations[a].pos) * 1.3 / 25) * 60) * slow;
  };
  const zoneDepots = (per) => SUPPLY.zones.map((z, i) => ({ ...z, count: Math.floor(per / 6) + (i < per % 6 ? 1 : 0) }));
  const depots = {
    met: zoneDepots(SUPPLY.metTeams),
    drf: [...zoneDepots(SUPPLY.drfTeams), { ...SUPPLY.ndrf, count: SUPPLY.ndrf.teams, extraCost: 300, request: true }],
    fire: base.fire.map((f) => ({ name: f.name, pos: f.pos, count: SUPPLY.fireCrews })),
    volunteers: SUPPLY.zones.map((z) => ({ name: `${z.name} volunteer hub`, pos: z.pos, count: Math.floor(SUPPLY.volunteersPerZone * (1 - noShow)) })),
  };
  const minutes = (d, s) => (d.leadMin ?? roadMin(d.pos, s));

  // counterpart donors: tier 0 dry city stations, tier 1 dry neighbouring districts, tier 2 state reserve
  const quant = q ?? ASSUMPTIONS.planQuantile;
  const dryAt = (pt) => forecast.members.filter((m) => Math.max(...severity(m.series[pt])) >= 1).length / forecast.members.length < 1 - quant - 1e-9;
  const donors = [
    ...sectors.map((s) => ({ id: s.id, name: s.name, pos: s.pos, avail: s.avail, ownNeed: s.need.police, dry: s.onset == null, tier: 0 })),
    ...DISTRICTS.map((d, k) => ({ id: `d${k}`, name: d.name, pos: d.pos, avail: Math.round(SUPPLY.districtPolice * (1 - SUPPLY.policeVacancy)),
      dry: forecast.points.length > LATTICE.length + k && dryAt(LATTICE.length + k), tier: 1, mobiliseMin: 60 })),
    { id: 'tssp', ...SUPPLY.tssp, dry: true, tier: 2 },
  ];
  const pairMin = (j, i) => {
    const d = donors[j];
    return d.tier === 0 ? base.travel[j][i] * slow : d.mobiliseMin + (km(d.pos, sectors[i].pos) * 1.35 / 40) * 60 * slow;
  };
  const police = pairCounterparts(sectors, donors, pairMin, { prev, offline });
  const teams = Object.fromEntries(Object.entries(depots).map(([k, ds]) => [k, allocate(ds, sectors, k, minutes)]));

  // ---- staged timeline ----
  const actions = [];
  const push = (a) => {
    const at = Math.max(0, a.atMin);
    actions.push({ ...a, atMin: at, at: addMin(t0, at), onsetAt: a.onsetMin == null ? null : addMin(t0, a.onsetMin),
      late: a.atMin < 0 ? -Math.round(a.atMin) : 0,
      stage: a.onsetMin == null ? 'Prepare' : stageOf(a.onsetMin - at) });
  };
  const onsetMin = (s) => (s.onset ?? 0) * 60;
  const atRisk = sectors.filter((s) => s.onset != null);
  if (atRisk.length) {
    const first = Math.min(...atRisk.map(onsetMin));
    push({ id: 'standby', kind: 'standby', atMin: 0, onsetMin: first,
      title: `Activate EOC watch: ${atRisk.length} sectors expected to flood`,
      detail: `Cancel leave at those stations; METs and DRF stand-to. First onset ${addMin(t0, first)}.` });
  }
  for (const p of police.pairs) {
    const s = sectors[p.to];
    push({ id: `pair-${p.from}-${p.to}`, kind: 'counterpart', sector: p.to, from: p.from, people: p.people,
      atMin: onsetMin(s) - p.minutes - 60, onsetMin: onsetMin(s),
      tier: p.tier, short: `${p.people} officers from ${donors[p.from].name} (${p.minutes} min)`,
      title: `${donors[p.from].name} → ${s.name}: ${p.people} officers`,
      detail: `${['Counterpart station', 'Outside-district counterpart', 'State reserve'][p.tier]}${p.continuity ? ' (kept from last plan)' : ''}; `
        + `${p.minutes} min${p.tier ? ' incl. mobilisation' : ''} in rain; report 1 h before onset.` });
  }
  const label = { met: 'Monsoon Emergency Team', drf: 'DRF rescue team', fire: 'swift-water crew', volunteers: 'trained volunteers' };
  for (const [kind, { moves }] of Object.entries(teams)) {
    for (const m of moves) {
      const d = depots[kind][m.depot], s = sectors[m.sector];
      const unit = kind === 'volunteers' ? `${m.teams} ${label[kind]}` : `${m.teams} × ${label[kind]}`;
      push({ id: `${kind}-${m.depot}-${m.sector}`, kind, sector: m.sector, teams: m.teams, request: !!d.request,
        atMin: onsetMin(s) - m.minutes - 60, onsetMin: onsetMin(s),
        short: `${d.request ? 'REQUEST ' : ''}${unit} from ${d.name} (${m.minutes} min)`,
        title: `${d.request ? 'REQUEST ' : ''}${unit} → ${s.name}`,
        detail: `From ${d.name}; ${m.minutes} min${d.request ? ' including mobilisation' : ' in rain'}.` });
    }
  }
  for (const u of base.underpasses) {
    const s = sectors[u.sector];
    if (s.onset == null) continue;
    push({ id: `close-${u.id}`, kind: 'underpass', sector: u.sector, pos: u.pos, atMin: onsetMin(s) - 30, onsetMin: onsetMin(s),
      short: `Close ${u.name}`, title: `Close ${u.name} (${s.name})`, detail: 'Barricade both ends, 2 officers posted until all-clear. Underpasses kill: Osong 2023, Balkampet RUB.' });
  }
  const alertSectors = atRisk.filter((s) => s.p2 >= 1 - (q ?? ASSUMPTIONS.planQuantile) - 1e-9 || s.confirmed);
  const byHour = Map.groupBy(alertSectors, (s) => s.onset);
  for (const [h, group] of byHour) {
    push({ id: `cap-${h}`, kind: 'alert', sectors: group.map((s) => s.id), atMin: h * 60 - 360, onsetMin: h * 60,
      title: `SACHET CAP alert: ${group.length} sector${group.length > 1 ? 's' : ''} (en, te, hi, ur)`,
      detail: [...new Set(group.map((s) => areaOf(s.name)).filter((a) => a.length >= 3))].join(', ') });
  }
  const long = atRisk.filter((s) => s.end - s.onset + 1 > SUPPLY.shiftH);
  for (const [h, group] of Map.groupBy(long, (s) => s.onset)) { // one relief wave per onset hour
    push({ id: `relief-${h}`, kind: 'relief', sectors: group.map((s) => s.id), atMin: (h + SUPPLY.shiftH) * 60, onsetMin: null,
      title: `Relief wave: rotate staff in ${group.length} sector${group.length > 1 ? 's' : ''}`,
      detail: `Events last up to ${Math.max(...group.map((s) => s.end - s.onset + 1))} h; nobody works past 12 h (fatigue cap, as TEC-FORCE rotates). `
        + [...new Set(group.map((s) => areaOf(s.name)).filter((a) => a.length >= 3))].join(', ') });
  }
  if (forecast.musi) {
    const th = base.musiThresholds;
    forecast.musi.time.forEach((d, i) => {
      const qd = forecast.musi.discharge[i];
      const offset = (Date.parse(`${d}T00:00Z`) - Date.parse(`${t0}:00Z`)) / 60e3;
      if (qd >= th.p99 && offset >= -24 * 60) {
        push({ id: `musi-${d}`, kind: 'musi', atMin: offset - 180, onsetMin: offset,
          title: `Musi at ${Math.round(qd)} m³/s on ${d}: evacuate river-bank cells`,
          detail: `GloFAS forecast vs 1990-2023 99th percentile ${Math.round(th.p99)} m³/s. Coordinate Himayat/Osman Sagar gate releases with HMWSSB.` });
      }
    });
  }
  actions.sort((a, b) => a.atMin - b.atMin || a.kind.localeCompare(b.kind));

  // ---- verification against what actually fell (replay only) ----
  let verification = null;
  if (forecast.observed) {
    const obsMax = forecast.observed.map((s) => Math.max(...severity(s)));
    const flagged = sectors.filter((s) => s.onset != null), hit = flagged.filter((s) => obsMax[s.point] >= 1);
    const flooded = sectors.filter((s) => obsMax[s.point] >= 1), missed = flooded.filter((s) => s.onset == null);
    verification = { flagged: flagged.length, hits: hit.length, observedSectors: flooded.length, missed: missed.length,
      observedMaxMm: Math.max(...forecast.observed.slice(0, LATTICE.length).map((s) => s.reduce((a, b) => a + b, 0))).toFixed(0) };
  }

  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const metrics = {
    members: forecast.members.length, sectorsAtRisk: atRisk.length,
    police: { need: sum(sectors.map((s) => Math.max(0, s.need.police - avail[s.id]))), paired: sum(police.pairs.map((p) => p.people)), unmet: sum([...police.unmet.values()]) },
    ...Object.fromEntries(Object.entries(teams).map(([k, t]) => [k, { need: sum(sectors.map((s) => s.need[k])), sent: sum(t.moves.map((m) => m.teams)), unmet: sum(t.unmet) }])),
    underpassesClosed: actions.filter((a) => a.kind === 'underpass').length,
    lateActions: actions.filter((a) => a.late).length,
  };
  return { t0, sectors, avail, donors, pairs: police.pairs, policeUnmet: [...police.unmet], teams, depots, actions, metrics, verification };
}
