// smc-strategy.js — Estrategia "Smart Money Concepts" completa:
// liquidity sweep + order blocks + fair value gaps + BOS/CHoCH +
// zonas premium/discount + equal highs/lows + sesgo multi-timeframe.
//
// Disparador de entrada: el precio mecha por debajo/arriba de un swing
// reciente (liquidity sweep) y aparece una vela de impulso de confirmación
// en la dirección contraria a la mecha. Sobre eso se aplican filtros duros
// (zona correcta del rango, sesgo del timeframe mayor no contrario) y bonus
// de confianza por cada confluencia adicional presente (order block, FVG,
// CHoCH, equal highs/lows) — así es como se usa SMC en la práctica: ninguna
// señal individual es suficiente sola, se busca que varias coincidan.

const config = require("./config");

// ── Swings ────────────────────────────────────────────────────────────────
// Swing high/low: la vela es el extremo entre `window` velas antes y después.
// Pivotes contiguos o casi empatados (ej. un techo de 2 velas) se funden en
// uno solo, quedándose con el más extremo — si no, el mismo pivote cuenta
// dos veces y arruina comparaciones que esperan pivotes distintos (sesgo, BOS/CHoCH).
function findSwings(candles, window) {
  const rawHighs = [];
  const rawLows = [];
  for (let i = window; i < candles.length - window; i++) {
    const slice = candles.slice(i - window, i + window + 1);
    if (slice.every(c => c.high <= candles[i].high)) rawHighs.push(i);
    if (slice.every(c => c.low  >= candles[i].low))  rawLows.push(i);
  }

  function mergeNearby(indices, isHigh) {
    const merged = [];
    for (const i of indices) {
      const last = merged[merged.length - 1];
      if (last !== undefined && i - last <= window) {
        const better = isHigh
          ? (candles[i].high > candles[last].high ? i : last)
          : (candles[i].low  < candles[last].low  ? i : last);
        merged[merged.length - 1] = better;
      } else {
        merged.push(i);
      }
    }
    return merged;
  }

  return { swingHighs: mergeNearby(rawHighs, true), swingLows: mergeNearby(rawLows, false) };
}

// ── Order Blocks ──────────────────────────────────────────────────────────
// Bullish OB: última vela roja antes de un impulso que rompe un swing high.
// Bearish OB: última vela verde antes de un impulso que rompe un swing low.
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

// ── Liquidity Sweep ────────────────────────────────────────────────────────
// Mecha más allá de un swing reciente, pero cierra de vuelta adentro.
function findLiquiditySweeps(candles, window) {
  const { swingHighs, swingLows } = findSwings(candles, window);
  const sweeps = [];

  for (let i = window + 1; i < candles.length; i++) {
    const c = candles[i];
    const recentLow  = [...swingLows].reverse().find(idx => idx < i && idx > i - 15);
    const recentHigh = [...swingHighs].reverse().find(idx => idx < i && idx > i - 15);

    if (recentLow !== undefined && c.low < candles[recentLow].low && c.close > candles[recentLow].low) {
      sweeps.push({ type: "bullish-sweep", index: i, sweptLevel: candles[recentLow].low, sweptIndex: recentLow });
    }
    if (recentHigh !== undefined && c.high > candles[recentHigh].high && c.close < candles[recentHigh].high) {
      sweeps.push({ type: "bearish-sweep", index: i, sweptLevel: candles[recentHigh].high, sweptIndex: recentHigh });
    }
  }
  return sweeps;
}

// ── Fair Value Gap ────────────────────────────────────────────────────────
// Patrón de 3 velas: hueco entre el high de la primera y el low de la
// tercera (bullish) o viceversa (bearish) — una zona de precio "sin operar"
// que el mercado tiende a rellenar más adelante.
function findFVGs(candles) {
  const fvgs = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    if (a.high < c.low)  fvgs.push({ type: "bullish", index: i - 1, top: c.low,  bottom: a.high });
    if (a.low  > c.high) fvgs.push({ type: "bearish", index: i - 1, top: a.low,  bottom: c.high });
  }
  return fvgs;
}

// ── Sesgo de estructura (para BOS/CHoCH y multi-timeframe) ────────────────
// Bullish: últimos dos swings muestran higher-high + higher-low.
// Bearish: lower-high + lower-low. Si no hay suficientes swings, neutral.
function getStructureBias(candles, window) {
  const { swingHighs, swingLows } = findSwings(candles, window);
  if (swingHighs.length < 2 || swingLows.length < 2) return "neutral";

  const [prevHigh, lastHigh] = swingHighs.slice(-2).map(i => candles[i].high);
  const [prevLow,  lastLow]  = swingLows.slice(-2).map(i => candles[i].low);

  if (lastHigh > prevHigh && lastLow > prevLow) return "bullish";
  if (lastHigh < prevHigh && lastLow < prevLow) return "bearish";
  return "neutral";
}

