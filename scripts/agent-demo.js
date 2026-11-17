// Ask the EOC agent a question from the terminal, on the 31 Aug 2024 replay.
// Local:  ollama serve  then  npm run agent -- "What should I approve first?"
// Claude: ANTHROPIC_API_KEY=... npm run agent -- --claude "What if Uppal floods?"
import { readFile } from 'node:fs/promises';
import { runAgent } from '../lib/ai/agent.js';
import { plan } from '../lib/planner.js';

const load = async (f) => JSON.parse(await readFile(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const args = process.argv.slice(2), useClaude = args[0] === '--claude';
const question = args.filter((a) => a !== '--claude').join(' ') || 'What is the situation and what should I approve first?';
const [base, hand, forecast] = await Promise.all([load('base.json'), load('hand.json'), load('replay/2024-09-01.json')]);
const opts = { costLoss: 0.1 };
const ctx = { base, hand, forecast, opts, plan: plan(base, hand, forecast, opts), reports: [] };

const provider = useClaude
  ? { kind: 'claude', client: new (await import('@anthropic-ai/sdk')).default() }
  : { kind: 'ollama', url: process.env.OLLAMA_URL ?? 'http://localhost:11434', model: process.env.OLLAMA_MODEL ?? 'llama3.1' };
console.time('agent');
const out = await runAgent({ provider, question, ctx });
console.timeEnd('agent');
for (const s of out.steps) console.log(`→ ${s.tool}(${JSON.stringify(s.args)})`);
console.log(`\n[${out.model}] ${out.text}`);
