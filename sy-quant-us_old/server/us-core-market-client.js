'use strict';

const kiwoom = require('./kiwoom-us-client');

const EXCHANGES = new Set(['NA', 'ND', 'NY']);

function normalizeExchange(value) {
  const text = String(value || '').toUpperCase().trim();
  if (EXCHANGES.has(text)) return text;
  if (text === '1' || text.includes('NYSE')) return 'NY';
  if (text === '2' || text.includes('NASDAQ') || text.includes('NASD')) return 'ND';
  if (text === '3' || text.includes('AMEX')) return 'NA';
  return '';
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, '').replace(/\+/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function fetchList({ apiId, apiPath, body, maxPages = 1 }) {
  const rows = [];
  let contYn = null;
  let nextKey = null;
  let lastData = null;
  const pageLimit = Math.max(1, Math.min(10, Math.trunc(Number(maxPages) || 1)));

  for (let page = 0; page < pageLimit; page += 1) {
    const { data, continuation } = await kiwoom.requestPage({
      apiId,
      apiPath,
      body,
      contYn,
      nextKey
    });

    lastData = data;
    if (Array.isArray(data.result_list)) rows.push(...data.result_list);
    if (continuation.contYn !== 'Y') break;

    contYn = 'Y';
    nextKey = continuation.nextKey || '';
  }

  return {
    rows,
    returnCode: Number(lastData?.return_code ?? 0),
    returnMsg: lastData?.return_msg || '',
    raw: lastData
  };
}

async function getMinuteChart({
  exchange,
  symbol,
  startDate,
  minute = 5,
  adjusted = false,
  exchangeRateApplied = true,
  maxPages = 2
} = {}) {
  const stexTp = normalizeExchange(exchange);
  const stkCd = String(symbol || '').toUpperCase().trim();
  if (!stexTp) throw new Error('minute chart exchange must be NA, ND, or NY');
  if (!stkCd) throw new Error('minute chart symbol is required');

  const result = await fetchList({
    apiId: 'usa06011',
    apiPath: '/api/us/chart',
    maxPages,
    body: {
      stex_tp: stexTp,
      stk_cd: stkCd,
      strt_dt: String(startDate || '').replace(/-/g, ''),
      tic_scope: String(Math.max(1, Math.trunc(Number(minute) || 5))),
      upd_stkpc_tp: adjusted ? '1' : '0',
      exrt_appl_tp: exchangeRateApplied ? '1' : '0'
    }
  });

  return {
    ...result,
    rows: result.rows.map(row => ({
      close: toNumber(row.cur_prc),
      volume: toNumber(row.trde_qty),
      open: toNumber(row.open_pric),
      high: toNumber(row.high_pric),
      low: toNumber(row.low_pric),
      time: String(row.cntr_tm || ''),
      businessDate: String(row.bus_dt || ''),
      raw: row
    }))
  };
}

async function getDailyChart({
  exchange,
  symbol,
  startDate,
  adjusted = true,
  exchangeRateApplied = false,
  maxPages = 1
} = {}) {
  const stexTp = normalizeExchange(exchange);
  const stkCd = String(symbol || '').toUpperCase().trim();
  if (!stexTp) throw new Error('daily chart exchange must be NA, ND, or NY');
  if (!stkCd) throw new Error('daily chart symbol is required');

  const result = await fetchList({
    apiId: 'usa06012',
    apiPath: '/api/us/chart',
    maxPages,
    body: {
      stex_tp: stexTp,
      stk_cd: stkCd,
      strt_dt: String(startDate || '').replace(/-/g, ''),
      upd_stkpc_tp: adjusted ? '1' : '0',
      exrt_appl_tp: exchangeRateApplied ? '1' : '0'
    }
  });

  return {
    ...result,
    rows: result.rows.map(row => ({
      close: toNumber(row.cur_prc),
      change: toNumber(row.pred_pre),
      changeRate: toNumber(row.flu_rt),
      volume: toNumber(row.acc_trde_qty),
      tradeValue: toNumber(row.acc_trde_prica),
      open: toNumber(row.open_pric),
      high: toNumber(row.high_pric),
      low: toNumber(row.low_pric),
      date: String(row.dt || ''),
      raw: row
    }))
  };
}

async function getTodayVolumeTop({ maxPages = 1 } = {}) {
  const result = await fetchList({
    apiId: 'usa20530',
    apiPath: '/api/us/rkinfo',
    maxPages,
    body: {
      stex_tp: '0',
      inds_cd: '',
      stk_tp: '1',
      trde_qty_tp: '10',
      qry_tp: '0',
      stk_cnd: '0',
      pric_cnd: '3',
      trde_prica_cnd: '100'
    }
  });

  return {
    ...result,
    rows: result.rows.map(row => ({
      rank: toNumber(row.rank),
      exchange: normalizeExchange(row.stex_tp),
      symbol: String(row.stk_cd || '').toUpperCase().trim(),
      name: String(row.stk_nm || row.stk_enm || row.stk_cd || ''),
      englishName: String(row.stk_enm || ''),
      price: toNumber(row.cur_prc),
      changeRate: toNumber(row.flu_rt),
      volume: toNumber(row.acc_trde_qty),
      previousRatio: toNumber(row.pred_rt),
      tradeValue: toNumber(row.trde_prica),
      raw: row,
      source: 'VOLUME_TOP'
    }))
  };
}

async function getChangeRateTopVsOpen({ maxPages = 1 } = {}) {
  const result = await fetchList({
    apiId: 'usa20920',
    apiPath: '/api/us/rkinfo',
    maxPages,
    body: {
      stex_tp: '0',
      inds_cd: '',
      trde_qty_tp: '10',
      stk_tp: '1',
      stk_cnd: '0',
      pric_cnd: '3',
      trde_prica_cnd: '100',
      sort_tp: '1'
    }
  });

  return {
    ...result,
    rows: result.rows.map(row => ({
      rank: toNumber(row.rank),
      exchange: normalizeExchange(row.stex_tp),
      symbol: String(row.stk_cd || '').toUpperCase().trim(),
      name: String(row.stk_nm || row.stk_enm || row.stk_cd || ''),
      englishName: String(row.stk_enm || ''),
      price: toNumber(row.cur_prc),
      changeRate: toNumber(row.flu_rt),
      openChangeRate: toNumber(row.open_pric_pre),
      high: toNumber(row.high_pric),
      low: toNumber(row.low_pric),
      open: toNumber(row.open_pric),
      volume: toNumber(row.acc_trde_qty),
      executionTime: String(row.cntr_tm || ''),
      raw: row,
      source: 'OPEN_CHANGE_TOP'
    }))
  };
}

module.exports = {
  normalizeExchange,
  toNumber,
  getMinuteChart,
  getDailyChart,
  getTodayVolumeTop,
  getChangeRateTopVsOpen
};
