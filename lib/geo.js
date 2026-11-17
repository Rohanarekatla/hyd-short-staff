// Small geometry helpers. Points are [lat, lon].
export function km([a1, o1], [a2, o2]) {
  const r = Math.PI / 180, dLat = (a2 - a1) * r, dLon = (o2 - o1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function nearest(p, list, get = (x) => x) {
  let best = -1, bestD = Infinity;
  list.forEach((x, i) => { const d = km(p, get(x)); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

// distance (km) from point to polyline, equirectangular projection (fine at city scale)
export function kmToLine(p, line) {
  const kx = 111.32 * Math.cos((p[0] * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][1] - p[1]) * kx, ay = (line[i - 1][0] - p[0]) * ky;
    const bx = (line[i][1] - p[1]) * kx, by = (line[i][0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

// monotone-chain convex hull, returns closed ring of [lat, lon]
export function hull(points) {
  const p = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (p.length < 3) return [...p, p[0]];
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const half = (pts) => pts.reduce((h, q) => {
    while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
    h.push(q);
    return h;
  }, []);
  const lower = half(p), upper = half([...p].reverse());
  const ring = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return [...ring, ring[0]];
}

export function quantile(xs, q) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}
