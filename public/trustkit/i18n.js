// trustkit/i18n.js
/**
 * Basit dil tespit (TR/EN) + LLM ile uyarı oluşturma + sanitize
 */

function detectLocale(text) {
  const s = String(text || '').toLowerCase();
  // çok kaba: Türkçe karakter veya sık TR stopword tespiti
  if (/[çğıöşü]/.test(s) || /\b(ama|lütfen|neden|niye|kanka|lan|abi|üzgünüm|özür)\b/.test(s)) {
    return 'tr';
  }
  return 'en';
}

function sanitizeWarning(s) {
  return String(s || '')
    .replace(/@everyone|@here/gi, '[mention removed]')
    .replace(/\bhttps?:\/\/\S+/gi, '[link removed]')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .slice(0, 500);
}

async function makeWarning(llm, logger, messageText, intents, locale) {
  // intents: [{label, severity}, ...]
  const labels = intents.map(i => `${i.label}:${i.severity}`).join(', ');
  const lang = locale || detectLocale(messageText);

  if (!llm) {
    // basit fallback
    return sanitizeWarning(lang === 'tr'
      ? 'Lütfen topluluk kurallarına uygun bir dil kullanın.'
      : 'Please follow community guidelines when messaging.');
  }

  const system = 'You are a brief, polite moderation assistant. Output ONLY the warning sentence.';
  const prompt = `
User message:
${messageText}

Detected issues (internal): ${labels}

Write a SHORT ${lang === 'tr' ? 'Turkish' : 'English'} warning to the user.
- No legal threats. No JSON. One or two short sentences max.
- Be polite but firm. Do not repeat slurs. Avoid quoting offensive words.
`;

  try {
    // llm may support different interfaces; reuse the judge adapter style
    let text;
    if (typeof llm.createChatCompletion === 'function') {
      const res = await llm.createChatCompletion({
        model: llm.model || process.env.LLM_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      });
      text = res?.choices?.[0]?.message?.content || '';
    } else if (typeof llm.generateResponse === 'function') {
      text = await llm.generateResponse(system, prompt);
    } else if (typeof llm.chat === 'function') {
      const out = await llm.chat({ system, prompt }); text = out?.content || String(out || '');
    } else if (typeof llm.complete === 'function') {
      text = await llm.complete(system, prompt);
    } else {
      text = '';
    }
    return sanitizeWarning(text || (lang === 'tr'
      ? 'Lütfen topluluk kurallarına uygun bir dil kullanın.'
      : 'Please follow community guidelines when messaging.'));
  } catch (e) {
    logger?.warn?.('[i18n] warning LLM fail:', e?.message || String(e));
    return sanitizeWarning(lang === 'tr'
      ? 'Lütfen topluluk kurallarına uygun bir dil kullanın.'
      : 'Please follow community guidelines when messaging.');
  }
}

module.exports = { detectLocale, sanitizeWarning, makeWarning };
