// SurgeForce command centre: Node server with no required dependencies (node >= 21). npm start -> http://localhost:8520
import { createServer } from 'node:http';
import { appendFile, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { capAlert } from './lib/cap.js';
import { sitrep } from './lib/copilot.js';
import { CONFIRMS, simulatedFeed, triage } from './lib/intake.js';
import { plan, SUPPLY } from './lib/planner.js';
import { ASSUMPTIONS } from './lib/risk.js';
import { simulate } from './lib/sim.js';
import { DISTRICTS, EVENTS, liveForecast, replayForecast } from './lib/weather.js';

const PORT = Number(process.env.PORT) || 8520;
const ROOT = new URL('.', import.meta.url).pathname;
const load = async (f) => JSON.parse(await readFile(join(ROOT, 'data', f), 'utf8'));
const base = await load('base.json'), hand = await load('hand.json'), calibration = await load('calibration.json');
const AUDIT = join(ROOT, 'data/audit.jsonl');

const reports = new Map();       // scenario -> citizen reports (WhatsApp / 1070 notes)
const approvals = new Map();     // action id -> { decision, by, at }
const prevPairs = new Map();     // scenario -> Map(recipient -> donor), keeps counterparts stable across re-plans
const lastPlan = new Map();      // scenario -> { plan, forecast }, for CAP export, simulation and sitrep
const simCache = new Map();      // plan fingerprint -> simulation result

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = async (req) => {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 1e5) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
};

const cityMean = (series) => series[0].map((_, h) => +(series.slice(0, 9).reduce((a, s) => a + s[h], 0) / 9).toFixed(2));

async function buildPlan(params) {
  const mode = params.get('mode') === 'live' ? 'live' : 'replay';
  const event = EVENTS.find((e) => e.id === params.get('event')) ?? EVENTS[0];
  const forecast = mode === 'live' ? await liveForecast() : await replayForecast(event.id);
  const costLoss = Math.min(0.5, Math.max(0.02, Number(params.get('cl')) || ASSUMPTIONS.costLoss));
  const offline = new Set((params.get('offline') || '').split(',').filter(Boolean).map(Number));
  const noShow = Math.min(0.9, Math.max(0, Number(params.get('noShow')) || 0));
  const key = mode === 'live' ? 'live' : event.id;
  const triaged = triage(reports.get(key) ?? [], base.stations, base.underpasses);
  const confirmed = new Set(triaged.filter((r) => CONFIRMS.has(r.category) && r.sector != null && r.dupOf == null).map((r) => r.sector));
  const p = plan(base, hand, forecast, { costLoss, confirmed, offline, noShow, prev: prevPairs.get(key) ?? new Map() });
  prevPairs.set(key, new Map(p.designated.map((x) => [x.to, x.from])));
  lastPlan.set(key, { plan: p, forecast, fingerprint: [key, costLoss, [...offline], noShow, [...confirmed]].join('|') });
  return {
    key, mode, event, costLoss, stale: forecast.stale ?? null, issuedAt: forecast.issuedAt ?? null,
    forecast: { times: forecast.times, members: forecast.members.map((m) => m.name), musi: forecast.musi,
      // city-mean hourly rain per member (and observed, in replay) for the forecast fan chart
      cityHourly: forecast.members.map((m) => cityMean(m.series)),
      observedHourly: forecast.observed ? cityMean(forecast.observed) : null },
    ...p, reports: triaged,
    actions: p.actions.map((a) => ({ ...a, approval: approvals.get(`${key}:${a.id}`) ?? null })),
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/base') {
      return json(res, 200, { ...base, travel: undefined, hand, districts: DISTRICTS, supply: SUPPLY, assumptions: ASSUMPTIONS, events: EVENTS, calibration });
    }
    if (url.pathname === '/api/plan') return json(res, 200, await buildPlan(url.searchParams));
    if (url.pathname === '/api/sim') { // Monte Carlo response simulation for the last plan (~2 s, cached)
      const last = lastPlan.get(url.searchParams.get('key'));
      if (!last) return json(res, 400, { error: 'load the plan first' });
      if (!simCache.has(last.fingerprint)) simCache.set(last.fingerprint, simulate(base, last.forecast, last.plan));
      return json(res, 200, simCache.get(last.fingerprint));
    }
    if (url.pathname === '/api/sitrep') {
      const last = lastPlan.get(url.searchParams.get('key'));
      if (!last) return json(res, 400, { error: 'load the plan first' });
      return json(res, 200, await sitrep(last.plan, simCache.get(last.fingerprint), url.searchParams.get('lang') || 'en'));
    }
    if (url.pathname === '/api/reports' && req.method === 'POST') {
      const { text, key } = await readBody(req);
      if (typeof text !== 'string' || !text.trim() || text.length > 1000) return json(res, 400, { error: 'text required (max 1000 chars)' });
      if (!lastPlan.has(key)) return json(res, 400, { error: 'unknown scenario key' });
      reports.set(key, [...(reports.get(key) ?? []), { text: text.trim(), at: new Date().toISOString() }]);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/reports/simulate' && req.method === 'POST') {
      const key = url.searchParams.get('key'), p = lastPlan.get(key)?.plan;
      if (!p) return json(res, 400, { error: 'unknown scenario key' });
      reports.set(key, [...(reports.get(key) ?? []), ...simulatedFeed(p.sectors).map((r) => ({ ...r, at: new Date().toISOString() }))]);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/reports' && req.method === 'DELETE') { reports.delete(url.searchParams.get('key')); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/approve' && req.method === 'POST') {
      const { key, ids, decision, by } = await readBody(req);
      if (!Array.isArray(ids) || !['approved', 'rejected'].includes(decision)) return json(res, 400, { error: 'ids[] and decision required' });
      const entry = { decision, by: String(by || 'commander').slice(0, 60), at: new Date().toISOString() };
      ids.forEach((id) => approvals.set(`${key}:${id}`, entry));
      await appendFile(AUDIT, ids.map((id) => JSON.stringify({ key, id, ...entry })).join('\n') + '\n');
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/cap') {
      const p = lastPlan.get(url.searchParams.get('key'))?.plan;
      const a = p?.actions.find((x) => x.id === url.searchParams.get('id') && x.kind === 'alert');
      if (!a) return json(res, 404, { error: 'plan or alert not found; load the plan first' });
      const xml = capAlert({ id: `surgeforce-${url.searchParams.get('key')}-${a.id}`, sentAt: a.at,
        onsetAt: a.onsetAt, sectors: a.sectors.map((i) => p.sectors[i]), cells: base.cells });
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      return res.end(xml);
    }
    const file = normalize(join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(join(ROOT, 'public'))) return json(res, 403, { error: 'forbidden' });
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') return json(res, 404, { error: 'not found' });
    console.error(e);
    json(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`SurgeForce on http://localhost:${PORT}`));
