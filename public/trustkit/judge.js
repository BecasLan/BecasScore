// trustkit/judge.js
/**
 * LLM Judge Pipeline (3-pass):
 *  1) strict classifier  -> { hate|insult|scam }
 *  2) reviewer            -> verdict + optional fix
 *  3) sanction assistant  -> summary + user_warning
 *
 * Dayanıklı davranışlar:
 *  - JSON olmayan cevapları onarma (code block, serbest metin vs.)
 *  - STEP-3 refuse etse bile summary/user_warning garanti üret
 *  - Final sınıflandırmayı STEP-1 (+ reviewer fix) ÜZERİNDEN kur
 *  - Çoklu intent (scam + hate + insult) destekli
 */

const MAX_HEAD = 800;

function head(x) {
  const s = typeof x === 'string' ? x : JSON.stringify(x || '');
  return s.slice(0, MAX_HEAD);
}

/* ---------------- JSON onarım yardımcıları ---------------- */

function extractJson(text) {
  if (!text) return null;
  // ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) return fence[1].trim();
  // ilk { ... } bloğu (temel ama iş görüyor)
  const m = text.match(/\{[\s\S]*\}$/m) || text.match(/\{[\s\S]*?\}/m);
  if (m) return m[0].trim();
  return null;
}

function softFixJson(s) {
  if (!s || typeof s !== 'string') return s;
  let t = s.trim();
  // trailing comma
  t = t.replace(/,\s*([}\]])/g, '$1');
  // tek tırnak -> çift tırnak (çok agresif değil)
  if (!/"/.test(t) && /'/.test(t)) t = t.replace(/'/g, '"');
  // undefined/null dizin hatalarına karşı küçük onarımlar gerekirse buraya eklenir
  return t;
}

async function parseJsonWithRepair(call, trace, raw) {
  try {
    if (!raw) return null;
    const try1 = extractJson(raw) || raw;
    const try2 = softFixJson(try1);
    return JSON.parse(try2);
  } catch (e) {
    // Son çare: LLM'e “Fix into valid JSON” de
    try {
      const sys = 'You fix malformed JSON into valid strict JSON. Output JSON object only.';
      const prompt = `Fix into a valid JSON object (no extra text):\n${String(raw).slice(0, 3500)}`;
      const fixed = await call(sys, prompt);
      trace.repairedRaw = head(fixed);
      const body = extractJson(fixed) || fixed;
      return JSON.parse(softFixJson(body));
    } catch {
      return null;
    }
  }
}

/* ---------------- Basit sinyal yardımcıları (deterministik çekirdek) ---------------- */

function looksLikeReporting(text) {
  const s = String(text || '').toLowerCase();
  // "çok scam var", "scammers are abundant", "dikkat uyarı", "report/şikayet"
  return (
    /\b(scammers?\s+are|too many scam|çok\s+scam|dolandırıcı(lar)?\s+(çok|dolu))\b/.test(s) ||
    /\b(dikkat|uyarı|warning)\b/.test(s) ||
    /\b(report|şikayet|complain|complaint)\b/.test(s)
  );
}

function hasHateTarget(text) {
  const s = String(text || '').toLowerCase();
  // kaba sözlük (örnek)
  const groups = [
    'jews','jewish','muslims?','christians?','kurds?','syrians?','suriyeliler',
    'roma(ns?)?','black (people|folks)?','blacks?','whites?','asians?',
    'lgbtq\\+?','gays?','trans(people|gender)?','women','men'
  ];
  const groupRe = new RegExp(`\\b(${groups.join('|')})\\b`, 'i');
  const hateCue = /\b(i\s+hate|go back|get out|inferior|vermin|filth|dirty|animals?)\b/i;
  return groupRe.test(s) && (hateCue.test(s) || /\b(anas[ıi]n[ıi]|am[ıi]na|kahp|orospu|pis)\b/i.test(s));
}

