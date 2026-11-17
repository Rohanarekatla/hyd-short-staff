// Fallback situation report when no AI provider is connected: the plan's facts in a fixed template.
// With a provider, the EOC agent (lib/ai/agent.js) writes the report from the same tools.
import { areaOf } from './intake.js';

const pct = (x) => `${Math.round(x * 100)}%`;

export function facts(p, sim) {
  const top = [...p.sectors].sort((a, b) => b.vulnerability - a.vulnerability).slice(0, 6);
  return {
    issued: p.t0, cityProbability: p.city.p1, drainsOverwhelmedProbability: p.city.p2, actThreshold: p.city.costLoss,
    onsetHour: p.city.onset, dailyOutlook: p.city.outlook.map(({ day, p: prob, p50, p90 }) => ({ day, prob, p50, p90 })),
    mostExposedAreas: top.map((s) => ({ area: areaOf(s.name), floodedKm2AtSev2: s.flooded[2], lowUnderpasses: s.lowUnderpasses })),
    confirmedAreas: p.sectors.filter((s) => s.confirmed).map((s) => areaOf(s.name)),
    staged: Object.fromEntries(['met', 'drf', 'volunteers'].map((k) => [k, p.metrics[k]])),
    counterpartsDesignated: p.metrics.designated, counterpartsActive: p.metrics.activePairs,
    underpassClosures: p.metrics.underpassesClosed,
    musiActions: p.actions.filter((a) => a.kind === 'musi').map((a) => a.title),
    simulation: sim ? { rescueWithin30: { reactive: sim.reactive.drf.within30, surgeforce: sim.surgeforce.drf.within30 } } : null,
  };
}

export function templateSitrep(f) {
  const lines = [
    `SITREP ${f.issued}. Chance of flood-level rain somewhere in Hyderabad: ${pct(f.cityProbability)} (act at ${pct(f.actThreshold)}).`,
    f.onsetHour == null ? 'No activation needed.' : `Expected onset: +${f.onsetHour} h. EOC activated.`,
    `Most exposed: ${f.mostExposedAreas.map((a) => a.area).join(', ')}.`,
    f.confirmedAreas.length ? `Flooding confirmed in: ${f.confirmedAreas.join(', ')}.` : 'No confirmed flooding yet.',
    `Staged: ${f.staged.met.sent} METs, ${f.staged.drf.sent} DRF teams, ${f.staged.volunteers.sent} volunteers. ${f.underpassClosures} underpass closures ordered. ${f.counterpartsDesignated} counterpart pairs on standby, ${f.counterpartsActive} active.`,
    ...f.musiActions,
  ];
  if (f.simulation) lines.push(`Simulated rescues reached within 30 min: ${pct(f.simulation.rescueWithin30.surgeforce)} (vs ${pct(f.simulation.rescueWithin30.reactive)} without staging).`);
  return lines.join('\n');
}
