// CAP 1.2 alert for NDMA's SACHET platform, with info blocks in English, Telugu, Hindi and Urdu
// (Telangana's second official language). Like Korea's alerts, it names the action, not just the hazard.
import { hull } from './geo.js';
import { areaOf } from './intake.js';

export const ALERT_TEXT = {
  'en-IN': (a) => ({ event: 'Urban flood', headline: `Flood risk in ${a}`, instruction: `Heavy rain expected in ${a}. Avoid underpasses and low-lying roads, move valuables up, keep phones charged. Emergency: 112, GHMC 040-21111111.` }),
  'te-IN': (a) => ({ event: 'పట్టణ వరద', headline: `${a} లో వరద ముప్పు`, instruction: `${a} లో భారీ వర్షం. అండర్‌పాస్‌లు, లోతట్టు రోడ్లకు దూరంగా ఉండండి. అత్యవసరం: 112.` }),
  'hi-IN': (a) => ({ event: 'शहरी बाढ़', headline: `${a} में बाढ़ का खतरा`, instruction: `${a} में भारी बारिश की संभावना। अंडरपास और निचली सड़कों से बचें। आपात स्थिति: 112.` }),
  'ur-IN': (a) => ({ event: 'شہری سیلاب', headline: `${a} میں سیلاب کا خطرہ`, instruction: `${a} میں شدید بارش متوقع ہے۔ انڈر پاس اور نشیبی سڑکوں سے دور رہیں۔ ہنگامی نمبر: 112۔` }),
};
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function capAlert({ id, sentAt, onsetAt, sectors, cells, severity = 'Severe', certainty = 'Likely' }) {
  const names = sectors.map((s) => areaOf(s.name)).join(', ');
  const ids = new Set(sectors.map((s) => s.id));
  const ring = hull(cells.filter((c) => ids.has(c.sector)).map((c) => c.pos));
  const polygon = ring.map(([la, lo]) => `${la.toFixed(4)},${lo.toFixed(4)}`).join(' ');
  const info = Object.entries(ALERT_TEXT).map(([lang, f]) => {
    const t = f(names);
    return `  <info>
    <language>${lang}</language><category>Met</category><event>${esc(t.event)}</event>
    <responseType>Avoid</responseType><urgency>Expected</urgency><severity>${severity}</severity><certainty>${certainty}</certainty>
    <onset>${onsetAt}:00+05:30</onset><senderName>SurgeForce (draft for GHMC / TGSDMA)</senderName>
    <headline>${esc(t.headline)}</headline><instruction>${esc(t.instruction)}</instruction>
    <area><areaDesc>${esc(names)}</areaDesc><polygon>${polygon}</polygon></area>
  </info>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${esc(id)}</identifier><sender>surgeforce@draft.local</sender><sent>${sentAt}:00+05:30</sent>
  <status>Exercise</status><msgType>Alert</msgType><scope>Public</scope>
${info}
</alert>`;
}