// ── BOS vs CHoCH ──────────────────────────────────────────────────────────
// BOS (Break of Structure): la última vela rompe un swing a favor del sesgo
// vigente — continuación de tendencia.
// CHoCH (Change of Character): rompe un swing EN CONTRA del sesgo vigente —
// primera señal de un posible cambio de tendencia.
function detectStructureBreak(candles, window) {
  const bias = getStructureBias(candles, window);
  const { swingHighs, swingLows } = findSwings(candles, window);
  const last = candles.length - 1;
  const lastSwingHigh = [...swingHighs].reverse().find(idx => idx < last);
  const lastSwingLow  = [...swingLows].reverse().find(idx => idx < last);
  const c = candles[last];

  if (lastSwingHigh !== undefined && c.close > candles[lastSwingHigh].high) {
    return { type: bias === "bearish" ? "CHoCH" : "BOS", direction: "bullish", brokeLevel: candles[lastSwingHigh].high };
  }
  if (lastSwingLow !== undefined && c.close < candles[lastSwingLow].low) {
    return { type: bias === "bullish" ? "CHoCH" : "BOS", direction: "bearish", brokeLevel: candles[lastSwingLow].low };
  }
  return null;
}

// ── Premium / Discount ──────────────────────────────────────────────────────
// Sobre el rango entre el último swing high y el último swing low: mitad de
// abajo = descuento (zona para buscar LONGs), mitad de arriba = premium
// (zona para buscar SHORTs). Es la regla clásica de SMC de "no comprar caro".
function getPremiumDiscount(candles, window) {
  const { swingHighs, swingLows } = findSwings(candles, window);
  if (!swingHighs.length || !swingLows.length) return null;

  const rangeHigh = candles[swingHighs[swingHighs.length - 1]].high;
  const rangeLow  = candles[swingLows[swingLows.length - 1]].low;
  if (rangeHigh <= rangeLow) return null;

  const price = candles[candles.length - 1].close;
  const position = (price - rangeLow) / (rangeHigh - rangeLow); // 0 = low, 1 = high

  return { position, zone: position < 0.5 ? "discount" : "premium", equilibrium: (rangeHigh + rangeLow) / 2, rangeHigh, rangeLow };
}

// ── Equal Highs / Equal Lows ────────────────────────────────────────────────
// Dos o más swings casi al mismo nivel: acumulan liquidez (stops) ahí — un
// sweep sobre un nivel "equal" es una señal más fuerte que sobre un swing suelto.
function findEqualLevels(candles, window, tolerancePct) {
  const { swingHighs, swingLows } = findSwings(candles, window);
  const equalHighs = [];
  for (let i = 1; i < swingHighs.length; i++) {
    const a = candles[swingHighs[i - 1]].high, b = candles[swingHighs[i]].high;
    if (Math.abs(a - b) / a < tolerancePct) equalHighs.push({ level: b, indices: [swingHighs[i - 1], swingHighs[i]] });
  }
  const equalLows = [];
  for (let i = 1; i < swingLows.length; i++) {
    const a = candles[swingLows[i - 1]].low, b = candles[swingLows[i]].low;
    if (Math.abs(a - b) / a < tolerancePct) equalLows.push({ level: b, indices: [swingLows[i - 1], swingLows[i]] });
  }
  return { equalHighs, equalLows };
}

