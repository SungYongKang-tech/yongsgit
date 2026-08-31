'use strict';

const fs = require('fs');
const path = require('path');
const coreHistory = require('./us-core-history-store');
const virtualTracker = require('./us-core-virtual-tracker');
const { marketTodayKey, isUsTradingDay } = require('./market-calendar');

const REPORT_DIR = path.join(__dirname, 'us-core-reports');
const CHECK_INTERVAL_MS = 60 * 1000;
const FINALIZE_AT_ET = '16:20';

let timer = null;
let lastGeneratedDate = null;
let lastCheckAt = null;
let lastError = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function compactDate(value) {
  return String(value || '').replace(/-/g, '');
}

function jsonPath(dateKey) {
  if (!validDateKey(dateKey)) throw new Error('date must be YYYY-MM-DD');
  return path.join(REPORT_DIR, `us-core-summary-${compactDate(dateKey)}.json`);
}

function textPath(dateKey) {
  if (!validDateKey(dateKey)) throw new Error('date must be YYYY-MM-DD');
  return path.join(REPORT_DIR, `us-core-summary-${compactDate(dateKey)}.txt`);
}

function nyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function avg(values = []) {
  const nums = values.map(toNumber).filter(Number.isFinite);
  return nums.length ? round(nums.reduce((sum, value) => sum + value, 0) / nums.length) : null;
}

function finalReturn(position) {
  if (position.status === 'CLOSED' && position.closeReturnRate !== null && position.closeReturnRate !== undefined) {
    return toNumber(position.closeReturnRate);
  }
  return toNumber(position.currentReturnRate);
}

function buildCandidateSummary(history) {
  const rows = Array.isArray(history?.summary?.candidates) ? history.summary.candidates : [];
  const readyRows = rows.filter(item => toNumber(item.readyCount) > 0);
  const watchRows = rows.filter(item => toNumber(item.watchCount) > 0);
  return {
    scanCount: toNumber(history?.summary?.scanCount),
    uniqueCandidateCount: toNumber(history?.summary?.uniqueCandidateCount),
    uniqueReadyCount: readyRows.length,
    uniqueWatchCount: watchRows.length,
    readySymbols: readyRows.map(item => item.symbol),
    topCandidates: rows.slice(0, 10).map(item => ({
      exchange: item.exchange,
      symbol: item.symbol,
      name: item.name,
      maxScore: toNumber(item.maxScore),
      readyCount: toNumber(item.readyCount),
      watchCount: toNumber(item.watchCount),
      scanCount: toNumber(item.scanCount),
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt
    }))
  };
}

function buildMarketSummary(history) {
  const scans = Array.isArray(history?.day?.scans) ? history.day.scans : [];
  const qqqRows = scans
    .map(scan => scan.market)
    .filter(item => item && Number.isFinite(Number(item.changeRate)));
  const errorCount = scans.reduce(
    (sum, scan) => sum + (Array.isArray(scan.errors) ? scan.errors.length : 0),
    0
  );
  return {
    firstQqqChangeRate: qqqRows.length ? toNumber(qqqRows[0].changeRate) : null,
    lastQqqChangeRate: qqqRows.length ? toNumber(qqqRows.at(-1).changeRate) : null,
    averageQqqChangeRate: avg(qqqRows.map(item => item.changeRate)),
    scanErrorCount: errorCount
  };
}

