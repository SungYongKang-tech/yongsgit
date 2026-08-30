'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const express = require('express');
const cors = require('cors');
const kiwoom = require('./kiwoom-us-client');
const portfolioManager = require('./portfolio-manager');
const strategySettings = require('./strategy-settings-store');
const activityStore = require('./us-dashboard-activity-store');
const usCore = require('./us-core-strategy');
const virtualTracker = require('./us-core-virtual-tracker');
const coreHistory = require('./us-core-history-store');

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
  res.status(500).json({ ok: false, error: err.message });
}

function buildUsStrategyDashboardSummary(portfolio = {}) {
  const totalAsset = Number(portfolio.totalAsset || 0);
  const totalProfitLoss = Number(portfolio.totalProfitLoss || 0);
  const totalReturnRate = Number(portfolio.totalReturnRate || 0);
  const unrealizedProfitLoss = Number(portfolio.unrealizedProfitLoss || 0);
  const settings = strategySettings.getSettings();
  const activity = activityStore.getDashboardActivity();
  const coreStatus = usCore.getCoreStatus();

  const strategies = Object.values(settings.strategies).map(item => {
    const realizedProfit = Number(activity.realizedByStrategy?.[item.id] || 0);
    const observerStatus = item.id === 'CORE' && !item.implemented
      ? '관찰중 · BUY OFF'
      : null;
    return {
      id: item.id,
      label: item.label,
      icon: item.icon,
      status: observerStatus || (item.implemented
        ? (item.buyEnabled ? 'BUY ON' : 'BUY OFF')
        : '준비중 · BUY OFF'),
      implemented: Boolean(item.implemented),
      buyEnabled: Boolean(item.buyEnabled),
      observerOnly: item.id === 'CORE' ? Boolean(coreStatus.observerOnly) : false,
      singleBuyRate: Number(item.singleBuyRate || 0),
      strategyMaxInvestmentRate: Number(item.strategyMaxInvestmentRate || item.allocationRate || 0),
      allocationRate: Number(item.strategyMaxInvestmentRate || item.allocationRate || 0),
      maxHoldings: Number(item.maxHoldings || 0),
      dailyMaxNewBuys: Number(item.dailyMaxNewBuys || 0),
      netProfit: realizedProfit,
      profitRate: 0,
      realizedProfit,
      unrealizedProfit: 0
    };
  });

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
    strategyControl: {
      masterBuyEnabled: Boolean(settings.masterBuyEnabled),
      masterMaxInvestmentRate: Number(settings.masterMaxInvestmentRate || 0),
      minimumCashRate: Number(settings.minimumCashRate || 0),
      allocationTotal: Number(settings.allocationTotal || 0),
      unallocatedRate: Number(settings.unallocatedRate || 0),
      implementedCount: Number(settings.implementedCount || 0),
      buyEnabledCount: Number(settings.buyEnabledCount || 0)
    },
    strategies,
    recent7Days: activity.recent7Days,
    details: {
      holdings: Array.isArray(portfolio.holdings) ? portfolio.holdings : [],
      candidates: Array.isArray(activity.candidates) ? activity.candidates : [],
      sellHistory: Array.isArray(activity.sellHistory) ? activity.sellHistory : []
    },
    observers: {
      CORE: {
        observerOnly: true,
        orderSubmissionEnabled: false,
        implemented: false,
        session: coreStatus.session,
        lastScan: coreStatus.lastScan,
        virtualTracker: virtualTracker.getStatus(),
        historyRecorder: coreHistory.getStatus()
      }
    },
    calculationNote: settings.masterBuyEnabled
      ? '전체 신규매수 ON · 전략별 매수허용과 운전한도는 설정에서 관리합니다.'
      : '전체 신규매수 OFF · US-CORE는 후보 관찰·가상성과 추적·일일 이력 저장만 수행하고 주문은 하지 않습니다.',
    updatedAt: portfolio.time || new Date().toISOString()
  };
}

app.get('/strategy-settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'strategy-settings.html'));
});

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

app.get('/api/strategy-settings', (req, res) => {
  try {
    res.json({ ok: true, mode: MODE, settings: strategySettings.getSettings() });
  } catch (err) {
    sendError(res, err);
  }
});

app.put('/api/strategy-settings', (req, res) => {
  try {
    const settings = strategySettings.updateSettings(req.body || {});
    console.log(
      '[US 전략설정 저장]',
      `MASTER=${settings.masterBuyEnabled ? 'ON' : 'OFF'}`,
      `MASTER_MAX=${settings.masterMaxInvestmentRate}%`,
      `MIN_CASH=${settings.minimumCashRate}%`,
      Object.values(settings.strategies)
        .map(item => `${item.id}:1종목${item.singleBuyRate}%/전략${item.strategyMaxInvestmentRate}%/${item.maxHoldings}종목/일${item.dailyMaxNewBuys}회/${item.buyEnabled ? 'BUY_ON' : 'BUY_OFF'}`)
        .join(' | ')
    );
    res.json({ ok: true, mode: MODE, settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/strategy-buy-check/:strategyId', (req, res) => {
  try {
    const result = strategySettings.isBuyAllowed(req.params.strategyId);
    res.json({
      ok: true,
      strategyId: String(req.params.strategyId || '').toUpperCase(),
      allowed: result.allowed,
      reason: result.reason,
      masterBuyEnabled: Boolean(result.settings?.masterBuyEnabled),
      strategy: result.strategy
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/dashboard-activity', (req, res) => {
  try {
    res.json({ ok: true, mode: MODE, activity: activityStore.getDashboardActivity() });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-core/status', (req, res) => {
  try {
    res.json(usCore.getCoreStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-core/virtual-trades', (req, res) => {
  try {
    res.json(virtualTracker.getStatus({ includePositions: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-core/history', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(coreHistory.getHistory(date));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-core/history-status', (req, res) => {
  try {
    res.json(coreHistory.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/us-core/scan', async (req, res) => {
  try {
    const force = req.body?.force === true || String(req.query.force || '') === '1';
    const result = await usCore.runCoreScan({ force });
    res.status(result.ok === false && result.status === 'ERROR' ? 500 : 200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-core/analyze', async (req, res) => {
  try {
    const exchange = String(req.query.exchange || '').toUpperCase();
    const symbol = String(req.query.symbol || '').toUpperCase();
    const result = await usCore.analyzeSymbol({ exchange, symbol });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
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
  const settings = strategySettings.getSettings();
  console.log('SY Quant US PAPER server listening on port ' + PORT);
  console.log(
    '[US 전략설정]',
    `MASTER=${settings.masterBuyEnabled ? 'ON' : 'OFF'}`,
    `MASTER_MAX=${settings.masterMaxInvestmentRate}%`,
    `MIN_CASH=${settings.minimumCashRate}%`,
    `구현전략=${settings.implementedCount}개`,
    '미구현 전략 BUY는 서버에서 강제 OFF'
  );
  usCore.startCoreObserver();
  virtualTracker.startVirtualTracker();
  coreHistory.startHistoryRecorder();
});
