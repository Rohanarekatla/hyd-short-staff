// Terrain flood model input: a 250 m grid with SRTM-based elevation (AWS open Terrarium tiles, z12 ~38 m), OSM nalas/streams/canals,
// and HAND (Height Above Nearest Drainage, Renno et al. 2008; used by NOAA's National Water Model):
// follow steepest descent (D8) from each cell until it reaches a drain or a pit; HAND is the height
// above that end point. Low HAND = water reaches you first. Pits are kept as drainage ends on purpose:
// in a city, closed depressions are where water ponds.  Run: npm run fetch-hand   (~2 minutes)
import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { kmToLine, km, nearest } from '../lib/geo.js';

const base = JSON.parse(await readFile(new URL('../data/base.json', import.meta.url), 'utf8'));
const [S, W, N, E] = base.bbox, DLAT = 0.00225, DLON = 0.00235; // ~250 m
const UA = { 'User-Agent': 'surgeforce-hackathon/0.2 (CipherCop 2026 prototype)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: UA, signal: AbortSignal.timeout(120000) });
    if (res.ok) return res.json();
    if (attempt >= 4) throw new Error(`${res.status} ${url.slice(0, 100)}`);
    await sleep(4000 * attempt);
  }
}

console.log('OSM waterways (nalas, streams, canals, rivers)');
const q = `[out:json][timeout:120];way["waterway"~"^(river|stream|canal|drain|ditch)$"](${S},${W},${N},${E});out geom;`;
let ways;
for (const host of ['overpass-api.de', 'overpass.kumi.systems']) {
  try { ways = (await getJSON(`https://${host}/api/interpreter`, { method: 'POST', body: new URLSearchParams({ data: q }) })).elements; break; }
  catch (e) { console.warn(`${host}: ${e.message.slice(0, 60)}`); }
}
const waterways = ways.map((w) => ({ kind: w.tags.waterway, name: w.tags.name ?? null, line: w.geometry.map((g) => [g.lat, g.lon]) }));

console.log('250 m grid');
const rows = Math.round((N - S) / DLAT), cols = Math.round((E - W) / DLON);
const cells = [];
const index = new Map(); // "r,c" -> cell idx
for (let r = 0; r <= rows; r++) {
  for (let c = 0; c <= cols; c++) {
    const pos = [+(S + r * DLAT).toFixed(5), +(W + c * DLON).toFixed(5)];
    const s = nearest(pos, base.stations, (x) => x.pos);
    if (km(pos, base.stations[s].pos) > 2.5) continue;
    index.set(`${r},${c}`, cells.length);
    cells.push({ r, c, pos, sector: s });
  }
}
console.log(`${cells.length} cells; elevation from Terrarium tiles`);
// minimal PNG decoder for 8-bit RGB/RGBA, non-interlaced (what Terrarium serves)
function decodePng(buf) {
  let pos = 8, w, h, ch, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ch = { 2: 3, 6: 4 }[data[9]]; if (data[8] !== 8 || !ch) throw new Error('unsupported PNG'); }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      const pr = () => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      out[y * stride + x] = (line[x] + [0, a, b, (a + b) >> 1, pr()][f]) & 255;
    }
  }
  return { w, h, ch, px: out };
}
const Z = 12, tiles = new Map();
const tileXY = ([lat, lon]) => {
  const n = 2 ** Z, x = ((lon + 180) / 360) * n, r = (lat * Math.PI) / 180;
  return [x, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};
for (const cell of cells) {
  const [fx, fy] = tileXY(cell.pos), key = `${Math.floor(fx)}/${Math.floor(fy)}`;
  if (!tiles.has(key)) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${key}.png`, { headers: UA });
    if (!res.ok) throw new Error(`tile ${key}: ${res.status}`);
    tiles.set(key, decodePng(Buffer.from(await res.arrayBuffer())));
    process.stdout.write(`${key} `);
  }
  const t = tiles.get(key), px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256));
  const i = (py * t.w + px) * t.ch;
  cell.elev = +(t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768).toFixed(1);
}
console.log('\nHAND');
const near = (p) => waterways.some((w) => kmToLine(p, w.line) <= 0.15);
cells.forEach((cell) => { cell.drain = near(cell.pos); });
const down = cells.map((cell) => { // D8 steepest descent neighbour, or -1 for a drain or a pit
  if (cell.drain) return -1;
  let best = -1, drop = 0;
  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    const j = index.get(`${cell.r + dr},${cell.c + dc}`);
    if (j == null) continue;
    const d = (cell.elev - cells[j].elev) / Math.hypot(dr, dc);
    if (d > drop) { drop = d; best = j; }
  }
  return best;
});
const outlet = new Int32Array(cells.length).fill(-2);
const resolve = (i) => { // iterative walk with memo; path length bounded by the grid
  const path = [];
  while (outlet[i] === -2 && down[i] !== -1 && path.length < 5000) { path.push(i); i = down[i]; }
  const end = outlet[i] >= 0 ? outlet[i] : i;
  outlet[i] = end; path.forEach((p) => { outlet[p] = end; });
  return end;
};
cells.forEach((cell, i) => {
  const o = resolve(i);
  cell.hand = +Math.max(0, cell.elev - cells[o].elev).toFixed(1);
  cell.pit = !cells[o].drain; // drains to a closed depression rather than a nala
});

const out = cells.map(({ pos, elev, hand, sector, drain, pit }) => [pos[0], pos[1], elev, hand, sector, drain ? 1 : 0, pit ? 1 : 0]);
await writeFile(new URL('../data/hand.json', import.meta.url), JSON.stringify({
  columns: ['lat', 'lon', 'elev', 'hand', 'sector', 'drain', 'pit'], cellKm: 0.25, cells: out,
  waterways: waterways.filter((w) => w.kind !== 'river').map((w) => w.line.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)])),
}));
const h = cells.map((c) => c.hand).sort((a, b) => a - b);
console.log(`waterways ${waterways.length}; drains ${cells.filter((c) => c.drain).length}; HAND p10/p50/p90 ${h[Math.floor(h.length * 0.1)]}/${h[Math.floor(h.length * 0.5)]}/${h[Math.floor(h.length * 0.9)]} m`);
