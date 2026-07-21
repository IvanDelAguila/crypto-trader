// strategies.js — Las 4 estrategias de trading

const { calcEMA, calcRSI, calcBollinger, detectEMACross } = require("./indicators");
const config = require("./config");

/**
 * Estrategia 1: EMA Crossover
 * Señal cuando EMA20 cruza EMA50
 */
function evalEMA(symbol, prices) {
  const cfg    = config.strategies.EMA;
  if (!cfg.enabled) return null;
  if (prices.length < cfg.slowPeriod + 5) return null;

  const cross = detectEMACross(prices, cfg.fastPeriod, cfg.slowPeriod);
  if (!cross) return null;

  const price = prices[prices.length - 1];

  if (cross.crossedUp) {
    const confidence = Math.min(95, 65 + Math.abs(cross.separation) * 10);
    return {
      strategy:   "EMA",
      symbol,
      type:       "LONG",
      price,
      confidence,
      tp:         price * (1 + cfg.tpPct),
      sl:         price * (1 - cfg.slPct),
      reason:     `EMA${cfg.fastPeriod} cruzó hacia arriba EMA${cfg.slowPeriod}`,
      details:    { ema20: cross.currFast.toFixed(4), ema50: cross.currSlow.toFixed(4), sep: cross.separation.toFixed(3) + "%" },
    };
  }

  if (cross.crossedDown) {
    const confidence = Math.min(95, 65 + Math.abs(cross.separation) * 10);
    return {
      strategy:   "EMA",
      symbol,
      type:       "SHORT",
      price,
      confidence,
      tp:         price * (1 - cfg.tpPct),
      sl:         price * (1 + cfg.slPct),
      reason:     `EMA${cfg.fastPeriod} cruzó hacia abajo EMA${cfg.slowPeriod}`,
      details:    { ema20: cross.currFast.toFixed(4), ema50: cross.currSlow.toFixed(4), sep: cross.separation.toFixed(3) + "%" },
    };
  }

  return null;
}

/**
 * Estrategia 2: RSI + Bollinger Bands
 * Señal cuando RSI extremo coincide con precio en banda de Bollinger
 */
function evalRSI(symbol, prices) {
  const cfg = config.strategies.RSI;
  if (!cfg.enabled) return null;
  if (prices.length < cfg.bbPeriod + cfg.rsiPeriod) return null;

  const price = prices[prices.length - 1];
  const rsi   = calcRSI(prices, cfg.rsiPeriod);
  const bb    = calcBollinger(prices, cfg.bbPeriod, cfg.bbStdDev);

  if (!rsi || !bb) return null;

  // LONG: RSI sobrevendido + precio bajo banda inferior
  if (rsi < cfg.rsiOversold && price <= bb.lower * 1.005) {
    const rsiStrength  = (cfg.rsiOversold - rsi) / cfg.rsiOversold;
    const bbStrength   = (bb.lower - price) / bb.lower;
    const confidence   = Math.min(92, 60 + rsiStrength * 40 + bbStrength * 20);
    return {
      strategy:   "RSI",
      symbol,
      type:       "LONG",
      price,
      confidence,
      tp:         Math.max(bb.middle, price * (1 + cfg.tpPct * 0.5)),
      sl:         price * (1 - cfg.slPct),
      reason:     `RSI sobrevendido (${rsi.toFixed(1)}) + precio bajo BB`,
      details:    { rsi: rsi.toFixed(2), bbUpper: bb.upper.toFixed(4), bbMiddle: bb.middle.toFixed(4), bbLower: bb.lower.toFixed(4) },
    };
  }

  // SHORT: RSI sobrecomprado + precio sobre banda superior
  if (rsi > cfg.rsiOverbought && price >= bb.upper * 0.995) {
    const rsiStrength = (rsi - cfg.rsiOverbought) / (100 - cfg.rsiOverbought);
    const bbStrength  = (price - bb.upper) / bb.upper;
    const confidence  = Math.min(92, 60 + rsiStrength * 40 + bbStrength * 20);
    return {
      strategy:   "RSI",
      symbol,
      type:       "SHORT",
      price,
      confidence,
      tp:         Math.min(bb.middle, price * (1 - cfg.tpPct * 0.5)),
      sl:         price * (1 + cfg.slPct),
      reason:     `RSI sobrecomprado (${rsi.toFixed(1)}) + precio sobre BB`,
      details:    { rsi: rsi.toFixed(2), bbUpper: bb.upper.toFixed(4), bbMiddle: bb.middle.toFixed(4), bbLower: bb.lower.toFixed(4) },
    };
  }

  return null;
}

