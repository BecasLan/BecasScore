// trustkit/middleware.js
const { detectLocale, makeWarning } = require('./i18n');
const { detectFUD } = require('./fud');
const { runLLMJudge, judgeToIntents } = require('./judge');

let PolicyEngine; try { ({ PolicyEngine } = require('./policy')); } catch {}
let generateWittyReply; try { ({ generateWittyReply } = require('./witty')); } catch {}

const MIN_TIMEOUT_SECS = 60;
const DEFAULT_TIMEOUT_SECS = 600;

class TrustMiddleware {
  constructor(store, analyzer, logger, cfg, anchorFn, policy) {
    this.store = store;
    this.analyzer = analyzer;
    this.logger = logger;
    this._llm = analyzer?.llm;

    this.cfg = Object.assign({
      ENABLED: true,
      ANNOUNCE_IN_CHANNEL: true,
      // Artık kanal slowmode yok; yalnızca kullanıcıya yaptırım
      THRESHOLDS: { WARN: 95, LIMIT: 85, MUTE: 70, BAN: 40 },
      TIMEOUTS: { soft: DEFAULT_TIMEOUT_SECS },
      PENALTIES: {
        insult:   { base: 2, maxPerMsg: 6 },
        hate:     { base: 5, maxPerMsg: 15 },
        scam:     { base: 10, maxPerMsg: 100 },
        spam:     { base: 3, maxPerMsg: 9 },
        nsfw:     { base: 3, maxPerMsg: 9 },
        toxicity: { base: 2, maxPerMsg: 6 },
        harassment:{ base: 3, maxPerMsg: 9 }
      },
      USER_COOLDOWN_MS: 8000,
      PER_MIN_CAP: 20,
      ADMINS: (process.env.ADMIN_USERS || '').split(',').map(s => s.trim()).filter(Boolean)
    }, cfg || {});

    this.anchor = anchorFn || (async () => {});
    if (policy && policy.get && policy.decide) this.policy = policy;
    else if (PolicyEngine) this.policy = new PolicyEngine();
    else this.policy = {
      _g: new Map(),
      get: gid => this._g.get(gid) || {
        ANNOUNCE_IN_CHANNEL: true,
        WARNINGS_VIA_LLM: true,
        WITTY_REPLY_ENABLED: true,
        SHOW_SCORE_ONLY: false,
        QUIET_MODE: false,
        ACTIONS: []
      },
      set: (gid, obj) => this._g.set(gid, obj),
      decide: () => []
    };

    // Komut filtresi
    const envPrefix = (process.env.PREFIX || '').trim();
    this.commandGuard = Object.assign({
      IGNORE_PREFIXED_COMMANDS: true,
      IGNORE_MENTIONS_OF_BOT: true,
      IGNORE_CONTAINS_BOTNAME: true,
      PREFIXES: [ envPrefix || 'becas', '!', '/' ],
      BOTNAME: (process.env.BOT_NAME || 'becas').toLowerCase()
    }, cfg?.COMMAND_GUARD || {});

    this.testGuard = Object.assign({
      IGNORE_TEST_MARKERS: true,
      MARKERS: ['test:', '[test]', '(test)'],
      BYPASS_CHANNELS: (process.env.TRUST_BYPASS_CHANNELS || '')
        .split(',').map(s => s.trim()).filter(Boolean)
    }, cfg?.TEST_GUARD || {});

    this._cooldown = new Map();
    this._perMin = new Map();
    this._sumCooldown = new Map();
  }

  _capPerMinute(uid, delta) {
    const now = Date.now();
    const box = this._perMin.get(uid) || { windowStart: now, spent: 0 };
    if (now - box.windowStart > 60_000) { box.windowStart = now; box.spent = 0; }
    const cap = this.cfg.PER_MIN_CAP;
    const room = -cap - box.spent;
    const applied = Math.max(delta, room);
    box.spent += applied;
    this._perMin.set(uid, box);
    return applied;
  }

