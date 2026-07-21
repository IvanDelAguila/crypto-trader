// engine.js — Motor de paper trading: gestión de posiciones y capital

const config = require("./config");

class TradingEngine {
  constructor() {
    this.capital    = config.initialCapital;
    this.positions  = [];          // posiciones abiertas
    this.trades     = [];          // historial de trades cerrados
    this.signals    = [];          // señales recientes (últimas 100)
    this.stats      = this._initStats();
    this.startTime  = new Date();
    this.autoTrade  = config.autoTrade;
  }

  _initStats() {
    return {
      totalTrades:  0,
      wins:         0,
      losses:       0,
      totalPnL:     0,
      bestTrade:    null,
      worstTrade:   null,
      byStrategy:   {
        EMA:     { trades: 0, wins: 0, pnl: 0 },
        RSI:     { trades: 0, wins: 0, pnl: 0 },
        FUNDING: { trades: 0, wins: 0, pnl: 0 },
        GRID:    { trades: 0, wins: 0, pnl: 0 },
      },
      bySymbol: {},
    };
  }

  // ── Capital ───────────────────────────────────────────────────────────────

  get freeCapital() {
    const locked = this.positions.reduce((a, p) => a + p.allocation, 0);
    return this.capital - locked;
  }

  get totalEquity() {
    return this.capital + this.openPnL;
  }

  get openPnL() {
    return this.positions.reduce((a, p) => a + (p.pnl || 0), 0);
  }

  get totalReturn() {
    return ((this.totalEquity - config.initialCapital) / config.initialCapital) * 100;
  }

  // ── Señales ───────────────────────────────────────────────────────────────

  addSignal(signal) {
    const full = { ...signal, id: Date.now() + Math.random(), timestamp: new Date() };
    this.signals = [full, ...this.signals].slice(0, 100);
    return full;
  }

  // ── Posiciones ────────────────────────────────────────────────────────────

  canOpenPosition(symbol, strategy) {
    // No abrir si ya hay posición abierta para este par+estrategia
    const alreadyOpen = this.positions.some(
      p => p.symbol === symbol && p.strategy === strategy
    );
    if (alreadyOpen) return { ok: false, reason: "Ya hay posición abierta" };

    // No superar máximo de posiciones simultáneas
    if (this.positions.length >= config.maxOpenPositions) {
      return { ok: false, reason: `Máximo de posiciones alcanzado (${config.maxOpenPositions})` };
    }

    // Capital mínimo disponible
    const minCapital = 20;
    if (this.freeCapital < minCapital) {
      return { ok: false, reason: `Capital insuficiente ($${this.freeCapital.toFixed(2)})` };
    }

    return { ok: true };
  }

  openPosition(signal) {
    const check = this.canOpenPosition(signal.symbol, signal.strategy);
    if (!check.ok) return { success: false, reason: check.reason };

    const allocation = Math.min(
      this.freeCapital * (config.maxRiskPerTrade / 100),
      75  // máximo $75 por posición con $500 capital
    );

    if (allocation < 10) return { success: false, reason: "Allocation demasiado pequeña" };

    const size = (allocation * config.leverage) / signal.price;

    const position = {
      id:          `${signal.symbol}-${signal.strategy}-${Date.now()}`,
      symbol:      signal.symbol,
      strategy:    signal.strategy,
      type:        signal.type,        // LONG | SHORT
      entryPrice:  signal.price,
      size,
      allocation,
      tp:          signal.tp,
      sl:          signal.sl,
      confidence:  signal.confidence,
      reason:      signal.reason,
      details:     signal.details,
      openTime:    new Date(),
      pnl:         0,
      pnlPct:      0,
      currentPrice: signal.price,
    };

    this.positions.push(position);
    return { success: true, position };
  }

  closePosition(posId, currentPrice, reason = "manual") {
    const idx = this.positions.findIndex(p => p.id === posId);
    if (idx === -1) return { success: false, reason: "Posición no encontrada" };

    const pos = this.positions[idx];
    const price = currentPrice || pos.currentPrice || pos.entryPrice;

    const priceDiff = pos.type === "LONG"
      ? price - pos.entryPrice
      : pos.entryPrice - price;

    const pnl    = priceDiff * pos.size;
    const pnlPct = (pnl / pos.allocation) * 100;

    const closedTrade = {
      ...pos,
      closePrice:  price,
      closePnl:    pnl,
      closePnlPct: pnlPct,
      closeTime:   new Date(),
      closeReason: reason,
      duration:    Math.floor((Date.now() - new Date(pos.openTime)) / 60000), // minutos
    };

    // Actualizar capital y posiciones
    this.capital = this.capital - pos.allocation + pos.allocation + pnl;
    this.positions.splice(idx, 1);
    this.trades.unshift(closedTrade);
    if (this.trades.length > 200) this.trades.pop();

    // Actualizar estadísticas
    this._updateStats(closedTrade);

    return { success: true, trade: closedTrade };
  }

