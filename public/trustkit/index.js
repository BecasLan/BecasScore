// trustkit/index.js
const { TrustStore } = require('./store');
const { IntentAnalyzer } = require('./intent');
const { TrustMiddleware } = require('./middleware');

// ⬇️ ESKİ: const { Policy } = require('./policy');
// ⬇️ YENİ: PolicyEngine'i alıyoruz
const { PolicyEngine } = require('./policy');

function setupTrustKit({ client, llm, logger, config, onAutoPlan }) {
  // Varsayılanlar
  const defaults = {
    ENABLED: true,
    ANNOUNCE_IN_CHANNEL: true,
    THRESHOLDS: { WARN: 95, LIMIT: 85, MUTE: 70, BAN: 40 },
    TIMEOUTS: { soft: 600 },
    PENALTIES: {
      insult:     { base: 2, maxPerMsg: 6 },
      toxicity:   { base: 2, maxPerMsg: 6 },
      harassment: { base: 3, maxPerMsg: 9 },
      spam:       { base: 3, maxPerMsg: 9 },
      scam:       { base: 10, maxPerMsg: 100 },
      nsfw:       { base: 3, maxPerMsg: 9 },
      hate:       { base: 5, maxPerMsg: 15 }
    }
  };

  const cfg = { ...defaults, ...(config?.TRUSTKIT || {}) };

  // Store + Analyzer
  const store = new TrustStore(logger, cfg);
  const analyzer = new IntentAnalyzer(llm, logger);

  // Policy varsayılanları (gürültüyü azaltıyoruz; kanala sadece skor satırı düşsün)
  const policyDefaults = cfg.POLICY || {
    QUIET_MODE: true,
    SHOW_SCORE_ONLY: true,
    WARNINGS_VIA_LLM: true,
    ANNOUNCE_IN_CHANNEL: true,
    FUD: { ENABLED: true, AUTOBAN: false, SEVERITY_TO_BAN: 2 },
    ACTIONS: [] // doğal-dil policy’ler middleware içinden eklenecek
  };

  // ⬇️ ESKİ: const policy = new Policy(logger, policyDefaults);
  // ⬇️ YENİ:
  const policy = new PolicyEngine(policyDefaults);

  // TrustMiddleware imzası: (store, analyzer, logger, cfg, anchorFn, policyInstance)
  const mw = new TrustMiddleware(store, analyzer, logger, cfg, undefined, policy);

  // Üst seviye dinleyici
  client.on('messageCreate', async (message) => {
    try {
      // === SELFTEST ===
      if (
        typeof message.content === 'string' &&
        message.content.trim().toLowerCase() === '!trust selftest'
      ) {
        logger.info('[TrustKit][SELFTEST] listener ok');
        await message.channel.send('✅ TrustKit self-test: listener aktif.');
        return;
      }

      // === SİMÜLASYON ===  (örn: !trust simulate insult 2)
      const sim = message.content?.match(
        /^!trust\s+simulate\s+(toxicity|insult|harassment|spam|scam|nsfw|hate)\s+([1-3])$/i
      );
      if (sim) {
        const label = sim[1].toLowerCase();
        const severity = parseInt(sim[2], 10);
        logger.info(`[TrustKit][SIM] ${label} ${severity}`);
        const plan = await mw.applySyntheticIntent?.(message, [{ label, severity }]);
        if (plan?.steps?.length && typeof onAutoPlan === 'function') {
          await onAutoPlan(plan, message);
        }
        return;
      }

      // === Normal akış ===
      const plan = await mw.observeMessage(message);
      if (plan?.steps?.length && typeof onAutoPlan === 'function') {
        await onAutoPlan(plan, message);
      }
    } catch (e) {
      logger.error('[TrustKit] top-level listener error:', e?.stack || e?.message || String(e));
    }
  });

  return { enabled: true, store, analyzer, mw };
}

module.exports = { setupTrustKit };
