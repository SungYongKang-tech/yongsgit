'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const kiwoom = require('./kiwoom-us-client');

const BASE_URL = String(process.env.KIWOOM_US_BASE_URL || '').replace(/\/$/, '');
const MODE = String(process.env.TRADING_MODE || '').toUpperCase();
const ORDER_ENABLED = String(process.env.US_ORDER_ENABLED || '').toLowerCase() === 'true';
const MAX_ORDER_QTY = Number(process.env.US_MAX_ORDER_QTY || 100);
const MAX_ORDER_USD = Number(process.env.US_MAX_ORDER_USD || 10000);

const EXCHANGES = new Set(['NA', 'ND', 'NY']);
const ORDER_TYPES = new Set(['00']);

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function assertPaperEnvironment() {
  if (MODE !== 'PAPER') {
    throw new Error('SY Quant US order client allows PAPER mode only');
  }
  if (BASE_URL !== 'https://mockapi.kiwoom.com') {
    throw new Error('SY Quant US order client allows Kiwoom mock API only');
  }
}

function assertOrderEnabled() {
  assertPaperEnvironment();
  if (!ORDER_ENABLED) {
    throw new Error('US order submission is disabled; set US_ORDER_ENABLED=true only for PAPER testing');
  }
}

function validateRiskSettings() {
  if (!Number.isInteger(MAX_ORDER_QTY) || MAX_ORDER_QTY <= 0) {
    throw new Error('US_MAX_ORDER_QTY must be a positive integer');
  }
  if (!Number.isFinite(MAX_ORDER_USD) || MAX_ORDER_USD <= 0) {
    throw new Error('US_MAX_ORDER_USD must be a positive number');
  }
}

function normalizeOrder({ exchange, symbol, quantity, orderType = '00', price = null }) {
  assertPaperEnvironment();
  validateRiskSettings();

  const stexTp = String(exchange || '').toUpperCase().trim();
  const stkCd = String(symbol || '').toUpperCase().trim();
  const trdeTp = String(orderType || '').trim();
  const qty = Number(quantity);

  if (!EXCHANGES.has(stexTp)) {
    throw new Error('exchange must be NA, ND, or NY');
  }
  if (!/^[A-Z0-9.-]{1,20}$/.test(stkCd)) {
    throw new Error('symbol format is invalid');
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('quantity must be a positive integer');
  }
  if (qty > MAX_ORDER_QTY) {
    throw new Error('quantity exceeds US_MAX_ORDER_QTY');
  }
  if (!ORDER_TYPES.has(trdeTp)) {
    throw new Error('Kiwoom US PAPER trading currently allows limit orders only (orderType 00)');
  }

  const ordUv = Number(price);
  if (!Number.isFinite(ordUv) || ordUv <= 0 || ordUv > 1000000) {
    throw new Error('limit price must be a positive number');
  }

  return {
    exchange: stexTp,
    symbol: stkCd,
    quantity: qty,
    orderType: trdeTp,
    price: ordUv
  };
}

async function previewBuy(input) {
  const order = normalizeOrder(input);
  const estimatedNotional = order.price * order.quantity;

  if (estimatedNotional > MAX_ORDER_USD) {
    throw new Error('estimated buy amount exceeds US_MAX_ORDER_USD');
  }

  const usd = await kiwoom.getUsdDeposit();
  if (estimatedNotional > toNumber(usd.orderAvailable)) {
    throw new Error('estimated buy amount exceeds USD order-available cash');
  }

  return {
    side: 'BUY',
    ...order,
    referencePrice: order.price,
    estimatedNotional,
    orderAvailable: toNumber(usd.orderAvailable),
    maxOrderQty: MAX_ORDER_QTY,
    maxOrderUsd: MAX_ORDER_USD,
    submissionEnabled: ORDER_ENABLED
  };
}

async function previewSell(input) {
  const order = normalizeOrder(input);
  const holdings = await kiwoom.getHoldings({
    exchange: order.exchange,
    symbol: order.symbol
  });

  const row = holdings.holdings.find(item =>
    item && String(item.stk_cd || '').toUpperCase() === order.symbol
  );

  if (!row) {
    throw new Error('holding not found for sell order');
  }

  const sellableQuantity = toNumber(row.sell_alowq || row.poss_qty);
  if (order.quantity > sellableQuantity) {
    throw new Error('sell quantity exceeds sellable holding quantity');
  }

  const estimatedNotional = order.price * order.quantity;
  if (estimatedNotional > MAX_ORDER_USD) {
    throw new Error('estimated sell amount exceeds US_MAX_ORDER_USD');
  }

  return {
    side: 'SELL',
    ...order,
    referencePrice: order.price,
    estimatedNotional,
    sellableQuantity,
    maxOrderQty: MAX_ORDER_QTY,
    maxOrderUsd: MAX_ORDER_USD,
    submissionEnabled: ORDER_ENABLED
  };
}

async function submitBuy(input) {
  const preview = await previewBuy(input);
  assertOrderEnabled();

  const body = {
    stex_tp: preview.exchange,
    stk_cd: preview.symbol,
    ord_qty: String(preview.quantity),
    trde_tp: preview.orderType,
    ord_uv: String(preview.price)
  };

  const { data } = await kiwoom.requestPage({
    apiId: 'ust20000',
    apiPath: '/api/us/ordr',
    body
  });

  return {
    ok: true,
    side: 'BUY',
    orderNo: data.ord_no || '',
    name: data.stk_nm || '',
    preview,
    raw: data
  };
}

async function submitSell(input) {
  const preview = await previewSell(input);
  assertOrderEnabled();

  const body = {
    stex_tp: preview.exchange,
    stk_cd: preview.symbol,
    ord_qty: String(preview.quantity),
    trde_tp: preview.orderType,
    ord_uv: String(preview.price)
  };

  const { data } = await kiwoom.requestPage({
    apiId: 'ust20001',
    apiPath: '/api/us/ordr',
    body
  });

  return {
    ok: true,
    side: 'SELL',
    orderNo: data.ord_no || '',
    name: data.stk_nm || '',
    preview,
    raw: data
  };
}

module.exports = {
  previewBuy,
  previewSell,
  submitBuy,
  submitSell,
  normalizeOrder
};
