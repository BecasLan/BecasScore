// trustkit/store.js
// DB-backed TrustStore (SQLite via better-sqlite3). Falls back to memory if DB kapalı/çöker.

let Database = null;
try { Database = require('better-sqlite3'); } catch { /* dependency yoksa memory fallback */ }

class TrustStore {
  constructor(logger, cfg = {}) {
    this.logger = logger;
    this.cfg = cfg || {};
    this.ok = true;

    // memory fallback yapılarını da hazır tut
    this._memScores = new Map();   // gid -> Map(uid -> score)
    this._memHist   = new Map();   // `${gid}:${uid}` -> events[]
    this._memSeen   = new Map();   // `${gid}:${msgId}` -> ts

    this._db = null;
    this._stmts = {};

    // DB etkin mi?
    const dbEnabled = !!(this.cfg.DB_ENABLED || process.env.DB_ENABLED === 'true');
    const dbUrl = (this.cfg.DB_URL || process.env.DB_URL || '').trim();

    if (dbEnabled && Database && dbUrl.startsWith('sqlite:')) {
      const file = dbUrl.replace(/^sqlite:/, '');
      try {
        this._db = new Database(file, { fileMustExist: false, timeout: 5000 });
        this._db.pragma('journal_mode = WAL');
        this._initSchema();
        this._prepareStatements();
        this.logger?.info?.(`[TrustStore] DB ready: ${file}`);
      } catch (e) {
        this.logger?.error?.('[TrustStore] DB init failed → using memory:', e?.message || String(e));
        this._db = null;
      }
    } else if (dbEnabled && !Database) {
      this.logger?.warn?.('[TrustStore] better-sqlite3 yok → memory fallback (npm i better-sqlite3)');
    } else {
      this.logger?.info?.('[TrustStore] DB disabled → memory mode');
    }
  }

  /* ==================== DB schema & statements ==================== */
  _initSchema() {
    const sql = `
      CREATE TABLE IF NOT EXISTS scores (
        gid   TEXT NOT NULL,
        uid   TEXT NOT NULL,
        score INTEGER NOT NULL,
        PRIMARY KEY (gid, uid)
      );
      CREATE TABLE IF NOT EXISTS events (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        ts     INTEGER NOT NULL,
        gid    TEXT NOT NULL,
        uid    TEXT NOT NULL,
        delta  INTEGER NOT NULL,
        next   INTEGER NOT NULL,
        tags   TEXT,         -- JSON string
        reason TEXT,
        source TEXT,
        msgId  TEXT
      );
      CREATE TABLE IF NOT EXISTS seen_messages (
        gid   TEXT NOT NULL,
        msgId TEXT NOT NULL,
        ts    INTEGER NOT NULL,
        PRIMARY KEY (gid, msgId)
      );
      CREATE INDEX IF NOT EXISTS idx_events_gid_uid_ts ON events(gid, uid, ts);
    `;
    this._db.exec(sql);
  }

  _prepareStatements() {
    this._stmts.getScore   = this._db.prepare(`SELECT score FROM scores WHERE gid=? AND uid=?`);
    this._stmts.upsertScore= this._db.prepare(`INSERT INTO scores (gid,uid,score) VALUES(?,?,?)
                                               ON CONFLICT(gid,uid) DO UPDATE SET score=excluded.score`);
    this._stmts.insertEvent= this._db.prepare(`INSERT INTO events (ts,gid,uid,delta,next,tags,reason,source,msgId)
                                               VALUES (?,?,?,?,?,?,?,?,?)`);
    this._stmts.getHistory = this._db.prepare(`SELECT ts,delta,next,tags,reason,source,msgId
                                               FROM events WHERE gid=? AND uid=? ORDER BY ts ASC`);
    this._stmts.getSeen    = this._db.prepare(`SELECT ts FROM seen_messages WHERE gid=? AND msgId=?`);
    this._stmts.upsertSeen = this._db.prepare(`INSERT INTO seen_messages (gid,msgId,ts) VALUES (?,?,?)
                                               ON CONFLICT(gid,msgId) DO UPDATE SET ts=excluded.ts`);
    this._stmts.cleanSeen  = this._db.prepare(`DELETE FROM seen_messages WHERE ts < ?`);
  }

  /* ==================== Helpers ==================== */
  _memUserMap(gid) {
    let m = this._memScores.get(gid);
    if (!m) { m = new Map(); this._memScores.set(gid, m); }
    return m;
  }

  _clampScore(val) {
    const v = Math.max(0, Math.min(100, parseInt(val, 10) || 100));
    return v;
  }

  /* ==================== Public API ==================== */

