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

function buildUsStrategyDashboardSummary(portfolio = {}) {
  const totalAsset = Number(portfolio.totalAsset || 0);
  const totalProfitLoss = Number(portfolio.totalProfitLoss || 0);
  const totalReturnRate = Number(portfolio.totalReturnRate || 0);
  const unrealizedProfitLoss = Number(portfolio.unrealizedProfitLoss || 0);

  return {
    ok: true,
    market: 'US',
    mode: MODE,
    currency: 'USD',
    overall: {
      initialCapital: Number(portfolio.initialCapital || 0),
      currentAsset: totalAsset,
      totalAsset,
      totalCash: Number(portfolio.totalCash || 0),
      availableCash: Number(portfolio.availableCash || 0),
      totalExposure: Number(portfolio.totalExposure || 0),
      netProfit: totalProfitLoss,
      profitRate: totalReturnRate,
      realizedProfit: totalProfitLoss - unrealizedProfitLoss,
      unrealizedProfit: unrealizedProfitLoss,
      holdingCount: Number(portfolio.holdingCount || 0)
    },
    strategies: [],
    details: {
      holdings: Array.isArray(portfolio.holdings) ? portfolio.holdings : []
    },
    calculationNote: 'US 전략은 아직 준비 중입니다. 현재는 USD 계좌 전체 성과를 표시합니다.',
    updatedAt: portfolio.time || new Date().toISOString()
  };
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

app.get('/api/strategy-dashboard-summary', async (req, res) => {
  try {
    const portfolio = await portfolioManager.getPortfolioSummary();
    res.json(buildUsStrategyDashboardSummary(portfolio));
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