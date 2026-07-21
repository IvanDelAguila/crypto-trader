// indicators.js — Cálculo de indicadores técnicos

/**
 * EMA — Exponential Moving Average
 */
function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * RSI — Relative Strength Index
 */
function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  const recent = changes.slice(-period);
  const gains  = recent.map(c => c > 0 ? c : 0);
  const losses = recent.map(c => c < 0 ? -c : 0);
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Bollinger Bands
 */
function calcBollinger(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper:  mean + stdDev * std,
    middle: mean,
    lower:  mean - stdDev * std,
    std,
  };
}

/**
 * MACD — Moving Average Convergence Divergence
 */
function calcMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return null;
  const emaFast   = calcEMA(prices, fast);
  const emaSlow   = calcEMA(prices, slow);
  if (!emaFast || !emaSlow) return null;
  const macdLine  = emaFast - emaSlow;

  // Signal line: EMA of MACD values
  const macdValues = [];
  for (let i = slow; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    const ef    = calcEMA(slice, fast);
    const es    = calcEMA(slice, slow);
    if (ef && es) macdValues.push(ef - es);
  }
  const signalLine = calcEMA(macdValues, signal);
  const histogram  = signalLine ? macdLine - signalLine : null;

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * ATR — Average True Range (volatilidad)
 */
function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i]  - lows[i],
      Math.abs(highs[i]  - closes[i - 1]),
      Math.abs(lows[i]   - closes[i - 1])
    );
    trs.push(tr);
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * Detectar cruce de EMAs
 */
function detectEMACross(prices, fast, slow) {
  if (prices.length < slow + 2) return null;

  const prevPrices = prices.slice(0, -1);
  const currFast   = calcEMA(prices,     fast);
  const currSlow   = calcEMA(prices,     slow);
  const prevFast   = calcEMA(prevPrices, fast);
  const prevSlow   = calcEMA(prevPrices, slow);

  if (!currFast || !currSlow || !prevFast || !prevSlow) return null;

  const crossedUp   = prevFast <= prevSlow && currFast > currSlow;
  const crossedDown = prevFast >= prevSlow && currFast < currSlow;

  return {
    crossedUp,
    crossedDown,
    currFast,
    currSlow,
    prevFast,
    prevSlow,
    separation: ((currFast - currSlow) / currSlow) * 100,
  };
}

module.exports = { calcEMA, calcRSI, calcBollinger, calcMACD, calcATR, detectEMACross };
