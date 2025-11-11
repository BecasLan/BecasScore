// trustkit/trustAdmin.js
// Admin/mod komutları: "becas ..." prefiksiyle çalışır.
// - Skor / sicil sorguları
// - Policy yönetimi (list/clear, SHOW_SCORE_ONLY toggle, witty on/off passthrough)
// - Manuel timeout (ceza)
// Not: PolicyEngine zaten "becas <label> timeout 10m" ve "becas witty on/off" komutlarını içerden emiyor.
// Buradaki TrustAdmin ise görünür yönetim komutlarını toplar ve route eder.

const ms = require('ms');

function isPrivileged(message) {
  try {
    const m = message.member;
    if (!m) return false;
    if (m.permissions?.has?.('Administrator')) return true;
    if (m.permissions?.has?.('ManageGuild')) return true;
    const names = (m.roles?.cache ? Array.from(m.roles.cache.values()).map(r => r.name.toLowerCase()) : []);
    return names.some(n =>
      n.includes('admin') || n.includes('mod') || n.includes('moderator') || n.includes('yönetici')
    );
  } catch {
    return false;
  }
}

function fmtUser(u) {
  return u?.id ? `<@${u.id}>` : 'user';
}

class TrustAdmin {
  /**
   * @param {object} deps
   *  - store: TrustStore (getScore(uid,gid), setScore, addEvent, getEvents? (opsiyonel))
   *  - policy: PolicyEngine
   *  - logger
   *  - cfg: { PREFIX?: string }
   *  - analyzer? (opsiyonel; gelecekte özetleyici istersen)
   */
  constructor({ store, policy, logger, cfg = {}, analyzer }) {
    this.store = store;
    this.policy = policy;
    this.logger = logger;
    this.cfg = cfg;
    this.analyzer = analyzer;
    this.prefix = (cfg.PREFIX || 'becas').toLowerCase();
  }

  /**
   * Mesaj komutlarını yakala. "becas " ile başlamalı.
   * true dönerse komutu biz işledik demektir.
   */
  async handle(message) {
    const raw = (message?.content || '').trim();
    if (!raw.toLowerCase().startsWith(this.prefix + ' ')) return false;

    const args = raw.slice(this.prefix.length).trim().split(/\s+/);
    const cmd = (args.shift() || '').toLowerCase();

    // Genel kullanıcıların erişebileceği komutlar:
    if (cmd === 'score' || (cmd === 'my' && (args[0] || '').toLowerCase() === 'score')) {
      // becas score  |  becas my score
      return await this._cmdScore(message, args);
    }
    if (cmd === 'record' || cmd === 'history') {
      // becas record [@user]
      // becas history [@user]
      return await this._cmdHistory(message, args);
    }

    // Aşağıdakiler yetki ister:
    if (!isPrivileged(message)) {
      await message.reply('⛔ Bu komutu kullanmak için yetkin yok.');
      return true;
    }

    // Policy görüntüleme / temizleme
    if (cmd === 'policy') {
      const sub = (args.shift() || '').toLowerCase();
      if (sub === 'list') return await this._cmdPolicyList(message);
      if (sub === 'clear') return await this._cmdPolicyClear(message);
      await message.reply('ℹ️ Kullanım: `becas policy list` | `becas policy clear`');
      return true;
    }

    // Gösterim modu
    if (cmd === 'show-score-only') {
      const val = (args.shift() || '').toLowerCase();
      if (val === 'on' || val === 'off') {
        this.policy.flags.SHOW_SCORE_ONLY = (val === 'on');
        await message.reply(`✅ SHOW_SCORE_ONLY: **${this.policy.flags.SHOW_SCORE_ONLY ? 'ON' : 'OFF'}**`);
        return true;
      }
      await message.reply('ℹ️ Kullanım: `becas show-score-only on|off`');
      return true;
    }

    // Witty (passthrough; PolicyEngine de bunu emiyor ama burada da kısa yol veriyoruz)
    if (cmd === 'witty') {
      const val = (args.shift() || '').toLowerCase();
      if (val === 'on' || val === 'off') {
        // PolicyEngine.tryAbsorbNaturalCommand zaten dynamicRules ekleyecek
        // ama buradan da kullanıcıya olumlu dönüş sağlayalım:
        this.policy.dynamicRules.push({ kind: 'witty', enabled: (val === 'on') });
        await message.reply(`✅ witty: **${val.toUpperCase()}**`);
        return true;
      }
      await message.reply('ℹ️ Kullanım: `becas witty on|off`');
      return true;
    }

    // Manuel timeout: becas punish @user timeout 10m [reason...]
    if (cmd === 'punish') {
      return await this._cmdPunish(message, args);
    }

    // Bilinmeyen alt komutlar: PolicyEngine natural-language kısmı zaten "becas" ile başlayan
    // timeout kurallarını emecektir (örn: becas profanity timeout 10m)
    // Burada ayrıca mesaj verelim:
    await message.reply('ℹ️ Komutlar: `score`, `record`, `history`, `policy list|clear`, `show-score-only on|off`, `witty on|off`, `punish @user timeout <süre>`');
    return true;
  }

