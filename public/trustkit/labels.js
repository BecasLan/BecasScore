// trustkit/labels.js
const CANON = [
  'hate', 'insult', 'scam', 'toxicity', 'harassment', 'spam', 'nsfw', 'profanity'
];

// tüm varyantları tek yerde normalize ediyoruz (EN + TR)
const MAP = new Map([
  // hate / ırkçılık
  ['hate','hate'], ['irkcilik','hate'], ['ırkçılık','hate'], ['racism','hate'], ['racist','hate'],
  // insult / profanity / küfür
  ['insult','insult'], ['profanity','insult'], ['kufur','insult'], ['küfür','insult'], ['abuse','insult'],
  // scam / dolandırıcılık
  ['scam','scam'], ['fraud','scam'], ['phish','scam'], ['dolandırıcılık','scam'],
  // toxicity / toksisite
  ['toxicity','toxicity'], ['toxic','toxicity'], ['toksisite','toxicity'],
  // harassment / taciz
  ['harassment','harassment'], ['harass','harassment'], ['taciz','harassment'],
  // spam
  ['spam','spam'],
  // nsfw
  ['nsfw','nsfw'], ['adult','nsfw'], ['porn','nsfw'],
  // profanity explicit synonym as its own tag mapped to insult (kanona tekleşsin diye)
  ['explicit','nsfw'],
]);

function normalizeLabel(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase();
  const hit = MAP.get(key);
  if (hit && CANON.includes(hit)) return hit;
  // doğrudan canonical gelirse
  if (CANON.includes(key)) return key;
  return null; // bilinmeyeni sessizce at
}

module.exports = { CANON, normalizeLabel };