  updatePositionPrice(symbol, price) {
    let updated = 0;
    const toClose = [];

    for (const pos of this.positions) {
      if (pos.symbol !== symbol) continue;

      const diff = pos.type === "LONG"
        ? price - pos.entryPrice
        : pos.entryPrice - price;

      pos.pnl         = diff * pos.size;
      pos.pnlPct      = (pos.pnl / pos.allocation) * 100;
      pos.currentPrice = price;
      updated++;

      // Verificar SL y TP
      if (pos.type === "LONG") {
        if (price <= pos.sl) toClose.push({ id: pos.id, price, reason: "stop-loss" });
        else if (price >= pos.tp) toClose.push({ id: pos.id, price, reason: "take-profit" });
      } else {
        if (price >= pos.sl) toClose.push({ id: pos.id, price, reason: "stop-loss" });
        else if (price <= pos.tp) toClose.push({ id: pos.id, price, reason: "take-profit" });
      }
    }

    // Cerrar las que tocaron SL/TP
    const closed = [];
    for (const { id, price: p, reason } of toClose) {
      const result = this.closePosition(id, p, reason);
      if (result.success) closed.push(result.trade);
    }

    return { updated, closed };
  }

  // ── Estadísticas ──────────────────────────────────────────────────────────

  _updateStats(trade) {
    const s = this.stats;
    s.totalTrades++;
    s.totalPnL += trade.closePnl;

    if (trade.closePnl > 0) {
      s.wins++;
      if (!s.bestTrade || trade.closePnl > s.bestTrade.closePnl) s.bestTrade = trade;
    } else {
      s.losses++;
      if (!s.worstTrade || trade.closePnl < s.worstTrade.closePnl) s.worstTrade = trade;
    }

    // Por estrategia
    if (s.byStrategy[trade.strategy]) {
      s.byStrategy[trade.strategy].trades++;
      s.byStrategy[trade.strategy].pnl += trade.closePnl;
      if (trade.closePnl > 0) s.byStrategy[trade.strategy].wins++;
    }

    // Por symbol
    if (!s.bySymbol[trade.symbol]) {
      s.bySymbol[trade.symbol] = { trades: 0, wins: 0, pnl: 0 };
    }
    s.bySymbol[trade.symbol].trades++;
    s.bySymbol[trade.symbol].pnl += trade.closePnl;
    if (trade.closePnl > 0) s.bySymbol[trade.symbol].wins++;
  }

  getFullStats() {
    const s    = this.stats;
    const wins = s.wins;
    const total = s.totalTrades;

    return {
      ...s,
      winRate:      total ? (wins / total * 100).toFixed(1) : "0.0",
      avgPnL:       total ? (s.totalPnL / total).toFixed(2) : "0.00",
      capital:      this.capital.toFixed(2),
      freeCapital:  this.freeCapital.toFixed(2),
      totalEquity:  this.totalEquity.toFixed(2),
      openPnL:      this.openPnL.toFixed(2),
      totalReturn:  this.totalReturn.toFixed(2),
      openPositions: this.positions.length,
      uptime:       Math.floor((Date.now() - this.startTime) / 60000),
      byStrategy:   Object.fromEntries(
        Object.entries(s.byStrategy).map(([k, v]) => [k, {
          ...v,
          winRate: v.trades ? (v.wins / v.trades * 100).toFixed(1) : "0.0",
          avgPnL:  v.trades ? (v.pnl / v.trades).toFixed(2) : "0.00",
        }])
      ),
    };
  }

  getState() {
    return {
      capital:      this.capital,
      freeCapital:  this.freeCapital,
      totalEquity:  this.totalEquity,
      openPnL:      this.openPnL,
      totalReturn:  this.totalReturn,
      positions:    this.positions,
      trades:       this.trades.slice(0, 50),
      signals:      this.signals.slice(0, 30),
      stats:        this.getFullStats(),
      autoTrade:    this.autoTrade,
      uptime:       Math.floor((Date.now() - this.startTime) / 60000),
    };
  }
}

module.exports = TradingEngine;
