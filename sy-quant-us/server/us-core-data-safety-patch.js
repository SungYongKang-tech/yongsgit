'use strict';

const kiwoom = require('./kiwoom-us-client');
const marketClient = require('./us-core-market-client');
const { getRecentTradingDateKeys } = require('./market-calendar');

let installed = false;

function numeric(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, '').replace(/\+/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function absolutePrice(value) {
  return Math.abs(numeric(value));
}

function normalizeQuotePrices(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    cur_prc: absolutePrice(row.cur_prc),
    open_pric: absolutePrice(row.open_pric),
    high_pric: absolutePrice(row.high_pric),
    low_pric: absolutePrice(row.low_pric)
  };
}

function normalizeMappedRows(result) {
  if (!result || !Array.isArray(result.rows)) return result;
  return {
    ...result,
    rows: result.rows.map(row => ({
      ...row,
      price: row.price === undefined ? row.price : absolutePrice(row.price),
      close: row.close === undefined ? row.close : absolutePrice(row.close),
      open: row.open === undefined ? row.open : absolutePrice(row.open),
      high: row.high === undefined ? row.high : absolutePrice(row.high),
      low: row.low === undefined ? row.low : absolutePrice(row.low)
    }))
  };
}

function parseDateKey(key) {
  const text = String(key || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(text)) return null;
  return Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)), 12);
}

function daysBetween(a, b) {
  const ams = parseDateKey(a);
  const bms = parseDateKey(b);
  if (ams === null || bms === null) return null;
  return Math.round((bms - ams) / 86400000);
}

function latestTradingDate() {
  return getRecentTradingDateKeys('US', 1)[0] || null;
}

function correctedDailyAnchor(startDate, preserveStartDate) {
  if (preserveStartDate) return startDate;
  const latest = latestTradingDate();
  if (!latest) return startDate;
  if (!startDate) return latest;

  const gap = daysBetween(startDate, latest);
  // CORE 평균거래량용 호출이 30~40일 전 날짜를 넘기던 오류를 방지한다.
  // 명시적 과거조회가 필요하면 preserveStartDate:true를 사용한다.
  if (gap !== null && gap > 14) return latest;
  return startDate;
}

function install() {
  if (installed) return;
  installed = true;

  const originalGetQuote = kiwoom.getQuote.bind(kiwoom);
  kiwoom.getQuote = async function patchedGetQuote(exchange, symbol) {
    const row = await originalGetQuote(exchange, symbol);
    return normalizeQuotePrices(row);
  };

  const originalMinute = marketClient.getMinuteChart.bind(marketClient);
  marketClient.getMinuteChart = async function patchedMinute(options = {}) {
    return normalizeMappedRows(await originalMinute(options));
  };

  const originalDaily = marketClient.getDailyChart.bind(marketClient);
  marketClient.getDailyChart = async function patchedDaily(options = {}) {
    const startDate = correctedDailyAnchor(options.startDate, options.preserveStartDate === true);
    return normalizeMappedRows(await originalDaily({ ...options, startDate }));
  };

  const originalVolumeTop = marketClient.getTodayVolumeTop.bind(marketClient);
  marketClient.getTodayVolumeTop = async function patchedVolumeTop(options = {}) {
    return normalizeMappedRows(await originalVolumeTop(options));
  };

  const originalOpenChangeTop = marketClient.getChangeRateTopVsOpen.bind(marketClient);
  marketClient.getChangeRateTopVsOpen = async function patchedOpenChangeTop(options = {}) {
    return normalizeMappedRows(await originalOpenChangeTop(options));
  };

  console.log('[US-CORE 데이터보정] 가격부호 정규화 + 최근 일봉 기준일 보정 활성화');
}

install();

module.exports = {
  install,
  absolutePrice,
  correctedDailyAnchor,
  latestTradingDate
};
