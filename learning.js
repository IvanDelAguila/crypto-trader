// learning.js — Ajuste adaptativo de riesgo basado en el historial propio de trades cerrados.
// No es un modelo de ML: es una heurística determinística y explicable que sube o baja
// el tamaño de posición según qué tan bien viene funcionando cada combinación
// estrategia+símbolo, y frena el riesgo global si el bot viene en racha perdedora.
// Los detalles de mercado (order book, sentimiento) que cada trade guarda en `details`
// quedan como dataset para un futuro modelo entrenado, cuando haya suficiente historial.

const store = require("./db");

const LOOKBACK     = 15;   // trades recientes a considerar por combinación
const MIN_SAMPLES  = 5;    // mínimo de trades para dejar de ser neutral (1.0x)
const MIN_MULT     = 0.4;
const MAX_MULT     = 1.3;

function _scoreFromTrades(trades) {
  if (trades.length < MIN_SAMPLES) return 1.0;

  const winRate    = trades.filter(t => t.closePnl > 0).length / trades.length;
  const avgPnlPct  = trades.reduce((a, t) => a + t.closePnlPct, 0) / trades.length;

  const winScore = (winRate - 0.5) * 2;                          // ~ -1 .. 1
  const pnlScore = Math.max(-1, Math.min(1, avgPnlPct / 10));     // normaliza contra ±10%
  const combined = winScore * 0.7 + pnlScore * 0.3;               // -1 .. 1

  const mult = 1 + combined * 0.3;
  return Math.max(MIN_MULT, Math.min(MAX_MULT, mult));
}

// Multiplicador de allocation para una combinación estrategia+símbolo concreta.
// Si no hay muestra suficiente para ese símbolo, cae a la muestra de la estrategia en general.
function getStrategyMultiplier(strategy, symbol) {
  const allTrades = store.getTrades(200);
  const bySymbol   = allTrades.filter(t => t.strategy === strategy && t.symbol === symbol).slice(0, LOOKBACK);
  const byStrategy = allTrades.filter(t => t.strategy === strategy).slice(0, LOOKBACK);

  const sample = bySymbol.length >= MIN_SAMPLES ? bySymbol : byStrategy;
  return _scoreFromTrades(sample);
}

// Vista agregada por estrategia (para dashboard/health), sin filtrar por símbolo.
function getStrategyOverview(strategyNames) {
  const allTrades = store.getTrades(200);
  const overview = {};
  for (const strat of strategyNames) {
    const trades = allTrades.filter(t => t.strategy === strat).slice(0, LOOKBACK);
    overview[strat] = {
      multiplier: Number(_scoreFromTrades(trades).toFixed(2)),
      sample:     trades.length,
    };
  }
  return overview;
}

// Freno global: si las últimas N trades vienen mal, reduce el tamaño de TODAS las posiciones
// nuevas, como aviso temprano antes de llegar al circuit breaker duro de pérdida diaria.
function getGlobalRiskThrottle() {
  const recent = store.getTrades(20);
  if (recent.length < 10) return 1.0;

  const winRate = recent.filter(t => t.closePnl > 0).length / recent.length;
  if (winRate < 0.30) return 0.5;
  if (winRate < 0.40) return 0.75;
  return 1.0;
}

module.exports = { getStrategyMultiplier, getStrategyOverview, getGlobalRiskThrottle };
