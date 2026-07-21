// server.js — API REST para el dashboard

const http = require("http");
const config = require("./config");

class ApiServer {
  constructor(engine, dataStore) {
    this.engine = engine;
    this.dataStore = dataStore;
    this.server = null;
    this.clients = new Set(); // SSE clients
  }

  _cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  _json(res, data, status = 200) {
    this._cors(res);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  _notFound(res) {
    this._json(res, { error: "Not found" }, 404);
  }

  _parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch { resolve({}); }
      });
      req.on("error", reject);
    });
  }

  // Broadcast a todos los clientes SSE conectados
  broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try { client.write(msg); }
      catch { this.clients.delete(client); }
    }
  }

  async handle(req, res) {
    const url = req.url.split("?")[0];
    const method = req.method;

    // OPTIONS preflight
    if (method === "OPTIONS") { this._cors(res); res.writeHead(204); res.end(); return; }

    // ── GET routes ──────────────────────────────────────────────────────────

    // Estado completo del bot
    if (method === "GET" && url === "/api/state") {
      return this._json(res, {
        ...this.engine.getState(),
        prices: this.dataStore.prices,
        changes: this.dataStore.changes,
        fundingRates: this.dataStore.fundingRates,
        priceHistory: this.dataStore.priceHistory,
      });
    }

    // Solo precios
    if (method === "GET" && url === "/api/prices") {
      return this._json(res, {
        prices: this.dataStore.prices,
        changes: this.dataStore.changes,
        updated: this.dataStore.lastUpdate,
      });
    }

    // Estadísticas
    if (method === "GET" && url === "/api/stats") {
      return this._json(res, this.engine.getFullStats());
    }

    // Posiciones abiertas
    if (method === "GET" && url === "/api/positions") {
      return this._json(res, this.engine.positions);
    }

    // Historial de trades
    if (method === "GET" && url === "/api/trades") {
      return this._json(res, this.engine.trades.slice(0, 100));
    }

    // Señales recientes
    if (method === "GET" && url === "/api/signals") {
      return this._json(res, this.engine.signals);
    }

    // Funding rates
    if (method === "GET" && url === "/api/funding") {
      return this._json(res, this.dataStore.fundingRates);
    }

    // Historial de precios
    if (method === "GET" && url === "/api/history") {
      return this._json(res, this.dataStore.priceHistory);
    }

    // Health check
    if (method === "GET" && url === "/api/health") {
      return this._json(res, {
        status: "ok",
        uptime: Math.floor((Date.now() - this.engine.startTime) / 1000),
        positions: this.engine.positions.length,
        equity: this.engine.totalEquity.toFixed(2),
        autoTrade: this.engine.autoTrade,
      });
    }

    // SSE — Server-Sent Events para updates en tiempo real
    if (method === "GET" && url === "/api/stream") {
      this._cors(res);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(": connected\n\n");
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
      return;
    }

    // ── POST routes ─────────────────────────────────────────────────────────

    // Abrir posición manualmente
    if (method === "POST" && url === "/api/open") {
      const body = await this._parseBody(req);
      if (!body.symbol || !body.strategy || !body.type || !body.price) {
        return this._json(res, { error: "Faltan campos requeridos" }, 400);
      }
      const signal = {
        symbol: body.symbol,
        strategy: body.strategy,
        type: body.type,
        price: parseFloat(body.price),
        confidence: parseFloat(body.confidence) || 75,
        tp: parseFloat(body.tp) || parseFloat(body.price) * (body.type === "LONG" ? 1.06 : 0.94),
        sl: parseFloat(body.sl) || parseFloat(body.price) * (body.type === "LONG" ? 0.97 : 1.03),
        reason: body.reason || "Manual",
      };
      const result = this.engine.openPosition(signal);
      return this._json(res, result, result.success ? 200 : 400);
    }

    // Cerrar posición
    if (method === "POST" && url === "/api/close") {
      const body = await this._parseBody(req);
      if (!body.posId) return this._json(res, { error: "posId requerido" }, 400);
      const price = this.dataStore.prices[body.symbol]?.price;
      const result = this.engine.closePosition(body.posId, price, "manual");
      return this._json(res, result, result.success ? 200 : 400);
    }

    // Toggle auto trading
    if (method === "POST" && url === "/api/auto") {
      const body = await this._parseBody(req);
      this.engine.autoTrade = body.enabled !== undefined ? body.enabled : !this.engine.autoTrade;
      return this._json(res, { autoTrade: this.engine.autoTrade });
    }

    // Reset paper trading
    if (method === "POST" && url === "/api/reset") {
      this.engine.capital = config.initialCapital;
      this.engine.positions = [];
      this.engine.trades = [];
      this.engine.signals = [];
      this.engine.stats = this.engine._initStats();
      this.engine.startTime = new Date();
      return this._json(res, { ok: true, message: "Bot reseteado a $500" });
    }

    this._notFound(res);
  }

  start() {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(err => {
        this._cors(res);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
    });

    this.server.listen(config.port, "0.0.0.0", () => {
      console.log(`\n🌐 API corriendo en http://localhost:${config.port}`);
      console.log(`   Dashboard: http://localhost:${config.port}/api/health\n`);
    });
  }
}

module.exports = ApiServer;
