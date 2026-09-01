'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const BASE_URL = String(process.env.KIWOOM_US_BASE_URL || '').replace(/\/$/, '');
const MODE = String(process.env.TRADING_MODE || '').toUpperCase();
const TOKEN_FILE = path.join(__dirname, 'token.txt');

const EXCHANGES = new Set(['NA', 'ND', 'NY']);
const ORDER_API_IDS = new Set(['ust20000', 'ust20001', 'ust20002', 'ust20003']);
const API_MIN_INTERVAL_MS = Number(process.env.US_API_MIN_INTERVAL_MS || 1100);
const READ_RATE_LIMIT_RETRIES = Number(process.env.US_READ_RATE_LIMIT_RETRIES || 2);
const READ_RATE_LIMIT_BACKOFF_MS = Number(process.env.US_READ_RATE_LIMIT_BACKOFF_MS || 1500);
const nextAllowedAtByApiId = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertPaperMode() {
  if (MODE !== 'PAPER') throw new Error('SY Quant US client currently allows PAPER mode only');
  if (BASE_URL !== 'https://mockapi.kiwoom.com') throw new Error('Unexpected Kiwoom US PAPER API URL');
}

function validateRateSettings() {
  if (!Number.isFinite(API_MIN_INTERVAL_MS) || API_MIN_INTERVAL_MS < 1000 || API_MIN_INTERVAL_MS > 10000) {
    throw new Error('US_API_MIN_INTERVAL_MS must be between 1000 and 10000');
  }
  if (!Number.isInteger(READ_RATE_LIMIT_RETRIES) || READ_RATE_LIMIT_RETRIES < 0 || READ_RATE_LIMIT_RETRIES > 5) {
    throw new Error('US_READ_RATE_LIMIT_RETRIES must be an integer between 0 and 5');
  }
  if (!Number.isFinite(READ_RATE_LIMIT_BACKOFF_MS) || READ_RATE_LIMIT_BACKOFF_MS < 1000 || READ_RATE_LIMIT_BACKOFF_MS > 30000) {
    throw new Error('US_READ_RATE_LIMIT_BACKOFF_MS must be between 1000 and 30000');
  }
}

function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error('token.txt not found');
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  if (!token) throw new Error('token.txt is empty');
  return token;
}

async function waitForApiSlot(apiId) {
  validateRateSettings();

  const now = Date.now();
  const reservedAt = Math.max(now, nextAllowedAtByApiId.get(apiId) || 0);
  nextAllowedAtByApiId.set(apiId, reservedAt + API_MIN_INTERVAL_MS);

  const waitMs = reservedAt - now;
  if (waitMs > 0) await sleep(waitMs);
}

async function sendRequest({ apiId, apiPath, body, contYn, nextKey }) {
  await waitForApiSlot(apiId);

  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    'authorization': 'Bearer ' + readToken(),
    'api-id': apiId
  };

  if (contYn !== null) headers['cont-yn'] = contYn;
  if (nextKey !== null) headers['next-key'] = nextKey;

  const response = await fetch(BASE_URL + apiPath, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Kiwoom response is not valid JSON (HTTP ' + response.status + ')');
  }

  return { response, data };
}

async function requestPage({ apiId, apiPath, body = {}, contYn = null, nextKey = null }) {
  assertPaperMode();

  const isOrderRequest = ORDER_API_IDS.has(apiId);
  const maxAttempts = isOrderRequest ? 1 : 1 + READ_RATE_LIMIT_RETRIES;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { response, data } = await sendRequest({
      apiId,
      apiPath,
      body,
      contYn,
      nextKey
    });

    const returnCode = Number(data.return_code ?? 0);
    const rateLimited = response.status === 429 || returnCode === 5;

    if (response.ok && returnCode === 0) {
      return {
        data,
        continuation: {
          contYn: response.headers.get('cont-yn'),
          nextKey: response.headers.get('next-key')
        }
      };
    }

    if (rateLimited && !isOrderRequest && attempt < maxAttempts) {
      await sleep(READ_RATE_LIMIT_BACKOFF_MS * attempt);
      continue;
    }

    const message = data.return_msg || data.message || 'Kiwoom API request failed';
    throw new Error(message + ' (HTTP ' + response.status + ', return_code=' + returnCode + ')');
  }

  throw new Error('Kiwoom API request failed after retry limit');
}

async function getQuote(exchange, symbol) {
  const stexTp = String(exchange || '').toUpperCase();
  const stkCd = String(symbol || '').toUpperCase();

  if (!EXCHANGES.has(stexTp)) throw new Error('exchange must be NA, ND, or NY');
  if (!stkCd) throw new Error('symbol is required');

  const { data } = await requestPage({
    apiId: 'usa20100',
    apiPath: '/api/us/mrkcond',
    body: { stex_tp: stexTp, stk_cd: stkCd }
  });

  return data;
}

async function getDeposit() {
  const { data } = await requestPage({
    apiId: 'ust21110',
    apiPath: '/api/us/acnt',
    body: {}
  });

  return data;
}

async function getUsdDeposit() {
  const data = await getDeposit();
  const rows = Array.isArray(data.result_list) ? data.result_list : [];
  const usd = rows.find(row => row && row.crnc_code === 'USD');
  if (!usd) throw new Error('USD deposit row not found');

  return {
    currency: usd.crnc_code,
    currencyName: usd.crnc_nm,
    deposit: Number(usd.fc_entra || 0),
    orderAvailable: Number(usd.fc_ord_alowa || 0),
    withdrawAvailable: Number(usd.fc_pymn_alowa || 0),
    raw: usd
  };
}

async function getHoldings({ exchange = '', symbol = '', maxPages = 10 } = {}) {
  const stexTp = String(exchange || '').toUpperCase();
  const stkCd = String(symbol || '').toUpperCase();

  if (stexTp && !EXCHANGES.has(stexTp)) {
    throw new Error('exchange must be empty, NA, ND, or NY');
  }

  const holdings = [];
  let contYn = null;
  let nextKey = null;
  let lastData = null;

  for (let page = 0; page < maxPages; page += 1) {
    const { data, continuation } = await requestPage({
      apiId: 'ust21070',
      apiPath: '/api/us/acnt',
      body: { stex_tp: stexTp, stk_cd: stkCd },
      contYn,
      nextKey
    });

    if (Array.isArray(data.result_list)) holdings.push(...data.result_list);
    lastData = data;

    if (continuation.contYn !== 'Y') break;

    contYn = 'Y';
    nextKey = continuation.nextKey || '';
  }

  return {
    returnCode: Number(lastData?.return_code ?? 0),
    returnMsg: lastData?.return_msg || '',
    holdings,
    rawSummary: lastData
  };
}

module.exports = {
  requestPage,
  getQuote,
  getDeposit,
  getUsdDeposit,
  getHoldings
};
