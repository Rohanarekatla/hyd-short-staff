// EOC copilot: turns the current plan into a short situation report for the commander, in English,
// Telugu, Hindi or Urdu. Uses Claude when the optional @anthropic-ai/sdk is installed and credentials
// are set (ANTHROPIC_API_KEY or an `ant auth login` profile); otherwise a deterministic template.
// The model only rewrites facts from the plan JSON; it never decides moves (those stay with the planner
// and the human sign-off).
import { areaOf } from './intake.js';

const LANG = { en: 'English', te: 'Telugu', hi: 'Hindi', ur: 'Urdu' };
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

let client; // lazily created; null when the SDK is not installed
async function getClient() {
  if (client !== undefined) return client;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
  } catch { client = null; }
  return client;
}

export async function sitrep(p, sim, lang = 'en') {
  const f = facts(p, sim);
  const c = await getClient();
  if (!c) return { source: 'template', text: templateSitrep(f) };
  try {
    const res = await c.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low' }, // a short rewrite of given facts
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the request is declined, the API retries on a fallback model in the same call
      system: 'You write situation reports for the commander of the GHMC emergency operations centre in Hyderabad. '
        + 'Use only the facts in the JSON you are given. Never invent numbers, places or orders. Plain text, at most 120 words, '
        + 'most urgent point first, end with the single decision the commander must take now.',
      messages: [{ role: 'user', content: `Write the situation report in ${LANG[lang] ?? 'English'}.\n\n${JSON.stringify(f)}` }],
    });
    if (res.stop_reason === 'refusal') return { source: 'template', text: templateSitrep(f), note: 'model declined' };
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { source: res.model, text: text || templateSitrep(f) };
  } catch (e) {
    return { source: 'template', text: templateSitrep(f), note: `Claude unavailable: ${e.constructor?.name ?? 'error'}` };
  }
}
