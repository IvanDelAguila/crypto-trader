// smc-strategy.js — Estrategia "Smart Money Concepts": order blocks + liquidity sweep.
//
// Idea: el precio mecha por debajo/arriba de un swing reciente (barre los stops
// que hay ahí — "liquidity sweep"), y si inmediatamente después aparece una vela
// de impulso en la dirección contraria a la mecha, se interpreta como una
// reversión real y se entra a favor de esa reversión.
//
// A diferencia de la demo inicial, acá se exige que el sweep sea reciente Y que
// venga confirmado por una vela de impulso — sin eso, cualquier mecha del rango
// normal del mercado se contaba como señal, generando mucho ruido (verificado
// con datos sintéticos antes de escribir esto).

const config = require("./config");

// Swing high/low: la vela es el extremo entre `window` velas antes y después.
function findSwings(candles, window) {
  const swingHighs = [];
  const swingLows = [];
  for (let i = window; i < candles.length - window; i++) {
    const slice = candles.slice(i - window, i + window + 1);
    if (slice.every(c => c.high <= candles[i].high)) swingHighs.push(i);
    if (slice.every(c => c.low  >= candles[i].low))  swingLows.push(i);
  }
  return { swingHighs, swingLows };
}

// Bullish OB: última vela roja antes de un impulso que rompe un swing high (BOS alcista).
// Bearish OB: última vela verde antes de un impulso que rompe un swing low (BOS bajista).
function findOrderBlocks(candles, { window, impulsePct }) {
  const { swingHighs, swingLows } = findSwings(candles, window);
  const obs = [];

  for (let i = window + 1; i < candles.length; i++) {
    const c = candles[i];
    const prevSwingHigh = [...swingHighs].reverse().find(idx => idx < i);
    const prevSwingLow  = [...swingLows].reverse().find(idx => idx < i);
    const movePct = (c.close - c.open) / c.open;

    if (prevSwingHigh !== undefined && c.close > candles[prevSwingHigh].high && movePct > impulsePct) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (candles[j].close < candles[j].open) {
          obs.push({ type: "bullish", index: j, low: candles[j].low, high: candles[j].high, brokeSwingAt: i });
          break;
        }
      }
    }

    if (prevSwingLow !== undefined && c.close < candles[prevSwingLow].low && movePct < -impulsePct) {
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (candles[j].close > candles[j].open) {
          obs.push({ type: "bearish", index: j, low: candles[j].low, high: candles[j].high, brokeSwingAt: i });
          break;
        }
      }
    }
  }
  return obs;
}

// Liquidity sweep: mecha más allá de un swing reciente, pero cierra de vuelta adentro.
function findLiquiditySweeps(candles, window) {
  const { swingHighs, swingLows } = findSwings(candles, window);
  const sweeps = [];

  for (let i = window + 1; i < candles.length; i++) {
    const c = candles[i];
    const recentLow  = [...swingLows].reverse().find(idx => idx < i && idx > i - 15);
    const recentHigh = [...swingHighs].reverse().find(idx => idx < i && idx > i - 15);

    if (recentLow !== undefined && c.low < candles[recentLow].low && c.close > candles[recentLow].low) {
      sweeps.push({ type: "bullish-sweep", index: i, sweptLevel: candles[recentLow].low });
    }
    if (recentHigh !== undefined && c.high > candles[recentHigh].high && c.close < candles[recentHigh].high) {
      sweeps.push({ type: "bearish-sweep", index: i, sweptLevel: candles[recentHigh].high });
    }
  }
  return sweeps;
}

function evalSMC(symbol, candles) {
  const cfg = config.smc.strategy;
  if (!cfg.enabled) return null;
  if (candles.length < cfg.minCandles) return null;

  const sweeps = findLiquiditySweeps(candles, cfg.swingWindow);
  const lastIndex = candles.length - 1;
  const lastSweep = sweeps.filter(s => s.index >= lastIndex - cfg.sweepRecency).pop();
  if (!lastSweep) return null;

  const last = candles[lastIndex];
  const obs = findOrderBlocks(candles, { window: cfg.swingWindow, impulsePct: cfg.impulsePct });
  const price = last.close;

  if (lastSweep.type === "bullish-sweep") {
    const bodyPct = (last.close - last.open) / last.open;
    if (!(last.close > last.open && bodyPct > cfg.confirmImpulsePct)) return null;

    const nearOB = obs.filter(o => o.type === "bullish").pop();
    const sl = lastSweep.sweptLevel * (1 - cfg.slBufferPct);
    const risk = price - sl;
    if (risk <= 0) return null;
    const tp = price + risk * cfg.rrRatio;
    const confidence = Math.min(90, 65 + (nearOB ? 15 : 0) + Math.min(bodyPct * 300, 10));

    return {
      strategy: "SMC", symbol, type: "LONG", price, confidence, tp, sl,
      reason: `Liquidity sweep alcista confirmado${nearOB ? " + order block" : ""} (barrió $${lastSweep.sweptLevel.toFixed(4)})`,
      details: { sweptLevel: lastSweep.sweptLevel, orderBlock: nearOB || null },
    };
  }

  if (lastSweep.type === "bearish-sweep") {
    const bodyPct = (last.open - last.close) / last.open;
    if (!(last.close < last.open && bodyPct > cfg.confirmImpulsePct)) return null;

    const nearOB = obs.filter(o => o.type === "bearish").pop();
    const sl = lastSweep.sweptLevel * (1 + cfg.slBufferPct);
    const risk = sl - price;
    if (risk <= 0) return null;
    const tp = price - risk * cfg.rrRatio;
    const confidence = Math.min(90, 65 + (nearOB ? 15 : 0) + Math.min(bodyPct * 300, 10));

    return {
      strategy: "SMC", symbol, type: "SHORT", price, confidence, tp, sl,
      reason: `Liquidity sweep bajista confirmado${nearOB ? " + order block" : ""} (barrió $${lastSweep.sweptLevel.toFixed(4)})`,
      details: { sweptLevel: lastSweep.sweptLevel, orderBlock: nearOB || null },
    };
  }

  return null;
}

module.exports = { evalSMC, findSwings, findOrderBlocks, findLiquiditySweeps };
