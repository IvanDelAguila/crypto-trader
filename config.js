// config.js — Configuración central del bot

const config = {
  // ── Symbols ──────────────────────────────────────────────────────────────
  symbols: [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT"
  ],

  symbolMeta: {
    BTCUSDT:  { name: "Bitcoin",    short: "BTC"  },
    ETHUSDT:  { name: "Ethereum",   short: "ETH"  },
    SOLUSDT:  { name: "Solana",     short: "SOL"  },
    BNBUSDT:  { name: "BNB",        short: "BNB"  },
    XRPUSDT:  { name: "XRP",        short: "XRP"  },
    DOGEUSDT: { name: "Dogecoin",   short: "DOGE" },
    ADAUSDT:  { name: "Cardano",    short: "ADA"  },
    AVAXUSDT: { name: "Avalanche",  short: "AVAX" },
    DOTUSDT:  { name: "Polkadot",   short: "DOT"  },
    LINKUSDT: { name: "Chainlink",  short: "LINK" },
  },

  // ── Trading ───────────────────────────────────────────────────────────────
  initialCapital:   parseFloat(process.env.INITIAL_CAPITAL) || 500,
  leverage:         parseFloat(process.env.LEVERAGE)         || 3,
  maxRiskPerTrade:  parseFloat(process.env.MAX_RISK_PER_TRADE) || 15, // % del capital
  maxDailyLossPct:  parseFloat(process.env.MAX_DAILY_LOSS_PCT) || 10, // % de pérdida diaria que pausa el auto-trade
  minConfidence:    parseFloat(process.env.MIN_CONFIDENCE)   || 70,
  maxOpenPositions: 6,
  breakevenTriggerPct: 0.35, // % del camino hacia el TP para mover el SL a breakeven
  tradeMode:        process.env.TRADE_MODE || "paper", // "paper" | "testnet"
  autoTrade:        process.env.AUTO_TRADE === "true",

  // ── Estrategias ───────────────────────────────────────────────────────────
  strategies: {
    EMA: {
      enabled:    true,
      name:       "EMA Crossover",
      fastPeriod: 20,
      slowPeriod: 50,
      tpPct:      0.06,   // +6% take profit
      slPct:      0.03,   // -3% stop loss
    },
    RSI: {
      enabled:      true,
      name:         "RSI + Bollinger",
      rsiPeriod:    14,
      rsiOversold:  35,
      rsiOverbought:65,
      bbPeriod:     20,
      bbStdDev:     2,
      tpPct:        0.05,
      slPct:        0.025,
    },
    FUNDING: {
      enabled:       false, // fapi.binance.com da HTTP 451 desde la región de Railway (bloqueo geográfico)
      name:          "Funding Rate Arbitrage",
      minFundingAbs: 0.0003, // mínimo funding rate para operar
      tpPct:         0.03,
      slPct:         0.02,
    },
    GRID: {
      enabled:    true,
      name:       "Grid Trading",
      gridLevels: 5,
      lookback:   20,      // velas para calcular rango
      tpPct:      0.04,
      slPct:      0.025,
    },
  },

  // ── API ───────────────────────────────────────────────────────────────────
  port:           parseInt(process.env.PORT) || 3001,
  binanceApiKey:  process.env.BINANCE_API_KEY    || "",
  binanceSecret:  process.env.BINANCE_API_SECRET || "",

  // ── Intervals (ms) ────────────────────────────────────────────────────────
  priceInterval:        3000,     // fetch precios cada 3s
  fundingInterval:      60000,    // fetch funding rates cada 1min
  signalInterval:       10000,    // evaluar señales cada 10s
  logInterval:          30000,    // log resumen cada 30s
  candleRefreshInterval: 5 * 60000,  // refrescar velas reales de 15m cada 5min
  orderBookInterval:     15000,      // fetch order book cada 15s
  sentimentInterval:     30 * 60000, // fetch Fear & Greed cada 30min (se actualiza ~1/día)

  // ── Motor de prueba SMC (Smart Money Concepts) ─────────────────────────────
  // Pool de capital totalmente separado del bot principal — mismo feed de precios
  // y order book, pero capital, posiciones y aprendizaje adaptativo propios, para
  // poder validar la estrategia sin arriesgar el capital del bot de arriba.
  smc: {
    initialCapital:      parseFloat(process.env.SMC_INITIAL_CAPITAL) || 1000,
    leverage:            parseFloat(process.env.SMC_LEVERAGE) || 3,
    maxRiskPerTrade:     parseFloat(process.env.SMC_MAX_RISK_PER_TRADE) || 15,
    maxDailyLossPct:     parseFloat(process.env.SMC_MAX_DAILY_LOSS_PCT) || 10,
    minConfidence:       parseFloat(process.env.SMC_MIN_CONFIDENCE) || 70,
    maxOpenPositions:    4,
    breakevenTriggerPct: 0.35,
    autoTrade:           process.env.SMC_AUTO_TRADE === "true",
    candleRefreshInterval:    5 * 60000,  // refrescar velas OHLC (15m) cada 5min
    htfInterval:              "1h",       // temporalidad mayor para el sesgo de estructura
    htfCandleRefreshInterval: 15 * 60000, // refrescar velas HTF cada 15min
    strategy: {
      enabled:            true,
      swingWindow:        3,      // velas a cada lado para considerar un swing high/low
      impulsePct:         0.015,  // % mínimo de cuerpo de vela para contar como "impulso" al armar el order block
      sweepRecency:       1,      // el liquidity sweep debe estar a lo sumo a N velas del final
      confirmImpulsePct:  0.004,  // % mínimo de cuerpo en la vela de confirmación tras el sweep
      slBufferPct:        0.002,  // colchón extra del SL debajo/encima del nivel barrido
      rrRatio:            2,       // TP = riesgo (entrada-SL) × este ratio
      minCandles:         40,
      htfMinCandles:      20,      // mínimo de velas HTF para calcular el sesgo (si no, se trata como neutral)
      equalTolerancePct:  0.0015,  // tolerancia entre swings para considerarlos "equal high/low"
    },
  },
};

module.exports = config;
