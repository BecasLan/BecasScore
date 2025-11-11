// trustkit/db.js
// Basit ve hızlı SQLite katmanı (better-sqlite3)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_URL = process.env.DB_URL || 'sqlite:./data/becas.db';
const SQLITE_PATH = DB_URL.startsWith('sqlite:') ? DB_URL.replace('sqlite:', '') : './data/becas.db';

const dir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  gid TEXT NOT NULL,
  uid TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (gid, uid)
);

CREATE TABLE IF NOT EXISTS violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gid TEXT NOT NULL,
  uid TEXT NOT NULL,
  label TEXT NOT NULL,
  severity INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT,
  tags TEXT,
  message_id TEXT,
  channel_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS summaries (
  gid TEXT NOT NULL,
  uid TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (gid, uid)
);
`);

const upsertUserStmt = db.prepare(`
INSERT INTO users (gid, uid, score, created_at, updated_at)
VALUES (@gid, @uid, @score, strftime('%s','now'), strftime('%s','now'))
ON CONFLICT(gid, uid) DO UPDATE SET
  score=excluded.score,
  updated_at=strftime('%s','now')
RETURNING score
`);

const getUserStmt = db.prepare(`SELECT gid, uid, score, created_at, updated_at FROM users WHERE gid=? AND uid=?`);

const insertViolStmt = db.prepare(`
INSERT INTO violations (gid, uid, label, severity, delta, reason, tags, message_id, channel_id)
VALUES (@gid, @uid, @label, @severity, @delta, @reason, @tags, @message_id, @channel_id)
`);

const getHistoryStmt = db.prepare(`
SELECT id, label, severity, delta, reason, tags, message_id, channel_id, created_at
FROM violations
WHERE gid=? AND uid=?
ORDER BY id DESC
LIMIT ?
`);

const getRecentForSummary = db.prepare(`
SELECT label, severity, delta, reason, tags, created_at
FROM violations
WHERE gid=? AND uid=?
ORDER BY id DESC
LIMIT 30
`);

const upsertSummaryStmt = db.prepare(`
INSERT INTO summaries (gid, uid, summary, updated_at)
VALUES (@gid, @uid, @summary, strftime('%s','now'))
ON CONFLICT(gid, uid) DO UPDATE SET
  summary=excluded.summary,
  updated_at=strftime('%s','now')
`);

const getSummaryStmt = db.prepare(`SELECT summary, updated_at FROM summaries WHERE gid=? AND uid=?`);

function applyPenaltyToDb({ gid, uid, delta, label, severity, reason, tags = [], messageId, channelId }) {
  // skor çek → delta uygula → yaz
  const current = getUserStmt.get(gid, uid);
  const next = Math.max(0, Math.min(100, (current?.score ?? 100) + delta));
  const ret = upsertUserStmt.get({ gid, uid, score: next });
  insertViolStmt.run({
    gid, uid,
    label: label || 'intent',
    severity: severity || 1,
    delta,
    reason: reason || null,
    tags: Array.isArray(tags) ? tags.join(',') : (tags || null),
    message_id: messageId || null,
    channel_id: channelId || null
  });
  return ret?.score ?? next;
}

function getUserScore(gid, uid) {
  const row = getUserStmt.get(gid, uid);
  return row?.score ?? 100;
}

function getUserHistory(gid, uid, limit = 10) {
  return getHistoryStmt.all(gid, uid, Math.max(1, Math.min(100, limit)));
}

function getEventsForSummary(gid, uid) {
  return getRecentForSummary.all(gid, uid);
}

function upsertSummary(gid, uid, summary) {
  upsertSummaryStmt.run({ gid, uid, summary });
}

function getSummary(gid, uid) {
  return getSummaryStmt.get(gid, uid);
}

module.exports = {
  db,
  applyPenaltyToDb,
  getUserScore,
  getUserHistory,
  getEventsForSummary,
  upsertSummary,
  getSummary
};