/**
 * Estrategia 3: Funding Rate Arbitrage
 * Cuando el funding rate es extremo, abre posición contraria
 */
function evalFunding(symbol, prices, fundingRate) {
  const cfg = config.strategies.FUNDING;
  if (!cfg.enabled) return null;
  if (prices.length < 10) return null;
  if (fundingRate === undefined || fundingRate === null) return null;

  const price    = prices[prices.length - 1];
  const absRate  = Math.abs(fundingRate);

  if (absRate < cfg.minFundingAbs) return null;

  // Funding positivo = longs pagan a shorts → abrir SHORT (cobrar funding)
  if (fundingRate > cfg.minFundingAbs) {
    const confidence = Math.min(90, 65 + absRate * 5000);
    return {
      strategy:   "FUNDING",
      symbol,
      type:       "SHORT",
      price,
      confidence,
      tp:         price * (1 - cfg.tpPct),
      sl:         price * (1 + cfg.slPct),
      reason:     `Funding rate positivo alto: ${(fundingRate * 100).toFixed(4)}%`,
      details:    { fundingRate: (fundingRate * 100).toFixed(4) + "%", annualized: (fundingRate * 3 * 365 * 100).toFixed(2) + "%" },
    };
  }

  // Funding negativo = shorts pagan a longs → abrir LONG
  if (fundingRate < -cfg.minFundingAbs) {
    const confidence = Math.min(90, 65 + absRate * 5000);
    return {
      strategy:   "FUNDING",
      symbol,
      type:       "LONG",
      price,
      confidence,
      tp:         price * (1 + cfg.tpPct),
      sl:         price * (1 - cfg.slPct),
      reason:     `Funding rate negativo alto: ${(fundingRate * 100).toFixed(4)}%`,
      details:    { fundingRate: (fundingRate * 100).toFixed(4) + "%", annualized: (fundingRate * 3 * 365 * 100).toFixed(2) + "%" },
    };
  }

  return null;
}

/**
 * Estrategia 4: Grid Trading
 * Opera en niveles de precio dentro de un rango definido
 */
function evalGrid(symbol, prices) {
  const cfg = config.strategies.GRID;
  if (!cfg.enabled) return null;
  if (prices.length < cfg.lookback) return null;

  const price    = prices[prices.length - 1];
  const recent   = prices.slice(-cfg.lookback);
  const high     = Math.max(...recent);
  const low      = Math.min(...recent);
  const range    = high - low;

  if (range === 0) return null;

  // No operar si el rango es muy pequeño (< 1%)
  if (range / low < 0.01) return null;

  const position  = (price - low) / range; // 0 = bottom, 1 = top
  const gridLevel = Math.floor(position * cfg.gridLevels);

  // Zona baja (0-20%): LONG
  if (position <= 0.20) {
    const confidence = Math.min(85, 60 + (0.20 - position) * 100);
    return {
      strategy:   "GRID",
      symbol,
      type:       "LONG",
      price,
      confidence,
      tp:         low + range * 0.5,  // target: mitad del rango
      sl:         price * (1 - cfg.slPct),
      reason:     `Precio en zona baja del grid (${(position * 100).toFixed(1)}%)`,
      details:    { gridLevel, high: high.toFixed(4), low: low.toFixed(4), rangeSize: (range / low * 100).toFixed(2) + "%" },
    };
  }

  // Zona alta (80-100%): SHORT
  if (position >= 0.80) {
    const confidence = Math.min(85, 60 + (position - 0.80) * 100);
    return {
      strategy:   "GRID",
      symbol,
      type:       "SHORT",
      price,
      confidence,
      tp:         low + range * 0.5,  // target: mitad del rango
      sl:         price * (1 + cfg.slPct),
      reason:     `Precio en zona alta del grid (${(position * 100).toFixed(1)}%)`,
      details:    { gridLevel, high: high.toFixed(4), low: low.toFixed(4), rangeSize: (range / low * 100).toFixed(2) + "%" },
    };
  }

  return null;
}

/**
 * Evalúa todas las estrategias para un symbol
 */
function evalAllStrategies(symbol, prices, fundingRate) {
  const signals = [];
  const evaluators = [
    () => evalEMA(symbol, prices),
    () => evalRSI(symbol, prices),
    () => evalFunding(symbol, prices, fundingRate),
    () => evalGrid(symbol, prices),
  ];

  for (const evaluate of evaluators) {
    try {
      const signal = evaluate();
      if (signal) signals.push(signal);
    } catch (err) {
      // Silenciar errores individuales de estrategia
    }
  }

  return signals;
}

module.exports = { evalEMA, evalRSI, evalFunding, evalGrid, evalAllStrategies };
