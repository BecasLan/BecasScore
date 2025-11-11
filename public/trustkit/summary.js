// trustkit/summary.js
// Kullanıcı ihlallerinden “niyet profili / summary” çıkarır (LLM)
const MAX_EVENTS = 30;

function buildPrompt(username, score, events, prevSummary) {
  const rows = events.map(e => `- ${new Date(e.created_at*1000).toISOString()} | ${e.label}/${e.severity} | Δ${e.delta} | ${e.reason || ''} | [${e.tags || ''}]`).join('\n');
  return `
You are a moderation analyst. Summarize a user's recent behavior as a short profile for moderators.

USER: ${username}
CURRENT_TRUST_SCORE: ${score}
RECENT_EVENTS (newest first):
${rows}

PREVIOUS_SUMMARY (may be empty):
${prevSummary || '(none)'}

Write a tight JSON with:
{
  "summary": "3-5 concise sentences in the same language as events if obvious; otherwise English.",
  "risk_flags": ["short tags like scam-heavy","frequent insults"],
  "advice": "1-2 sentences about what to watch for next time"
}

- Do not include PII.
- Be neutral, factual.
- If events are empty: summary should say behavior is clean.
  `.trim();
}

async function updateUserSummary(llm, logger, { username, score, events, prevSummary }) {
  try {
    const prompt = buildPrompt(username, score, events.slice(0, MAX_EVENTS), prevSummary);
    const res = await llm.createChatCompletion({
      messages: [
        { role: 'system', content: 'You are a senior moderation analyst. Output JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    });
    const content = res?.choices?.[0]?.message?.content || '';
    const json = JSON.parse(content.replace(/```json|```/g,'').trim());
    return {
      summary: String(json.summary || '').slice(0, 1200),
      risk_flags: Array.isArray(json.risk_flags) ? json.risk_flags.slice(0,10) : [],
      advice: String(json.advice || '').slice(0, 500)
    };
  } catch (e) {
    logger?.warn?.('[Summary] LLM failed; fallback clean summary', e?.message || String(e));
    return {
      summary: 'No major issues detected recently.',
      risk_flags: [],
      advice: 'Continue monitoring normally.'
    };
  }
}

module.exports = { updateUserSummary };