function hasProfanity(text) {
  const s = String(text || '').toLowerCase();
  const PROF_TR = /\b(amk|amq|amc[ıi]k|siktir|orospu|puşt|geri zekal[ıi]|aq|aq\b|sikerim|yarrak|g[öo]t|salak|aptal)\b/i;
  const PROF_EN = /\b(fuck|shit|bitch|asshole|retard(ed)?|moron|idiot|cunt|dick|prick)\b/i;
  const PROF_ES = /\b(joder|mierda|puta|gilipollas|imbecil|idiota)\b/i;
  return PROF_TR.test(s) || PROF_EN.test(s) || PROF_ES.test(s);
}

function scamLevel(text) {
  const s = String(text || '').toLowerCase();
  if (looksLikeReporting(s)) return 0; // rapor/uyarı ise SCAM sayma
  const hard = /\b(free|claim|airdrop|gift|nitro|boost|reward|promo)\b/i.test(s)
    || /\b(dm|pm)\s*(me|now)\b/i.test(s)
    || /\b(seed|private\s*key|mnemonic|wallet)\b/i.test(s)
    || /\b(join|invite)\b/i.test(s)
    || /https?:\/\/\S+/i.test(s);
  const soft = /\b(win|giveaway|çekiliş|hediye|kaz(a|an))\b/i.test(s);
  if (hard) return 3;
  if (soft) return 2;
  return 0;
}

/* ---------------- EN↔TR eşlemeleri ---------------- */

function mapBack(hate) {
  if (hate === 'SEVERE') return 'AĞIR';
  if (hate === 'MILD') return 'HAFİF';
  return 'YOK';
}
function mapBackScam(scam) {
  if (scam === 'CERTAIN') return 'KESIN';
  if (scam === 'SUSPECT') return 'SCAM';
  return 'YOK';
}

/* ---------------- Intent üretimi ---------------- */

function computeIntentsFromFinal(finalCls) {
  const out = [];
  const h = String(finalCls.hate || '').toUpperCase();
  const i = String(finalCls.insult || '').toUpperCase();
  const s = String(finalCls.scam || '').toUpperCase();

  const sevMap = { SEVERE: 3, MILD: 2, NONE: 0 };
  const scamMap = { CERTAIN: 3, SUSPECT: 2, NONE: 0 };

  if (sevMap[h] > 0) out.push({ label: 'hate', severity: sevMap[h] });
  if (sevMap[i] > 0) out.push({ label: 'insult', severity: sevMap[i] });
  if (scamMap[s] > 0) out.push({ label: 'scam', severity: scamMap[s] });

  // SCAM öncelik ama diğerleri de dönebilir — sıralama hassasiyeti gerekiyorsa burada sort et
  return out;
}

/* ---------------- LLM çağırma adaptörü ---------------- */

function pickLLM(llm) {
  // llm.createChatCompletion({ messages: [...] })
  async function call(system, user) {
    // createChatCompletion
    if (llm && typeof llm.createChatCompletion === 'function') {
      const res = await llm.createChatCompletion({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.2
      });
      return res?.choices?.[0]?.message?.content || '';
    }
    // generateResponse(system, prompt)
    if (llm && typeof llm.generateResponse === 'function') {
      const out = await llm.generateResponse(system, user);
      return typeof out === 'string' ? out : (out?.content || '');
    }
    // chat({system, user})
    if (llm && typeof llm.chat === 'function') {
      const out = await llm.chat({ system, user });
      return out?.text || out?.content || '';
    }
    // complete(prompt)
    if (llm && typeof llm.complete === 'function') {
      const out = await llm.complete(`${system}\n\n${user}`);
      return out?.text || out?.content || '';
    }
    throw new Error('LLM adapter: no compatible method');
  }
  return call;
}

/* ---------------- Ana akış ---------------- */

