// Held-out evaluation of intake triage: keyword rules vs on-device multilingual embeddings.
// The 32 messages are worded differently from the few-shot examples. Writes data/intake-eval.json.
// Run: npm run eval:intake   (first run downloads the ~120 MB model from Hugging Face, then cached)
import { readFile, writeFile } from 'node:fs/promises';
import * as transformers from '@huggingface/transformers';
import { makeClassifier, transformersEmbedder, MODEL } from '../lib/ai/intake-ai.js';
import { classify } from '../lib/intake.js';

const set = JSON.parse(await readFile(new URL('../test/fixtures/intake-eval.json', import.meta.url), 'utf8'));
const ai = await makeClassifier(await transformersEmbedder(transformers));
const preds = await ai(set.map((s) => s.text));
const LIFE = new Set(['rescue_needed', 'medical', 'power_hazard']);
const score = (get) => {
  const ok = set.filter((s, i) => get(i) === s.label).length;
  const life = set.filter((s) => LIFE.has(s.label));
  const missedLife = set.filter((s, i) => LIFE.has(s.label) && !LIFE.has(get(i))).length;
  return { accuracy: +(ok / set.length).toFixed(3), lifeThreateningMissed: missedLife, lifeThreateningTotal: life.length };
};
const result = {
  model: MODEL, n: set.length, built: new Date().toISOString(),
  keywords: score((i) => classify(set[i].text)),
  ai: score((i) => preds[i].category),
  rows: set.map((s, i) => ({ text: s.text, label: s.label, keywords: classify(s.text), ai: preds[i].category, margin: preds[i].margin })),
};
await writeFile(new URL('../data/intake-eval.json', import.meta.url), JSON.stringify(result, null, 1));
console.log(`keywords: accuracy ${result.keywords.accuracy}, missed life-threatening ${result.keywords.lifeThreateningMissed}/${result.keywords.lifeThreateningTotal}`);
console.log(`AI:       accuracy ${result.ai.accuracy}, missed life-threatening ${result.ai.lifeThreateningMissed}/${result.ai.lifeThreateningTotal}`);
result.rows.filter((r) => r.ai !== r.label).forEach((r) => console.log(`  AI wrong: ${r.label} -> ${r.ai} (${r.margin}) ${r.text}`));
