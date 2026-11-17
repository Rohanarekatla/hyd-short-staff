import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { capAlert } from '../lib/cap.js';
import { triage } from '../lib/intake.js';
import { minCostFlow } from '../lib/mcf.js';
import { pairCounterparts, plan, SUPPLY } from '../lib/planner.js';
import { severity } from '../lib/risk.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url)));

test('min-cost flow serves the riskier sink first and skips unprofitable demand', () => {
  // 0 source, 1 sink, 2 depot (3 teams), 3 risky sector (needs 2), 4 calm sector (needs 2, reward below travel)
  const { flows } = minCostFlow(5, [
    { from: 0, to: 2, cap: 3, cost: 0 },
    { from: 2, to: 3, cap: 9, cost: 30, tag: 'risky' }, { from: 2, to: 4, cap: 9, cost: 30, tag: 'calm' },
    { from: 3, to: 1, cap: 2, cost: -1000 }, { from: 4, to: 1, cap: 2, cost: -20 },
  ], 0, 1);
  const sent = Object.fromEntries(flows.filter((f) => f.tag).map((f) => [f.tag, f.flow]));
  assert.deepEqual(sent, { risky: 2 });
});

test('severity uses 1 h, 3 h and 24 h triggers', () => {
  assert.deepEqual(severity([0, 13, 0]), [0, 1, 0]);
  assert.deepEqual(severity([0, 25, 0]), [0, 2, 0]);
  assert.equal(Math.max(...severity(Array(24).fill(5))), 2); // 120 mm/24 h = IMD very heavy
  assert.equal(Math.max(...severity(Array(24).fill(2))), 0);
});

test('counterparts: wet donors excluded, floors kept, tiers in order, pairs kept across plans', () => {
  const sectors = [
    { id: 0, need: { police: 20 }, avail: 10, p2: 0.9 },           // short by 10
    { id: 1, need: { police: 0 }, avail: 10, p2: 0 },              // dry city donor: can lend 4 (keeps 60%)
    { id: 2, need: { police: 0 }, avail: 30, p2: 0.5 },            // wet: must not lend
  ];
  const donors = [
    { id: 0, avail: 10, ownNeed: 20, dry: false, tier: 0 }, { id: 1, avail: 10, ownNeed: 0, dry: true, tier: 0 },
    { id: 2, avail: 30, ownNeed: 0, dry: false, tier: 0 }, { id: 'd0', avail: 50, dry: true, tier: 1 },
  ];
  const minutes = () => 20;
  const { pairs, unmet } = pairCounterparts(sectors, donors, minutes);
  assert.deepEqual(pairs.map((p) => [p.from, p.people]), [[1, 4], [3, 6]]);
  assert.equal(unmet.size, 0);
  const again = pairCounterparts(sectors, donors, minutes, { prev: new Map([[0, 3]]) });
  assert.deepEqual(again.pairs.map((p) => [p.from, p.people, p.continuity]), [[3, 10, true]]);
});

test('intake triages in four languages, places by area and merges duplicates', () => {
  const stations = [{ name: 'Amberpet Police Station' }, { name: 'Malakpet Police Station' }];
  const r = triage([
    { text: 'Amberpet house flooded, family trapped' }, { text: 'Amberpet లో మమ్మల్ని కాపాడండి' },
    { text: 'Malakpet میں بجلی کا تار گرا ہے' }, { text: 'Where is the shelter in Malakpet?' },
  ], stations);
  assert.deepEqual(r.map((x) => [x.category, x.sector, x.route, x.dupOf]), [
    ['rescue_needed', 0, 'human', null], ['rescue_needed', 0, 'human', 0],
    ['power_hazard', 1, 'human', null], ['info_request', 1, 'ai_answered', null]]);
});

test('CAP alert has four languages and a closed polygon', () => {
  const xml = capAlert({ id: 'x', sentAt: '2024-08-31T18:00', onsetAt: '2024-09-01T00:00',
    sectors: [{ id: 0, name: 'Amberpet Police Station' }],
    cells: [{ sector: 0, pos: [17.39, 78.51] }, { sector: 0, pos: [17.4, 78.52] }, { sector: 0, pos: [17.38, 78.53] }] });
  assert.equal(xml.match(/<info>/g).length, 4);
  for (const lang of ['en-IN', 'te-IN', 'hi-IN', 'ur-IN']) assert.ok(xml.includes(`<language>${lang}</language>`));
  const ring = xml.match(/<polygon>([^<]+)<\/polygon>/)[1].split(' ');
  assert.equal(ring[0], ring.at(-1));
  assert.ok(xml.includes('<status>Exercise</status>'));
});

test('full plan on the real 31 Aug 2024 replay respects supply, floors and stress tests', () => {
  const base = load('base.json'), fc = load('replay/2024-09-01.json');
  const p = plan(base, fc, { q: 0.8 });
  assert.ok(p.metrics.sectorsAtRisk > 0 && p.actions.length > 0);
  for (const [kind, t] of Object.entries(p.teams)) {
    const sent = new Map();
    t.moves.forEach((m) => sent.set(m.depot, (sent.get(m.depot) ?? 0) + m.teams));
    sent.forEach((n, d) => assert.ok(n <= p.depots[kind][d].count, `${kind} depot ${d} over-sent`));
  }
  const lent = new Map();
  p.pairs.forEach((x) => lent.set(x.from, (lent.get(x.from) ?? 0) + x.people));
  lent.forEach((n, j) => {
    const d = p.donors[j];
    assert.ok(d.dry, `${d.name} lent while wet`);
    if (d.tier === 0) assert.ok(d.avail - n >= Math.ceil(SUPPLY.floor * d.avail), `${d.name} below floor`);
  });
  const closures = p.actions.filter((a) => a.kind === 'underpass');
  assert.ok(closures.every((a) => p.sectors[a.sector].onset != null));

  const stressed = plan(base, fc, { q: 0.8, noShow: 0.5, offline: new Set([0]) });
  assert.ok(stressed.metrics.volunteers.sent <= p.metrics.volunteers.sent);
  assert.ok(!stressed.pairs.some((x) => x.from === 0)); // an offline station lends nobody
});