  _isBypassedChannel(message) {
    try {
      const g = this.testGuard || {};
      const id = message?.channel?.id;
      const name = message?.channel?.name;
      if (!id && !name) return false;
      return (g.BYPASS_CHANNELS || []).some(x => x === id || x === name);
    } catch { return false; }
  }
  _hasTestMarker(message) {
    try {
      const g = this.testGuard || {};
      if (!g.IGNORE_TEST_MARKERS) return false;
      const text = String(message?.content || '').toLowerCase();
      return (g.MARKERS || []).some(m => text.startsWith(m.toLowerCase()) || text.includes(` ${m.toLowerCase()}`));
    } catch { return false; }
  }
  _isCommandLike(message) {
    try {
      const text = String(message?.content || '').trim();
      if (!text) return false;
      const guard = this.commandGuard || {};

      if (guard.IGNORE_MENTIONS_OF_BOT) {
        const botId = message?.client?.user?.id;
        if (botId) {
          const re = new RegExp(`<@!?${botId}>`);
          if (re.test(text)) return true;
        }
      }
      if (guard.IGNORE_PREFIXED_COMMANDS) {
        const prefixes = Array.isArray(guard.PREFIXES) ? guard.PREFIXES : [];
        for (const p of prefixes) {
          if (!p) continue;
          const wordPrefix = new RegExp(`^${escapeRe(p)}\\b`, 'i');
          const charPrefix = new RegExp(`^\\s*${escapeRe(p)}`);
          if (wordPrefix.test(text) || charPrefix.test(text)) return true;
        }
      }
      if (guard.IGNORE_CONTAINS_BOTNAME) {
        const botname = String(guard.BOTNAME || '').toLowerCase();
        if (botname && new RegExp(`\\b${escapeRe(botname)}\\b`, 'i').test(text)) return true;
      }
      return false;
    } catch { return false; }
  }

  // Doğal dil ile politika set etme:
  async _maybeHandlePolicyNL(message) {
    const text = String(message.content || '').trim();
    if (!text) return false;
    if (!/^\s*becas\b/i.test(text)) return false;

    const isAdmin = this.cfg.ADMINS.includes(message.author?.id) ||
      message.member?.permissions?.has?.('ADMINISTRATOR');
    if (!isAdmin) return false;

    const low = text.toLowerCase();
    let gid = message.guild?.id;
    const curr = this.policy.get(gid) || {};
    const updated = { ...curr };

    const minutesRe = /(\d+)\s*(minute|min|dakika|dk|hour|saat)/i;
    const timeoutRe = /\b(timeout|mute|sustur|timeoutla)\b/i;
    const banRe = /\bban(la|)\b/i;

    const wantInsult = /\b(profanity|insult|küfür|kufur)\b/i.test(low);
    const wantHate   = /\b(hate|ırk|irk|ırkç|nefre|nefret)\b/i.test(low);
    const wantScam   = /\b(scam|phish|nitro|airdrop|seed|private\s*key|mnemonic|wallet|cüzdan)\b/i.test(low);

    const isBan = banRe.test(low);
    const isTimeout = timeoutRe.test(low);

    let seconds = DEFAULT_TIMEOUT_SECS;
    const m = low.match(minutesRe);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      seconds = /(hour|saat)/.test(unit) ? n * 3600 : n * 60;
    }
    if (!Number.isFinite(seconds) || seconds < MIN_TIMEOUT_SECS) seconds = DEFAULT_TIMEOUT_SECS;

    if (!updated.ACTIONS) updated.ACTIONS = [];
    const pushRule = (label) => {
      updated.ACTIONS = updated.ACTIONS.filter(r => (r?.match?.label || '') !== label);
      if (isBan) {
        updated.ACTIONS.push({ match: { label, minSeverity: 1 }, do: [{ type: 'ban', reason: `${label} policy` }] });
      } else if (isTimeout) {
        updated.ACTIONS.push({
          match: { label, minSeverity: 2 },
          do: [{ type: 'timeout', seconds, reason: `${label} policy` }, { type: 'witty-reply' }]
        });
      }
    };
    if (wantInsult) pushRule('insult');
    if (wantHate)   pushRule('hate');
    if (wantScam)   pushRule('scam');

