// SOCDA-style intake (Japan's LINE disaster chatbot, here for WhatsApp/1070 call notes): triage a report,
// place it in a police-station sector by area name, merge duplicates. A confirmed rescue or medical
// report overrides the forecast for that sector (ground truth beats models).
const KEYWORDS = { // checked in order: the most dangerous category wins
  rescue_needed: ['trapped', 'rescue', 'drowning', 'stuck on roof', 'washed away', 'bachao', 'बचाओ', 'फंसे',
    'రక్షించండి', 'కాపాడండి', 'chikkukunn', 'kapadandi', 'بچاؤ', 'پھنس'],
  medical: ['injured', 'ambulance', 'unconscious', 'doctor', 'घायल', 'एम्बुलेंस', 'గాయ', 'అంబులెన్స్', 'زخمی', 'ایمبولینس'],
  power_hazard: ['live wire', 'electric', 'transformer', 'current', 'बिजली', 'करंट', 'కరెంట్', 'తీగ', 'بجلی', 'کرنٹ'],
  road_blocked: ['road blocked', 'underpass', 'tree fell', 'waterlogged', 'सड़क बंद', 'రోడ్డు', 'سڑک بند'],
  info_request: ['where', 'when', 'shelter', 'status', 'kahan', 'कहाँ', 'ఎక్కడ', 'ఎప్పుడు', 'کہاں'],
};
export const HUMAN_ONLY = new Set(['rescue_needed', 'medical', 'power_hazard', 'unclassified']);
export const CONFIRMS = new Set(['rescue_needed', 'medical']);

export const classify = (text) => {
  const t = text.toLowerCase();
  return Object.keys(KEYWORDS).find((c) => KEYWORDS[c].some((w) => t.includes(w))) ?? 'unclassified';
};

export const areaOf = (stationName) => stationName
  .replace(/\b(police|station|traffic|traffice|ps|cyberabad|watch|tower|booth|law|and|order|women|old)\b/gi, ' ')
  .replace(/[-–,.]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

export function triage(reports, stations, underpasses = []) {
  const places = [
    ...stations.map((s, i) => ({ key: areaOf(s.name).toLowerCase(), sector: i })),
    ...underpasses.filter((u) => !/^underpass/i.test(u.name)).map((u) => ({ key: u.name.toLowerCase(), sector: u.sector })),
  ].filter((p) => p.key.length >= 4).sort((a, b) => b.key.length - a.key.length);
  const seen = new Map();
  return reports.map((r, i) => {
    const category = classify(r.text);
    const hit = places.find((p) => r.text.toLowerCase().includes(p.key));
    const sector = hit ? hit.sector : null;
    const key = `${sector}|${category}`;
    const dupOf = sector != null && seen.has(key) ? seen.get(key) : null;
    if (sector != null && !seen.has(key)) seen.set(key, i);
    const route = HUMAN_ONLY.has(category) ? 'human' : category === 'info_request' ? 'ai_answered' : 'task';
    return { ...r, id: i, category, sector, route, dupOf };
  });
}

// simulated citizen reports near the riskiest sectors, so the demo feed matches whatever the forecast shows
const TEMPLATES = [
  (a) => `Water entering houses in ${a}, 3 kids trapped on first floor, please rescue`,
  (a) => `${a} లో ఇంట్లోకి నీళ్ళు వచ్చాయి, మమ్మల్ని కాపాడండి`,
  (a) => `${a} में बिजली का तार पानी में गिरा है, करंट है`,
  (a) => `Where is the nearest shelter in ${a}?`,
  (a) => `${a} underpass waterlogged, road blocked, two cars stuck`,
  (a) => `${a} میں پانی بھر گیا ہے، بزرگ پھنس گئے ہیں، بچاؤ`,
  (a) => `${a}: old man injured, need ambulance`,
  (a) => `When will the water recede in ${a}? status please`,
];
export function simulatedFeed(sectors, n = 10) {
  const hot = [...sectors].filter((s) => s.onset != null && areaOf(s.name).length >= 3).sort((a, b) => b.vulnerability - a.vulnerability).slice(0, 5);
  if (!hot.length) return [];
  return Array.from({ length: n }, (_, i) => ({ text: TEMPLATES[i % TEMPLATES.length](areaOf(hot[(i * 3) % hot.length].name)), simulated: true }));
}
