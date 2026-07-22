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
  minConfidence:    parseFloat(process.env.MIN_CONFIDENCE)   || 70,
  maxOpenPositions: 6,
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
  priceInterval:   3000,   // fetch precios cada 3s
  fundingInterval: 60000,  // fetch funding rates cada 1min
  signalInterval:  10000,  // evaluar señales cada 10s
  logInterval:     30000,  // log resumen cada 30s
};

module.exports = config;
