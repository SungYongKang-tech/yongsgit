'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const express = require('express');
const cors = require('cors');
const kiwoom = require('./kiwoom-us-client');
const portfolioManager = require('./portfolio-manager');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const MODE = String(process.env.TRADING_MODE || 'PAPER').toUpperCase();

if (PORT === 3000) {
  throw new Error('SY Quant US must not use KR port 3000');
}

if (MODE !== 'PAPER') {
  throw new Error('SY Quant US initial mode must be PAPER');
}

app.use(cors());
app.use(express.json());

function sendError(res, err) {
  console.error('[SY Quant US API]', err.message);
  res.status(500).json({
    ok: false,
    error: err.message
  });
}

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    server: 'sy-quant-us',
    mode: MODE,
    port: PORT,
    file: __filename,
    cwd: process.cwd(),
    time: new Date().toISOString()
  });
});

app.get('/api/portfolio-summary', async (req, res) => {
  try {
    const summary = await portfolioManager.getPortfolioSummary();
    res.json(summary);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us/quote', async (req, res) => {
  try {
    const exchange = String(req.query.exchange || '').toUpperCase();
    const symbol = String(req.query.symbol || '').toUpperCase();
    const data = await kiwoom.getQuote(exchange, symbol);

    res.json({
      ok: true,
      mode: MODE,
      exchange: data.stex_tp,
      symbol: data.stk_cd,
      name: data.stk_nm,
      englishName: data.stk_enm,
      price: data.cur_prc,
      changeRate: data.flu_rt,
      open: data.open_pric,
      high: data.high_pric,
      low: data.low_pric,
      volume: data.acc_trde_qty,
      currency: data.curr_unit,
      raw: data
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us/deposit', async (req, res) => {
  try {
    const usd = await kiwoom.getUsdDeposit();

    res.json({
      ok: true,
      mode: MODE,
      currency: usd.currency,
      currencyName: usd.currencyName,
      deposit: usd.deposit,
      orderAvailable: usd.orderAvailable,
      withdrawAvailable: usd.withdrawAvailable
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us/holdings', async (req, res) => {
  try {
    const exchange = String(req.query.exchange || '').toUpperCase();
    const symbol = String(req.query.symbol || '').toUpperCase();
    const result = await kiwoom.getHoldings({ exchange, symbol });

    res.json({
      ok: true,
      mode: MODE,
      returnCode: result.returnCode,
      returnMsg: result.returnMsg,
      holdingCount: result.holdings.length,
      holdings: result.holdings
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('SY Quant US PAPER server listening on port ' + PORT);
});
