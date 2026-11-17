// EOC agent: an LLM that answers the commander by calling SurgeForce's tested tools.
// Design follows the DORA benchmark (NeurIPS 2026): LLM agents fail mostly on tool selection and argument
// grounding over long pipelines, so the agent gets few, well-described tools over a deterministic planner,
// every number comes from a tool result, every call is shown, and it cannot approve or dispatch anything.
// Providers: Claude (Anthropic SDK, best quality) or a local model through Ollama (sovereign / offline).
import { areaOf, triage } from '../intake.js';
import { plan as runPlan } from '../planner.js';
import { simulate } from '../sim.js';
import { ALERT_TEXT } from '../cap.js';

const pct = (x) => Math.round(x * 100);

export const TOOLS = [
  { name: 'get_situation', description: 'Current city-wide picture: probability of flood-level rain, onset time, daily outlook, what is staged, counterparts, underpass closures, confirmed areas, Musi river alerts. Call this first.',
    schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_area', description: 'Details for one police-station area by name (e.g. "Uppal"): flood-prone ground, underpasses, what it needs if hit, what is staged there, its counterpart.',
    schema: { type: 'object', properties: { area: { type: 'string', description: 'Area or police station name' } }, required: ['area'], additionalProperties: false } },
  { name: 'what_if_flooded', description: 'What changes if these areas are confirmed flooded (as if a citizen report came in). Does not change the live plan.',
    schema: { type: 'object', properties: { areas: { type: 'array', items: { type: 'string' }, description: 'Area names, e.g. ["Uppal"]' } }, required: ['areas'], additionalProperties: false } },
  { name: 'what_if_threshold', description: 'What changes if the commander uses a different false-alarm/miss cost ratio. Only use when the commander asks about caution or cost.',
    schema: { type: 'object', properties: { cost_loss: { type: 'number', description: '0.05 (very cautious) to 0.5' } }, required: ['cost_loss'], additionalProperties: false } },
  { name: 'what_if_offline', description: 'What changes if one police station is out of action. Only use when the commander asks about a station being unavailable.',
    schema: { type: 'object', properties: { area: { type: 'string' } }, required: ['area'], additionalProperties: false } },
  { name: 'simulate_response', description: 'Monte Carlo response simulation: share of rescues reached within 30 minutes with staging vs teams waiting at depots.',
    schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'list_reports', description: 'Citizen reports received so far, with AI triage category, area, and whether a human must handle it.',
    schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'draft_public_alert', description: 'Draft the public alert text (headline and instruction) for named areas in en, te, hi or ur. It is a draft for the commander to approve.',
    schema: { type: 'object', properties: { areas: { type: 'array', items: { type: 'string' } }, language: { type: 'string', enum: ['en', 'te', 'hi', 'ur'] } }, required: ['areas'], additionalProperties: false } },
];

const LANG = { en: 'English', te: 'Telugu', hi: 'Hindi', ur: 'Urdu' };
export const SYSTEM = (lang) => `You are the duty officer's assistant in the GHMC flood emergency operations centre, Hyderabad.
Answer the commander's question using the tools. Every number, place and time you state must come from a tool result; if no tool gives it, say you don't know.
You cannot approve, dispatch or send anything: say what the commander should approve. Be brief: at most 120 words, most urgent point first. Answer in ${LANG[lang] ?? 'English'}.`;

