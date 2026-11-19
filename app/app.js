/* global maplibregl */
// Everything runs in the browser: the planner, the simulation, CAP alerts, the on-device AI that triages
// citizen reports, and the AI agent (Claude, or a local model through Ollama). Static hosting is enough.
import { plan as runPlan } from '../lib/planner.js';
import { simulate } from '../lib/sim.js';
import { capAlert } from '../lib/cap.js';
import { CONFIRMS, simulatedFeed, triage } from '../lib/intake.js';
import { EVENTS, fetchLive } from '../lib/weather.js';
import { runAgent } from '../lib/ai/agent.js';
import { makeClassifier, transformersEmbedder } from '../lib/ai/intake-ai.js';
import { facts, templateSitrep } from '../lib/copilot.js';

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
const ANTHROPIC_SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const state = { mode: 'replay', cl: 0.1, offline: '', noShow: 0, tab: 'timeline', plan: null, base: null, cap: null, sim: null, lang: 'en',
  forecasts: {}, reports: {}, approvals: new Map(), prevPairs: new Map(), classify: null, aiStatus: 'loading on-device AI…', agent: null,
  provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'llama3.1', apiKey: '' };
const KIND = { bundle: 'Sector', standby: 'EOC', counterpart: 'Counterpart', met: 'MET', drf: 'DRF', fire: 'Fire', volunteers: 'Volunteers', underpass: 'Underpass', alert: 'CAP alert', relief: 'Relief', musi: 'Musi' };
const TIER = ['City counterpart', 'District counterpart', 'State reserve'];
const fmt = (t) => t && new Date(`${t}:00Z`).toLocaleString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const area = (n) => n.replace(/\b(traffic\s+)?police\s+station\b|\bpolice\b/gi, '').trim();
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------- map: MapLibre GL with real 3D terrain; flood exposure and station need drawn as extrusions ----------
const DEM = { type: 'raster-dem', tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Elevation © Mapzen / AWS Terrain Tiles' };
const VIEW = { center: [78.475, 17.385], zoom: 10.6, pitch: 60, bearing: -20 };
const map = new maplibregl.Map({
  container: 'map', ...VIEW, maxPitch: 78, attributionControl: { compact: true },
  style: {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 16, attribution: 'Tiles © Esri · data © OpenStreetMap contributors' },
      dem: DEM, shade: DEM, // separate source for hillshade, as MapLibre recommends
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#070b11' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.9, 'raster-brightness-max': 0.75, 'raster-saturation': -0.3 } },
      { id: 'shade', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#3a5675', 'hillshade-accent-color': '#05080c' } },
    ],
    terrain: { source: 'dem', exaggeration: 3 },
    sky: { 'sky-color': '#0a1424', 'horizon-color': '#1b3150', 'fog-color': '#070b11', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.25 },
  },
});
new ResizeObserver(() => map.resize()).observe(document.querySelector('.left'));
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
const fc = (features) => ({ type: 'FeatureCollection', features });
const feat = (type, coordinates, properties = {}) => ({ type: 'Feature', geometry: { type, coordinates }, properties });
const ll = (line) => line.map(([lat, lon]) => [lon, lat]);
const box = ([lat, lon], dy, dx) => [[[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy], [lon - dx, lat - dy]]];
const LINK = ['#3ccf91', '#b48cff', '#f2b544'];
const ready = new Promise((resolve) => map.on('load', () => {
  for (const id of ['nalas', 'musi', 'hand', 'links', 'under', 'stations']) map.addSource(id, { type: 'geojson', data: fc([]) });
  map.addLayer({ id: 'nalas', type: 'line', source: 'nalas', paint: { 'line-color': '#3f6a92', 'line-width': 1, 'line-opacity': 0.55 } });
  map.addLayer({ id: 'musi-glow', type: 'line', source: 'musi', paint: { 'line-color': '#4fb3ff', 'line-width': 10, 'line-blur': 8, 'line-opacity': 0.45 } });
  map.addLayer({ id: 'musi', type: 'line', source: 'musi', paint: { 'line-color': '#8fd3ff', 'line-width': 2.2 } });
  map.addLayer({ id: 'hand', type: 'fill-extrusion', source: 'hand', paint: {
    'fill-extrusion-color': ['match', ['get', 'band'], 'conf', '#ff4d5e', 'b1', '#2f7bff', 'b2', '#4fb3ff', '#9fd6ff'],
    'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.82, 'fill-extrusion-vertical-gradient': true } });
  map.addLayer({ id: 'links-ready', type: 'line', source: 'links', filter: ['!', ['get', 'active']], layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-dasharray': [2, 3], 'line-opacity': 0.85 } });
  map.addLayer({ id: 'links-active', type: 'line', source: 'links', filter: ['get', 'active'], layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': 0.95 } });
  map.addLayer({ id: 'stations', type: 'fill-extrusion', source: 'stations', paint: {
    'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.95 } });
  map.addLayer({ id: 'under', type: 'circle', source: 'under', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 7], 'circle-color': ['case', ['get', 'closing'], '#ff4d5e', '#5d6b7a'],
    'circle-stroke-color': '#e8f1fa', 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map' } });
  const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tip', offset: 10 });
  for (const id of ['under', 'links-ready', 'links-active', 'stations']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; tip.remove(); });
    map.on('mousemove', id, (e) => tip.setLngLat(e.lngLat).setHTML(e.features[0].properties.tip).addTo(map));
  }
  map.on('click', 'stations', (e) => { tip.remove(); new maplibregl.Popup({ maxWidth: '340px', className: 'card-pop' }).setLngLat(e.lngLat).setHTML(sectorPopup(e.features[0].properties.i)).addTo(map); });
  resolve();
}));

async function drawMap() {
  await ready;
  const { base, plan } = state;
  const conf = new Set(plan.sectors.filter((s) => s.confirmed).map((s) => s.id));
  const k = 0.35 + plan.city.p2; // columns rise the likelier drains overflow
  const cells = [];
  for (const [lat, lon, , h, sector] of base.hand.cells) {
    if (h > 4 && !conf.has(sector)) continue;
    const c = conf.has(sector);
    cells.push(feat('Polygon', box([lat, lon], 0.00105, 0.00113), { band: c ? 'conf' : h <= 1 ? 'b1' : h <= 2.5 ? 'b2' : 'b3', height: c ? 700 : Math.round((4.6 - h) * 95 * k) }));
  }
  map.getSource('hand').setData(fc(cells));
  map.getSource('nalas').setData(fc(base.hand.waterways.map((l) => feat('LineString', ll(l)))));
  map.getSource('musi').setData(fc(base.musi.map((l) => feat('LineString', ll(l)))));
  const closing = new Set(plan.actions.filter((a) => a.kind === 'underpass').map((a) => a.id));
  map.getSource('under').setData(fc(base.underpasses.map((u) => {
    const c = closing.has(`close-${u.id}`);
    return feat('Point', [u.pos[1], u.pos[0]], { closing: c, tip: `<b>${esc(u.name)}</b><br>HAND ${plan.underpassHand[u.id]} m${c ? ' · <span class="bad">closure planned</span>' : ''}` });
  })));
  const shown = plan.pairs.length ? plan.pairs : plan.designated, active = plan.pairs.length > 0;
  const receiving = new Set(shown.map((p) => p.to));
  map.getSource('links').setData(fc(shown.map((p) => feat('LineString', [[plan.donors[p.from].pos[1], plan.donors[p.from].pos[0]], [plan.sectors[p.to].pos[1], plan.sectors[p.to].pos[0]]],
    { active, color: LINK[p.tier], tip: `${esc(plan.donors[p.from].name)} → ${esc(plan.sectors[p.to].name)}<br><b>${p.people} officers</b> · ${active ? 'active' : 'pre-designated'}` }))));
  const vmax = Math.max(1e-9, ...plan.sectors.map((s) => s.vulnerability));
  map.getSource('stations').setData(fc(base.stations.map((s, i) => feat('Polygon', box(s.pos, 0.0032, 0.0034), {
    i, height: Math.round(350 + 2400 * (plan.sectors[i]?.vulnerability ?? 0) / vmax),
    color: conf.has(i) ? '#ff4d5e' : receiving.has(i) ? '#f2b544' : '#3ccf91',
    tip: `<b>${esc(s.name)}</b><br>${conf.has(i) ? 'flooding confirmed' : receiving.has(i) ? 'has a counterpart' : 'covered locally'} · click for playbook` }))));
}
document.getElementById('mapctl').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.view;
  if (v === '3d') map.easeTo({ pitch: 60, bearing: -20, duration: 900 });
  if (v === '2d') map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
  if (v === 'reset') map.flyTo({ ...VIEW, duration: 1200 });
  if (v) document.querySelectorAll('#mapctl [data-view="3d"], #mapctl [data-view="2d"]').forEach((b) => b.classList.toggle('on', b.dataset.view === (v === '2d' ? '2d' : '3d')));
});

function sectorPopup(i) {
  const s = state.plan.sectors[i], pb = state.plan.playbook[i];
  const list = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none';
  return `<b>${esc(s.name)}</b>${s.confirmed ? ' <span class="badge late">confirmed</span>' : ''}<br>`
    + `Flood-prone ground: ${s.flooded[1]} / ${s.flooded[2]} / ${s.flooded[3]} km² at severity 1 / 2 / 3 (HAND)<br>`
    + `Underpasses: ${s.underpasses} (${s.lowUnderpasses} in low ground)${s.riverine ? ` · ${s.riverine} km² on the Musi bank` : ''}<br>`
    + `<b>If hit</b>, needs: ${list(pb.ifHit)}<br>Staged here now: ${list(pb.stagedHere)}<br>`
    + `Counterpart: ${pb.counterpart.map((c) => `${esc(c.donor)} (${c.people}, ${c.minutes}′)`).join(', ') || 'none needed'}<br>`
    + `<span class="muted small">${state.base.stations.length ? `${state.plan.avail[i]} officers deployable here` : ''}</span>`;
}
const addH = (t0, h) => new Date(Date.parse(`${t0}:00Z`) + h * 3600e3).toISOString().slice(0, 16);

// ---------- rainfall chart: ensemble spread (10–90% band), median, and what actually fell ----------
function drawFan() {
  const f = state.plan.forecast, svg = $('#fan');
  const W = svg.clientWidth || 600, H = svg.clientHeight || 140, L = 46, R = 12, T = 8, B = 20;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); // real pixels: text and lines are never stretched
  const cum = (xs) => xs.reduce((a, v, i) => (a.push((a[i - 1] ?? 0) + v), a), []);
  const series = f.cityHourly.map(cum), obs = f.observedHourly ? cum(f.observedHourly) : null, N = f.times.length;
  const q = (h, p) => { const v = series.map((s) => s[h]).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.round(p * (v.length - 1)))]; };
  const p10 = [], p50 = [], p90 = [];
  for (let h = 0; h < N; h++) { p10.push(q(h, 0.1)); p50.push(q(h, 0.5)); p90.push(q(h, 0.9)); }
  const top = Math.max(10, ...series.map((s) => s.at(-1)), ...(obs ? [obs.at(-1)] : []));
  const step = [5, 10, 20, 25, 50, 100, 200].find((s) => top / s <= 5) ?? 500, max = Math.ceil(top / step) * step;
  const x = (h) => L + (h / (N - 1)) * (W - L - R), y = (v) => H - B - (v / max) * (H - T - B);
  const line = (s) => s.map((v, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const band = `${line(p90)}L${p10.map((v, h) => [x(h), y(v)]).reverse().map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join('L')}Z`;
  const grid = [];
  for (let v = 0; v <= max; v += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#1c2a3a"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end" class="ax">${v} mm</text>`);
  const days = f.times.map((t, h) => (t.endsWith('T00:00') ? h : -1)).filter((h) => h >= 0);
  const dayTicks = days.map((h) => `<line x1="${x(h)}" x2="${x(h)}" y1="${T}" y2="${H - B}" stroke="#22344a" stroke-dasharray="2 3"/>`
    + `<text x="${x(h) + 4}" y="${H - 6}" class="ax">${fmt(f.times[h]).split(', ').slice(0, 2).join(' ')}</text>`).join('');
  svg.innerHTML = grid.join('') + dayTicks
    + series.map((s) => `<path d="${line(s)}" fill="none" stroke="#4fb3ff" stroke-opacity=".14" stroke-width="1"/>`).join('')
    + `<path d="${band}" fill="#4fb3ff" fill-opacity=".16"/>`
    + `<path d="${line(p50)}" fill="none" stroke="#4fb3ff" stroke-width="2"/>`
    + (obs ? `<path d="${line(obs)}" fill="none" stroke="#ffffff" stroke-width="2"/>` : '')
    + `<line id="fanX" y1="${T}" y2="${H - B}" stroke="#8a9db1" stroke-width="1" visibility="hidden"/>`
    + `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="fanHit"/>`;
  const tip = $('#fanTip'), cross = $('#fanX');
  $('#fanHit').onmousemove = (e) => {
    const h = Math.max(0, Math.min(N - 1, Math.round(((e.offsetX - L) / (W - L - R)) * (N - 1))));
    cross.setAttribute('x1', x(h)); cross.setAttribute('x2', x(h)); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${fmt(f.times[h])}</b><br>Median forecast <b>${Math.round(p50[h])} mm</b><br>Likely range ${Math.round(p10[h])}–${Math.round(p90[h])} mm`
      + (obs ? `<br>Actually fell <b>${Math.round(obs[h])} mm</b>` : '');
    tip.hidden = false; tip.style.left = `${Math.min(x(h) + 26, W - 190)}px`;
  };
  $('#fanHit').onmouseleave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  const finals = series.map((s) => s.at(-1)).sort((a, b) => a - b);
  $('#fanNote').innerHTML = `<span class="lg"><i class="band"></i>likely range (10–90% of ${f.members.length} forecasts)</span>`
    + `<span class="lg"><i class="med"></i>median</span>` + (obs ? `<span class="lg"><i class="obs"></i>actually fell (ERA5): ${Math.round(obs.at(-1))} mm</span>` : '')
    + `<span class="lg muted">72 h total: ${Math.round(finals[0])}–${Math.round(finals.at(-1))} mm</span>`;
}
new ResizeObserver(() => state.plan && drawFan()).observe($('#fan'));

// ---------- KPIs ----------
function drawKpis() {
  const m = state.plan.metrics, p = state.plan, c = p.city;
  const k = (l, v, sub, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v ${cls}">${v}</div><div class="s">${sub}</div></div>`;
  const team = (t, name) => k(name, `${t.sent}/${t.need}`, t.unmet ? `${t.unmet} short` : t.need ? 'staged' : 'none needed', t.unmet ? 'bad' : t.need ? 'good' : '');
  const day = c.outlook.reduce((a, o) => (o.p > a.p ? o : a), c.outlook[0]);
  $('#kpis').innerHTML = k('Flood-level rain somewhere in city', pct(c.p1), `${m.members} forecasts · act at ≥ ${pct(c.costLoss)}`, c.onset != null ? 'bad' : 'good')
    + k('Worst day: ≥ 30 mm anywhere', pct(day.p), `${day.day} · P90 ${day.p90} mm`)
    + k('Counterparts', m.activePairs ? `${m.activePairs} active` : `${m.designated} ready`, m.activePairs ? `${m.confirmed} sectors confirmed` : 'pre-designated, activate on report')
    + team(m.met, 'Monsoon Emergency Teams') + team(m.drf, 'DRF rescue teams')
    + k('Underpasses to close', m.underpassesClosed, 'before water arrives')
    + k('Actions', p.actions.length, m.lateActions ? `${m.lateActions} already late` : 'all on time', m.lateActions ? 'bad' : '');
  const b = $('#banner');
  b.hidden = !p.stale && !(p.mode === 'live' && c.onset == null);
  b.textContent = p.stale || `Live: no forecast member reaches the action threshold in the next 72 h (${m.members} members, issued ${new Date(p.issuedAt).toLocaleString('en-IN')}). Switch to Replay to see a real event.`;
}

// ---------- panel ----------
const panels = {
  timeline() {
    const items = timelineItems(state.plan.actions);
    if (!items.length) return '<p class="muted">Nothing to do: no forecast member brings flooding in the next 72 hours.</p>';
    return ['Watch', 'Prepare', 'Act'].map((st) => {
      const acts = items.filter((a) => a.stage === st);
      if (!acts.length) return '';
      return `<div class="stage ${st}"><h3>${st} <span class="muted small">${acts.length} decisions
        <button class="btn" data-approve-stage="${st}">Approve all</button></span></h3>${acts.map(actionCard).join('')}</div>`;
    }).join('') + `<p class="muted small">Stages follow Japan's timeline method: Watch = more than 24 h before onset, Prepare = 6–24 h, Act = under 6 h.
      Each sector's moves (counterpart officers, teams, underpass closures) are one decision.</p>`;
  },
  pairs() {
    const p = state.plan;
    const row = (x) => `<tr><td>${esc(p.donors[x.from].name)}<div class="muted small">${TIER[x.tier]}${x.continuity ? ' · kept' : ''}</div></td>
      <td>${esc(p.sectors[x.to].name)}</td><td class="n">${x.people}</td><td class="n">${x.minutes}′</td></tr>`;
    const head = '<tr><th>Donor</th><th>Receives</th><th class="n">Officers</th><th class="n">Travel</th></tr>';
    const dist = p.donors.filter((d) => d.tier === 1).map((d) => `${esc(d.name.replace(/ district police| police commissionerate/i, ''))}: <b class="${d.dry ? '' : 'muted'}">${d.dry ? 'dry, can lend' : 'wet'}</b>`).join(' · ');
    return `<div class="card"><h4>Pre-designated, activated on confirmation</h4><div class="muted small">Japan pairs each struggling municipality with one supporter (対口支援), and in 2025 began naming supporters before a Nankai Trough quake.
      Here every exposed station gets its counterpart before the rain: a low-exposure city station that keeps 60% of its strength, then a dry district, then the TSSP reserve.
      A donor may be named for more stations than it can serve at once, because only about 38% of exposed sectors are hit on a heavy-rain day (backtest). A citizen report activates the pair.</div>
      <div class="small" style="margin-top:6px">${dist}</div></div>
      ${p.pairs.length ? `<h4>Active now</h4><table>${head}${p.pairs.map(row).join('')}</table>` : ''}
      <h4 style="margin-top:10px">Pre-designated (${p.designated.length})</h4>
      ${p.designated.length ? `<table>${head}${p.designated.map(row).join('')}</table>` : '<p class="muted">No station would be short at this threshold.</p>'}
      ${p.policeUnmet.length ? `<p class="muted">Still short after activation: ${p.policeUnmet.map(([i, n]) => `${esc(p.sectors[i].name)} (${n})`).join(', ')}</p>` : ''}`;
  },
  teams() {
    const p = state.plan, m = p.metrics;
    const names = { met: 'Monsoon Emergency Teams (12 people)', drf: 'HYDRAA DRF rescue teams (15)', fire: 'Fire swift-water crews', volunteers: 'Trained volunteers (Aapda Mitra / NSS / NCC)' };
    return Object.entries(names).map(([k, n]) => {
      const t = m[k], moves = p.teams[k].moves;
      const rows = moves.slice(0, 40).map((mv) => `<tr><td>${esc(p.depots[k][mv.depot].name)}</td><td>${esc(p.sectors[mv.sector].name)}</td><td class="n">${mv.teams}</td><td class="n">${mv.minutes}′</td></tr>`).join('');
      return `<div class="card"><h4>${n}</h4><div class="small">${t.sent} sent of ${t.need} needed${t.unmet ? ` · <b style="color:var(--act)">${t.unmet} short</b>` : ''}</div>
        <div class="bar"><i class="${t.unmet ? 'short' : ''}" style="width:${t.need ? Math.round((t.sent / t.need) * 100) : 100}%"></i></div>
        ${rows ? `<table style="margin-top:6px"><tr><th>From</th><th>To</th><th class="n">Units</th><th class="n">Travel</th></tr>${rows}</table>` : ''}
        ${moves.length > 40 ? `<div class="muted small">+${moves.length - 40} more moves</div>` : ''}</div>`;
    }).join('') + '<p class="muted small">Stage 1: teams are staged to the expected need (if-hit need × 38% hit share, or full need where confirmed), weighted by terrain exposure, at least travel time (min-cost flow). Click a station on the map for its stage-2 playbook. NDRF is requested only when local DRF runs out; it needs about 5.5 h.</p>';
  },
  reports() {
    const p = state.plan;
    const rows = p.reports.slice().reverse().map((r) => `<tr><td>${esc(r.text)}${r.simulated ? ' <span class="badge">sim</span>' : ''}</td>
      <td><span class="badge ${r.route === 'human' ? 'late' : r.route === 'ai_answered' ? 'ok' : ''}">${r.category.replace('_', ' ')}</span><div class="muted small">${r.route.replace('_', ' ')} · ${r.by === 'ai' ? 'AI' : 'rules'}</div></td>
      <td>${r.sector == null ? '<span class="muted">unplaced</span>' : esc(area(p.sectors[r.sector].name))}${r.dupOf != null ? '<div class="muted small">duplicate</div>' : ''}</td></tr>`).join('');
    return `<div class="card"><h4>Citizen reports (WhatsApp / 1070)</h4>
      <div class="muted small">On-device AI (multilingual-e5 embeddings, runs in this browser, no data leaves it) reads English, Telugu, Hindi and Urdu, as Japan's SOCDA chatbot does on LINE.
      Each report is triaged, placed by area name and merged with duplicates. A rescue or medical report confirms flooding in that sector and re-plans it at once. Life-threatening reports always go to a human; the AI can escalate a report, never downgrade one.</div>
      <div class="small" style="margin-top:4px">AI status: <b>${esc(state.aiStatus)}</b></div>
      <div class="row" style="display:flex;gap:6px;margin-top:8px"><input type="text" id="rep" placeholder="e.g. Amberpet లో ఇంట్లో నీళ్ళు, కాపాడండి" style="flex:1;max-width:none">
      <button class="btn primary" id="send">Send</button></div>
      <div style="display:flex;gap:6px;margin-top:6px"><button class="btn" id="sim">Simulate 10 reports</button><button class="btn" id="clr">Clear</button></div></div>
      ${rows ? `<table><tr><th>Report</th><th>Triage</th><th>Sector</th></tr>${rows}</table>` : '<p class="muted">No reports yet.</p>'}`;
  },
  alerts() {
    const p = state.plan, alerts = p.actions.filter((a) => a.kind === 'alert');
    if (!alerts.length) return '<p class="muted">No public alert needed.</p>';
    return `<p class="muted small">Draft CAP 1.2 alerts for NDMA's SACHET (cell broadcast), in English, Telugu, Hindi and Urdu, with an area polygon built from the sector's cells. Status stays "Exercise" until a commander approves.</p>`
      + alerts.map((a) => `<div class="card"><h4>${esc(a.title)}</h4><div class="small">Issue ${fmt(a.at)} · onset ${fmt(a.onsetAt)}</div>
        <div class="muted small">${esc(a.detail)}</div><div style="margin-top:6px"><button class="btn" data-cap="${a.id}">Show CAP XML</button></div>
        ${state.cap?.id === a.id ? `<pre class="xml">${esc(state.cap.xml)}</pre>` : ''}</div>`).join('');
  },
  evidence() {
    const cal = state.base.calibration, c = cal.city['30'], pt = cal.point['30'], cl = state.plan.city.costLoss;
    const val = (r) => r.value.reduce((b, v) => (Math.abs(v.costLoss - cl) < Math.abs(b.costLoss - cl) ? v : b)).raw;
    const v = state.plan.verification, s = state.sim;
    const simCard = !s ? '<p class="muted">Running the response simulation…</p>' : `
      <table><tr><th></th><th class="n">Teams wait at depots</th><th class="n">SurgeForce staging</th></tr>
      <tr><td>Rescues reached within 30 min</td><td class="n">${pct(s.reactive.drf.within30)}</td><td class="n"><b>${pct(s.surgeforce.drf.within30)}</b></td></tr>
      <tr><td>Rescue response, 90th percentile</td><td class="n">${s.reactive.drf.p90}′</td><td class="n"><b>${s.surgeforce.drf.p90}′</b></td></tr>
      <tr><td>Waterlogging jobs within 30 min</td><td class="n">${pct(s.reactive.met.within30)}</td><td class="n"><b>${pct(s.surgeforce.met.within30)}</b></td></tr></table>
      <div class="muted small">${s.eventRuns} simulated storms from the real forecast members; ${s.reactive.drf.n} rescues, ${s.reactive.met.n} waterlogging jobs.
      Road speed falls with water depth (Pregnolato et al. 2017): travel ×${s.travelFactor.join(' / ×')} at severity 1 / 2 / 3. Incident rates are synthetic.</div>`;
    return `<div class="card"><h4>Can the forecast tell us when? Where?</h4>
      <div class="muted small">Backtest over the ${cal.seasons.join(' and ')} monsoons: what 6 global models forecast 1–3 days ahead vs ERA5, at ≥ 30 mm/day.</div>
      <table><tr><th></th><th class="n">Events</th><th class="n">Brier skill</th><th class="n">ROC area</th><th class="n">Value at your C/L</th></tr>
      <tr><td><b>Anywhere in the city</b> (when)</td><td class="n">${c.events}/${c.n}</td><td class="n">${c.brierSkillRaw}</td><td class="n">${c.rocRaw}</td><td class="n"><b>${val(c)}</b></td></tr>
      <tr><td>At one 25 km point (where)</td><td class="n">${pt.events}/${pt.n}</td><td class="n">${pt.brierSkillRaw}</td><td class="n">${pt.rocRaw}</td><td class="n">${val(pt)}</td></tr></table>
      <div class="muted small">So SurgeForce uses the forecast for <b>when</b> and terrain plus reports for <b>where</b>. A fitted EMOS-style calibration did not beat the raw ensemble with 15 events (it is re-fitted each season).</div>
      ${valueChart(c, pt, cl)}${reliabilityChart(c)}</div>
      <div class="card"><h4>What staging buys (response simulation)</h4>${simCard}</div>
      ${state.base.intakeEval ? `<div class="card"><h4>AI triage vs keyword rules (held-out, 4 languages)</h4>
        <table><tr><th></th><th class="n">Accuracy</th><th class="n">Life-threatening missed</th></tr>
        <tr><td>Keyword rules</td><td class="n">${pct(state.base.intakeEval.keywords.accuracy)}</td><td class="n">${state.base.intakeEval.keywords.lifeThreateningMissed} / ${state.base.intakeEval.keywords.lifeThreateningTotal}</td></tr>
        <tr><td><b>On-device AI</b> (${esc(state.base.intakeEval.model.split('/')[1])})</td><td class="n"><b>${pct(state.base.intakeEval.ai.accuracy)}</b></td><td class="n"><b>${state.base.intakeEval.ai.lifeThreateningMissed} / ${state.base.intakeEval.ai.lifeThreateningTotal}</b></td></tr></table>
        <div class="muted small">${state.base.intakeEval.n} messages written differently from the AI's few-shot examples. In the app both run together, and a report flagged life-threatening by either goes to a human.</div></div>` : ''}
      ${v ? `<div class="card"><h4>This replay vs what fell</h4><table><tr><th>Day</th><th class="n">Forecast P(≥ 30 mm)</th><th class="n">ERA5 max</th></tr>
        ${v.days.map((d) => `<tr><td>${d.day}</td><td class="n">${pct(d.p)}</td><td class="n">${d.observedMaxMm} mm${d.event ? ' ✓' : ''}</td></tr>`).join('')}</table>
        <div class="muted small">ERA5 is a 25 km reanalysis that smooths cloudbursts; gauge peaks are higher.</div></div>` : ''}`;
  },
  copilot() {
    const a = state.agent;
    const presets = ['What is the situation and what should I approve first?', 'What changes if Uppal is confirmed flooded?',
      'How much does staging help rescues?', 'Draft a public alert for the most exposed areas in Telugu'];
    return `<div class="card"><h4>AI assistant (agent)</h4><div class="muted small">An LLM that answers by calling SurgeForce's tested tools: situation, area playbooks, what-if re-plans, the response simulation, reports and alert drafts.
      Every number comes from a tool, and every call is shown below. It cannot approve or send anything. Few, single-purpose tools follow the DORA benchmark (NeurIPS 2026): agents fail mostly on choosing tools and filling their arguments.</div>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
        <label class="ctl"><input type="radio" name="prov" value="ollama" ${state.provider === 'ollama' ? 'checked' : ''}> Local model (Ollama, data stays on this machine)</label>
        <label class="ctl"><input type="radio" name="prov" value="claude" ${state.provider === 'claude' ? 'checked' : ''}> Claude Opus 5.5</label></div>
      ${state.provider === 'ollama' ? `<div style="display:flex;gap:6px;margin-top:6px"><input type="text" id="ourl" value="${esc(state.ollamaUrl)}" style="flex:1;max-width:none"><input type="text" id="omodel" value="${esc(state.ollamaModel)}" style="width:110px"></div>`
        : `<div style="margin-top:6px"><input type="text" id="akey" placeholder="Anthropic API key (kept in this tab only)" value="${esc(state.apiKey)}" style="width:100%;max-width:none"></div>`}
      <div style="display:flex;gap:6px;margin-top:6px"><select id="lang">${[['en', 'English'], ['te', 'Telugu'], ['hi', 'Hindi'], ['ur', 'Urdu']].map(([v, n]) => `<option value="${v}" ${state.lang === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <input type="text" id="ask" placeholder="Ask the assistant…" style="flex:1;max-width:none"><button class="btn primary" id="go">Ask</button></div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${presets.map((q) => `<button class="btn" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>
      ${a ? `<div class="card"><h4>${a.pending ? 'Thinking…' : `Answer · ${esc(a.model ?? '')}`}</h4>
        ${a.error ? `<p style="color:var(--act)">${esc(a.error)}</p><pre class="xml" style="white-space:pre-wrap">${esc(templateSitrep(facts(state.plan, state.sim)))}</pre><div class="muted small">Template report shown instead.</div>` : ''}
        ${a.text ? `<pre class="xml" style="white-space:pre-wrap">${esc(a.text)}</pre>` : ''}
        ${a.steps?.length ? `<div class="small"><b>Tool calls</b>${a.steps.map((st) => `<div class="muted">→ ${esc(st.tool)}(${esc(JSON.stringify(st.args))})</div>`).join('')}</div>` : ''}</div>` : ''}`;
  },
  method() {
    const b = state.base;
    return `<div class="card"><h4>Where AI is used</h4><div class="small">
      • <b>Forecasting:</b> 173-member ensemble including ECMWF's machine-learned AIFS model (51 AI members)<br>
      • <b>Verification:</b> learned calibration and skill scores from two monsoons decide what the AI forecasts are trusted for<br>
      • <b>Citizen reports:</b> multilingual embedding model in the browser, 91% vs 13% for keywords on held-out messages<br>
      • <b>Optimisation:</b> min-cost-flow staging, counterpart matching, Monte Carlo response simulation<br>
      • <b>Agent:</b> Claude Opus 5.5 or a local Llama 3.1 that answers by calling the planner's tools</div></div>
      <div class="card"><h4>Real data</h4><div class="small">
      • ${b.stations.length} police stations, ${b.fire.length} fire stations, ${b.underpasses.length} road underpasses, the Musi and ${b.hand.waterways.length} nalas/streams from OpenStreetMap<br>
      • ${b.hand.cells.length} cells of 250 m with SRTM-based elevation (AWS Terrarium tiles) and HAND, height above nearest drainage (as in NOAA's National Water Model)<br>
      • Road times between stations from OSRM; in floods, speed falls with water depth (Pregnolato et al. 2017)<br>
      • Live: 173-member ensemble (NCEP GEFS 31, ECMWF ENS 51, DWD ICON-EPS 40, ECMWF AIFS 51) via Open-Meteo<br>
      • Replay: what 6 global models forecast 1–3 days before 31 Aug 2024 (Open-Meteo Previous Runs)<br>
      • Backtest: 2024 + 2025 monsoons, 18 forecast members vs ERA5<br>
      • Musi: GloFAS discharge vs its 1990–2023 95th/99th percentile (${Math.round(b.musiThresholds.p95)} / ${Math.round(b.musiThresholds.p99)} m³/s)<br>
      • Team counts from the GHMC/HYDRAA 2025 plan: 150 METs × 12, 51 DRF teams × 15</div></div>
      <div class="card"><h4>Decision rule (cost–loss)</h4><div class="small">Act when the forecast probability is at least C/L, the cost of a wasted deployment divided by the loss from an unprepared flood (Richardson 2000).
      The header buttons set that ratio; planning numbers use the matching (1 − C/L) quantile of the forecast members.</div></div>
      <div class="card"><h4>Synthetic (swap for duty rosters)</h4><div class="small muted">Deployable officers per station (22% vacancy applied), team placement by zone, volunteer pools, district reserves, incident rates in the simulation, citizen reports marked "sim".</div></div>
      <div class="card"><h4>Severity triggers</h4><div class="small">Level 1/2/3 when 1 h, 3 h or 24 h rain at the worst city point exceeds
      ${b.assumptions.triggers.map((t, i) => `<br>L${i + 1}: ${t[0]} mm/h · ${t[1]} mm/3 h · ${t[2]} mm/24 h · ground ≤ ${b.assumptions.stageM[i + 1]} m HAND floods`).join('')}
      <div class="muted">24 h values are IMD's heavy, very heavy and extremely heavy categories; 1 h values bracket GHMC's stated drain capacity of 12–20 mm/h.</div></div></div>`;
  },
};

function valueChart(c, pt, cl) {
  const W = 420, H = 150, x = (a) => 30 + (a / 0.95) * (W - 40), y = (v) => H - 20 - Math.max(-0.2, v) / 1.2 * (H - 40) - 0.2 / 1.2 * (H - 40);
  const line = (r, color) => `<path d="${r.value.map((v, i) => `${i ? 'L' : 'M'}${x(v.costLoss).toFixed(1)},${y(v.raw).toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="2"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:440px;display:block;margin-top:8px"><text x="30" y="12" fill="#8295a8" font-size="10">Economic value vs cost/loss ratio (1 = perfect forecast, 0 = no better than climatology)</text>
    <line x1="30" x2="${W - 10}" y1="${y(0)}" y2="${y(0)}" stroke="#1f2c3a"/><line x1="${x(cl)}" x2="${x(cl)}" y1="20" y2="${H - 20}" stroke="#f2b544" stroke-dasharray="3 3"/>
    ${line(c, '#3ccf91')}${line(pt, '#ff5d5d')}
    <text x="${x(cl) + 4}" y="30" fill="#f2b544" font-size="9">your C/L</text><text x="${W - 120}" y="40" fill="#3ccf91" font-size="10">city (when)</text>
    <text x="${W - 120}" y="54" fill="#ff5d5d" font-size="10">point (where)</text>
    ${[0, 0.25, 0.5, 0.75].map((a) => `<text x="${x(a)}" y="${H - 6}" fill="#8295a8" font-size="9">${a}</text>`).join('')}</svg>`;
}
function reliabilityChart(c) {
  const S = 150, m = 25, sc = (v) => m + v * (S - 2 * m);
  const pts = c.reliabilityRaw.filter((b) => b.n);
  return `<svg viewBox="0 0 ${S + 150} ${S}" style="width:100%;max-width:300px;display:block;margin-top:6px"><text x="${m}" y="14" fill="#8295a8" font-size="10">Reliability: forecast vs observed frequency</text>
    <line x1="${sc(0)}" y1="${S - sc(0)}" x2="${sc(1)}" y2="${S - sc(1)}" stroke="#1f2c3a" stroke-dasharray="3 3"/>
    <path d="${pts.map((b, i) => `${i ? 'L' : 'M'}${sc(b.forecast).toFixed(1)},${(S - sc(b.observed)).toFixed(1)}`).join('')}" fill="none" stroke="#3ccf91" stroke-width="2"/>
    ${pts.map((b) => `<circle cx="${sc(b.forecast)}" cy="${S - sc(b.observed)}" r="${2 + Math.sqrt(b.n) / 3}" fill="#3ccf91"><title>${b.n} days: forecast ${pct(b.forecast)}, observed ${pct(b.observed)}</title></circle>`).join('')}
    <text x="${S - 10}" y="${S - 30}" fill="#8295a8" font-size="9">diagonal = perfectly reliable</text></svg>`;
}

const BUNDLED = new Set(['counterpart', 'met', 'drf', 'fire', 'volunteers', 'underpass']);
function timelineItems(actions) {
  const solo = [], bySector = new Map();
  for (const a of actions) {
    if (BUNDLED.has(a.kind) && a.sector != null) {
      if (!bySector.has(a.sector)) bySector.set(a.sector, []);
      bySector.get(a.sector).push(a);
    } else solo.push({ ...a, ids: [a.id] });
  }
  const bundles = [...bySector].map(([sid, acts]) => {
    const first = acts[0], decisions = new Set(acts.map((a) => a.approval?.decision ?? null));
    return { kind: 'bundle', id: `bundle-${sid}`, ids: acts.map((a) => a.id), atMin: first.atMin, at: first.at, onsetAt: first.onsetAt,
      stage: first.stage, late: Math.max(...acts.map((a) => a.late)), request: acts.some((a) => a.request),
      title: `Pre-position: ${state.plan.sectors[sid].name}`, lines: acts,
      approval: decisions.size === 1 && !decisions.has(null) ? first.approval : null };
  });
  return [...solo, ...bundles].sort((a, b) => a.atMin - b.atMin);
}

function actionCard(a) {
  const ap = a.approval?.decision;
  const badges = [`<span class="badge">${KIND[a.kind]}</span>`, a.late ? `<span class="badge late">${a.late} min late</span>` : '', a.request ? '<span class="badge req">request</span>' : ''].join(' ');
  return `<div class="act ${ap || ''}"><div class="t"><span>${fmt(a.at)}${a.onsetAt ? ` · onset ${fmt(a.onsetAt).split(', ').pop()}` : ''}</span><span>${badges}</span></div>
    <div class="ti">${esc(a.title)}</div>
    ${a.lines ? `<ul class="d lines">${a.lines.map((l) => `<li><b>${fmt(l.at).split(', ').pop()}</b> ${esc(l.short)}${l.late ? ` <span class="badge late">${l.late} min late</span>` : ''}</li>`).join('')}</ul>` : `<div class="d">${esc(a.detail)}</div>`}
    <div class="row">${ap ? `<span class="badge ${ap === 'approved' ? 'ok' : 'late'}">${ap} by ${esc(a.approval.by)}</span>`
      : `<button class="btn" data-ok="${a.ids.join(',')}">Approve</button><button class="btn" data-no="${a.ids.join(',')}">Reject</button>`}
      ${a.kind === 'alert' ? `<button class="btn" data-cap="${a.id}">CAP XML</button>` : ''}</div></div>`;
}

function drawPanel() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === state.tab));
  $('#panel').innerHTML = panels[state.tab]();
  if (state.tab === 'evidence' && !state.sim) {
    setTimeout(() => { state.sim = simulate(state.base, state.forecast, state.raw); if (state.tab === 'evidence') drawPanel(); }, 30);
  }
}

// ---------- data (all in the browser) ----------
const cityMean = (series) => series[0].map((_, h) => +(series.slice(0, 9).reduce((a, x) => a + x[h], 0) / 9).toFixed(2));
const getJSON = (f) => fetch(`data/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); });

async function forecastFor(mode) {
  const key = mode === 'live' ? 'live' : EVENTS[0].id, cached = state.forecasts[key];
  if (cached && (mode !== 'live' || Date.now() - cached.at < 30 * 60e3)) return { key, forecast: cached.data };
  const data = mode === 'live' ? await fetchLive() : await getJSON(`replay/${key}.json`);
  state.forecasts[key] = { at: Date.now(), data };
  return { key, forecast: data };
}

async function load() {
  document.body.style.cursor = 'progress';
  try {
    const { key, forecast } = await forecastFor(state.mode);
    const reports = state.reports[key] ?? [];
    const ai = state.classify && reports.length ? await state.classify(reports.map((r) => r.text)) : null;
    const triaged = triage(reports, state.base.stations, state.base.underpasses, ai);
    const confirmed = new Set(triaged.filter((r) => CONFIRMS.has(r.category) && r.sector != null && r.dupOf == null).map((r) => r.sector));
    const opts = { costLoss: state.cl, confirmed, offline: new Set(state.offline === '' ? [] : [Number(state.offline)]), noShow: state.noShow, prev: state.prevPairs.get(key) ?? new Map() };
    const p = runPlan(state.base, state.base.hand, forecast, opts);
    state.prevPairs.set(key, new Map(p.designated.map((x) => [x.to, x.from])));
    state.forecast = forecast; state.raw = p; state.opts = opts; state.ai = ai; state.sim = null;
    state.plan = { ...p, key, mode: state.mode, costLoss: state.cl, issuedAt: forecast.issuedAt ?? null, stale: null, reports: triaged,
      forecast: { times: forecast.times, members: forecast.members.map((m) => m.name), musi: forecast.musi,
        cityHourly: forecast.members.map((m) => cityMean(m.series)), observedHourly: forecast.observed ? cityMean(forecast.observed) : null },
      actions: p.actions.map((a) => ({ ...a, approval: state.approvals.get(`${key}:${a.id}`) ?? null })) };
    drawKpis(); drawFan(); drawPanel(); drawMap().then(bootDone);
  } catch (e) {
    bootDone();
    $('#banner').hidden = false; $('#banner').textContent = `Could not build the plan: ${e.message}`;
  } finally { document.body.style.cursor = ''; }
}

// hide the boot screen once the 3D map has drawn (or after 8 s, so slow tiles never block the app)
function bootDone() {
  const b = $('#boot');
  if (!b || b.classList.contains('done')) return;
  $('#bootStep').textContent = 'Rendering 3D terrain…';
  const hide = () => { b.classList.add('done'); setTimeout(() => b.remove(), 600); };
  map.once('idle', hide); setTimeout(hide, 8000);
}

function approve(ids, decision) {
  const entry = { decision, by: 'Commander, GHMC EOC', at: new Date().toISOString() };
  ids.forEach((id) => state.approvals.set(`${state.plan.key}:${id}`, entry));
  try { localStorage.setItem('surgeforce-audit', JSON.stringify([...state.approvals])); } catch { /* storage off: keep in memory */ }
  load();
}

async function askAgent(question) {
  state.agent = { pending: true }; drawPanel();
  try {
    const provider = state.provider === 'claude'
      ? { kind: 'claude', client: new (await import(ANTHROPIC_SDK)).default({ apiKey: state.apiKey, dangerouslyAllowBrowser: true }) }
      : { kind: 'ollama', url: state.ollamaUrl.replace(/\/$/, ''), model: state.ollamaModel };
    const ctx = { base: state.base, hand: state.base.hand, forecast: state.forecast, plan: state.raw, opts: state.opts,
      reports: state.reports[state.plan.key] ?? [], ai: state.ai, sim: state.sim };
    state.agent = await runAgent({ provider, question, ctx, lang: state.lang });
    state.sim = ctx.sim ?? state.sim;
  } catch (e) {
    state.agent = { error: state.provider === 'ollama'
      ? `Could not reach the local model (${e.message}). Start it with: OLLAMA_ORIGINS=${location.origin} ollama serve`
      : `Claude request failed: ${e.message}` };
  }
  drawPanel();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.parentElement.id === 'mode') { state.mode = t.dataset.v; setSeg('#mode', t); return load(); }
  if (t.parentElement.id === 'quant') { state.cl = Number(t.dataset.v); setSeg('#quant', t); return load(); }
  if (t.dataset.t) { state.tab = t.dataset.t; return drawPanel(); }
  if (t.dataset.ok) return approve(t.dataset.ok.split(','), 'approved');
  if (t.dataset.no) return approve(t.dataset.no.split(','), 'rejected');
  if (t.dataset.approveStage) return approve(timelineItems(state.plan.actions).filter((a) => a.stage === t.dataset.approveStage && !a.approval).flatMap((a) => a.ids), 'approved');
  if (t.dataset.cap) {
    const a = state.raw.actions.find((x) => x.id === t.dataset.cap);
    state.cap = { id: a.id, xml: capAlert({ id: `surgeforce-${state.plan.key}-${a.id}`, sentAt: a.at, onsetAt: a.onsetAt, sectors: a.sectors.map((i) => state.raw.sectors[i]), cells: state.base.cells }) };
    state.tab = 'alerts'; return drawPanel();
  }
  if (t.dataset.q || t.id === 'go') {
    readAgentInputs();
    const q = t.dataset.q ?? $('#ask').value.trim();
    if (q) return askAgent(q);
    return;
  }
  const key = state.plan.key;
  if (t.id === 'send') {
    const text = $('#rep').value.trim().slice(0, 1000);
    if (!text) return;
    state.reports[key] = [...(state.reports[key] ?? []), { text, at: new Date().toISOString() }];
    return load();
  }
  if (t.id === 'sim') { state.reports[key] = [...(state.reports[key] ?? []), ...simulatedFeed(state.raw.sectors)]; return load(); }
  if (t.id === 'clr') { delete state.reports[key]; return load(); }
});
function readAgentInputs() {
  if ($('#ourl')) { state.ollamaUrl = $('#ourl').value.trim(); state.ollamaModel = $('#omodel').value.trim(); }
  if ($('#akey')) state.apiKey = $('#akey').value.trim();
  if ($('#lang')) state.lang = $('#lang').value;
}
document.addEventListener('change', (e) => {
  if (e.target.name === 'prov') { readAgentInputs(); state.provider = e.target.value; drawPanel(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'rep') $('#send').click();
  if (e.key === 'Enter' && e.target.id === 'ask') $('#go').click();
});
const setSeg = (sel, btn) => document.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b === btn));
$('#offline').addEventListener('change', (e) => { state.offline = e.target.value; load(); });
$('#noshow').addEventListener('input', (e) => { $('#noshowOut').textContent = pct(Number(e.target.value)); });
$('#noshow').addEventListener('change', (e) => { state.noShow = Number(e.target.value); load(); });

const [base, hand, calibration, intakeEval] = await Promise.all([getJSON('base.json'), getJSON('hand.json'), getJSON('calibration.json'), getJSON('intake-eval.json').catch(() => null)]);
state.base = { ...base, hand, calibration, intakeEval };
try { state.approvals = new Map(JSON.parse(localStorage.getItem('surgeforce-audit') ?? '[]')); } catch { /* storage off */ }
$('#offline').innerHTML += state.base.stations.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
load();

// on-device AI for report triage loads in the background; rules cover reports until it is ready
(async () => {
  try {
    const tf = await import(TRANSFORMERS);
    tf.env.allowLocalModels = false;
    state.classify = await makeClassifier(await transformersEmbedder(tf));
    state.aiStatus = 'on-device AI ready (multilingual-e5-small)';
    if (state.reports[state.plan?.key]?.length) load();
  } catch (e) { state.aiStatus = `on-device AI unavailable (${e.message.slice(0, 60)}); using rules`; }
  if (state.tab === 'reports') drawPanel();
})();
