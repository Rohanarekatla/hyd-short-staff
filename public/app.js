/* global L */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const state = { mode: 'replay', q: 0.8, offline: '', noShow: 0, tab: 'timeline', plan: null, base: null, cap: null };
const KIND = { bundle: 'Sector', standby: 'EOC', counterpart: 'Counterpart', met: 'MET', drf: 'DRF', fire: 'Fire', volunteers: 'Volunteers', underpass: 'Underpass', alert: 'CAP alert', relief: 'Relief', musi: 'Musi' };
const TIER = ['City counterpart', 'District counterpart', 'State reserve'];
const fmt = (t) => t && new Date(`${t}:00Z`).toLocaleString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const area = (n) => n.replace(/\b(traffic\s+)?police\s+station\b|\bpolice\b/gi, '').trim();
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------- map ----------
const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([17.41, 78.46], 11);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri · data &copy; OpenStreetMap contributors', maxZoom: 16,
}).addTo(map);
const layers = { cells: L.layerGroup().addTo(map), links: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map) };
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => {
  const d = L.DomUtil.create('div', 'legend');
  d.innerHTML = '<b>Chance of drains overwhelmed</b><br><i style="background:#ff4d4d"></i>≥ 60%<br><i style="background:#ff9a3c"></i>30–60%<br>'
    + '<i style="background:#f2d24b"></i>10–30%<br><i style="background:#2b3d50"></i>&lt; 10%<br>'
    + '<span style="color:#4fb3ff">━</span> Musi &nbsp; ◆ underpass &nbsp; <span style="color:#3ccf91">┅</span> counterpart';
  return d;
};
legend.addTo(map);
const riskColor = (p) => (p >= 0.6 ? '#ff4d4d' : p >= 0.3 ? '#ff9a3c' : p >= 0.1 ? '#f2d24b' : '#2b3d50');

function drawMap() {
  const { base, plan } = state;
  Object.values(layers).forEach((l) => l.clearLayers());
  const sec = plan.sectors;
  for (const c of base.cells) {
    const s = sec[c.sector];
    const r = L.rectangle([[c.pos[0] - 0.0045, c.pos[1] - 0.0047], [c.pos[0] + 0.0045, c.pos[1] + 0.0047]], {
      stroke: false, fillColor: riskColor(s.p2), fillOpacity: c.dep <= base.assumptions.depLowM ? 0.75 : 0.45,
    });
    r.bindPopup(() => sectorPopup(s, c));
    layers.cells.addLayer(r);
  }
  base.musi.forEach((line) => layers.marks.addLayer(L.polyline(line, { color: '#4fb3ff', weight: 3, opacity: 0.9 })));
  const closing = new Set(plan.actions.filter((a) => a.kind === 'underpass').map((a) => a.id));
  base.underpasses.forEach((u) => {
    const icon = L.divIcon({ className: '', html: `<div class="up-icon ${closing.has(`close-${u.id}`) ? 'close' : ''}"></div>`, iconSize: [12, 12] });
    layers.marks.addLayer(L.marker(u.pos, { icon }).bindTooltip(`${esc(u.name)}${closing.has(`close-${u.id}`) ? ' · closure planned' : ''}`));
  });
  base.stations.forEach((s, i) => layers.marks.addLayer(L.circleMarker(s.pos, {
    radius: 4, color: '#fff', weight: 1, fillColor: plan.sectors[i].confirmed ? '#ff4d4d' : '#4fb3ff', fillOpacity: 1,
  }).bindTooltip(`${esc(s.name)} · ${plan.avail[i]} deployable`)));
  for (const p of plan.pairs) {
    const from = plan.donors[p.from].pos, to = plan.sectors[p.to].pos;
    layers.links.addLayer(L.polyline([from, to], { color: ['#3ccf91', '#b48cff', '#f2b544'][p.tier], weight: 1.5 + Math.min(4, p.people / 4), dashArray: '6 6', opacity: 0.85 })
      .bindTooltip(`${esc(plan.donors[p.from].name)} → ${esc(plan.sectors[p.to].name)}: ${p.people} officers`));
  }
}

