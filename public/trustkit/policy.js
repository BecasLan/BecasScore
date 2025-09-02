// trustkit/policy.js
const DEFAULT_POLICY = {
  ANNOUNCE_IN_CHANNEL: true,
  WARNINGS_VIA_LLM: true,
  WITTY_REPLY_ENABLED: true,  // 👈 witty default AÇIK
  SHOW_SCORE_ONLY: false,
  QUIET_MODE: false,
  ACTIONS: [],
  FUD: { ENABLED: false, AUTOBAN: false, SEVERITY_TO_BAN: 2 }
};

class PolicyEngine {
  constructor(overrides = {}) {
    this._byGuild = new Map();
    this._default = { ...DEFAULT_POLICY, ...(overrides || {}) };
  }
  set(gid, policyObj) { this._byGuild.set(gid, { ...this._default, ...(policyObj || {}) }); }
  get(gid) { return this._byGuild.get(gid) || this._default; }
  decide(intents, gid) {
    const policy = this.get(gid);
    const actions = [];
    for (const it of (intents || [])) {
      for (const rule of (policy.ACTIONS || [])) {
        const m = rule.match || {};
        const okLabel = (String(m.label || '').toLowerCase() === String(it.label || '').toLowerCase());
        if (!okLabel) continue;
        const sev = parseInt(it.severity || 0, 10);
        if (m.exactSeverity != null) {
          if (sev !== m.exactSeverity) continue;
        } else if (m.minSeverity != null) {
          if (sev < m.minSeverity) continue;
        }
        actions.push(...(rule.do || []));
      }
    }
    return actions;
  }
}

module.exports = { PolicyEngine, DEFAULT_POLICY };
module.exports.default = PolicyEngine;
