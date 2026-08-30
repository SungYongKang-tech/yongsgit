'use strict';

const kiwoom = require('./kiwoom-us-client');

const INITIAL_CAPITAL = Number(process.env.US_INITIAL_CAPITAL || 100000);

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
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

  const totalCash = toNumber(usd.deposit);
  const availableCash = toNumber(usd.orderAvailable);
  const totalExposure = holdings.reduce((sum, row) => sum + row.evaluationAmount, 0);
  const totalPurchaseAmount = holdings.reduce((sum, row) => sum + row.purchaseAmount, 0);
  const unrealizedProfitLoss = holdings.reduce((sum, row) => sum + row.profitLoss, 0);
  const totalAsset = totalCash + totalExposure;
  const totalProfitLoss = totalAsset - INITIAL_CAPITAL;
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
  toNumber
};
