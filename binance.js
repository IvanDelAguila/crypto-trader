// binance.js — Fetcher de datos de Binance (público, sin API key)

const https = require("https");

const BASE_URL  = "api.binance.com";
const FAPI_URL  = "fapi.binance.com";

/**
 * GET request genérico vía HTTPS nativo (sin axios para menor dependencia)
 */
function get(host, path) {
  return new Promise((resolve, reject) => {
    const options = { hostname: host, path, method: "GET", headers: { "User-Agent": "CryptoBot/1.0" } };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse error: " + data.slice(0, 100))); }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

/**
 * Precios 24h de múltiples símbolos
 */
async function get24hrTicker(symbols) {
  const result = {};
  const promises = symbols.map(async (symbol) => {
    try {
      const data = await get(BASE_URL, `/api/v3/ticker/24hr?symbol=${symbol}`);
      if (data && data.lastPrice) {
        result[symbol] = {
          price:       parseFloat(data.lastPrice),
          change24h:   parseFloat(data.priceChangePercent),
          high24h:     parseFloat(data.highPrice),
          low24h:      parseFloat(data.lowPrice),
          volume24h:   parseFloat(data.volume),
          quoteVolume: parseFloat(data.quoteVolume),
        };
      }
    } catch {}
  });
  await Promise.all(promises);
  return result;

  const result = {};
  for (const item of data) {
    result[item.symbol] = {
      price:         parseFloat(item.lastPrice),
      change24h:     parseFloat(item.priceChangePercent),
      high24h:       parseFloat(item.highPrice),
      low24h:        parseFloat(item.lowPrice),
      volume24h:     parseFloat(item.volume),
      quoteVolume:   parseFloat(item.quoteVolume),
    };
  }
  return result;
}

/**
 * Klines (velas) para construir historial de precios
 */
async function getKlines(symbol, interval = "1m", limit = 100) {
  const data = await get(BASE_URL, `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  // Retorna array de closes
  return data.map(k => parseFloat(k[4])); // índice 4 = close price
}

/**
 * Funding rates de todos los futuros perpetuos
 */
async function getFundingRates(symbols) {
  try {
    const data   = await get(FAPI_URL, "/fapi/v1/premiumIndex");
    const result = {};
    for (const item of data) {
      if (symbols.includes(item.symbol)) {
        result[item.symbol] = parseFloat(item.lastFundingRate);
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Precio actual simple
 */
async function getPrice(symbol) {
  const data = await get(BASE_URL, `/api/v3/ticker/price?symbol=${symbol}`);
  return parseFloat(data.price);
}

module.exports = { get24hrTicker, getKlines, getFundingRates, getPrice };
