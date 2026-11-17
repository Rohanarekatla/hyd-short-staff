// AI intake: multilingual sentence embeddings (multilingual-e5-small, ~100 languages incl. Telugu, Hindi,
// Urdu) + few-shot nearest-prototype classification, running fully on-device (Transformers.js, no API key).
// Cross-lingual embeddings put "trapped, send a boat" and "మమ్మల్ని రక్షించండి" next to each other,
// which keyword lists cannot (Lamsal et al. 2024, CrisisTransformers). Safety rule in triage(): AI may
// escalate a report to a human, never de-escalate one the rules flagged as life-threatening.
export const MODEL = 'Xenova/multilingual-e5-small';

export const EXAMPLES = {
  rescue_needed: [
    'People are trapped in the house, water is rising, send a boat',
    'My elderly parents are stuck on the terrace, please help them get out',
    'A man is being swept away in the nala',
    'మా ఇంట్లో నీళ్ళు పెరుగుతున్నాయి, మమ్మల్ని రక్షించండి',
    'వృద్ధులు డాబా మీద చిక్కుకున్నారు, పడవ పంపండి',
    'घर में पानी भर गया है, हम फंसे हुए हैं, बचाओ',
    'बच्चे छत पर फंसे हैं, नाव भेजिए',
    'ہم گھر میں پھنس گئے ہیں، پانی بڑھ رہا ہے، مدد کریں',
  ],
  medical: [
    'My father is unconscious and we need an ambulance',
    'A woman is injured and bleeding badly',
    'Pregnant lady needs to reach hospital urgently',
    'మా అమ్మకు గాయమైంది, అంబులెన్స్ కావాలి',
    'ఒకతను స్పృహ తప్పి పడిపోయాడు',
    'एक आदमी घायल है, एम्बुलेंस भेजो',
    'मरीज को तुरंत अस्पताल ले जाना है',
    'ایک بچہ زخمی ہے، ایمبولینس چاہیے',
  ],
  power_hazard: [
    'A live electric wire has fallen into the water',
    'Sparks coming from the transformer near our street',
    'Electric pole fell on the road and wires are in the water',
    'కరెంట్ తీగ నీళ్ళలో పడింది',
    'ట్రాన్స్‌ఫార్మర్ నుండి మంటలు వస్తున్నాయి',
    'बिजली का तार पानी में गिरा है',
    'ट्रांसफार्मर से चिंगारी निकल रही है',
    'بجلی کا تار پانی میں گرا ہوا ہے',
  ],
  road_blocked: [
    'The underpass is full of water and cars are stuck',
    'A big tree fell and blocked the main road',
    'Road is waterlogged, vehicles cannot pass',
    'అండర్‌పాస్ లో నీళ్ళు నిండిపోయాయి, వాహనాలు ఆగిపోయాయి',
    'రోడ్డు మీద చెట్టు పడిపోయింది',
    'अंडरपास में पानी भर गया, गाड़ियाँ फंसी हैं',
    'पेड़ गिरने से सड़क बंद है',
    'انڈر پاس میں پانی بھر گیا ہے، سڑک بند ہے',
  ],
  info_request: [
    'Where is the nearest shelter?',
    'When will the water level go down?',
    'Is the school open tomorrow?',
    'Where can we get drinking water and food?',
    'దగ్గరలో ఆశ్రయం ఎక్కడ ఉంది?',
    'నీళ్ళు ఎప్పుడు తగ్గుతాయి?',
    'सबसे नज़दीकी राहत शिविर कहाँ है?',
    'پانی کب اترے گا؟',
  ],
};

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

// embed: async (string[]) => number[][] of L2-normalised vectors
export async function makeClassifier(embed, k = 3) {
  const cats = Object.keys(EXAMPLES);
  const protos = await Promise.all(cats.map((c) => embed(EXAMPLES[c].map((t) => `query: ${t}`))));
  return async (texts) => {
    if (!texts.length) return [];
    const vecs = await embed(texts.map((t) => `query: ${t}`));
    return vecs.map((v) => {
      const scores = cats.map((c, i) => {
        const sims = protos[i].map((p) => dot(v, p)).sort((a, b) => b - a).slice(0, k);
        return sims.reduce((a, b) => a + b, 0) / sims.length; // mean of the k nearest examples
      });
      const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
      return { category: cats[order[0]], score: +scores[order[0]].toFixed(3), margin: +(scores[order[0]] - scores[order[1]]).toFixed(3) };
    });
  };
}

// Transformers.js loader shared by Node (npm package) and the browser (CDN module passed in)
export async function transformersEmbedder(transformers) {
  const extractor = await transformers.pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  return async (texts) => (await extractor(texts, { pooling: 'mean', normalize: true })).tolist();
}