  getScore(gid, uid) {
    try {
      if (this._db) {
        const row = this._stmts.getScore.get(gid, uid);
        return row ? this._clampScore(row.score) : 100;
      } else {
        const m = this._memUserMap(gid);
        return Number.isFinite(m.get(uid)) ? m.get(uid) : 100;
      }
    } catch (e) {
      this.logger?.error?.('[TrustStore] getScore error:', e?.message || String(e));
      return 100;
    }
  }

  setScore(gid, uid, value) {
    try {
      const v = this._clampScore(value);
      if (this._db) {
        this._stmts.upsertScore.run(gid, uid, v);
      } else {
        this._memUserMap(gid).set(uid, v);
      }
      return v;
    } catch (e) {
      this.logger?.error?.('[TrustStore] setScore error:', e?.message || String(e));
      return 100;
    }
  }

  resetScore(gid, uid) {
    return this.setScore(gid, uid, 100);
  }

  /**
   * Ceza uygula (delta ≤ 0 beklenir; pozitif gelirse 0 sayar)
   * returns nextScore
   */
  applyPenalty(gid, uid, delta, meta = {}) {
    try {
      let d = Number(delta);
      if (!Number.isFinite(d)) d = 0;
      if (d > 0) d = 0;

      const prev = this.getScore(gid, uid);
      let next = prev + d;
      if (next > prev) next = prev;
      if (next < 0) next = 0;

      // write score
      this.setScore(gid, uid, next);

      // write event
      const evt = {
        ts: Date.now(),
        gid, uid,
        delta: d,
        next,
        tags: JSON.stringify(Array.isArray(meta.tags) ? meta.tags.slice(0, 50) : []),
        reason: meta.reason || '',
        source: meta.source || '',
        msgId: meta.msgId || ''
      };

      if (this._db) {
        this._stmts.insertEvent.run(evt.ts, gid, uid, evt.delta, evt.next, evt.tags, evt.reason, evt.source, evt.msgId);
      } else {
        const key = `${gid}:${uid}`;
        const arr = this._memHist.get(key) || [];
        arr.push(evt);
        if (arr.length > 5000) arr.shift();
        this._memHist.set(key, arr);
      }

      return next;
    } catch (e) {
      this.logger?.error?.('[TrustStore] applyPenalty exception:', e?.stack || e?.message || String(e));
      return this.getScore(gid, uid);
    }
  }

  /**
   * Idempotency: aynı mesajı kısa sürede tekrar işlemeyi engelle
   * returns true → zaten görülmüş (skip edilebilir)
   */
  seenMessage(gid, msgId, windowMs = 15000) {
    try {
      const now = Date.now();
      if (this._db) {
        // temizlik (nadiren)
        try { this._stmts.cleanSeen.run(now - windowMs * 2); } catch {}
        const row = this._stmts.getSeen.get(gid, msgId);
        if (row) {
          const ts = row.ts;
          if (now - ts <= windowMs) {
            return true;
          }
        }
        this._stmts.upsertSeen.run(gid, msgId, now);
        return false;
      } else {
        const key = `${gid}:${msgId}`;
        const prev = this._memSeen.get(key);
        if (prev && (now - prev) <= windowMs) return true;
        this._memSeen.set(key, now);
        // hafif temizlik
        if (this._memSeen.size > 50000) {
          const cutoff = now - windowMs * 2;
          for (const [k, ts] of this._memSeen) {
            if (ts < cutoff) this._memSeen.delete(k);
          }
        }
        return false;
      }
    } catch (e) {
      this.logger?.warn?.('[TrustStore] seenMessage error:', e?.message || String(e));
      return false;
    }
  }

  /**
   * Kullanıcı geçmişi (en eski→en yeni)
   */
  history(gid, uid, limit = 50) {
    try {
      if (this._db) {
        const rows = this._stmts.getHistory.all(gid, uid);
        const out = rows.map(r => ({
          ts: r.ts,
          delta: r.delta,
          next: r.next,
          tags: safeParseJson(r.tags, []),
          reason: r.reason,
          source: r.source,
          msgId: r.msgId
        }));
        if (limit && out.length > limit) {
          return out.slice(out.length - limit);
        }
        return out;
      } else {
        const key = `${gid}:${uid}`;
        const arr = this._memHist.get(key) || [];
        if (!limit || limit >= arr.length) return arr.slice();
        return arr.slice(arr.length - limit);
      }
    } catch (e) {
      this.logger?.error?.('[TrustStore] history error:', e?.message || String(e));
      return [];
    }
  }
}

function safeParseJson(s, def) {
  try { return JSON.parse(s); } catch { return def; }
}

module.exports = { TrustStore };
