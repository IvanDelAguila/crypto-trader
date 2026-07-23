// db.js — Persistencia en archivo JSON: capital, posiciones abiertas y trades cerrados
// sobreviven a reinicios/redeploys (siempre que DATA_DIR apunte a un volumen persistente).
//
// Se usa JSON plano en vez de un driver SQLite nativo para evitar problemas de
// compilación (node-gyp/Python) en el entorno de build de Railway.

const path = require("path");
const fs   = require("fs");

const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const filePath = path.join(dataDir, "trading.json");

function load() {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      state:     parsed.state     || {},
      positions: parsed.positions || [],
      trades:    parsed.trades    || [],
    };
  } catch (e) {
    return { state: {}, positions: [], trades: [] };
  }
}

let data = load();

// Escritura atómica: escribe a un archivo temporal y renombra, para no
// dejar el archivo corrupto si el proceso muere a mitad de un write.
function persist() {
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, filePath);
}

// ── Estado simple clave/valor (capital, autoTrade, etc.) ─────────────────────
function getState(key, fallback) {
  return key in data.state ? data.state[key] : fallback;
}

function setState(key, value) {
  data.state[key] = value;
  persist();
}

// ── Posiciones abiertas ───────────────────────────────────────────────────────
function insertPosition(p) {
  data.positions.push({
    id: p.id, symbol: p.symbol, strategy: p.strategy, type: p.type,
    entryPrice: p.entryPrice, size: p.size, allocation: p.allocation,
    tp: p.tp, sl: p.sl, confidence: p.confidence, reason: p.reason,
    details: p.details || {},
    openTime: new Date(p.openTime).toISOString(),
  });
  persist();
}

function deletePosition(id) {
  data.positions = data.positions.filter(p => p.id !== id);
  persist();
}

function updatePosition(id, patch) {
  const pos = data.positions.find(p => p.id === id);
  if (!pos) return;
  Object.assign(pos, patch);
  persist();
}

function getPositions() {
  return data.positions.map(p => ({
    ...p,
    openTime: new Date(p.openTime),
    pnl: 0,
    pnlPct: 0,
    currentPrice: p.entryPrice,
  }));
}

// ── Trades cerrados ───────────────────────────────────────────────────────────
function insertTrade(t) {
  data.trades.unshift({
    id: t.id, symbol: t.symbol, strategy: t.strategy, type: t.type,
    entryPrice: t.entryPrice, size: t.size, allocation: t.allocation,
    tp: t.tp, sl: t.sl, confidence: t.confidence, reason: t.reason,
    details: t.details || {},
    openTime: new Date(t.openTime).toISOString(),
    closePrice: t.closePrice, closePnl: t.closePnl, closePnlPct: t.closePnlPct,
    closeTime: new Date(t.closeTime).toISOString(),
    closeReason: t.closeReason, duration: t.duration,
  });
  if (data.trades.length > 200) data.trades.length = 200;
  persist();
}

function getTrades(limit = 200) {
  return data.trades.slice(0, limit).map(t => ({
    ...t,
    openTime: new Date(t.openTime),
    closeTime: new Date(t.closeTime),
  }));
}

function clearAll() {
  data = { state: {}, positions: [], trades: [] };
  persist();
}

module.exports = {
  getState, setState,
  insertPosition, deletePosition, updatePosition, getPositions,
  insertTrade, getTrades, clearAll,
};
