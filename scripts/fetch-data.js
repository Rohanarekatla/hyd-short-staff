// Builds the real-data snapshot in data/: OSM police/fire stations, road underpasses and the Musi,
// a 1 km grid with Copernicus DEM elevation, an OSRM road-time matrix, GloFAS Musi thresholds,
// and replay forecasts for past events. Run: npm run fetch-data   (needs internet, ~2 minutes)
import { writeFile } from 'node:fs/promises';
import { km, kmToLine, nearest } from '../lib/geo.js';
import { fetchReplay, EVENTS, LATTICE } from '../lib/weather.js';
import { areaOf } from '../lib/intake.js';

const BBOX = [17.28, 78.28, 17.56, 78.62]; // south, west, north, east: GHMC and inner ORR
const UA = { 'User-Agent': 'surgeforce-hackathon/0.2 (CipherCop 2026 prototype)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (name, obj) => writeFile(new URL(`../data/${name}`, import.meta.url), JSON.stringify(obj));

async function getJSON(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...UA, ...init.headers }, signal: AbortSignal.timeout(120000) });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${url.slice(0, 120)}`);
    await sleep(5000 * attempt);
  }
}

async function overpass(q) { // main instance, then a public mirror
  const init = { method: 'POST', body: new URLSearchParams({ data: `[out:json][timeout:120];${q}` }) };
  try { return await getJSON('https://overpass-api.de/api/interpreter', init); } catch (e) {
    console.warn(`overpass-api.de failed (${e.message.slice(0, 40)}), trying mirror`);
    return getJSON('https://overpass.kumi.systems/api/interpreter', init);
  }
}
const center = (e) => (e.center ? [e.center.lat, e.center.lon] : [e.lat, e.lon]);
const bb = BBOX.join(',');

console.log('OSM: police and fire stations');
const services = (await overpass(`nwr["amenity"~"^(police|fire_station)$"](${bb});out center tags;`)).elements;
const seen = new Set();
const stations = services
  .filter((e) => e.tags.amenity === 'police' && /police station|traffic| ps\b/i.test(e.tags.name || '')
    && !/commission|office|outpost|headquarter|booth|tower/i.test(e.tags.name))
  .map((e) => ({ name: e.tags.name.replace(/\s+/g, ' ').trim(), pos: center(e) }))
  .filter((s) => areaOf(s.name).length >= 3) // drop generic names ("Police station") that can't be placed
  .filter((s) => { const k = s.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
  .map((s, id) => ({ id, ...s }));
const fire = services.filter((e) => e.tags.amenity === 'fire_station')
  .map((e, id) => ({ id, name: e.tags.name || 'Fire station', pos: center(e) }));

console.log('OSM: road underpasses');
const under = (await overpass(`(way["highway"~"^(trunk|primary|secondary|tertiary|residential|unclassified)$"]["tunnel"="yes"](${bb});`
  + `way["highway"~"^(trunk|primary|secondary|tertiary)$"]["layer"~"^-"](${bb}););out center tags;`)).elements;
const underpasses = [];
for (const e of under) { // merge carriageway pieces of the same underpass (within 250 m)
  const pos = center(e), name = e.tags.name || `Underpass on ${e.tags.highway} road`;
  if (underpasses.some((u) => km(u.pos, pos) < 0.25)) continue;
  underpasses.push({ id: underpasses.length, name, road: e.tags.highway, pos });
}

console.log('OSM: Musi river');
const musiWays = (await overpass(`way["waterway"="river"]["name"~"Musi|Moosi",i](${bb});out geom;`)).elements;
const musi = musiWays.map((w) => w.geometry.map((g) => [g.lat, g.lon]));

console.log('Grid and DEM elevation');
const cells = [];
for (let lat = BBOX[0]; lat <= BBOX[2]; lat += 0.009) {
  for (let lon = BBOX[1]; lon <= BBOX[3]; lon += 0.0094) {
    const pos = [+lat.toFixed(4), +lon.toFixed(4)];
    const s = nearest(pos, stations, (x) => x.pos);
    if (km(pos, stations[s].pos) <= 2.5) cells.push({ pos, sector: s });
  }
}
for (let i = 0; i < cells.length; i += 100) {
  const chunk = cells.slice(i, i + 100);
  const r = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((c) => c.pos[0])}&longitude=${chunk.map((c) => c.pos[1])}`);
  r.elevation.forEach((e, j) => { chunk[j].elev = e; });
  await sleep(300);
}
for (const c of cells) { // depression: how far below its 2 km neighbourhood this cell sits
  const ring = cells.filter((o) => o !== c && km(o.pos, c.pos) <= 2);
  c.dep = +(c.elev - ring.reduce((s, o) => s + o.elev, 0) / Math.max(1, ring.length)).toFixed(1);
  c.musiKm = musi.length ? +Math.min(...musi.map((l) => kmToLine(c.pos, l))).toFixed(2) : 99;
}
underpasses.forEach((u) => { u.sector = nearest(u.pos, stations, (x) => x.pos); });

console.log('OSRM road travel times between stations');
const coords = stations.map((s) => `${s.pos[1]},${s.pos[0]}`).join(';');
const table = await getJSON(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`);
const travel = table.durations.map((row) => row.map((sec) => (sec == null ? null : Math.round(sec / 60))));

console.log('GloFAS: Musi discharge climatology');
const clim = await getJSON('https://flood-api.open-meteo.com/v1/flood?latitude=17.37&longitude=78.48&daily=river_discharge&start_date=1990-01-01&end_date=2023-12-31');
const q = clim.daily.river_discharge.filter((x) => x != null).sort((a, b) => a - b);
const musiThresholds = { p95: q[Math.floor(q.length * 0.95)], p99: q[Math.floor(q.length * 0.99)], max: q.at(-1) };

await save('base.json', { bbox: BBOX, fetchedAt: new Date().toISOString(), stations, fire, underpasses, musi, cells, travel, musiThresholds });
console.log(`stations ${stations.length}, fire ${fire.length}, underpasses ${underpasses.length}, cells ${cells.length}`);

for (const ev of EVENTS) {
  console.log(`Replay forecasts for ${ev.id}`);
  await save(`replay/${ev.id}.json`, await fetchReplay(ev, getJSON));
}
console.log('lattice', LATTICE.length, 'points. Done.');
