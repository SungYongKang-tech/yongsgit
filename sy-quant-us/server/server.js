'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const express = require('express');
const cors = require('cors');
const kiwoom = require('./kiwoom-us-client');
const usOrder = require('./kiwoom-us-order-client');
const paperAutoTrader = require('./us-paper-auto-trader');
const portfolioManager = require('./portfolio-manager');
const strategySettings = require('./strategy-settings-store');
const activityStore = require('./us-dashboard-activity-store');
require('./us-core-data-safety-patch');
const usCore = require('./us-core-strategy');
const virtualTracker = require('./us-core-virtual-tracker');
const coreHistory = require('./us-core-history-store');
const coreDailySummary = require('./us-core-daily-summary');
const usFast = require('./us-fast-strategy');
const fastVirtualTracker = require('./us-fast-virtual-tracker');
const fastHistory = require('./us-fast-history-store');
const fastDailySummary = require('./us-fast-daily-summary');
const usVolume = require('./us-volume-strategy');
const volumeVirtualTracker = require('./us-volume-virtual-tracker');
const volumeHistory = require('./us-volume-history-store');
const volumeDailySummary = require('./us-volume-daily-summary');
const usWave = require('./us-wave-strategy');
const waveVirtualTracker = require('./us-wave-virtual-tracker');
const waveHistory = require('./us-wave-history-store');
const waveDailySummary = require('./us-wave-daily-summary');
const installUsAnalysisRoutes = require('./analysis-download');

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


function normalizePaperOrderInput(body = {}) {
  return {
    exchange: String(body.exchange || '').toUpperCase().trim(),
    symbol: String(body.symbol || '').toUpperCase().trim(),
    quantity: Number(body.quantity),
    price: Number(body.price),
    orderType: String(body.orderType || '00').trim()
  };
}

function requirePaperTestAcknowledgement(req) {
  const value = String(
    req.body?.confirm ||
    req.headers['x-syquant-paper-order-confirm'] ||
    ''
  ).trim().toUpperCase();

  if (value !== 'PAPER') {
    throw new Error('실제 모의주문 제출에는 confirm="PAPER"가 필요합니다.');
  }
}

