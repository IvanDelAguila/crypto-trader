// db.js — Persistencia SQLite: capital, posiciones abiertas y trades cerrados
// sobreviven a reinicios/redeploys (siempre que DATA_DIR apunte a un volumen persistente)

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "trading.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    key   TEXT PRIMARY KEY,
    value TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS positions (
    id           TEXT PRIMARY KEY,
    symbol       TEXT,
    strategy     TEXT,
    type         TEXT,
    entryPrice   REAL,
    size         REAL,
    allocation   REAL,
    tp           REAL,
    sl           REAL,
    confidence   REAL,
    reason       TEXT,
    details      TEXT,
    openTime     TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id           TEXT,
    symbol       TEXT,
    strategy     TEXT,
    type         TEXT,
    entryPrice   REAL,
    size         REAL,
    allocation   REAL,
    tp           REAL,
    sl           REAL,
    confidence   REAL,
    reason       TEXT,
    details      TEXT,
    openTime     TEXT,
    closePrice   REAL,
    closePnl     REAL,
    closePnlPct  REAL,
    closeTime    TEXT,
    closeReason  TEXT,
    duration     INTEGER
  )
`);

// ── Estado simple clave/valor (capital, autoTrade, etc.) ─────────────────────
function getState(key, fallback) {
  const row = db.prepare(`SELECT value FROM state WHERE key = ?`).get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setState(key, value) {
  db.prepare(`
    INSERT INTO state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

// ── Posiciones abiertas ───────────────────────────────────────────────────────
function insertPosition(p) {
  db.prepare(`
    INSERT INTO positions (id, symbol, strategy, type, entryPrice, size, allocation, tp, sl, confidence, reason, details, openTime)
    VALUES (@id, @symbol, @strategy, @type, @entryPrice, @size, @allocation, @tp, @sl, @confidence, @reason, @details, @openTime)
  `).run({
    id: p.id, symbol: p.symbol, strategy: p.strategy, type: p.type,
    entryPrice: p.entryPrice, size: p.size, allocation: p.allocation,
    tp: p.tp, sl: p.sl, confidence: p.confidence, reason: p.reason,
    details: JSON.stringify(p.details || {}),
    openTime: new Date(p.openTime).toISOString(),
  });
}

function deletePosition(id) {
  db.prepare(`DELETE FROM positions WHERE id = ?`).run(id);
}

function getPositions() {
  return db.prepare(`SELECT * FROM positions`).all().map(r => ({
    ...r,
    details: JSON.parse(r.details || "{}"),
    openTime: new Date(r.openTime),
    pnl: 0,
    pnlPct: 0,
    currentPrice: r.entryPrice,
  }));
}

// ── Trades cerrados ───────────────────────────────────────────────────────────
function insertTrade(t) {
  db.prepare(`
    INSERT INTO trades (id, symbol, strategy, type, entryPrice, size, allocation, tp, sl, confidence, reason, details, openTime, closePrice, closePnl, closePnlPct, closeTime, closeReason, duration)
    VALUES (@id, @symbol, @strategy, @type, @entryPrice, @size, @allocation, @tp, @sl, @confidence, @reason, @details, @openTime, @closePrice, @closePnl, @closePnlPct, @closeTime, @closeReason, @duration)
  `).run({
    id: t.id, symbol: t.symbol, strategy: t.strategy, type: t.type,
    entryPrice: t.entryPrice, size: t.size, allocation: t.allocation,
    tp: t.tp, sl: t.sl, confidence: t.confidence, reason: t.reason,
    details: JSON.stringify(t.details || {}),
    openTime: new Date(t.openTime).toISOString(),
    closePrice: t.closePrice, closePnl: t.closePnl, closePnlPct: t.closePnlPct,
    closeTime: new Date(t.closeTime).toISOString(),
    closeReason: t.closeReason, duration: t.duration,
  });
}

function getTrades(limit = 200) {
  return db.prepare(`SELECT * FROM trades ORDER BY rowid DESC LIMIT ?`).all(limit).map(r => ({
    ...r,
    details: JSON.parse(r.details || "{}"),
    openTime: new Date(r.openTime),
    closeTime: new Date(r.closeTime),
  }));
}

function clearAll() {
  db.exec(`DELETE FROM positions`);
  db.exec(`DELETE FROM trades`);
  db.exec(`DELETE FROM state`);
}

module.exports = {
  db, getState, setState,
  insertPosition, deletePosition, getPositions,
  insertTrade, getTrades, clearAll,
};
