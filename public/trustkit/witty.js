// trustkit/witty.js
/**
 * generateWittyReply(llm, messageText, primaryLabel)
 *  - tek cümle, nazik ama net
 *  - TR/EN otomatik
 *  - slur redaction
 */
function redact(s='') {
  return String(s)
    .replace(/\bnigger(s)?\b/gi, 'n****r$1')
    .replace(/\bnigga(s)?\b/gi, 'n***a$1')
    .replace(/jews?\b/gi, 'j*ws')
    .replace(/zenci(ler)?/gi, 'z*nci$1')
    .slice(0, 180);
}

async function generateWittyReply(llm, text, label='moderation') {
  if (!llm) return null;
  const isTR = /[çğıöşü]/i.test(String(text||'')) || /\b(merhaba|selam|neden|lütfen|kurallar)\b/i.test(String(text||''));
  const system = 'You write one-line, friendly but firm moderation replies. No insults. No sarcasm. Output plain text only.';
  const prompt = `${isTR ? 'Mesaj' : 'Message'}: ${redact(text)}\n` +
    `${isTR
      ? 'Kısa bir uyarı cümlesi yaz (tek satır):'
      : 'Write a short one-line warning:'}`;

  // LLM adapter
  const call = async () => {
    if (typeof llm.createChatCompletion === 'function') {
      const res = await llm.createChatCompletion({ messages:[
        { role:'system', content: system },
        { role:'user',   content: prompt }
      ], temperature: 0.3 });
      return res?.choices?.[0]?.message?.content || '';
    }
    if (typeof llm.generateResponse === 'function') {
      const out = await llm.generateResponse(system, prompt);
      return typeof out === 'string' ? out : (out?.content || '');
    }
    if (typeof llm.chat === 'function') {
      const out = await llm.chat({ system, user: prompt });
      return out?.text || out?.content || '';
    }
    return '';
  };

  const textOut = redact(await call());
  if (!textOut) return null;
  // tek satır, 180 char sınırı
  return textOut.replace(/\s+/g, ' ').trim().slice(0, 180);
}

module.exports = { generateWittyReply };
