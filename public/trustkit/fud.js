// trustkit/policy.js
/**
 * Policy: sunucu bazlı kurallar + geçici (TTL) override.
 * - get(gid): effective policy (defaults + persistent + aktif temp patch'ler)
 * - set(gid, patch): kalıcı patch
 * - setTemporary(gid, patch, ttlMs): ttl boyunca geçici override
 */
class Policy {
  constructor(logger, defaults) {
    this.logger = logger;
    this.defaults = Object.assign({
      QUIET_MODE: true,
      SHOW_SCORE_ONLY: true,
      WARNINGS_VIA_LLM: true,
      ANNOUNCE_IN_CHANNEL: true,
      FUD: { ENABLED: true, AUTOBAN: false, SEVERITY_TO_BAN: 2 }
    }, defaults || {});
    this._byGuild = new Map(); // kalıcı patch
    this._temps   = new Map(); // geçici patch listeleri: gid -> [{expiresAt, patch}]
  }

  get(guildId) {
    const now = Date.now();
    // temp'leri süresi geçenleri sil
    const list = this._temps.get(guildId) || [];
    const activeTemps = list.filter(t => t.expiresAt > now);
    if (activeTemps.length !== list.length) {
      this._temps.set(guildId, activeTemps);
      this.logger?.info?.('[Policy] expired temp overrides cleaned', { guildId });
    }

    // merge: defaults <- persistent <- temps (sırayla)
    let eff = deepMerge({}, this.defaults);
    eff = deepMerge(eff, this._byGuild.get(guildId) || {});
    for (const t of activeTemps) eff = deepMerge(eff, t.patch);
    return eff;
  }

  set(guildId, patch) {
    const cur = this._byGuild.get(guildId) || {};
    const next = deepMerge(cur, patch);
    this._byGuild.set(guildId, next);
    this.logger?.info?.('[Policy] persistent updated', { guildId, patch: safeJson(patch) });
  }

  setTemporary(guildId, patch, ttlMs) {
    const expiresAt = Date.now() + Math.max(1, parseInt(ttlMs || 0, 10));
    const arr = this._temps.get(guildId) || [];
    arr.push({ expiresAt, patch });
    this._temps.set(guildId, arr);
    this.logger?.info?.('[Policy] temp override set', {
      guildId, ttlMs, until: new Date(expiresAt).toISOString(), patch: safeJson(patch)
    });
  }
}

/* helpers */
function deepMerge(a, b) {
  const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function safeJson(x){ try{return JSON.stringify(x)}catch{return String(x)} }

module.exports = { Policy };