function sectorPopup(s, c) {
  const need = Object.entries(s.need).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none';
  return `<b>${esc(s.name)}</b><br>Floods (any level): ${pct(s.p1)} · drains overwhelmed: ${pct(s.p2)} · flash flood: ${pct(s.p3)}<br>`
    + `Peak 24 h rain: ${s.peakRain24.p50} mm median, ${s.peakRain24.p90} mm (P90)<br>`
    + `Onset: ${s.onset == null ? 'not expected' : fmt(addH(state.plan.t0, s.onset))}<br>`
    + `Need at ${state.plan.q ? `P${Math.round(state.plan.q * 100)}` : ''}: ${need}<br>`
    + `<span class="muted small">This cell: ${c.elev} m, ${c.dep > 0 ? '+' : ''}${c.dep} m vs 2 km around${c.musiKm <= 0.6 ? ', Musi bank' : ''}</span>`;
}
const addH = (t0, h) => new Date(Date.parse(`${t0}:00Z`) + h * 3600e3).toISOString().slice(0, 16);

// ---------- fan chart ----------
function drawFan() {
  const f = state.plan.forecast, svg = $('#fan');
  const cum = (xs) => xs.reduce((a, v, i) => (a.push((a[i - 1] ?? 0) + v), a), []);
  const series = f.cityHourly.map(cum), obs = f.observedHourly ? cum(f.observedHourly) : null;
  const H = f.times.length, max = Math.max(10, ...series.map((s) => s.at(-1)), ...(obs ? [obs.at(-1)] : []));
  const x = (h) => (h / (H - 1)) * 590 + 5, y = (v) => 140 - (v / max) * 130;
  const path = (s) => s.map((v, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const days = f.times.map((t, h) => (t.endsWith('T00:00') ? h : -1)).filter((h) => h > 0);
  svg.innerHTML = days.map((h) => `<line x1="${x(h)}" x2="${x(h)}" y1="5" y2="140" stroke="#1f2c3a"/>`
    + `<text x="${x(h) + 3}" y="14" fill="#8295a8" font-size="9">${fmt(f.times[h]).split(',')[0]}</text>`).join('')
    + series.map((s) => `<path d="${path(s)}" fill="none" stroke="#4fb3ff" stroke-opacity="${Math.max(0.12, 1.5 / Math.sqrt(series.length))}" stroke-width="1.2"/>`).join('')
    + (obs ? `<path d="${path(obs)}" fill="none" stroke="#ffffff" stroke-width="2.2"/>` : '')
    + `<text x="8" y="${y(max) + 10}" fill="#8295a8" font-size="9">${Math.round(max)} mm</text>`;
  const finals = series.map((s) => s.at(-1)).sort((a, b) => a - b);
  $('#fanNote').textContent = `${f.members.length} members · 72 h city total: ${Math.round(finals[0])}–${Math.round(finals.at(-1))} mm`
    + (obs ? ` · white = what actually fell (ERA5): ${Math.round(obs.at(-1))} mm` : '');
}

// ---------- KPIs ----------
function drawKpis() {
  const m = state.plan.metrics, p = state.plan;
  const k = (l, v, s, cls = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
  const team = (t, name) => k(name, `${t.sent}/${t.need}`, t.unmet ? `${t.unmet} short` : 'fully covered', t.unmet ? 'bad' : t.need ? 'good' : '');
  $('#kpis').innerHTML = k('Sectors expected to flood', `${m.sectorsAtRisk}/${p.sectors.length}`, `${m.members} forecasts · plan at P${Math.round(p.q * 100)}`, m.sectorsAtRisk ? 'bad' : 'good')
    + k('Officers via counterparts', `${m.police.paired}/${m.police.need}`, m.police.unmet ? `${m.police.unmet} short` : `${p.pairs.length} pairs`, m.police.unmet ? 'bad' : m.police.need ? 'good' : '')
    + team(m.met, 'Monsoon Emergency Teams') + team(m.drf, 'DRF rescue teams') + team(m.volunteers, 'Volunteers')
    + k('Underpasses to close', m.underpassesClosed, 'before water arrives')
    + k('Actions', p.actions.length, m.lateActions ? `${m.lateActions} already late` : 'all on time', m.lateActions ? 'bad' : '');
  const b = $('#banner');
  b.hidden = !p.stale && !(p.mode === 'live' && !m.sectorsAtRisk);
  b.textContent = p.stale || `Live: no sector reaches flood level in the next 72 h across all ${m.members} forecasts (issued ${new Date(p.issuedAt).toLocaleString('en-IN')}). Switch to Replay to see a real event.`;
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
    const rows = p.pairs.map((x) => `<tr><td>${esc(p.donors[x.from].name)}<div class="muted small">${TIER[x.tier]}${x.continuity ? ' · kept' : ''}</div></td>
      <td>${esc(p.sectors[x.to].name)}<div class="muted small">drains overwhelmed ${pct(p.sectors[x.to].p2)}</div></td><td class="n">${x.people}</td><td class="n">${x.minutes}′</td></tr>`).join('');
    const dist = p.donors.filter((d) => d.tier === 1).map((d) => `${esc(d.name.replace(/ district police| police commissionerate/i, ''))}: <b class="${d.dry ? '' : 'muted'}">${d.dry ? 'dry, can lend' : 'wet, keeps its own'}</b>`).join(' · ');
    return `<div class="card"><h4>How pairing works</h4><div class="muted small">Each short station gets one counterpart, as in Japan's 対口支援 (used after Noto 2024), not staff from ten places.
      First choice is a dry city station that keeps 60% of its own strength, then a dry neighbouring district, then the TSSP reserve. Pairs are kept across re-plans, so officers learn the ground.</div>
      <div class="small" style="margin-top:6px">${dist}</div></div>
      ${p.pairs.length ? `<table><tr><th>Donor</th><th>Receives</th><th class="n">Officers</th><th class="n">Travel</th></tr>${rows}</table>` : '<p class="muted">No station is short of officers at this planning level.</p>'}
      ${p.policeUnmet.length ? `<p class="muted">Still short: ${p.policeUnmet.map(([i, n]) => `${esc(p.sectors[i].name)} (${n})`).join(', ')}</p>` : ''}`;
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
    }).join('') + '<p class="muted small">Teams go where risk-weighted need is highest, at least travel time (min-cost flow). NDRF is only requested when local DRF runs out; it needs about 5.5 h to arrive.</p>';
  },
  reports() {
    const p = state.plan;
    const rows = p.reports.slice().reverse().map((r) => `<tr><td>${esc(r.text)}${r.simulated ? ' <span class="badge">sim</span>' : ''}</td>
      <td><span class="badge ${r.route === 'human' ? 'late' : r.route === 'ai_answered' ? 'ok' : ''}">${r.category.replace('_', ' ')}</span><div class="muted small">${r.route.replace('_', ' ')}</div></td>
      <td>${r.sector == null ? '<span class="muted">unplaced</span>' : esc(area(p.sectors[r.sector].name))}${r.dupOf != null ? '<div class="muted small">duplicate</div>' : ''}</td></tr>`).join('');
    return `<div class="card"><h4>Citizen reports (WhatsApp / 1070)</h4>
      <div class="muted small">Like Japan's SOCDA chatbot: each report is triaged, placed by area name and merged with duplicates. A rescue or medical report confirms flooding in that sector and re-plans it immediately. Life-threatening reports always go to a human.</div>
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
  method() {
    const p = state.plan, b = state.base, v = p.verification;
    return `${v ? `<div class="card"><h4>Replay check against what actually fell</h4><div class="small">${v.flagged} sectors flagged at P${Math.round(p.q * 100)};
      ${v.hits} of them saw flood-level rain (ERA5). ${v.observedSectors} sectors did, and ${v.missed} were missed. Max city-point rain: ${v.observedMaxMm} mm.</div>
      <div class="muted small">ERA5 is a 25 km reanalysis that smooths cloudbursts, so the real peaks were higher (IMD Begumpet logged far more in Oct 2020 than ERA5 shows).</div></div>` : ''}
      <div class="card"><h4>Real data</h4><div class="small">
      • ${b.stations.length} police stations, ${b.fire.length} fire stations, ${b.underpasses.length} road underpasses and the Musi from OpenStreetMap<br>
      • ${b.cells.length} one-km cells with Copernicus DEM elevation; "low-lying" means 8 m or more below the 2 km neighbourhood<br>
      • Road times between stations from OSRM (OpenStreetMap routing), ×1.5 in rain<br>
      • Live: 122-member ensemble (NCEP GEFS 31, ECMWF ENS 51, DWD ICON-EPS 40) via Open-Meteo<br>
      • Replay: what 6 global models forecast 1–3 days before 31 Aug 2024 (Open-Meteo Previous Runs)<br>
      • Musi: GloFAS discharge vs its 1990–2023 95th/99th percentile (${Math.round(b.musiThresholds.p95)} / ${Math.round(b.musiThresholds.p99)} m³/s)<br>
      • Team counts from the GHMC/HYDRAA 2025 plan: 150 METs × 12, 51 DRF teams × 15</div></div>
      <div class="card"><h4>Synthetic (swap for duty rosters)</h4><div class="small muted">Deployable officers per station (vacancy 22% applied), team placement by zone, volunteer pools, district reserves, citizen reports marked "sim".</div></div>
      <div class="card"><h4>Severity triggers</h4><div class="small">Level 1/2/3 when 1 h, 3 h or 24 h rain exceeds
      ${b.assumptions.triggers.map((t, i) => `<br>L${i + 1}: ${t[0]} mm/h · ${t[1]} mm/3 h · ${t[2]} mm/24 h`).join('')}
      <div class="muted">24 h values are IMD's heavy, very heavy and extremely heavy categories. 1 h values bracket GHMC's stated drain capacity of 12–20 mm/h.</div></div></div>`;
  },
};

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
}

// ---------- data ----------
async function load() {
  const qs = new URLSearchParams({ mode: state.mode, q: state.q, offline: state.offline, noShow: state.noShow });
  document.body.style.cursor = 'progress';
  try {
    const res = await fetch(`/api/plan?${qs}`);
    const plan = await res.json();
    if (!res.ok) throw new Error(plan.error);
    state.plan = plan;
    drawKpis(); drawMap(); drawFan(); drawPanel();
  } catch (e) {
    $('#banner').hidden = false; $('#banner').textContent = `Could not build the plan: ${e.message}`;
  } finally { document.body.style.cursor = ''; }
}

async function approve(ids, decision) {
  await fetch('/api/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: state.plan.key, ids, decision, by: 'Commander, GHMC EOC' }) });
  load();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.parentElement.id === 'mode') { state.mode = t.dataset.v; setSeg('#mode', t); return load(); }
  if (t.parentElement.id === 'quant') { state.q = Number(t.dataset.v); setSeg('#quant', t); return load(); }
  if (t.dataset.t) { state.tab = t.dataset.t; return drawPanel(); }
  if (t.dataset.ok) return approve(t.dataset.ok.split(','), 'approved');
  if (t.dataset.no) return approve(t.dataset.no.split(','), 'rejected');
  if (t.dataset.approveStage) return approve(timelineItems(state.plan.actions).filter((a) => a.stage === t.dataset.approveStage && !a.approval).flatMap((a) => a.ids), 'approved');
  if (t.dataset.cap) {
    const xml = await (await fetch(`/api/cap?key=${state.plan.key}&id=${t.dataset.cap}`)).text();
    state.cap = { id: t.dataset.cap, xml }; state.tab = 'alerts'; return drawPanel();
  }
  if (t.id === 'send') {
    const text = $('#rep').value.trim();
    if (!text) return;
    await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, key: state.plan.key }) });
    return load();
  }
  if (t.id === 'sim') { await fetch(`/api/reports/simulate?key=${state.plan.key}`, { method: 'POST' }); return load(); }
  if (t.id === 'clr') { await fetch(`/api/reports?key=${state.plan.key}`, { method: 'DELETE' }); return load(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'rep') $('#send').click(); });
const setSeg = (sel, btn) => document.querySelectorAll(`${sel} button`).forEach((b) => b.classList.toggle('on', b === btn));
$('#offline').addEventListener('change', (e) => { state.offline = e.target.value; load(); });
$('#noshow').addEventListener('input', (e) => { $('#noshowOut').textContent = pct(Number(e.target.value)); });
$('#noshow').addEventListener('change', (e) => { state.noShow = Number(e.target.value); load(); });

state.base = await (await fetch('/api/base')).json();
$('#offline').innerHTML += state.base.stations.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
load();
