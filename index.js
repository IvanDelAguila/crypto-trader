// index.js — Punto de entrada principal del bot
require("dotenv").config();

const config        = require("./config");
const TradingEngine = require("./engine");
const ApiServer     = require("./server");
const binance       = require("./binance");
const { evalAllStrategies } = require("./strategies");

// ── Colores para consola ──────────────────────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  bright: "\x1b[1m",
  cyan:   "\x1b[36m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  gray:   "\x1b[90m",
  white:  "\x1b[37m",
  magenta:"\x1b[35m",
};

const log = {
  info:    (...a) => console.log(`${c.cyan}[INFO]${c.reset}`, ...a),
  signal:  (...a) => console.log(`${c.magenta}[SIGNAL]${c.reset}`, ...a),
  trade:   (...a) => console.log(`${c.green}[TRADE]${c.reset}`, ...a),
  close:   (...a) => console.log(`${c.yellow}[CLOSE]${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.yellow}[WARN]${c.reset}`, ...a),
  error:   (...a) => console.log(`${c.red}[ERROR]${c.reset}`, ...a),
  stat:    (...a) => console.log(`${c.gray}[STAT]${c.reset}`, ...a),
};

const fmt  = (n, d = 2) => Number(n).toFixed(d);
const fmtP = (n) => (n >= 0 ? "+" : "") + fmt(n) + "%";

// ── Data Store ────────────────────────────────────────────────────────────────
const dataStore = {
  prices:       {},
  changes:      {},
  fundingRates: {},
  priceHistory: {},   // { SYMBOL: [price, price, ...] }  máx 200 velas
  lastUpdate:   null,
};

// ── Init ──────────────────────────────────────────────────────────────────────
const engine = new TradingEngine();
const server = new ApiServer(engine, dataStore);

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner() {
  console.log(`
${c.cyan}${c.bright}╔══════════════════════════════════════════╗
║         CRYPTO TRADER BOT v1.0           ║
║      Paper Trading — Binance Data        ║
╚══════════════════════════════════════════╝${c.reset}

  Capital inicial : ${c.green}$${config.initialCapital}${c.reset}
  Apalancamiento  : ${c.yellow}${config.leverage}x${c.reset}
  Modo            : ${c.cyan}${config.tradeMode.toUpperCase()}${c.reset}
  Auto-trade      : ${engine.autoTrade ? c.green + "ON" : c.red + "OFF"}${c.reset}
  Symbols         : ${c.gray}${config.symbols.join(", ")}${c.reset}
  Estrategias     : ${c.gray}EMA · RSI/BB · Funding Rate · Grid${c.reset}
  API Port        : ${c.cyan}${config.port}${c.reset}

`);
}

// ── Fetch precios ─────────────────────────────────────────────────────────────
async function fetchPrices() {
  try {
    const tickers = await binance.get24hrTicker(config.symbols);

    for (const [symbol, data] of Object.entries(tickers)) {
      dataStore.prices[symbol]  = data.price;
      dataStore.changes[symbol] = data.change24h;

      // Actualizar historial (máx 200 velas)
      if (!dataStore.priceHistory[symbol]) dataStore.priceHistory[symbol] = [];
      dataStore.priceHistory[symbol].push(data.price);
      if (dataStore.priceHistory[symbol].length > 200) {
        dataStore.priceHistory[symbol].shift();
      }

      // Actualizar PnL de posiciones abiertas
      const result = engine.updatePositionPrice(symbol, data.price);
      if (result.closed.length > 0) {
        for (const trade of result.closed) {
          const emoji  = trade.closePnl >= 0 ? "✅" : "❌";
          const reason = trade.closeReason === "take-profit" ? "TAKE PROFIT" : trade.closeReason === "stop-loss" ? "STOP LOSS" : "MANUAL";
          log.close(`${emoji} ${trade.symbol} ${trade.strategy} ${reason} | PnL: ${trade.closePnl >= 0 ? c.green : c.red}$${fmt(trade.closePnl)}${c.reset} (${fmtP(trade.closePnlPct)}) | Duración: ${trade.duration}m`);
          server.broadcast("trade_closed", trade);
        }
      }
    }

    dataStore.lastUpdate = new Date().toISOString();
    server.broadcast("prices", { prices: dataStore.prices, changes: dataStore.changes });

  } catch (err) {
    log.error("fetchPrices:", err.message);
  }
}

// ── Fetch funding rates ───────────────────────────────────────────────────────
async function fetchFundingRates() {
  try {
    const rates = await binance.getFundingRates(config.symbols);
    Object.assign(dataStore.fundingRates, rates);
    log.info(`Funding rates actualizados (${Object.keys(rates).length} símbolos)`);
  } catch (err) {
    log.error("fetchFundingRates:", err.message);
  }
}

