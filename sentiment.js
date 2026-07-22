// sentiment.js — Índice de sentimiento de mercado (Fear & Greed Index, api.alternative.me)
// Fuente pública gratuita, sin API key, se actualiza ~1 vez por día.

const https = require("https");

function getFearGreedIndex() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: "api.alternative.me", path: "/fng/?limit=1", method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode} de api.alternative.me`));
          }
          try {
            const json = JSON.parse(data);
            const item = json.data && json.data[0];
            if (!item) return reject(new Error("Respuesta sin datos"));
            resolve({
              value:          parseInt(item.value, 10),
              classification: item.value_classification,
              updated:        new Date().toISOString(),
            });
          } catch (e) {
            reject(new Error("JSON parse error: " + data.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

module.exports = { getFearGreedIndex };