  async _cmdScore(message, args) {
    const mention = message.mentions?.users?.first?.();
    const target = mention || message.author;
    const gid = message.guild?.id;
    const score = await this.store.getScore(target.id, gid);
    await message.reply(`${fmtUser(target)} current score: **${score}**`);
    return true;
  }

  async _cmdHistory(message, args) {
    const mention = message.mentions?.users?.first?.();
    const target = mention || message.author;
    const gid = message.guild?.id;

    // Store'da getRecentEvents yoksa gracefully degrade
    const hasFn = typeof this.store.getRecentEvents === 'function';
    if (!hasFn) {
      await message.reply('ℹ️ Bu sunucuda ayrıntılı sicil listesi aktif değil.');
      return true;
    }

    const events = await this.store.getRecentEvents(target.id, gid, 10);
    if (!events || events.length === 0) {
      await message.reply(`${fmtUser(target)} için son sicil kaydı bulunamadı.`);
      return true;
    }

    const lines = events.map(e => {
      const labs = (e?.intents || []).map(i => `${i.label}/${i.severity}`).join(', ');
      const d = e?.delta || 0;
      return `• ${new Date(e.ts || Date.now()).toLocaleString()} — Δ ${d} — ${labs || 'none'} — “${(e.contentPreview || '').slice(0, 60)}”`;
    });

    await message.reply(`**${fmtUser(target)} — son ${events.length} kayıt:**\n${lines.join('\n')}`);
    return true;
  }

  async _cmdPolicyList(message) {
    const rules = this.policy.dynamicRules || [];
    if (rules.length === 0) {
      await message.reply('📭 Aktif dinamik kural yok.');
      return true;
    }
    const lines = rules.map((r, i) => {
      if (r.kind === 'timeout') return `${i+1}. timeout — label=${r.label}, seconds=${r.seconds}`;
      if (r.kind === 'witty') return `${i+1}. witty — enabled=${r.enabled !== false}`;
      return `${i+1}. ${r.kind}`;
    });
    await message.reply(`📜 Dinamik kurallar:\n${lines.join('\n')}`);
    return true;
  }

  async _cmdPolicyClear(message) {
    this.policy.dynamicRules = [];
    await message.reply('🧹 Dinamik kurallar temizlendi.');
    return true;
  }

  async _cmdPunish(message, args) {
    // beklenen: becas punish @user timeout 10m [reason...]
    const mention = message.mentions?.users?.first?.();
    if (!mention) {
      await message.reply('ℹ️ Kullanım: `becas punish @user timeout 10m [reason]`');
      return true;
    }
    const action = (args.shift() || '').toLowerCase(); // should be 'timeout'
    if (action !== 'timeout') {
      await message.reply('ℹ️ Şu an sadece `timeout` destekleniyor.');
      return true;
    }
    const durText = (args.shift() || '');
    if (!durText) {
      await message.reply('ℹ️ Süre belirt: örn `10m`, `1h`');
      return true;
    }
    const seconds = (() => {
      try {
        const v = ms(durText);
        return (typeof v === 'number' && v > 0) ? Math.floor(v / 1000) : 600;
      } catch { return 600; }
    })();
    const reason = args.join(' ').trim() || 'Manual punishment';

    try {
      const member = await message.guild.members.fetch(mention.id);
      await member.timeout(seconds * 1000, reason);
      await message.reply(`✅ ${fmtUser(mention)} timeout **${seconds}s** (${reason})`);
    } catch (e) {
      await message.reply(`⚠️ timeout başarısız: ${e?.message || String(e)}`);
    }
    return true;
  }
}

module.exports = { TrustAdmin };