const DEFAULT_TABLE = `
CATEGORIES (English-first, TR accepted):
- HATE (SEVERE / MILD / NONE) — TR: IRKCILIK (AĞIR / HAFİF / YOK)
- INSULT (SEVERE / MILD / NONE) — TR: KÜFÜR (AĞIR / HAFİF / YOK)
- SCAM (CERTAIN / SUSPECT / NONE) — TR: (KESİN / SCAM / YOK)
Rules:
- HATE only if target group/identity + derogatory/hostile language.
- INSULT only if explicit profanity/insult words.
- SCAM = CERTAIN only if there is solicitation (links/invites/wallet/seed/reward/"DM me").
- Reporting/complaining about scams without solicitation → SCAM = NONE.
- If message is general complaint like "too many scams here" → SCAM = NONE.
`;

async function runLLMJudge(llm, text, logger, table = DEFAULT_TABLE) {
  const call = pickLLM(llm);
  const trace = { step1: {}, step2: {}, step3: {} };

  /* ---------- STEP 1: strict classifier ---------- */
  trace.step1.system = 'You are a strict multilingual moderation classifier. Output JSON only, no prose.';
  trace.step1.prompt = `TABLE:\n\n${table}\n\n\nMESSAGE:\n${text}\n\nReturn STRICT JSON with exactly these keys:\n{\n  "classification": {\n    "hate": "SEVERE" | "MILD" | "NONE",\n    "insult": "SEVERE" | "MILD" | "NONE",\n    "scam": "CERTAIN" | "SUSPECT" | "NONE"\n  },\n  "reason": "short reason"\n}\n\nHard constraints:\n- If no explicit profanity words → insult="NONE".\n- If no group/identity target → hate="NONE".\n- If solicitation pattern not present → scam="NONE".\n- Reporting/complaining about scams (without solicitation) → scam="NONE".`;
  try { trace.step1.raw = head(await call(trace.step1.system, trace.step1.prompt)); }
  catch (e) { trace.step1.callError = e?.message || String(e); trace.step1.raw = ''; }
  const json1 = await parseJsonWithRepair(call, trace.step1, trace.step1.raw) || {};
  const cls1 = json1?.classification || {};

  // Canonicalize STEP-1
  const canon = {
    hate:   (cls1.hate || cls1.irkcilik || 'NONE'),
    insult: (cls1.insult || cls1.kufur || 'NONE'),
    scam:   (cls1.scam || 'NONE')
  };
  trace.step1.parsed = { classification: canon, reason: json1?.reason };

  /* ---------- STEP 2: reviewer ---------- */
  trace.step2.system = 'You are a second independent reviewer. Output JSON only.';
  trace.step2.prompt = `MESSAGE:\n${text}\n\nFIRST_DECISION:\n${JSON.stringify(canon)}\n\nFIRST_REASON:\n${json1?.reason || ''}\n\nAnswer JSON:\n{\n  "verdict": "EVET" | "HAYIR",\n  "why": "very short",\n  "fix": { "hate": "SEVERE|MILD|NONE", "insult": "SEVERE|MILD|NONE", "scam": "CERTAIN|SUSPECT|NONE" }\n}`;
  try { trace.step2.raw = head(await call(trace.step2.system, trace.step2.prompt)); }
  catch (e) { trace.step2.callError = e?.message || String(e); trace.step2.raw = ''; }
  const json2 = await parseJsonWithRepair(call, trace.step2, trace.step2.raw) || {};

  function sanitizeFix(fx = {}) {
    const pick = (val, allowed) => (allowed.includes(val) ? val : null);
    return {
      hate:   pick(fx.hate,   ['SEVERE','MILD','NONE']),
      insult: pick(fx.insult, ['SEVERE','MILD','NONE']),
      scam:   pick(fx.scam,   ['CERTAIN','SUSPECT','NONE'])
    };
  }
  const fx = sanitizeFix(json2.fix || {});
  trace.step2.parsed = { verdict: json2.verdict, why: json2.why, fix: fx };

  /* ---------- FINAL classification (STEP-1 + reviewer fix) ---------- */
  const finalCls = {
    hate:   fx.hate   || canon.hate,
    insult: fx.insult || canon.insult,
    scam:   fx.scam   || canon.scam,
    irkcilik: (fx.hate   || canon.hate)   === 'SEVERE' ? 'AĞIR' :
              (fx.hate   || canon.hate)   === 'MILD'   ? 'HAFİF' : 'YOK',
    kufur:   (fx.insult || canon.insult) === 'SEVERE' ? 'AĞIR' :
             (fx.insult || canon.insult) === 'MILD'   ? 'HAFİF' : 'YOK'
  };

  /* ---------- STEP 3: sanction assistant (summary + user_warning) ---------- */
  trace.step3.system = 'You are a sanctions assistant. Output JSON only. Use the same language as MESSAGE if obvious, otherwise English.';
  trace.step3.prompt = `MESSAGE:\n${text}\n\nFINAL_CLASSIFICATION (EN canon + TR legacy):\n${JSON.stringify(finalCls)}\n\nWrite JSON (no extra keys):\n{\n  "summary": "1 sentence for moderators (same language as the message if possible)",\n  "user_warning": "short warning for user (same language as the message if possible)"\n}`;
  try { trace.step3.raw = head(await call(trace.step3.system, trace.step3.prompt)); }
  catch (e) { trace.step3.callError = e?.message || String(e); trace.step3.raw = ''; }

  let json3 = await parseJsonWithRepair(call, trace.step3, trace.step3.raw);
  // Güvenli varsayılan (refuse/boş durumda anahtarlar garanti)
  if (!json3 || typeof json3 !== 'object') json3 = {};
  const isTR = /[çğıöşü]/i.test(String(text||'')) || /\b(merhaba|selam|neden|lütfen|kurallar)\b/i.test(String(text||''));
  if (!json3.summary)      json3.summary      = isTR ? 'Kısa moderasyon özeti mevcut.' : 'Short moderation summary.';
  if (!json3.user_warning) json3.user_warning = isTR ? 'Lütfen topluluk kurallarına dikkat ediniz.' : 'Please mind the community rules.';
  json3.summary      = String(json3.summary).slice(0, 200);
  json3.user_warning = String(json3.user_warning).slice(0, 200);
  trace.step3.parsed = { summary: json3.summary, user_warning: json3.user_warning };

  /* ---------- INTENTS ---------- */
  let intents = computeIntentsFromFinal(finalCls);
  // Güvenlik: yine boşsa STEP-1'e degrade et
  if (!intents?.length) {
    intents = computeIntentsFromFinal({
      hate: canon.hate, insult: canon.insult, scam: canon.scam,
      irkcilik: finalCls.irkcilik, kufur: finalCls.kufur
    });
  }

  return {
    step1: { classification: canon, reason: json1?.reason },
    step2: { verdict: json2.verdict || 'EVET', why: json2.why || 'ok', fix: fx },
    step3: { summary: json3.summary, user_warning: json3.user_warning },
    final: finalCls,
    intents,
    trace
  };
}

/* -------- Yüksek seviyeli köprü: judge çıktısını intent setine çevir -------- */

function judgeToIntents(judge) {
  const intents = Array.isArray(judge?.intents) ? judge.intents.map(it => ({
    label: String(it.label || 'none').toLowerCase(),
    severity: Math.max(1, Math.min(3, parseInt(it.severity ?? 1, 10) || 1))
  })) : [];

  const filtered = intents.filter(it => it.label !== 'none' && it.severity > 0);

  return {
    intents: filtered,
    warning: judge?.step3?.user_warning,
    summary: judge?.step3?.summary,
    trace: judge?.trace
  };
}

module.exports = { runLLMJudge, judgeToIntents, DEFAULT_TABLE, computeIntentsFromFinal };