function buildUsStrategyDashboardSummary(portfolio = {}) {
  const settings = strategySettings.getSettings();
  const activity = activityStore.getDashboardActivity();
  const coreStatus = usCore.getCoreStatus();
  const fastStatus = usFast.getFastStatus();
  const volumeStatus = usVolume.getVolumeStatus();
  const waveStatus = usWave.getWaveStatus();

  const autoTraderStatus = paperAutoTrader.getStatus();
  const account = autoTraderStatus?.kiwoomAccount || {};
  const totalAsset = Number(autoTraderStatus?.totalAsset || portfolio.totalAsset || 0);
  const totalProfitLoss = Number(autoTraderStatus?.netProfit || 0);
  const totalReturnRate = Number(autoTraderStatus?.profitRate || 0);
  const unrealizedProfitLoss = Number(autoTraderStatus?.unrealizedProfit || 0);
  const strategyBudgets = autoTraderStatus?.strategies || {};

  const strategies = Object.values(settings.strategies).map(item => {
    const realizedProfit = Number(activity.realizedByStrategy?.[item.id] || 0);

    const strategyBudget = Number(
      strategyBudgets?.[item.id]?.budget || 0
    );

    const strategyProfitRate = strategyBudget > 0
      ? Number(((realizedProfit / strategyBudget) * 100).toFixed(4))
      : 0;
    const observerStatus = (item.id === 'CORE' || item.id === 'FAST' || item.id === 'VOLUME' || item.id === 'WAVE') && !item.implemented
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
      observerOnly: item.id === 'CORE'
        ? Boolean(coreStatus.observerOnly)
        : item.id === 'FAST'
          ? Boolean(fastStatus.observerOnly)
          : item.id === 'VOLUME'
            ? Boolean(volumeStatus.observerOnly)
            : item.id === 'WAVE'
              ? Boolean(waveStatus.observerOnly)
              : false,
      singleBuyRate: Number(item.singleBuyRate || 0),
      strategyMaxInvestmentRate: Number(item.strategyMaxInvestmentRate || item.allocationRate || 0),
      allocationRate: Number(item.strategyMaxInvestmentRate || item.allocationRate || 0),
      maxHoldings: Number(item.maxHoldings || 0),
      dailyMaxNewBuys: Number(item.dailyMaxNewBuys || 0),
      netProfit: realizedProfit,
      profitRate: strategyProfitRate,
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
      initialCapital: Number(autoTraderStatus?.startingCapital || autoTraderStatus?.paperCapital || portfolio.initialCapital || 0),
      currentAsset: totalAsset,
      totalAsset,
      totalCash: Number(account.deposit || portfolio.totalCash || 0),
      availableCash: Number(account.orderAvailable || portfolio.availableCash || 0),
      totalExposure: Number(account.holdingsValue || portfolio.totalExposure || 0),
      netProfit: totalProfitLoss,
      profitRate: totalReturnRate,
      realizedProfit: totalProfitLoss - unrealizedProfitLoss,
      unrealizedProfit: unrealizedProfitLoss,
      holdingCount: Number(account.holdingCount ?? portfolio.holdingCount ?? 0)
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
        historyRecorder: coreHistory.getStatus(),
        dailySummary: coreDailySummary.getStatus()
      },
      FAST: {
        observerOnly: true,
        orderSubmissionEnabled: false,
        implemented: false,
        session: fastStatus.session,
        lastScan: fastStatus.lastScan,
        virtualTracker: fastVirtualTracker.getStatus(),
        historyRecorder: fastHistory.getStatus(),
        dailySummary: fastDailySummary.getStatus()
      },
      VOLUME: {
        observerOnly: true,
        orderSubmissionEnabled: false,
        implemented: false,
        session: volumeStatus.session,
        lastScan: volumeStatus.lastScan,
        virtualTracker: volumeVirtualTracker.getStatus(),
        historyRecorder: volumeHistory.getStatus(),
        dailySummary: volumeDailySummary.getStatus()
      },
      WAVE: {
        observerOnly: true,
        orderSubmissionEnabled: false,
        implemented: false,
        session: waveStatus.session,
        lastScan: waveStatus.lastScan,
        virtualTracker: waveVirtualTracker.getStatus(),
        historyRecorder: waveHistory.getStatus(),
        dailySummary: waveDailySummary.getStatus()
      }
    },
    calculationNote: settings.masterBuyEnabled
      ? '전체 신규매수 ON · 전략별 매수허용과 운전한도는 설정에서 관리합니다.'
      : '전체 신규매수 OFF · US-CORE/US-FAST/US-VOLUME/US-WAVE는 후보 관찰·가상성과 추적·일일 이력·장마감 요약만 수행하고 주문은 하지 않습니다.',
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

app.get('/api/us-core/daily-summary', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(coreDailySummary.getSummary(date, { preview: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-core/daily-summary-status', (req, res) => {
  try {
    res.json(coreDailySummary.getStatus());
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

app.get('/api/us-fast/status', (req, res) => {
  try {
    res.json(usFast.getFastStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-fast/virtual-trades', (req, res) => {
  try {
    res.json(fastVirtualTracker.getStatus({ includePositions: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-fast/history', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(fastHistory.getHistory(date));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-fast/history-status', (req, res) => {
  try {
    res.json(fastHistory.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-fast/daily-summary', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(fastDailySummary.getSummary(date, { preview: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-fast/daily-summary-status', (req, res) => {
  try {
    res.json(fastDailySummary.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/us-fast/scan', async (req, res) => {
  try {
    const force = req.body?.force === true || String(req.query.force || '') === '1';
    const result = await usFast.runFastScan({ force });
    res.status(result.ok === false && result.status === 'ERROR' ? 500 : 200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-volume/status', (req, res) => {
  try {
    res.json(usVolume.getVolumeStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-volume/virtual-trades', (req, res) => {
  try {
    res.json(volumeVirtualTracker.getStatus({ includePositions: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-volume/history', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(volumeHistory.getHistory(date));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-volume/history-status', (req, res) => {
  try {
    res.json(volumeHistory.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-volume/daily-summary', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(volumeDailySummary.getSummary(date, { preview: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-volume/daily-summary-status', (req, res) => {
  try {
    res.json(volumeDailySummary.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/us-volume/scan', async (req, res) => {
  try {
    const force = req.body?.force === true || String(req.query.force || '') === '1';
    const result = await usVolume.runVolumeScan({ force });
    res.status(result.ok === false && result.status === 'ERROR' ? 500 : 200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-wave/status', (req, res) => {
  try {
    res.json(usWave.getWaveStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-wave/virtual-trades', (req, res) => {
  try {
    res.json(waveVirtualTracker.getStatus({ includePositions: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-wave/history', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(waveHistory.getHistory(date));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-wave/history-status', (req, res) => {
  try {
    res.json(waveHistory.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-wave/daily-summary', (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    res.json(waveDailySummary.getSummary(date, { preview: true }));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/us-wave/daily-summary-status', (req, res) => {
  try {
    res.json(waveDailySummary.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/us-wave/scan', async (req, res) => {
  try {
    const force = req.body?.force === true || String(req.query.force || '') === '1';
    const result = await usWave.runWaveScan({ force });
    res.status(result.ok === false && result.status === 'ERROR' ? 500 : 200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});


// -----------------------------------------------------------------------------
// US PAPER 수동 주문 테스트 API
// - 전략 자동매매와 완전히 분리된 수동 테스트 경로
// - preview는 주문을 제출하지 않음
// - 실제 제출은 US_ORDER_ENABLED=true + confirm="PAPER" 둘 다 필요
// -----------------------------------------------------------------------------

app.post('/api/us/paper-order/preview-buy', async (req, res) => {
  try {
    const input = normalizePaperOrderInput(req.body || {});
    const result = await usOrder.previewBuy(input);
    res.json({ ok: true, mode: MODE, submitted: false, testOnly: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, submitted: false, error: err.message });
  }
});

app.post('/api/us/paper-order/preview-sell', async (req, res) => {
  try {
    const input = normalizePaperOrderInput(req.body || {});
    const result = await usOrder.previewSell(input);
    res.json({ ok: true, mode: MODE, submitted: false, testOnly: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, submitted: false, error: err.message });
  }
});

app.post('/api/us/paper-order/modify', async (req, res) => {
  try {
    requirePaperTestAcknowledgement(req);
    const result = await usOrder.modifyOrder({
      origOrderNo: req.body?.origOrderNo,
      exchange: req.body?.exchange,
      symbol: req.body?.symbol,
      price: Number(req.body?.price),
      stopPrice: req.body?.stopPrice || ''
    });
    res.json({ ok: true, mode: MODE, submitted: true, testOnly: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, submitted: false, error: err.message });
  }
});

app.post('/api/us/paper-order/cancel', async (req, res) => {
  try {
    requirePaperTestAcknowledgement(req);
    const result = await usOrder.cancelOrder({
      origOrderNo: req.body?.origOrderNo,
      exchange: req.body?.exchange,
      symbol: req.body?.symbol
    });
    res.json({ ok: true, mode: MODE, submitted: true, testOnly: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, submitted: false, error: err.message });
  }
});

app.post('/api/us/paper-order/buy', async (req, res) => {
  try {
    requirePaperTestAcknowledgement(req);
    const input = normalizePaperOrderInput(req.body || {});
    const result = await usOrder.submitBuy(input);

    console.log(
      '[US PAPER TEST BUY]',
      `${input.exchange}:${input.symbol}`,
      `${input.quantity}주`,
      `@${input.price}`,
      `orderNo=${result.orderNo || '-'}`
    );

    res.json({ ok: true, mode: MODE, submitted: true, testOnly: true, result });
  } catch (err) {
    console.error('[US PAPER TEST BUY 실패]', err.message);
    res.status(400).json({ ok: false, submitted: false, error: err.message });
  }
});

app.post('/api/us/paper-order/sell', async (req, res) => {
  try {
    requirePaperTestAcknowledgement(req);
    const input = normalizePaperOrderInput(req.body || {});
    const result = await usOrder.submitSell(input);

    console.log(
      '[US PAPER TEST SELL]',
      `${input.exchange}:${input.symbol}`,
      `${input.quantity}주`,
      `@${input.price}`,
      `orderNo=${result.orderNo || '-'}`
    );

    res.json({ ok: true, mode: MODE, submitted: true, testOnly: true, result });
  } catch (err) {
    console.error('[US PAPER TEST SELL 실패]', err.message);
    res.status(400).json({ ok: false, submitted: false, error: err.message });
  }
});

app.get('/api/us/paper-order/status', (req, res) => {
  const clientStatus = typeof usOrder.getOrderClientStatus === 'function'
    ? usOrder.getOrderClientStatus()
    : null;

  res.json({
    ok: true,
    mode: MODE,
    paperOnly: MODE === 'PAPER',
    orderClient: clientStatus,
    endpoints: {
      previewBuy: 'POST /api/us/paper-order/preview-buy',
      previewSell: 'POST /api/us/paper-order/preview-sell',
      buy: 'POST /api/us/paper-order/buy',
      sell: 'POST /api/us/paper-order/sell',
      modify: 'POST /api/us/paper-order/modify',
      cancel: 'POST /api/us/paper-order/cancel'
    },
    submitRequirement: 'US_ORDER_ENABLED=true and confirm="PAPER"',
    note: '현재 수동 PAPER 주문 테스트 전용이며 전략 자동매매와 연결되지 않았습니다.'
  });
});

app.get('/api/us/auto-trader/status', (req, res) => {
  try {
    res.json(paperAutoTrader.getStatus());
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

app.get('/api/us/account-summary', async (req, res) => {
  try {
    const account = await kiwoom.getAccountSnapshot({ force: true });
    await paperAutoTrader.refreshAccountSnapshot({ force: false });
    res.json({ ok: true, mode: MODE, account });
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

installUsAnalysisRoutes(app);

app.listen(PORT, '0.0.0.0', () => {
  const settings = strategySettings.getSettings();
  console.log('SY Quant US PAPER server listening on port ' + PORT);
  console.log('[US PAPER 주문 테스트 API] preview/BUY/SELL 활성화 · 제출은 US_ORDER_ENABLED=true + confirm=PAPER 필요');
  console.log(
    '[US 전략설정]',
    `MASTER=${settings.masterBuyEnabled ? 'ON' : 'OFF'}`,
    `MASTER_MAX=${settings.masterMaxInvestmentRate}%`,
    `MIN_CASH=${settings.minimumCashRate}%`,
    `구현전략=${settings.implementedCount}개`,
    '미구현 전략 BUY는 서버에서 강제 OFF'
  );

  paperAutoTrader.startAutoTrader();

  usCore.startCoreObserver();
  virtualTracker.startVirtualTracker();
  coreHistory.startHistoryRecorder();
  coreDailySummary.startDailySummary();

  usFast.startFastObserver();
  fastVirtualTracker.startVirtualTracker();
  fastHistory.startHistoryRecorder();
  fastDailySummary.startDailySummary();

  usVolume.startVolumeObserver();
  volumeVirtualTracker.startVirtualTracker();
  volumeHistory.startHistoryRecorder();
  volumeDailySummary.startDailySummary();

  usWave.startWaveObserver();
  waveVirtualTracker.startVirtualTracker();
  waveHistory.startHistoryRecorder();
  waveDailySummary.startDailySummary();
});