// ── Señal principal ──────────────────────────────────────────────────────────
// candles: velas de la temporalidad de operación (15m).
// htfCandles: velas de una temporalidad mayor (1h), opcional — si no viene o
// no hay suficientes, el sesgo HTF se trata como neutral (no bloquea nada).
function evalSMC(symbol, candles, htfCandles) {
  const cfg = config.smc.strategy;
  if (!cfg.enabled) return null;
  if (candles.length < cfg.minCandles) return null;

  const sweeps = findLiquiditySweeps(candles, cfg.swingWindow);
  const lastIndex = candles.length - 1;
  const lastSweep = sweeps.filter(s => s.index >= lastIndex - cfg.sweepRecency).pop();
  if (!lastSweep) return null;

  const last = candles[lastIndex];
  const price = last.close;

  const obs = findOrderBlocks(candles, { window: cfg.swingWindow, impulsePct: cfg.impulsePct });
  const fvgs = findFVGs(candles);
  const structureBreak = detectStructureBreak(candles, cfg.swingWindow);
  const pd = getPremiumDiscount(candles, cfg.swingWindow);
  const { equalHighs, equalLows } = findEqualLevels(candles, cfg.swingWindow, cfg.equalTolerancePct);
  const htfBias = (htfCandles && htfCandles.length >= cfg.htfMinCandles)
    ? getStructureBias(htfCandles, cfg.swingWindow)
    : "neutral";

  if (lastSweep.type === "bullish-sweep") {
    const bodyPct = (last.close - last.open) / last.open;
    if (!(last.close > last.open && bodyPct > cfg.confirmImpulsePct)) return null;

    // Filtros duros: no comprar en zona premium, no ir contra el sesgo del timeframe mayor
    if (pd && pd.zone !== "discount") return null;
    if (htfBias === "bearish") return null;

    const nearOB  = obs.filter(o => o.type === "bullish").pop();
    const nearFVG = fvgs.filter(f => f.type === "bullish").pop();
    const isEqualLow = equalLows.some(e => Math.abs(e.level - lastSweep.sweptLevel) / e.level < cfg.equalTolerancePct);
    const isCHoCH = structureBreak?.type === "CHoCH" && structureBreak.direction === "bullish";

    const sl = lastSweep.sweptLevel * (1 - cfg.slBufferPct);
    const risk = price - sl;
    if (risk <= 0) return null;
    const tp = price + risk * cfg.rrRatio;

    let confidence = 60 + Math.min(bodyPct * 200, 8);
    if (nearOB) confidence += 12;
    if (nearFVG) confidence += 8;
    if (isEqualLow) confidence += 8;
    if (isCHoCH) confidence += 10;
    if (htfBias === "bullish") confidence += 7;
    confidence = Math.min(94, confidence);

    const parts = ["Liquidity sweep alcista"];
    if (isEqualLow) parts.push("equal lows");
    if (nearOB) parts.push("order block");
    if (nearFVG) parts.push("FVG");
    if (isCHoCH) parts.push("CHoCH");
    parts.push(`zona ${pd?.zone || "?"}`);
    if (htfBias !== "neutral") parts.push(`HTF ${htfBias}`);

    return {
      strategy: "SMC", symbol, type: "LONG", price, confidence, tp, sl,
      reason: parts.join(" + "),
      details: {
        sweptLevel: lastSweep.sweptLevel, orderBlock: nearOB || null, fvg: nearFVG || null,
        structureBreak, premiumDiscount: pd, htfBias, equalLevel: isEqualLow,
      },
    };
  }

  if (lastSweep.type === "bearish-sweep") {
    const bodyPct = (last.open - last.close) / last.open;
    if (!(last.close < last.open && bodyPct > cfg.confirmImpulsePct)) return null;

    if (pd && pd.zone !== "premium") return null;
    if (htfBias === "bullish") return null;

    const nearOB  = obs.filter(o => o.type === "bearish").pop();
    const nearFVG = fvgs.filter(f => f.type === "bearish").pop();
    const isEqualHigh = equalHighs.some(e => Math.abs(e.level - lastSweep.sweptLevel) / e.level < cfg.equalTolerancePct);
    const isCHoCH = structureBreak?.type === "CHoCH" && structureBreak.direction === "bearish";

    const sl = lastSweep.sweptLevel * (1 + cfg.slBufferPct);
    const risk = sl - price;
    if (risk <= 0) return null;
    const tp = price - risk * cfg.rrRatio;

    let confidence = 60 + Math.min(bodyPct * 200, 8);
    if (nearOB) confidence += 12;
    if (nearFVG) confidence += 8;
    if (isEqualHigh) confidence += 8;
    if (isCHoCH) confidence += 10;
    if (htfBias === "bearish") confidence += 7;
    confidence = Math.min(94, confidence);

    const parts = ["Liquidity sweep bajista"];
    if (isEqualHigh) parts.push("equal highs");
    if (nearOB) parts.push("order block");
    if (nearFVG) parts.push("FVG");
    if (isCHoCH) parts.push("CHoCH");
    parts.push(`zona ${pd?.zone || "?"}`);
    if (htfBias !== "neutral") parts.push(`HTF ${htfBias}`);

    return {
      strategy: "SMC", symbol, type: "SHORT", price, confidence, tp, sl,
      reason: parts.join(" + "),
      details: {
        sweptLevel: lastSweep.sweptLevel, orderBlock: nearOB || null, fvg: nearFVG || null,
        structureBreak, premiumDiscount: pd, htfBias, equalLevel: isEqualHigh,
      },
    };
  }

  return null;
}

module.exports = {
  evalSMC,
  findSwings, findOrderBlocks, findLiquiditySweeps, findFVGs,
  getStructureBias, detectStructureBreak, getPremiumDiscount, findEqualLevels,
};