// ── Cargar historial inicial ──────────────────────────────────────────────────
async function loadInitialHistory() {
  log.info("Cargando historial de velas (esto puede tardar ~30s)...");
  let loaded = 0;

  for (const symbol of config.symbols) {
    try {
      const closes = await binance.getKlines(symbol, "15m", 150);
      dataStore.priceHistory[symbol] = closes;
      loaded++;
      process.stdout.write(`  ${c.gray}${symbol} ✓${c.reset} `);
      // Pequeña pausa para no saturar la API
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      log.warn(`No se pudo cargar historial de ${symbol}: ${err.message}`);
    }
  }

  console.log(`\n${c.green}  ${loaded}/${config.symbols.length} símbolos cargados${c.reset}\n`);
}

// ── Evaluar señales ───────────────────────────────────────────────────────────
function evaluateSignals() {
  let newSignals = 0;

  for (const symbol of config.symbols) {
    const prices      = dataStore.priceHistory[symbol] || [];
    const fundingRate = dataStore.fundingRates[symbol];

    if (prices.length < 30) continue;

    const signals = evalAllStrategies(symbol, prices, fundingRate);

    for (const signal of signals) {
      const full = engine.addSignal(signal);

      log.signal(
        `📡 ${c.bright}${config.symbolMeta[symbol]?.short || symbol}${c.reset}` +
        ` ${signal.type === "LONG" ? c.green + "LONG" : c.red + "SHORT"}${c.reset}` +
        ` [${signal.strategy}]` +
        ` conf: ${signal.confidence.toFixed(0)}%` +
        ` | ${signal.reason}`
      );

      newSignals++;
      server.broadcast("signal", full);

      // Auto-trade si está activado y confianza suficiente
      if (engine.autoTrade && signal.confidence >= config.minConfidence) {
        const result = engine.openPosition(signal);
        if (result.success) {
          log.trade(
            `🚀 ABRIENDO ${signal.type} ${config.symbolMeta[symbol]?.short}` +
            ` [${signal.strategy}]` +
            ` @ $${fmt(signal.price)}` +
            ` | alloc: $${fmt(result.position.allocation)}` +
            ` | TP: $${fmt(signal.tp)} SL: $${fmt(signal.sl)}`
          );
          server.broadcast("position_opened", result.position);
        }
      }
    }
  }

  return newSignals;
}

// ── Log periódico de estado ───────────────────────────────────────────────────
function logStatus() {
  const stats  = engine.getFullStats();
  const equity = engine.totalEquity;
  const ret    = engine.totalReturn;

  console.log(`
${c.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.bright}  RESUMEN — ${new Date().toLocaleTimeString()}${c.reset}
  Equity    : ${ret >= 0 ? c.green : c.red}$${fmt(equity)} (${fmtP(ret)})${c.reset}
  Capital   : $${fmt(engine.freeCapital)} libre
  Trades    : ${stats.totalTrades} totales | Win: ${stats.winRate}%
  PnL total : ${parseFloat(stats.totalPnL) >= 0 ? c.green : c.red}$${fmt(stats.totalPnL)}${c.reset}
  Posiciones: ${engine.positions.length} abiertas
  Auto-trade: ${engine.autoTrade ? c.green + "ON" : c.red + "OFF"}${c.reset}
  Uptime    : ${stats.uptime}m
${c.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);

  // Posiciones abiertas
  if (engine.positions.length > 0) {
    console.log(`\n  ${c.bright}Posiciones abiertas:${c.reset}`);
    for (const p of engine.positions) {
      const short = config.symbolMeta[p.symbol]?.short || p.symbol;
      const pnlColor = p.pnl >= 0 ? c.green : c.red;
      console.log(
        `  ${short} ${p.type === "LONG" ? c.green + "L" : c.red + "S"}${c.reset}` +
        ` [${p.strategy}]` +
        ` entry: $${fmt(p.entryPrice)}` +
        ` → now: $${fmt(p.currentPrice || p.entryPrice)}` +
        ` | ${pnlColor}$${fmt(p.pnl)} (${fmtP(p.pnlPct)})${c.reset}`
      );
    }
    console.log();
  }

  server.broadcast("status", engine.getState());
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  // 1. Iniciar servidor API
  server.start();

  // 2. Cargar historial inicial de velas para tener señales desde el arranque
  await loadInitialHistory();

  // 3. Primer fetch de precios y funding
  await fetchPrices();
  await fetchFundingRates();

  // 4. Primera evaluación de señales
  evaluateSignals();

  // 5. Loops periódicos
  setInterval(fetchPrices,       config.priceInterval);
  setInterval(fetchFundingRates, config.fundingInterval);
  setInterval(evaluateSignals,   config.signalInterval);
  setInterval(logStatus,         config.logInterval);

  // Log inicial de estado
  logStatus();

  log.info("Bot corriendo. Ctrl+C para detener.\n");
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on("SIGINT",  () => { log.info("Deteniendo bot..."); process.exit(0); });
process.on("SIGTERM", () => { log.info("Deteniendo bot..."); process.exit(0); });
process.on("uncaughtException",  err => log.error("Uncaught:", err.message));
process.on("unhandledRejection", err => log.error("Unhandled:", err));

main().catch(err => { log.error("Fatal:", err); process.exit(1); });