function buildVirtualSummary(dateKey) {
  const status = virtualTracker.getStatus({ includePositions: true });
  const positions = (Array.isArray(status.positions) ? status.positions : [])
    .filter(item => item.marketDate === dateKey);
  const completed = positions.filter(item => item.status === 'CLOSED');
  const review = positions.filter(item => item.status === 'CLOSE_REVIEW');
  const returns = positions.map(finalReturn);
  const wins = returns.filter(value => value > 0).length;
  const losses = returns.filter(value => value < 0).length;
  const flats = returns.length - wins - losses;

  const milestone = minutes => positions
    .map(item => item.milestones?.[String(minutes)]?.returnRate)
    .filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(toNumber);

  const ranked = positions
    .map(item => ({ ...item, analysisReturnRate: finalReturn(item) }))
    .sort((a, b) => b.analysisReturnRate - a.analysisReturnRate);

  return {
    entryCount: positions.length,
    closedCount: completed.length,
    closeReviewCount: review.length,
    winCount: wins,
    lossCount: losses,
    flatCount: flats,
    winRate: positions.length ? round((wins / positions.length) * 100) : null,
    averageReturnRate: avg(returns),
    average10MinReturnRate: avg(milestone(10)),
    average30MinReturnRate: avg(milestone(30)),
    average60MinReturnRate: avg(milestone(60)),
    averageSampledMfeRate: avg(positions.map(item => item.sampledMaxReturnRate)),
    averageSampledMaeRate: avg(positions.map(item => item.sampledMinReturnRate)),
    best: ranked.length ? {
      symbol: ranked[0].symbol,
      name: ranked[0].name,
      entryPrice: ranked[0].entryPrice,
      finalPrice: ranked[0].closePrice ?? ranked[0].lastPrice,
      returnRate: ranked[0].analysisReturnRate,
      entryScore: ranked[0].entryScore,
      sampledMfeRate: ranked[0].sampledMaxReturnRate,
      sampledMaeRate: ranked[0].sampledMinReturnRate
    } : null,
    worst: ranked.length ? {
      symbol: ranked.at(-1).symbol,
      name: ranked.at(-1).name,
      entryPrice: ranked.at(-1).entryPrice,
      finalPrice: ranked.at(-1).closePrice ?? ranked.at(-1).lastPrice,
      returnRate: ranked.at(-1).analysisReturnRate,
      entryScore: ranked.at(-1).entryScore,
      sampledMfeRate: ranked.at(-1).sampledMaxReturnRate,
      sampledMaeRate: ranked.at(-1).sampledMinReturnRate
    } : null,
    positions: ranked.map(item => ({
      exchange: item.exchange,
      symbol: item.symbol,
      name: item.name,
      status: item.status,
      entryAt: item.entryAt,
      entryPrice: item.entryPrice,
      entryScore: item.entryScore,
      finalPrice: item.closePrice ?? item.lastPrice,
      returnRate: item.analysisReturnRate,
      sampledMfeRate: item.sampledMaxReturnRate,
      sampledMaeRate: item.sampledMinReturnRate,
      return10m: item.milestones?.['10']?.returnRate ?? null,
      return30m: item.milestones?.['30']?.returnRate ?? null,
      return60m: item.milestones?.['60']?.returnRate ?? null,
      entrySignal: clone(item.entrySignal || {})
    }))
  };
}

function buildSummary(dateKey, { final = false } = {}) {
  if (!validDateKey(dateKey)) throw new Error('date must be YYYY-MM-DD');
  const history = coreHistory.getHistory(dateKey);
  const candidates = buildCandidateSummary(history);
  const virtual = buildVirtualSummary(dateKey);
  const market = buildMarketSummary(history);
  const enteredSymbols = new Set(virtual.positions.map(item => item.symbol));
  const readyWithoutVirtualEntry = candidates.readySymbols.filter(symbol => !enteredSymbols.has(symbol));

  return {
    ok: true,
    strategy: 'CORE',
    market: 'US',
    observerOnly: true,
    actualOrderEnabled: false,
    reportType: final ? 'FINAL' : 'PREVIEW',
    tradingDate: dateKey,
    generatedAt: new Date().toISOString(),
    candidates,
    virtual,
    marketSummary: market,
    consistency: {
      readyWithoutVirtualEntryCount: readyWithoutVirtualEntry.length,
      readyWithoutVirtualEntry
    }
  };
}

function formatRate(value) {
  if (value === null || value === undefined) return '-';
  const n = toNumber(value);
  return `${n > 0 ? '+' : ''}${round(n).toFixed(2)}%`;
}

function formatText(summary) {
  const c = summary.candidates;
  const v = summary.virtual;
  const m = summary.marketSummary;
  const lines = [
    '===== SY Quant US-CORE DAILY SUMMARY =====',
    `거래일: ${summary.tradingDate}`,
    `보고서: ${summary.reportType}`,
    `생성: ${summary.generatedAt}`,
    '실제주문: OFF',
    '',
    '===== 후보 =====',
    `스캔: ${c.scanCount}회`,
    `고유후보: ${c.uniqueCandidateCount}종목`,
    `READY 경험: ${c.uniqueReadyCount}종목`,
    `WATCH 경험: ${c.uniqueWatchCount}종목`,
    `READY 미가상진입: ${summary.consistency.readyWithoutVirtualEntryCount}종목`,
    '',
    '===== 가상진입 성과 =====',
    `가상진입: ${v.entryCount}종목`,
    `종료: ${v.closedCount} / 확인필요: ${v.closeReviewCount}`,
    `승/패/보합: ${v.winCount}/${v.lossCount}/${v.flatCount}`,
    `승률: ${v.winRate === null ? '-' : `${v.winRate}%`}`,
    `평균수익률: ${formatRate(v.averageReturnRate)}`,
    `10분 평균: ${formatRate(v.average10MinReturnRate)}`,
    `30분 평균: ${formatRate(v.average30MinReturnRate)}`,
    `60분 평균: ${formatRate(v.average60MinReturnRate)}`,
    `평균 MFE(5분표본): ${formatRate(v.averageSampledMfeRate)}`,
    `평균 MAE(5분표본): ${formatRate(v.averageSampledMaeRate)}`,
    '',
    '===== 시장 =====',
    `QQQ 최초: ${formatRate(m.firstQqqChangeRate)}`,
    `QQQ 마지막: ${formatRate(m.lastQqqChangeRate)}`,
    `QQQ 평균: ${formatRate(m.averageQqqChangeRate)}`,
    `스캔 오류: ${m.scanErrorCount}건`,
    '',
    '===== 최고 / 최악 =====',
    v.best ? `최고: ${v.best.symbol} ${formatRate(v.best.returnRate)} / 진입점수 ${v.best.entryScore}` : '최고: -',
    v.worst ? `최악: ${v.worst.symbol} ${formatRate(v.worst.returnRate)} / 진입점수 ${v.worst.entryScore}` : '최악: -',
    '',
    '===== 가상진입 상세 ====='
  ];

  if (!v.positions.length) {
    lines.push('가상진입 없음');
  } else {
    for (const row of v.positions) {
      lines.push(
        `${row.symbol} | ${row.status} | 진입 ${row.entryPrice} | 점수 ${row.entryScore} | ` +
        `10m ${formatRate(row.return10m)} | 30m ${formatRate(row.return30m)} | ` +
        `60m ${formatRate(row.return60m)} | 최종 ${formatRate(row.returnRate)} | ` +
        `MFE ${formatRate(row.sampledMfeRate)} | MAE ${formatRate(row.sampledMaeRate)}`
      );
    }
  }

  lines.push('', '===== 최고점수 후보 =====');
  if (!c.topCandidates.length) lines.push('후보 없음');
  for (const row of c.topCandidates) {
    lines.push(
      `${row.symbol} | 최고 ${row.maxScore}점 | READY ${row.readyCount}회 | WATCH ${row.watchCount}회 | 스캔 ${row.scanCount}회`
    );
  }

  return lines.join('\n') + '\n';
}

