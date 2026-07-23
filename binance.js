const https = require("https");
const BASE_URL = "data-api.binance.vision";
const FAPI_URL = "fapi.binance.com";

function get(host, path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: host,
            path,
            method: "GET",
            headers: { "User-Agent": "CryptoBot/1.0" },
        };
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`HTTP ${res.statusCode} from ${host}${path}: ${data.slice(0, 200)}`));
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("JSON parse error: " + data.slice(0, 200))); }
            });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
        req.end();
    });
}

async function get24hrTicker(symbols) {
    const result = {};
    await Promise.all(
        symbols.map(async (symbol) => {
            try {
                const data = await get(BASE_URL, "/api/v3/ticker/24hr?symbol=" + symbol);
                if (data && data.lastPrice) {
                    result[symbol] = {
                        price: parseFloat(data.lastPrice),
                        change24h: parseFloat(data.priceChangePercent),
                        high24h: parseFloat(data.highPrice),
                        low24h: parseFloat(data.lowPrice),
                        volume24h: parseFloat(data.volume),
                        quoteVolume: parseFloat(data.quoteVolume),
                    };
                }
            } catch { }
        })
    );
    return result;
}

async function getKlines(symbol, interval, limit) {
    interval = interval || "15m";
    limit = limit || 150;
    const data = await get(
        BASE_URL,
        "/api/v3/klines?symbol=" + symbol + "&interval=" + interval + "&limit=" + limit
    );
    if (!Array.isArray(data)) throw new Error("Klines not array");
    return data.map((k) => parseFloat(k[4]));
}

async function getFundingRates(symbols) {
    try {
        const data = await get(FAPI_URL, "/fapi/v1/premiumIndex");
        if (!Array.isArray(data)) {
            console.log("[binance] premiumIndex no devolvió un array:", JSON.stringify(data).slice(0, 200));
            return {};
        }
        const result = {};
        for (const item of data) {
            if (symbols.includes(item.symbol)) {
                result[item.symbol] = parseFloat(item.lastFundingRate);
            }
        }
        return result;
    } catch (e) {
        console.log("[binance] getFundingRates falló:", e.message);
        return {};
    }
}

async function getPrice(symbol) {
    const data = await get(BASE_URL, "/api/v3/ticker/price?symbol=" + symbol);
    return parseFloat(data.price);
}

// Desbalance del order book: -1 (presión vendedora) .. +1 (presión compradora)
async function getOrderBookImbalance(symbol, limit) {
    limit = limit || 20;
    const data = await get(BASE_URL, "/api/v3/depth?symbol=" + symbol + "&limit=" + limit);
    if (!data.bids || !data.asks) throw new Error("Depth sin bids/asks");

    const bidVol = data.bids.reduce((a, [, qty]) => a + parseFloat(qty), 0);
    const askVol = data.asks.reduce((a, [, qty]) => a + parseFloat(qty), 0);
    const total = bidVol + askVol;

    return total === 0 ? 0 : (bidVol - askVol) / total;
}

// Velas OHLC completas (a diferencia de getKlines, que solo devuelve el cierre).
// Hace falta open/high/low para detectar order blocks y liquidity sweeps.
async function getKlinesOHLC(symbol, interval, limit) {
    interval = interval || "15m";
    limit = limit || 150;
    const data = await get(
        BASE_URL,
        "/api/v3/klines?symbol=" + symbol + "&interval=" + interval + "&limit=" + limit
    );
    if (!Array.isArray(data)) throw new Error("Klines not array");
    return data.map((k) => ({
        openTime: k[0],
        open:  parseFloat(k[1]),
        high:  parseFloat(k[2]),
        low:   parseFloat(k[3]),
        close: parseFloat(k[4]),
    }));
}

module.exports = { get24hrTicker, getKlines, getFundingRates, getPrice, getOrderBookImbalance, getKlinesOHLC };