// ctx: { base, hand, forecast, plan, opts, reports, ai } -> tool executor
export function makeTools(ctx) {
  const findSector = (name) => {
    const n = String(name ?? '').toLowerCase().trim();
    return ctx.plan.sectors.find((s) => areaOf(s.name).toLowerCase() === n)
      ?? ctx.plan.sectors.find((s) => s.name.toLowerCase().includes(n) || (n.length >= 4 && n.includes(areaOf(s.name).toLowerCase())));
  };
  const summary = (p) => ({
    floodRainProbability: `${pct(p.city.p1)}%`, actThreshold: `${pct(p.city.costLoss)}%`,
    onset: p.city.onset == null ? 'not expected' : p.actions.find((a) => a.id === 'standby')?.onsetAt,
    stagedMETs: p.metrics.met.sent, stagedDRF: p.metrics.drf.sent, drfShort: p.metrics.drf.unmet, volunteers: p.metrics.volunteers.sent,
    counterpartsDesignated: p.metrics.designated, counterpartsActive: p.metrics.activePairs, policeStillShort: p.metrics.policeShort,
    underpassClosures: p.metrics.underpassesClosed, lateActions: p.metrics.lateActions,
  });
  // small models often send ["a"] as the string "['a']" or "a, b": repair instead of failing (argument grounding)
  const list = (v) => (Array.isArray(v) ? v : String(v ?? '').replace(/[[\]'"]/g, '').split(',').map((x) => x.trim()).filter(Boolean));
  const whatIf = ({ confirm = [], costLoss, offline }) => {
    const opts = { ...ctx.opts, confirmed: new Set(ctx.opts.confirmed ?? []), offline: new Set(ctx.opts.offline ?? []) };
    const unknown = [];
    if (Number.isFinite(costLoss)) opts.costLoss = Math.min(0.5, Math.max(0.05, costLoss));
    if (offline) { const s = findSector(offline); if (s) opts.offline.add(s.id); else unknown.push(offline); }
    for (const a of confirm) { const s = findSector(a); if (s) opts.confirmed.add(s.id); else unknown.push(a); }
    const alt = runPlan(ctx.base, ctx.hand, ctx.forecast, opts);
    const changed = Object.fromEntries(Object.entries(summary(alt)).filter(([k, v]) => summary(ctx.plan)[k] !== v)
      .map(([k, v]) => [k, { now: summary(ctx.plan)[k], then: v }]));
    const activated = alt.pairs.map((p) => `${alt.donors[p.from].name} sends ${p.people} officers to ${alt.sectors[p.to].name}`);
    return { changed, activatedCounterparts: activated, unknownAreas: unknown };
  };
  return {
    get_situation: () => ({ ...summary(ctx.plan),
      dailyOutlook: ctx.plan.city.outlook.map((o) => ({ day: o.day, chanceOf30mmAnywhere: `${pct(o.p)}%`, medianMm: o.p50, p90Mm: o.p90 })),
      confirmedAreas: ctx.plan.sectors.filter((s) => s.confirmed).map((s) => areaOf(s.name)),
      mostExposed: [...ctx.plan.sectors].sort((a, b) => b.vulnerability - a.vulnerability).slice(0, 5).map((s) => areaOf(s.name)),
      musi: ctx.plan.actions.filter((a) => a.kind === 'musi').map((a) => a.title) }),
    get_area: ({ area }) => {
      const s = findSector(area);
      if (!s) return { error: `No area matching "${area}". Known areas include ${ctx.plan.sectors.slice(0, 8).map((x) => areaOf(x.name)).join(', ')}.` };
      const pb = ctx.plan.playbook[s.id];
      return { station: s.name, confirmed: s.confirmed, floodProneKm2: { severity1: s.flooded[1], severity2: s.flooded[2], severity3: s.flooded[3] },
        underpasses: s.underpasses, lowGroundUnderpasses: s.lowUnderpasses, officersDeployable: s.avail, needsIfHit: pb.ifHit, stagedHere: pb.stagedHere, counterpart: pb.counterpart };
    },
    what_if_flooded: ({ areas }) => whatIf({ confirm: list(areas) }),
    what_if_threshold: ({ cost_loss }) => whatIf({ costLoss: Number(cost_loss) }),
    what_if_offline: ({ area }) => whatIf({ offline: String(area) }),
    simulate_response: () => {
      const s = ctx.sim ?? (ctx.sim = simulate(ctx.base, ctx.forecast, ctx.plan, { runs: 80 }));
      return { simulatedStorms: s.eventRuns, rescuesWithin30Min: { teamsAtDepots: `${pct(s.reactive.drf.within30)}%`, withStaging: `${pct(s.surgeforce.drf.within30)}%` },
        rescueP90Minutes: { teamsAtDepots: s.reactive.drf.p90, withStaging: s.surgeforce.drf.p90 }, note: 'incident rates are synthetic' };
    },
    list_reports: () => triage(ctx.reports ?? [], ctx.base.stations, ctx.base.underpasses, ctx.ai)
      .map((r) => ({ text: r.text, category: r.category, area: r.sector == null ? null : areaOf(ctx.plan.sectors[r.sector].name), handledBy: r.route, duplicate: r.dupOf != null })),
    draft_public_alert: ({ areas, language = 'en' }) => {
      const names = list(areas).map((a) => findSector(a)).filter(Boolean).map((s) => areaOf(s.name));
      if (!names.length) return { error: 'none of those areas are known' };
      return { language, ...(ALERT_TEXT[{ en: 'en-IN', te: 'te-IN', hi: 'hi-IN', ur: 'ur-IN' }[language] ?? 'en-IN'](names.join(', '))), status: 'draft, needs commander approval' };
    },
  };
}

function execTool(tools, name, args) {
  try {
    if (!tools[name]) return { error: `unknown tool ${name}` };
    return tools[name](typeof args === 'string' ? JSON.parse(args || '{}') : (args ?? {}));
  } catch (e) { return { error: e.message }; }
}

// provider: { kind: 'claude', client } | { kind: 'ollama', url, model }. Returns { text, steps, model }.
export async function runAgent({ provider, question, ctx, lang = 'en', maxSteps = 6 }) {
  const tools = makeTools(ctx), steps = [];
  if (provider.kind === 'claude') {
    const messages = [{ role: 'user', content: question }];
    for (let i = 0; i < maxSteps; i++) {
      const res = await provider.client.beta.messages.create({
        model: 'claude-opus-5-5', max_tokens: 8000, output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', // on a policy decline, the API retries on a fallback model
        system: SYSTEM(lang), tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })), messages,
      });
      if (res.stop_reason === 'refusal') return { text: 'The model declined this request.', steps, model: res.model };
      messages.push({ role: 'assistant', content: res.content }); // full content: thinking blocks must be passed back
      const calls = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !calls.length) {
        return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), steps, model: res.model };
      }
      messages.push({ role: 'user', content: calls.map((c) => {
        const out = execTool(tools, c.name, c.input);
        steps.push({ tool: c.name, args: c.input, result: out });
        return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out), is_error: !!out?.error };
      }) });
    }
    return { text: 'Stopped after too many steps.', steps, model: 'claude-opus-5-5' };
  }
  // Ollama chat API with tools (Llama 3.1 and similar)
  const messages = [{ role: 'system', content: SYSTEM(lang) }, { role: 'user', content: question }];
  for (let i = 0; i < maxSteps; i++) {
    const res = await fetch(`${provider.url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model, messages, stream: false, options: { temperature: 0 },
        tools: TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) }) });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const msg = (await res.json()).message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return { text: msg.content.trim(), steps, model: provider.model };
    for (const c of msg.tool_calls) {
      const out = execTool(tools, c.function.name, c.function.arguments);
      steps.push({ tool: c.function.name, args: c.function.arguments, result: out });
      messages.push({ role: 'tool', tool_name: c.function.name, content: JSON.stringify(out) });
    }
  }
  return { text: 'Stopped after too many steps.', steps, model: provider.model };
}
