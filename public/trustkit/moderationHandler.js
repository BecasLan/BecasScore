// trustkit/moderationHandler.js
// Ceza uygula + witty tetikle + Unknown label = sessiz log.
// Scam en yüksek öncelik; kamuya tek satırlık uyarı; DM/kanal tercihi policy ile.

const { CANON, normalizeLabel } = require('./labels');

class ModerationHandler {
  /**
   * @param {Object} deps
   * deps: { logger, policy, store, witty, discord }
   */
  constructor(deps) {
    this.log = deps.logger;
    this.policy = deps.policy;
    this.store = deps.store;      // trust store (db) – score & sicil
    this.witty = deps.witty;      // witty responder
    this.discord = deps.discord;  // discord yardımcıları
  }

  /**
   * intents: [{ label, severity, user_warning?, summary? }, ...]
   * ctx: { guildId, userId, message, lang }
   */
  async handleIntents(intents, ctx) {
    try {
      const safe = Array.isArray(intents) ? intents : [];
      if (safe.length === 0) return { applied: [], warnings: [] };

      // 1) Etiketleri normalize et, unknownları at.
      const normalized = [];
      for (const it of safe) {
        const norm = normalizeLabel(it.label);
        if (!norm) {
          this.log?.debug?.('[Moderation] drop unknown label', it?.label);
          continue;
        }
        // Scam üst öncelik için weight
        const weight = norm === 'scam' ? 999 : (it.severity || 0);
        normalized.push({ ...it, label: norm, _w: weight });
      }
      if (normalized.length === 0) return { applied: [], warnings: [] };

      // 2) Öncelik: scam > kalanlar severity
      normalized.sort((a, b) => b._w - a._w);

      const applied = [];
      const warningsOut = [];

      for (const item of normalized) {
        // Policy’den ceza kuralı çek
        const rule = this.policy?.resolveRule(item.label, item.severity) || {};
        const delta = Number(rule.delta ?? 0);
        const timeoutSec = Number(rule.timeoutSec ?? 0);
        const deleteMsg = !!rule.deleteMessage;

        // 2.1 Sicil & skor güncelle
        const scoreAfter = await this.store.applyPenalty(ctx.guildId, ctx.userId, {
          label: item.label,
          severity: item.severity || 0,
          delta,
          summary: item.summary || null,
        });

        // 2.2 Discord eylemleri (mesaj sil / timeout vs.)
        try {
          if (deleteMsg && ctx.message?.deletable) {
            await ctx.message.delete().catch(()=>{});
          }
          if (timeoutSec > 0 && this.discord?.timeoutMember) {
            await this.discord.timeoutMember(ctx.message, ctx.userId, timeoutSec, `Becas Score (${item.label}/${item.severity})`);
          }
        } catch (actErr) {
          this.log?.warn?.('[Moderation] discord action failed', actErr?.message || actErr);
        }

        // 2.3 Kamuya tek satırlık uyarı (spam yok)
        const publicWarnings = this.policy?.publicWarnings !== false;
        const userWarning = item.user_warning || this.policy?.defaultWarning?.(item.label, ctx.lang);
        if (publicWarnings && userWarning && ctx.message?.channel?.send) {
          const warn = `⚠️ ${userWarning}  (Becas Score: **${scoreAfter}**)`;
          warningsOut.push(warn);
          await ctx.message.channel.send(warn).catch(()=>{});
        }

        // 2.4 Witty: her cezada tetikle
        try {
          if (this.witty?.reply) {
            await this.witty.reply(ctx.message, {
              label: item.label,
              severity: item.severity || 0,
              lang: ctx.lang || 'auto',
              score: scoreAfter,
            }).catch(()=>{});
          }
        } catch (werr) {
          this.log?.debug?.('[Moderation] witty failed', werr?.message || werr);
        }

        applied.push({ label: item.label, severity: item.severity || 0, delta, timeoutSec, scoreAfter });
      }

      return { applied, warnings: warningsOut };
    } catch (e) {
      this.log?.error?.('[Moderation] handleIntents exception:', e);
      return { applied: [], warnings: [] };
    }
  }
}

module.exports = { ModerationHandler };
