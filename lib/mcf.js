// Min-cost flow by successive shortest paths (Bellman-Ford, so negative "reward" arcs are allowed).
// Stops as soon as the cheapest path no longer lowers total cost, so unprofitable demand stays unmet.
// Integral capacities give integral flows: whole teams, no rounding.
export function minCostFlow(nodeCount, arcs, source, sink) {
  const g = Array.from({ length: nodeCount }, () => []);
  const edges = [];
  for (const a of arcs) {
    const fwd = { to: a.to, cap: a.cap, cost: a.cost, flow: 0, arc: a };
    const rev = { to: a.from, cap: 0, cost: -a.cost, flow: 0, arc: null };
    fwd.rev = rev; rev.rev = fwd;
    g[a.from].push(fwd); g[a.to].push(rev); edges.push(fwd);
  }
  let total = 0;
  for (;;) {
    const dist = Array(nodeCount).fill(Infinity), prev = Array(nodeCount).fill(null);
    dist[source] = 0;
    for (let i = 0, changed = true; changed && i < nodeCount; i++) {
      changed = false;
      for (let u = 0; u < nodeCount; u++) {
        if (dist[u] === Infinity) continue;
        for (const e of g[u]) {
          if (e.cap - e.flow > 0 && dist[u] + e.cost < dist[e.to] - 1e-9) {
            dist[e.to] = dist[u] + e.cost; prev[e.to] = e; changed = true;
          }
        }
      }
    }
    if (dist[sink] === Infinity || dist[sink] >= 0) break;
    let push = Infinity;
    for (let v = sink; v !== source; v = prev[v].rev.to) push = Math.min(push, prev[v].cap - prev[v].flow);
    for (let v = sink; v !== source; v = prev[v].rev.to) { prev[v].flow += push; prev[v].rev.flow -= push; }
    total += push * dist[sink];
  }
  return { cost: total, flows: edges.filter((e) => e.flow > 0).map((e) => ({ ...e.arc, flow: e.flow })) };
}
