/* global L */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const state = { mode: 'replay', cl: 0.1, offline: '', noShow: 0, tab: 'timeline', plan: null, base: null, cap: null, sim: null, sitrep: null, lang: 'en' };
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
const layers = { terrain: L.layerGroup().addTo(map), links: L.layerGroup().addTo(map), marks: L.layerGroup().addTo(map) };
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => {
  const d = L.DomUtil.create('div', 'legend');
  d.innerHTML = '<b>Where water collects (HAND)</b><br><i style="background:#1f6fff"></i>≤ 1 m above nearest drain<br>'
    + '<i style="background:#4fb3ff"></i>1–2.5 m<br><i style="background:#a8d8ff"></i>2.5–4 m<br><i style="background:#ff4d4d"></i>confirmed flooding<br>'
    + '<span style="color:#4fb3ff">━</span> Musi <span style="color:#6f8fb0">─</span> nala &nbsp; ◆ underpass &nbsp; <span style="color:#3ccf91">┅</span> counterpart';
  return d;
};
legend.addTo(map);
const handColor = (h) => (h <= 1 ? '#1f6fff' : h <= 2.5 ? '#4fb3ff' : '#a8d8ff');

function drawMap() {
  const { base, plan } = state;
  Object.values(layers).forEach((l) => l.clearLayers());
  const conf = new Set(plan.sectors.filter((s) => s.confirmed).map((s) => s.id));
  const alpha = 0.25 + 0.6 * plan.city.p2; // terrain glows brighter the likelier drains overflow
  for (const [lat, lon, , h, sector] of base.hand.cells) {
    if (h > 4 && !conf.has(sector)) continue;
    layers.terrain.addLayer(L.rectangle([[lat - 0.0011, lon - 0.0012], [lat + 0.0011, lon + 0.0012]], {
      stroke: false, interactive: false, fillColor: conf.has(sector) ? '#ff4d4d' : handColor(h), fillOpacity: conf.has(sector) ? 0.55 : alpha,
    }));
  }
  base.hand.waterways.forEach((line) => layers.terrain.addLayer(L.polyline(line, { color: '#6f8fb0', weight: 1, opacity: 0.6, interactive: false })));
  base.musi.forEach((line) => layers.marks.addLayer(L.polyline(line, { color: '#4fb3ff', weight: 3, opacity: 0.9 })));
  const closing = new Set(plan.actions.filter((a) => a.kind === 'underpass').map((a) => a.id));
  base.underpasses.forEach((u) => {
    const icon = L.divIcon({ className: '', html: `<div class="up-icon ${closing.has(`close-${u.id}`) ? 'close' : ''}"></div>`, iconSize: [12, 12] });
    layers.marks.addLayer(L.marker(u.pos, { icon }).bindTooltip(`${esc(u.name)} · HAND ${plan.underpassHand[u.id]} m${closing.has(`close-${u.id}`) ? ' · closure planned' : ''}`));
  });
  base.stations.forEach((s, i) => layers.marks.addLayer(L.circleMarker(s.pos, {
    radius: 5, color: '#fff', weight: 1, fillColor: conf.has(i) ? '#ff4d4d' : '#3ccf91', fillOpacity: 1,
  }).bindPopup(() => sectorPopup(i))));
  const shown = plan.pairs.length ? plan.pairs : plan.designated;
  for (const p of shown) {
    const from = plan.donors[p.from].pos, to = plan.sectors[p.to].pos;
    layers.links.addLayer(L.polyline([from, to], { color: ['#3ccf91', '#b48cff', '#f2b544'][p.tier], weight: plan.pairs.length ? 3 : 1.2,
      dashArray: plan.pairs.length ? null : '4 6', opacity: 0.8 })
      .bindTooltip(`${esc(plan.donors[p.from].name)} → ${esc(plan.sectors[p.to].name)}: ${p.people} officers${plan.pairs.length ? ' (active)' : ' (pre-designated)'}`));
  }
}

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
  const m = state.plan.metrics, p = state.plan, c = p.city;
  const k = (l, v, sub, cls = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div><div class="s">${sub}</div></div>`;
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
      ${v ? `<div class="card"><h4>This replay vs what fell</h4><table><tr><th>Day</th><th class="n">Forecast P(≥ 30 mm)</th><th class="n">ERA5 max</th></tr>
        ${v.days.map((d) => `<tr><td>${d.day}</td><td class="n">${pct(d.p)}</td><td class="n">${d.observedMaxMm} mm${d.event ? ' ✓' : ''}</td></tr>`).join('')}</table>
        <div class="muted small">ERA5 is a 25 km reanalysis that smooths cloudbursts; gauge peaks are higher.</div></div>` : ''}`;
  },
  copilot() {
    const r = state.sitrep;
    return `<div class="card"><h4>Situation report</h4><div class="muted small">Written from the plan's facts only. Uses Claude when the server has credentials; otherwise a fixed template. It never changes the plan.</div>
      <div style="display:flex;gap:6px;margin-top:8px"><select id="lang">${[['en', 'English'], ['te', 'Telugu'], ['hi', 'Hindi'], ['ur', 'Urdu']].map(([v, n]) => `<option value="${v}" ${state.lang === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn primary" id="gen">Write sitrep</button></div>
      ${r ? `<pre class="xml" style="white-space:pre-wrap">${esc(r.text)}</pre><div class="muted small">Source: ${esc(r.source)}${r.note ? ` · ${esc(r.note)}` : ''}</div>` : ''}</div>`;
  },
  method() {
    const b = state.base;
    return `<div class="card"><h4>Real data</h4><div class="small">
      • ${b.stations.length} police stations, ${b.fire.length} fire stations, ${b.underpasses.length} road underpasses, the Musi and ${b.hand.waterways.length} nalas/streams from OpenStreetMap<br>
      • ${b.hand.cells.length} cells of 250 m with SRTM-based elevation (AWS Terrarium tiles) and HAND, height above nearest drainage (as in NOAA's National Water Model)<br>
      • Road times between stations from OSRM; in floods, speed falls with water depth (Pregnolato et al. 2017)<br>
      • Live: 122-member ensemble (NCEP GEFS 31, ECMWF ENS 51, DWD ICON-EPS 40) via Open-Meteo<br>
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
    fetch(`/api/sim?key=${state.plan.key}`).then((r) => r.json()).then((sim) => { state.sim = sim; if (state.tab === 'evidence') drawPanel(); });
  }
}

// ---------- data ----------
async function load() {
  const qs = new URLSearchParams({ mode: state.mode, cl: state.cl, offline: state.offline, noShow: state.noShow });
  document.body.style.cursor = 'progress';
  try {
    const res = await fetch(`/api/plan?${qs}`);
    const plan = await res.json();
    if (!res.ok) throw new Error(plan.error);
    state.plan = plan; state.sim = null; state.sitrep = null;
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
  if (t.parentElement.id === 'quant') { state.cl = Number(t.dataset.v); setSeg('#quant', t); return load(); }
  if (t.id === 'gen') {
    state.lang = $('#lang').value; t.disabled = true; t.textContent = 'Writing…';
    state.sitrep = await (await fetch(`/api/sitrep?key=${state.plan.key}&lang=${state.lang}`)).json();
    return drawPanel();
  }
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
