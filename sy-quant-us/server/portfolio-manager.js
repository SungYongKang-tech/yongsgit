'use strict';

const fs = require('fs');
const path = require('path');

const kiwoom = require('./kiwoom-us-client');

const INITIAL_CAPITAL = Number(process.env.US_INITIAL_CAPITAL || 100000);
const AUTO_STATE_FILE = path.join(__dirname, 'us-paper-auto-state.json');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function loadAutoState() {
  if (!fs.existsSync(AUTO_STATE_FILE)) {
    return { ok: false, positions: [], error: 'us-paper-auto-state.json 없음' };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(AUTO_STATE_FILE, 'utf8'));
    return {
      ok: true,
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch (error) {
    return { ok: false, positions: [], error: error.message };
  }
}

function getRealizedProfitLossFromAutoState() {
  const state = loadAutoState();
  const realizedProfitLoss = state.positions
    .filter(row => row && row.status === 'CLOSED')
    .reduce((sum, row) => sum + toNumber(row.realizedProfit), 0);

  return {
    realizedProfitLoss,
    stateOk: state.ok,
    stateUpdatedAt: state.updatedAt || null,
    error: state.error || null
  };
}

function normalizeHolding(row) {
  const quantity = toNumber(row.poss_qty);
  const buyPrice = toNumber(row.frgn_stk_book_uv);
  const currentPrice = toNumber(row.now_pric);
  const purchaseAmount = toNumber(row.frgn_stk_book_amt);
  const evaluationAmount = toNumber(row.evlt_amt);
  const profitLoss = toNumber(row.pl_amt);
  const profitLossRate = toNumber(row.pl_rt);

  return {
    exchange: row.stex_nm || '',
    currency: row.crnc_code || '',
    symbol: row.stk_cd || '',
    name: row.frgn_stk_nm || '',
    quantity,
    sellableQuantity: toNumber(row.sell_alowq),
    buyPrice,
    currentPrice,
    purchaseAmount,
    evaluationAmount,
    profitLoss,
    profitLossRate,
    raw: row
  };
}

async function getPortfolioSummary() {
  if (!Number.isFinite(INITIAL_CAPITAL) || INITIAL_CAPITAL <= 0) {
    throw new Error('US_INITIAL_CAPITAL must be a positive number');
  }

  const [usd, balance] = await Promise.all([
    kiwoom.getUsdDeposit(),
    kiwoom.getHoldings()
  ]);

  const holdings = balance.holdings
    .filter(row => row && row.crnc_code === 'USD')
    .map(normalizeHolding)
    .filter(row => row.quantity !== 0 || row.evaluationAmount !== 0);

  const brokerDeposit = toNumber(usd.deposit);
  const availableCash = toNumber(usd.orderAvailable);
  const totalExposure = holdings.reduce((sum, row) => sum + row.evaluationAmount, 0);
  const totalPurchaseAmount = holdings.reduce((sum, row) => sum + row.purchaseAmount, 0);
  const unrealizedProfitLoss = holdings.reduce((sum, row) => sum + row.profitLoss, 0);

  // US PAPER의 usd.deposit은 보유 평가금액이 차감되지 않은 원금성 값으로 반환될 수 있다.
  // 따라서 deposit + exposure 방식은 보유 평가금액을 이중계상할 수 있다.
  // 퀀트 손익은 AUTO STATE의 실현손익 + 브로커 보유현황의 미실현손익으로 계산한다.
  const autoRealized = getRealizedProfitLossFromAutoState();
  const realizedProfitLoss = toNumber(autoRealized.realizedProfitLoss);
  const totalProfitLoss = realizedProfitLoss + unrealizedProfitLoss;
  const totalAsset = INITIAL_CAPITAL + totalProfitLoss;

  // 회계상 현금 = 총자산 - 현재 보유 평가금액.
  // 실제 주문가능금액은 브로커 orderAvailable을 availableCash로 별도 보존한다.
  const totalCash = Math.max(0, totalAsset - totalExposure);
  const totalReturnRate = (totalProfitLoss / INITIAL_CAPITAL) * 100;

  return {
    ok: true,
    accountName: 'SY Quant US PAPER',
    currency: 'USD',
    initialCapital: INITIAL_CAPITAL,
    totalCash,
    availableCash,
    totalExposure,
    totalPurchaseAmount,
    unrealizedProfitLoss,
    totalAsset,
    totalProfitLoss,
    totalReturnRate,
    holdingCount: holdings.length,
    holdings,
    source: {
      accounting: 'AUTO_REALIZED_PLUS_BROKER_UNREALIZED',
      brokerDeposit,
      brokerOrderAvailable: availableCash,
      autoStateFile: AUTO_STATE_FILE,
      autoStateOk: autoRealized.stateOk,
      autoStateUpdatedAt: autoRealized.stateUpdatedAt,
      autoStateError: autoRealized.error,
      depositReturnCode: 0,
      holdingsReturnCode: balance.returnCode,
      holdingsReturnMsg: balance.returnMsg
    },
    time: new Date().toISOString()
  };
}

module.exports = {
  getPortfolioSummary,
  normalizeHolding,
  toNumber,
  loadAutoState,
  getRealizedProfitLossFromAutoState
};
