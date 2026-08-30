'use strict';

const kiwoom = require('./kiwoom-us-client');
const marketClient = require('./us-core-market-client');
const { getRecentTradingDateKeys } = require('./market-calendar');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function compactDate(key) {
  return String(key || '').replace(/-/g, '');
}

function addDaysKey(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

async function runCheck(name, fn) {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    const status = detail?.status || 'PASS';
    return {
      name,
      ok: status !== 'FAIL',
      status,
      elapsedMs: Date.now() - startedAt,
      ...detail
    };
  } catch (err) {
    return {
      name,
      ok: false,
      status: 'FAIL',
      elapsedMs: Date.now() - startedAt,
      error: err.message
    };
  }
}

async function runDiagnostics() {
  const targetTradingDate = getRecentTradingDateKeys('US', 1)[0];
  if (!targetTradingDate) throw new Error('최근 미국 거래일을 계산하지 못했습니다.');

  const compactTarget = compactDate(targetTradingDate);
  const checks = [];

  checks.push(await runCheck('NVDA 현재가 API', async () => {
    const row = await kiwoom.getQuote('ND', 'NVDA');
    const price = toNumber(row.cur_prc);
    return {
      status: price > 0 ? 'PASS' : 'WARN',
      symbol: 'NVDA',
      exchange: 'ND',
      price,
      message: price > 0 ? '현재가 응답 정상' : '응답은 받았지만 가격이 0입니다.'
    };
  }));

  checks.push(await runCheck('QQQ 5분봉 API', async () => {
    const result = await marketClient.getMinuteChart({
      exchange: 'ND',
      symbol: 'QQQ',
      startDate: targetTradingDate,
      minute: 5,
      maxPages: 1
    });
    const sameDay = result.rows.filter(row => String(row.businessDate || '') === compactTarget);
    return {
      status: sameDay.length > 0 ? 'PASS' : result.rows.length > 0 ? 'WARN' : 'FAIL',
      symbol: 'QQQ',
      rowCount: result.rows.length,
      targetDateRowCount: sameDay.length,
      latestBusinessDate: result.rows.map(row => String(row.businessDate || '')).sort().at(-1) || null,
      returnCode: result.returnCode,
      returnMsg: result.returnMsg,
      message: sameDay.length > 0 ? '최근 거래일 5분봉 정상' : '최근 거래일 분봉 날짜를 확인해야 합니다.'
    };
  }));

  checks.push(await runCheck('NVDA 5분봉 API', async () => {
    const result = await marketClient.getMinuteChart({
      exchange: 'ND',
      symbol: 'NVDA',
      startDate: targetTradingDate,
      minute: 5,
      maxPages: 1
    });
    const sameDay = result.rows.filter(row => String(row.businessDate || '') === compactTarget);
    return {
      status: sameDay.length > 0 ? 'PASS' : result.rows.length > 0 ? 'WARN' : 'FAIL',
      symbol: 'NVDA',
      rowCount: result.rows.length,
      targetDateRowCount: sameDay.length,
      latestBusinessDate: result.rows.map(row => String(row.businessDate || '')).sort().at(-1) || null,
      returnCode: result.returnCode,
      returnMsg: result.returnMsg,
      message: sameDay.length > 0 ? '최근 거래일 5분봉 정상' : '최근 거래일 분봉 날짜를 확인해야 합니다.'
    };
  }));

  checks.push(await runCheck('NVDA 일봉 API', async () => {
    const result = await marketClient.getDailyChart({
      exchange: 'ND',
      symbol: 'NVDA',
      startDate: addDaysKey(targetTradingDate, -35),
      maxPages: 1
    });
    const dates = result.rows.map(row => String(row.date || '')).filter(Boolean).sort();
    return {
      status: result.rows.length >= 5 ? 'PASS' : result.rows.length > 0 ? 'WARN' : 'FAIL',
      symbol: 'NVDA',
      rowCount: result.rows.length,
      latestDate: dates.at(-1) || null,
      returnCode: result.returnCode,
      returnMsg: result.returnMsg,
      message: result.rows.length >= 5 ? '일봉 표본 정상' : '일봉 표본 수가 적습니다.'
    };
  }));

  checks.push(await runCheck('당일 거래량 상위 API', async () => {
    const result = await marketClient.getTodayVolumeTop({ maxPages: 1 });
    return {
      status: result.rows.length > 0 ? 'PASS' : 'WARN',
      rowCount: result.rows.length,
      sampleSymbols: result.rows.slice(0, 5).map(row => row.symbol),
      returnCode: result.returnCode,
      returnMsg: result.returnMsg,
      message: result.rows.length > 0 ? '거래량 상위 응답 정상' : '장외시간이라 결과가 비어 있을 수 있습니다.'
    };
  }));

  checks.push(await runCheck('시가대비 상승률 상위 API', async () => {
    const result = await marketClient.getChangeRateTopVsOpen({ maxPages: 1 });
    return {
      status: result.rows.length > 0 ? 'PASS' : 'WARN',
      rowCount: result.rows.length,
      sampleSymbols: result.rows.slice(0, 5).map(row => row.symbol),
      returnCode: result.returnCode,
      returnMsg: result.returnMsg,
      message: result.rows.length > 0 ? '상승률 상위 응답 정상' : '장외시간이라 결과가 비어 있을 수 있습니다.'
    };
  }));

  const failCount = checks.filter(item => item.status === 'FAIL').length;
  const warnCount = checks.filter(item => item.status === 'WARN').length;
  const passCount = checks.filter(item => item.status === 'PASS').length;

  return {
    ok: failCount === 0,
    strategy: 'CORE',
    diagnosticOnly: true,
    actualOrderEnabled: false,
    writesCandidateState: false,
    writesVirtualTradeState: false,
    targetTradingDate,
    status: failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS',
    passCount,
    warnCount,
    failCount,
    checks,
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  runDiagnostics
};
