// trustkit/intent.js
const { runLLMJudge, judgeToIntents } = require('./judge');

class IntentAnalyzer {
  constructor(llm, logger, table) {
    this.llm = llm;
    this.logger = logger;
    this.table = table;
  }

  async analyze(message) {
    const content = String(message?.content || '').trim();
    if (!content) return { intents: [] };

    try {
      const judged = await runLLMJudge(this.llm, content, this.logger, this.table);
      const mapped = judgeToIntents(judged);
      // TRACE'i burada info/debug seviyesinde basmak istersen:
      this.logger?.debug?.('[IntentAnalyzer] trace step1:', judged.trace?.step1);
      this.logger?.debug?.('[IntentAnalyzer] trace step2:', judged.trace?.step2);
      this.logger?.debug?.('[IntentAnalyzer] trace step3:', judged.trace?.step3);
      return mapped;
    } catch (e) {
      this.logger?.error?.('[IntentAnalyzer/Judge] fatal:', e?.stack || e?.message || String(e));
      return { intents: [] };
    }
  }
}

module.exports = { IntentAnalyzer };