    if ((wantInsult || wantHate || wantScam) && updated.ACTIONS.length) {
      if (updated.WITTY_REPLY_ENABLED == null) updated.WITTY_REPLY_ENABLED = true;
      if (updated.ANNOUNCE_IN_CHANNEL == null) updated.ANNOUNCE_IN_CHANNEL = true;
      if (updated.WARNINGS_VIA_LLM == null) updated.WARNINGS_VIA_LLM = true;

      this.policy.set(gid, updated);
      try {
        await message.channel.send(
          `✅ Policy updated: ` +
          updated.ACTIONS.map(a => `${a.match.label} → ${a.do[0].type}${a.do[0].seconds ? ` ${Math.round(a.do[0].seconds/60)}m` : ''}`).join(' | ')
        );
      } catch {}
      return true;
    }
    return false;
  }

  async observeMessage(message) {
    try {
      const gid = message.guild?.id;
      const uid = message.author?.id;
      const content = String(message.content || '');

      // NL policy
      if (await this._maybeHandlePolicyNL(message)) return null;

      const pol = this.policy ? this.policy.get(gid) : {
        QUIET_MODE: true, SHOW_SCORE_ONLY: true, ANNOUNCE_IN_CHANNEL: true,
        WARNINGS_VIA_LLM: true, WITTY_REPLY_ENABLED: true,
        ACTIONS: []
      };

      this.logger.info('[TrustKit] observeMessage', { gid, uid, len: content.length });
      if (!this.cfg.ENABLED) return null;
      if (!message?.guild || message.author?.bot) return null;
      if (this._isBypassedChannel(message)) return null;
      if (this._hasTestMarker(message)) return null;
      if (this._isCommandLike(message)) { this.logger.info('[TrustKit] skip (command-like message)', { uid, preview: content.slice(0,80) }); return null; }

      // cooldown + ağır ihlalde bypass
      const now = Date.now();
      const last = this._cooldown.get(uid) || 0;
      let preOverride = false;
      try {
        const s = content.toLowerCase();
        const severeHate = /\b(nigger|nigga|kike|spic|chink|paki)\b/i.test(s) || /\bsuriyeliler\b.*(defol|sikeyim)/i.test(s);
        const severeScam = /\b(seed|private\s*key|mnemonic|wallet)\b/i.test(s) || /https?:\/\/\S+/i.test(s);
        preOverride = severeHate || severeScam;
      } catch {}
      if ((now - last) < this.cfg.USER_COOLDOWN_MS && !preOverride) { this.logger.info('[TrustKit] cooldown skip for', uid); return null; }

      // LLM analiz
      let res;
      try {
        if (this.analyzer?.analyze) res = await this.analyzer.analyze(message);
        else {
          const judge = await runLLMJudge(this._llm, content, this.logger);
          res = judgeToIntents(judge);
          res.trace = judge.trace;
          res.step1 = judge.step1;
        }
      } catch (e) {
        this.logger.error('[TrustKit] analyzer.analyze error', { err: e?.stack || e?.message || String(e), preview: content.slice(0,140) });
        return null;
      }
      this.logger.info('[TrustKit] analyzer result', { intents: res?.intents || [] });

      // FUD sinyali (opsiyonel)
      let fudSeverity = 0;
      if (pol?.FUD?.ENABLED) {
        try { fudSeverity = await detectFUD(this._llm, this.logger, content); }
        catch (e) { this.logger.warn('[TrustKit] detectFUD failed', e?.message || String(e)); }
        this.logger.info('[TrustKit] FUD severity', { fudSeverity });
      }

      const intents = Array.isArray(res?.intents) ? res.intents : [];
      if (!intents.length && fudSeverity < 1) return null;

      // Puan
      let delta = 0;
      const tags = [];
      for (const it of intents) {
        const conf = this.cfg.PENALTIES?.[String(it.label||'').toLowerCase()];
        const sev = Math.max(1, Math.min(3, parseInt(it?.severity ?? 1, 10) || 1));
        if (!conf) continue;
        const drop = Math.min(conf.base * sev, conf.maxPerMsg);
        delta -= drop;
        tags.push(`${it.label}:${sev}(-${drop})`);
      }
      if (delta === 0 && fudSeverity < 1) return null;
      delta = this._capPerMinute(uid, delta);

      // Skor yaz
      let next = 100;
      try {
        next = this.store.applyPenalty(gid, uid, delta, { tags, reason: 'intent', source: 'judge', msgId: message.id });
      } catch (e) {
        this.logger.error('[TrustKit] applyPenalty error', { err: e?.stack || e?.message || String(e), gid, uid, delta, tags });
        return null;
      }
      this._cooldown.set(uid, Date.now());

      // DB & Summary (best effort)
      try {
        const { applyPenaltyToDb, getEventsForSummary, getSummary, upsertSummary, getUserScore } = require('./db');
        const { updateUserSummary } = require('./summary');
        applyPenaltyToDb({
          gid, uid, delta,
          label: (intents[0]?.label || 'intent'),
          severity: (intents[0]?.severity || 1),
          reason: res?.step1?.reason || 'judge',
          tags, messageId: message.id, channelId: message.channel?.id
        });

        const nowMs = Date.now();
        if ((this._sumCooldown.get(uid) || 0) <= nowMs) {
          const prev = getSummary(gid, uid)?.summary || '';
          const events = getEventsForSummary(gid, uid);
          const userObj = await message.guild.members.fetch(uid).catch(()=>null);
          const username = userObj?.user?.tag || userObj?.user?.username || uid;

          const upd = await updateUserSummary(this._llm, this.logger, {
            username,
            score: getUserScore(gid, uid),
            events,
            prevSummary: prev
          });
          const packed = [
            upd.summary,
            upd.risk_flags?.length ? `\n\nRisk Flags:\n- ${upd.risk_flags.join('\n- ')}` : '',
            upd.advice ? `\n\nAdvice:\n${upd.advice}` : ''
          ].join('');
          upsertSummary(gid, uid, packed.trim());
          this._sumCooldown.set(uid, nowMs + 30_000);
        }
      } catch (e) {
        this.logger.warn('[TrustKit] DB/Summary persist failed', e?.message || String(e));
      }

      // --- Politika/Aksiyonlar ---
      const steps = [];
      try {
        // 1) Sunucu politikası
        const policyObj = this.policy.get(gid);
        const actions = this.policy.decide(intents, gid);

        const pushTimeout = (secs, reason) => {
          let s = parseInt(secs || 0, 10);
          if (!Number.isFinite(s) || s < MIN_TIMEOUT_SECS) s = DEFAULT_TIMEOUT_SECS;
          // hem seconds hem duration alanını doldur → handler hangisini okuyorsa
          steps.push({
            tool: 'discord.request',
            params: { action: 'member.timeout', userId: uid, seconds: s, duration: s, reason: reason || 'Timeout' },
            id: `timeout-${uid}-${Date.now()}`
          });
        };

        for (const act of actions) {
          const t = (act.type || '').toLowerCase();
          if (t === 'ban') {
            steps.push({ tool: 'discord.request', params: { action: 'member.ban', userId: uid, reason: act.reason || 'Policy: ban' }, id: `policy-ban-${uid}` });
          } else if (t === 'timeout') {
            pushTimeout(act.seconds, act.reason || 'Policy: timeout');
          } else if (t === 'witty-reply' && policyObj?.WITTY_REPLY_ENABLED !== false && typeof generateWittyReply === 'function') {
            try {
              const witty = await generateWittyReply(this._llm, content, (intents[0]?.label || 'moderation'));
              if (!policyObj?.QUIET_MODE && witty) { try { await message.channel.send(witty); } catch {} }
            } catch (e) { this.logger.warn('[TrustKit] witty reply failed', e?.message || String(e)); }
          }
        }

        // 2) Eşik tabanlı fallback (KANAL SLOWMODE KALDIRILDI)
        if (!actions.length) {
          const T = this.cfg.THRESHOLDS;
          if (next <= T.MUTE && next > T.BAN) {
            pushTimeout(this.cfg.TIMEOUTS?.soft, 'Trust threshold');
          }
          if (next <= T.BAN) {
            steps.push({ tool: 'discord.request', params: { action: 'member.ban', userId: uid, reason: 'Trust threshold' }, id: `ban-${uid}` });
          }
        }

        // 3) Kanala duyuru (sade)
        if (policyObj?.ANNOUNCE_IN_CHANNEL !== false) {
          const locale = detectLocale(content);
          let warning = null;
          if (policyObj?.WARNINGS_VIA_LLM && !policyObj?.SHOW_SCORE_ONLY) {
            try { warning = await makeWarning(this._llm, this.logger, content, intents, locale); }
            catch (e) { this.logger.warn('[TrustKit] makeWarning failed', e?.message || String(e)); }
          }
          const lineScore = `📊 <@${uid}> score: **${next}** (${delta})`;
          const out = policyObj?.QUIET_MODE || policyObj?.SHOW_SCORE_ONLY
            ? lineScore
            : (warning ? `⚠️ ${warning}\n${lineScore}` : lineScore);
          try { await message.channel.send(out.slice(0, 1900)); } catch (e) { this.logger.warn('[TrustKit] channel.send failed', e?.message || String(e)); }
        }

      } catch (e) {
        this.logger.warn('[TrustKit] policy actions failed', e?.message || String(e));
      }

      return steps.length ? { steps, meta: { strategy: 'sequential' } } : null;

    } catch (e) {
      this.logger.error('[TrustKit] observeMessage exception', e?.stack || e?.message || String(e));
      return null;
    }
  }
}

module.exports = { TrustMiddleware };

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
