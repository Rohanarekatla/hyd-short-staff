import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { capAlert } from '../lib/cap.js';
import { triage } from '../lib/intake.js';
import { minCostFlow } from '../lib/mcf.js';
import { pairCounterparts, plan, SUPPLY } from '../lib/planner.js';
import { brier, economicValue, fitLogistic, predict, rocArea } from '../lib/calibrate.js';
import { simulate, speedAtDepth } from '../lib/sim.js';
import { facts, templateSitrep } from '../lib/copilot.js';
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

test('calibration maths: logistic fit ranks correctly, Brier and Richardson value behave', () => {
  const X = [], y = [];
  for (let i = 0; i < 200; i++) { const f = i / 200; X.push([1, f]); y.push(f > 0.6 ? 1 : 0); }
  const w = fitLogistic(X, y);
  assert.ok(predict(w, [1, 0.9]) > 0.8 && predict(w, [1, 0.1]) < 0.2);
  assert.equal(rocArea([0.1, 0.9], [0, 1]), 1);
  assert.equal(brier([1, 0], [1, 0]), 0);
  assert.ok(Math.abs(economicValue([1, 0, 0, 1], [1, 0, 0, 1], 0.2) - 1) < 1e-9); // perfect forecast = full value
  assert.ok(Math.abs(economicValue([0.25, 0.25, 0.25, 0.25], [1, 0, 0, 0], 0.2)) < 1e-9); // climatology = no value
});

test('road speed falls with water depth and stops at 30 cm', () => {
  assert.ok(Math.abs(speedAtDepth(0) - 86.9448) < 1e-9);
  assert.ok(speedAtDepth(150) < speedAtDepth(50));
  assert.equal(speedAtDepth(300), 0);
});

test('two-stage plan on the real 31 Aug 2024 replay respects supply, floors, terrain and reports', () => {
  const base = load('base.json'), hand = load('hand.json'), fc = load('replay/2024-09-01.json');
  const p = plan(base, hand, fc, { costLoss: 0.1 });
  assert.ok(p.city.onset != null && p.actions.length > 0);
  for (const [kind, t] of Object.entries(p.teams)) {
    const sent = new Map();
    t.moves.forEach((m) => sent.set(m.depot, (sent.get(m.depot) ?? 0) + m.teams));
    sent.forEach((n, d) => assert.ok(n <= p.depots[kind][d].count, `${kind} depot ${d} over-sent`));
  }
  assert.equal(p.pairs.length, 0); // nothing confirmed yet: counterparts are designated, not active
  assert.ok(p.designated.length > 0 && p.designated.every((x) => p.donors[x.from].dry));
  // more exposed terrain gets at least as much staged as the least exposed sector
  const byVuln = [...p.sectors].sort((a, b) => b.vulnerability - a.vulnerability);
  assert.ok(byVuln[0].need.met >= byVuln.at(-1).need.met);

  const conf = plan(base, hand, fc, { costLoss: 0.1, confirmed: new Set([byVuln[0].id]) });
  assert.ok(conf.pairs.every((x) => x.to === byVuln[0].id));
  assert.ok(conf.sectors[byVuln[0].id].need.met >= p.sectors[byVuln[0].id].need.met);
  const lent = new Map();
  conf.pairs.forEach((x) => lent.set(x.from, (lent.get(x.from) ?? 0) + x.people));
  lent.forEach((n, j) => {
    const d = conf.donors[j];
    if (d.tier === 0) assert.ok(d.avail - n >= Math.ceil(SUPPLY.floor * d.avail), `${d.name} below floor`);
  });

  const stressed = plan(base, hand, fc, { costLoss: 0.1, noShow: 0.5, offline: new Set([1]) });
  assert.ok(stressed.metrics.volunteers.sent <= p.metrics.volunteers.sent);
  assert.ok(!stressed.designated.some((x) => x.from === 1)); // an offline station lends nobody

  // the simulation should show staging helps, and the copilot template should carry the key facts
  const sim = simulate(base, fc, p, { runs: 40 });
  assert.ok(sim.surgeforce.drf.within30 >= sim.reactive.drf.within30);
  const text = templateSitrep(facts(p, sim));
  assert.match(text, /Chance of flood-level rain/);
  assert.match(text, /underpass closures/);
});

test('AI intake: nearest-prototype classifier, and AI can escalate but never downgrade a life-threatening report', async () => {
  const { makeClassifier, EXAMPLES } = await import('../lib/ai/intake-ai.js');
  const cats = Object.keys(EXAMPLES);
  // stand-in embedder: one-hot by which category's example text the input contains
  const embed = async (texts) => texts.map((t) => cats.map((c) => (EXAMPLES[c].some((ex) => t.includes(ex.slice(0, 12))) ? 1 : 0)));
  const classify = await makeClassifier(embed);
  const [r] = await classify([EXAMPLES.medical[0]]);
  assert.equal(r.category, 'medical');

  const stations = [{ name: 'Uppal Police Station' }];
  const reports = [{ text: 'Uppal family trapped, rescue' }, { text: 'Uppal water up to the knees near the temple' }];
  const out = triage(reports, stations, [], [{ category: 'info_request' }, { category: 'rescue_needed' }]);
  assert.equal(out[0].category, 'rescue_needed'); // rules said rescue: AI's "info" cannot downgrade it
  assert.equal(out[0].route, 'human');
  assert.equal(out[1].category, 'rescue_needed'); // rules found nothing, AI escalated
  assert.equal(out[1].by, 'ai');
});

test('agent loop calls planner tools, repairs malformed arguments, and answers from tool results', async () => {
  const { runAgent } = await import('../lib/ai/agent.js');
  const base = load('base.json'), hand = load('hand.json'), fc = load('replay/2024-09-01.json');
  const opts = { costLoss: 0.1 };
  const ctx = { base, hand, forecast: fc, opts, plan: plan(base, hand, fc, opts), reports: [] };
  const script = [ // what a small local model actually sent us: a list as a string
    { tool_calls: [{ function: { name: 'what_if_flooded', arguments: { areas: "['Uppal']" } } }] },
    { content: 'Confirming Uppal activates its counterparts.' },
  ];
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ message: { role: 'assistant', content: '', ...script[seen.length - 1] } }) };
  };
  try {
    const out = await runAgent({ provider: { kind: 'ollama', url: 'http://x', model: 'test' }, question: 'What if Uppal floods?', ctx });
    assert.equal(out.text, 'Confirming Uppal activates its counterparts.');
    assert.equal(out.steps[0].tool, 'what_if_flooded');
    assert.deepEqual(out.steps[0].result.unknownAreas, []);
    assert.ok(out.steps[0].result.activatedCounterparts.length > 0);
    assert.equal(seen[1].messages.at(-1).role, 'tool'); // the tool result went back to the model
  } finally { globalThis.fetch = realFetch; }
});