function writeFinalSummary(dateKey) {
  ensureDir();
  const summary = buildSummary(dateKey, { final: true });
  const jsonTarget = jsonPath(dateKey);
  const textTarget = textPath(dateKey);
  const jsonTemp = `${jsonTarget}.${process.pid}.${Date.now()}.tmp`;
  const textTemp = `${textTarget}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(jsonTemp, JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(textTemp, formatText(summary), 'utf8');
  fs.renameSync(jsonTemp, jsonTarget);
  fs.renameSync(textTemp, textTarget);
  lastGeneratedDate = dateKey;
  lastError = null;
  console.log(
    '[US-CORE 일일요약]',
    `${dateKey} / 후보 ${summary.candidates.uniqueCandidateCount} / READY ${summary.candidates.uniqueReadyCount} /`,
    `가상진입 ${summary.virtual.entryCount} / 평균 ${formatRate(summary.virtual.averageReturnRate)} / 실제주문 없음`
  );
  return summary;
}

function readStoredSummary(dateKey) {
  const target = jsonPath(dateKey);
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function getSummary(dateKey, { preview = true } = {}) {
  const resolved = validDateKey(dateKey) ? dateKey : marketTodayKey('US');
  const stored = readStoredSummary(resolved);
  if (stored) return stored;
  return preview ? buildSummary(resolved, { final: false }) : null;
}

function checkAndGenerate(now = new Date()) {
  lastCheckAt = now.toISOString();
  try {
    const dateKey = marketTodayKey('US', now);
    const clock = nyClock(now);
    if (!isUsTradingDay(dateKey)) return { generated: false, reason: 'NON_TRADING_DAY' };
    if (clock < FINALIZE_AT_ET) return { generated: false, reason: 'WAITING_FOR_CLOSE' };
    if (lastGeneratedDate === dateKey || fs.existsSync(jsonPath(dateKey))) {
      lastGeneratedDate = dateKey;
      return { generated: false, reason: 'ALREADY_GENERATED' };
    }
    return { generated: true, summary: writeFinalSummary(dateKey) };
  } catch (err) {
    lastError = err.message;
    console.error('[US-CORE 일일요약 오류]', err.message);
    return { generated: false, reason: 'ERROR', error: err.message };
  }
}

function getStatus() {
  return {
    ok: true,
    strategy: 'CORE',
    summaryEnabled: true,
    actualOrderEnabled: false,
    polling: Boolean(timer),
    checkIntervalMs: CHECK_INTERVAL_MS,
    finalizeAtEt: FINALIZE_AT_ET,
    reportDir: REPORT_DIR,
    lastGeneratedDate,
    lastCheckAt,
    lastError
  };
}

function startDailySummary() {
  if (timer) return timer;
  ensureDir();
  timer = setInterval(checkAndGenerate, CHECK_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  const initial = setTimeout(checkAndGenerate, 10000);
  if (typeof initial.unref === 'function') initial.unref();
  console.log('[US-CORE 일일요약] 16:20 ET 자동생성 시작 / JSON+TXT / 실제주문 영향 없음');
  return timer;
}

module.exports = {
  REPORT_DIR,
  FINALIZE_AT_ET,
  startDailySummary,
  checkAndGenerate,
  buildSummary,
  writeFinalSummary,
  getSummary,
  getStatus,
  formatText
};
