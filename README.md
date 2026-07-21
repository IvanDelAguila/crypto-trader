# 🤖 Crypto Trader Bot

Bot de paper trading automático para las top 10 cryptos con 4 estrategias simultáneas.

## Estrategias incluidas

| Estrategia | Descripción |
|---|---|
| **EMA Crossover** | Señal cuando EMA20 cruza EMA50 |
| **RSI + Bollinger** | RSI extremo + precio en banda de Bollinger |
| **Funding Rate** | Opera contra el funding rate cuando es alto |
| **Grid Trading** | Opera en niveles dentro de un rango de precio |

## Symbols monitoreados

BTC · ETH · SOL · BNB · XRP · DOGE · ADA · AVAX · DOT · LINK

---

## Instalación local (Windows)

```bash
# 1. Clonar o descargar el proyecto
cd crypto-trader-bot

# 2. Instalar dependencias
npm install

# 3. Copiar variables de entorno
copy .env.example .env

# 4. (Opcional) Editar .env con tu configuración

# 5. Correr el bot
npm start
```

El bot abre una API en `http://localhost:3001`

---

## Deploy en Railway (24/7 gratis)

### Paso 1 — GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU_USUARIO/crypto-trader-bot.git
git push -u origin main
```

### Paso 2 — Railway
1. Ve a [railway.app](https://railway.app)
2. Sign up con GitHub
3. **New Project → Deploy from GitHub repo**
4. Selecciona `crypto-trader-bot`
5. Railway detecta Node.js automáticamente y despliega

### Paso 3 — Variables de entorno en Railway
En el dashboard de Railway → tu proyecto → **Variables**:

```
INITIAL_CAPITAL=500
LEVERAGE=3
TRADE_MODE=paper
AUTO_TRADE=false
MIN_CONFIDENCE=70
MAX_RISK_PER_TRADE=15
PORT=3001
```

### Paso 4 — Obtener URL pública
Railway te da una URL pública como:
`https://crypto-trader-bot-production.up.railway.app`

Desde ahí puedes ver:
- `/api/health` — estado del bot
- `/api/state`  — estado completo
- `/api/signals` — señales recientes
- `/api/trades`  — historial

---

## API Endpoints

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del bot |
| GET | `/api/state` | Estado completo (posiciones, trades, stats) |
| GET | `/api/prices` | Precios actuales |
| GET | `/api/signals` | Señales recientes |
| GET | `/api/positions` | Posiciones abiertas |
| GET | `/api/trades` | Historial de trades |
| GET | `/api/funding` | Funding rates |
| GET | `/api/stream` | Stream SSE en tiempo real |
| POST | `/api/open` | Abrir posición manual |
| POST | `/api/close` | Cerrar posición |
| POST | `/api/auto` | Toggle auto-trading |
| POST | `/api/reset` | Reset a $500 |

---

## Configuración avanzada

Edita `config.js` para ajustar:

```js
strategies: {
  EMA: {
    fastPeriod: 20,   // período EMA rápida
    slowPeriod: 50,   // período EMA lenta
    tpPct: 0.06,      // take profit 6%
    slPct: 0.03,      // stop loss 3%
  },
  RSI: {
    rsiOversold:  35, // compra cuando RSI < 35
    rsiOverbought:65, // vende cuando RSI > 65
  },
  // ...
}
```

---

## Con pm2 (Windows, siempre activo)

```bash
npm install -g pm2
pm2 start index.js --name crypto-bot
pm2 save
pm2 startup
```

---

## Notas importantes

- Este bot opera en **modo paper** por defecto — no mueve dinero real
- Los datos de precio son reales de Binance vía API pública
- Para pasar a dinero real necesitas API keys de Binance Testnet o Mainnet
- Revisa el historial de trades al menos 2-4 semanas antes de evaluar resultados
