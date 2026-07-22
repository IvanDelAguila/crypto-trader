// index.js — Punto de entrada principal del bot
require("dotenv").config();

const config        = require("./config");
const TradingEngine = require("./engine");
const ApiServer     = require("./server");
const binance       = require("./binance");
const sentiment     = require("./sentiment");
const learning      = require("./learning");
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
  orderBook:    {},   // { SYMBOL: -1..1 } desbalance compra/venta
  sentiment:    null, // { value, classification, updated }
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

      // priceHistory NO se toca acá — son velas reales de 15m, refrescadas
      // por separado en refreshCandleHistory(). Mezclar ticks de 3s aquí
      // corrompía el historial y rompía EMA/RSI/Bollinger/Grid.

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
  if (!config.strategies.FUNDING.enabled) return;
  try {
    const rates = await binance.getFundingRates(config.symbols);
    Object.assign(dataStore.fundingRates, rates);
    log.info(`Funding rates actualizados (${Object.keys(rates).length} símbolos)`);
  } catch (err) {
    log.error("fetchFundingRates:", err.message);
  }
}

// ── Fetch order book (desbalance compra/venta) ────────────────────────────────
async function fetchOrderBook() {
  await Promise.all(
    config.symbols.map(async (symbol) => {
      try {
        dataStore.orderBook[symbol] = await binance.getOrderBookImbalance(symbol);
      } catch (err) {
        // Silencioso: si falla, applyMarketContext simplemente no ajusta con esta señal
      }
    })
  );
}

// ── Fetch sentimiento de mercado (Fear & Greed) ────────────────────────────────
async function fetchSentiment() {
  try {
    dataStore.sentiment = await sentiment.getFearGreedIndex();
    log.info(`Sentimiento de mercado: ${dataStore.sentiment.value} (${dataStore.sentiment.classification})`);
  } catch (err) {
    log.warn("fetchSentiment:", err.message);
  }
}

// ── Ajustar confianza de una señal con el contexto de mercado disponible ──────
// No reemplaza la lógica de cada estrategia: la refuerza si el order book y el
// sentimiento están alineados, y la penaliza si van en contra, para evitar
// entrar justo antes de un movimiento adverso.
function applyMarketContext(signal, symbol) {
  const context = {};
  let confidence = signal.confidence;

  const imbalance = dataStore.orderBook[symbol];
  if (imbalance !== undefined) {
    const aligned = (signal.type === "LONG" && imbalance > 0) || (signal.type === "SHORT" && imbalance < 0);
    const adj = Math.abs(imbalance) * 15; // hasta ±15 puntos de confianza
    confidence += aligned ? adj : -adj;
    context.orderBookImbalance = Number(imbalance.toFixed(3));
  }

  const fg = dataStore.sentiment;
  if (fg) {
    if (fg.value >= 80 && signal.type === "LONG")  confidence -= 10; // greed extremo: cuidado comprando el techo
    if (fg.value <= 20 && signal.type === "SHORT") confidence -= 10; // fear extremo: cuidado vendiendo el piso
    context.sentiment = fg.value;
    context.sentimentClass = fg.classification;
  }

  signal.confidence = Math.max(0, Math.min(99, confidence));
  signal.details = { ...signal.details, marketContext: context };
}

// ── Cargar / refrescar historial de velas reales ─────────────────────────────
// Reemplaza priceHistory[symbol] por completo con las últimas 150 velas de
// 15m reales de Binance. Se llama al arranque y luego periódicamente, para
// que las estrategias siempre evalúen sobre velas reales, no ticks de 3s.
async function refreshCandleHistory(quiet = false) {
  if (!quiet) log.info("Cargando historial de velas (esto puede tardar ~30s)...");
  let loaded = 0;

  for (const symbol of config.symbols) {
    try {
      const closes = await binance.getKlines(symbol, "15m", 150);
      dataStore.priceHistory[symbol] = closes;
      loaded++;
      if (!quiet) process.stdout.write(`  ${c.gray}${symbol} ✓${c.reset} `);
      // Pequeña pausa para no saturar la API
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      log.warn(`No se pudo cargar historial de ${symbol}: ${err.message}`);
    }
  }

  if (!quiet) console.log(`\n${c.green}  ${loaded}/${config.symbols.length} símbolos cargados${c.reset}\n`);
  else log.info(`Historial de velas refrescado (${loaded}/${config.symbols.length} símbolos)`);
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
      applyMarketContext(signal, symbol);

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

      // Auto-trade si está activado y la confianza supera el umbral, ajustado
      // según qué tan bien viene funcionando esta combinación estrategia+símbolo
      const strategyMult    = learning.getStrategyMultiplier(signal.strategy, symbol);
      const effectiveMinConf = config.minConfidence + (1 - strategyMult) * 20;

      if (engine.autoTrade && signal.confidence >= effectiveMinConf) {
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
  await refreshCandleHistory();

  // 3. Primer fetch de precios, funding, order book y sentimiento
  await fetchPrices();
  await fetchFundingRates();
  await fetchOrderBook();
  await fetchSentiment();

  // 4. Primera evaluación de señales
  evaluateSignals();

  // 5. Loops periódicos
  setInterval(fetchPrices,             config.priceInterval);
  setInterval(fetchFundingRates,       config.fundingInterval);
  setInterval(fetchOrderBook,          config.orderBookInterval);
  setInterval(fetchSentiment,          config.sentimentInterval);
  setInterval(evaluateSignals,         config.signalInterval);
  setInterval(logStatus,               config.logInterval);
  setInterval(() => refreshCandleHistory(true), config.candleRefreshInterval);

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
