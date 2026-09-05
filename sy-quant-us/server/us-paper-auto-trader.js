'use strict';

const fs = require('fs');
const path = require('path');

const kiwoom = require('./kiwoom-us-client');
const orderClient = require('./kiwoom-us-order-client');
const strategySettings = require('./strategy-settings-store');
const activityStore = require('./us-dashboard-activity-store');

const STATE_FILE = path.join(__dirname, 'us-paper-auto-state.json');

const FALLBACK_PAPER_CAPITAL = Number(process.env.US_PAPER_CAPITAL || 40000);
let accountSnapshot = {
  totalAsset: FALLBACK_PAPER_CAPITAL,
  deposit: FALLBACK_PAPER_CAPITAL,
  orderAvailable: FALLBACK_PAPER_CAPITAL,
  holdingsValue: 0,
  holdingCount: 0,
  source: 'ENV_FALLBACK',
  fetchedAt: null
};
const MONITOR_INTERVAL_MS = Number(process.env.US_AUTO_MONITOR_INTERVAL_MS || 60000);

// 미체결 주문은 별도 빠른 감시.
// 전체 보유/청산 감시는 기존 60초를 유지한다.
const PENDING_MONITOR_INTERVAL_MS = Number(
  process.env.US_PENDING_MONITOR_INTERVAL_MS || 5000
);
const MAX_AUTO_BUYS_PER_SCAN = Number(process.env.US_MAX_AUTO_BUYS_PER_SCAN || 1);

// 키움 US PAPER 주문클라이언트의 1회 주문금액 상한과 동일하게 유지
const MAX_AUTO_ORDER_USD = Number(process.env.US_MAX_ORDER_USD || 10000);
const STRONG_READY_BUDGET_SCALE = Math.max(
  0.1,
  Math.min(1, Number(process.env.US_STRONG_READY_BUDGET_SCALE || 0.50))
);

const BUY_MODIFY_AFTER_MS = Number(process.env.US_BUY_MODIFY_AFTER_MS || 45000);
const SELL_MODIFY_AFTER_MS = Number(process.env.US_SELL_MODIFY_AFTER_MS || 15000);
const MODIFY_COOLDOWN_MS = Number(process.env.US_MODIFY_COOLDOWN_MS || 20000);
const MAX_BUY_MODIFY_COUNT = Number(process.env.US_MAX_BUY_MODIFY_COUNT || 3);
const MAX_SELL_MODIFY_COUNT = Number(process.env.US_MAX_SELL_MODIFY_COUNT || 6);

// BUY 미체결 대응 v1.6.5
// 빠른 전략은 더 빨리 현재가로 정정하되,
// 최초 주문가 대비 과도한 추격매수는 제한한다.
const BUY_REPRICE_POLICY = {
  FAST:   { afterMs:  8000, maxChaseRate: 1.00 },
  VOLUME: { afterMs: 12000, maxChaseRate: 0.80 },
  WAVE:   { afterMs: 20000, maxChaseRate: 0.80 },
  CORE:   { afterMs: 25000, maxChaseRate: 0.60 }
};

function buyRepricePolicy(strategy) {
  return BUY_REPRICE_POLICY[String(strategy || '').toUpperCase()] || {
    afterMs: BUY_MODIFY_AFTER_MS,
    maxChaseRate: 0.80
  };
}

const STOP_LOSS_REENTRY_COOLDOWN_MS = Number(
  process.env.US_STOP_LOSS_REENTRY_COOLDOWN_MS || 60 * 60 * 1000
);

const STRATEGIES = new Set(['CORE', 'FAST', 'VOLUME', 'WAVE']);

const EXIT_RULES = Object.freeze({
  CORE: {
    // CORE 초기보호 v1
    // QQQ 양호 진입은 첫 30분 정상 흔들림을 허용한다.
    stopLossRate: -1.8,
    takeProfitRate: null,

    initialProtectMinutes: 30,
    initialProtectQqqMinRate: -0.5,
    initialEmergencyStopRate: -3.2,
    weakMarketStopRate: -1.5,

    protectTriggerRate: 2.5,
    protectFloorRate: 0.25,

    trailTriggerRate: 4.0,
    trailGapRate: 1.5,

    forceExitEt: '15:50',
    maxHoldMinutes: 0
  },
  FAST:   { stopLossRate: -1.0, takeProfitRate: 2.0, forceExitEt: '15:45', maxHoldMinutes: 90 },
  VOLUME: {
    stopLossRate: -1.3,
    takeProfitRate: null,
    protectTriggerRate: 2.0,
    protectFloorRate: 0.5,
    trailTriggerRate: 3.0,
    trailGapRate: 1.2,
    forceExitEt: '15:45',
    maxHoldMinutes: 0
  },
  WAVE: {
    stopLossRate: -2.5,
    takeProfitRate: null,
    protectTriggerRate: 3.0,
    protectFloorRate: 0.5,
    trailTriggerRate: 5.0,
    trailGapRate: 2.0,
    forceExitEt: null,
    maxHoldMinutes: 0
  }
});

let monitorTimer = null;
let pendingTimer = null;
let monitorRunning = false;
let stateWriteChain = Promise.resolve();
let engineChain = Promise.resolve();

function runExclusive(task) {
  const run = engineChain.then(task, task);
  engineChain = run.catch(() => {});
  return run;
}

function nowIso() { return new Date().toISOString(); }

function nyDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type)?.value || '00';
  return `${get('hour')}:${get('minute')}`;
}

function round(value, digits = 2) {
  const n = Number(value);
  const factor = 10 ** digits;
  return Number.isFinite(n) ? Math.round(n * factor) / factor : 0;
}

function currentPaperCapital() {
  const n = Number(accountSnapshot?.totalAsset || 0);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK_PAPER_CAPITAL;
}

async function refreshAccountSnapshot({ force = false } = {}) {
  try {
    const next = await kiwoom.getAccountSnapshot({ force });
    if (Number(next?.totalAsset || 0) > 0) accountSnapshot = next;
  } catch (error) {
    console.error('[US MASTER 계좌조회 실패]', error.message, '/ 기존 스냅샷 유지');
  }
  return accountSnapshot;
}

function defaultState() {
  return { version: 2, market: 'US', paperCapital: currentPaperCapital(), positions: [], orders: [], updatedAt: null };
}


function loadState() {
  if (!fs.existsSync(STATE_FILE)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      ...defaultState(),
      ...parsed,
      version: 2,
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : []
    };
  } catch (error) {
    console.error('[US AUTO STATE 읽기 실패]', error.message);
    return defaultState();
  }
}

function saveState(nextState) {
  const capital = currentPaperCapital();
  const startingCapital = Number(nextState.startingCapital || 0) > 0
    ? Number(nextState.startingCapital)
    : capital;
  const payload = {
    ...nextState,
    version: 2,
    market: 'US',
    startingCapital,
    paperCapital: capital,
    updatedAt: nowIso()
  };
  stateWriteChain = stateWriteChain.then(async () => {
    const tmp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  }).catch(error => console.error('[US AUTO STATE 저장 실패]', error.message));
  return stateWriteChain;
}

function normalizeStrategy(id) {
  const value = String(id || '').trim().toUpperCase();
  return STRATEGIES.has(value) ? value : '';
}

function activePosition(row) { return row && row.status === 'OPEN'; }
function activeOrder(row) {
  return row && ['SUBMITTED', 'PENDING_FILL', 'MODIFYING', 'STALE_PENDING'].includes(row.status);
}

function openOrPendingSymbols(state) {
  const set = new Set();
  for (const p of state.positions.filter(activePosition)) set.add(String(p.symbol || '').toUpperCase());
  for (const o of state.orders.filter(activeOrder)) set.add(String(o.symbol || '').toUpperCase());
  return set;
}

function recentStopLossSymbols(
  state,
  strategyId = '',
  cooldownMs = STOP_LOSS_REENTRY_COOLDOWN_MS
) {
  const set = new Set();
  const cutoff = Date.now() - Math.max(0, Number(cooldownMs || 0));

  const strategy = normalizeStrategy(strategyId);

  for (const position of state.positions || []) {
    if (!position || position.status !== 'CLOSED') continue;
    if (strategy && normalizeStrategy(position.strategy) !== strategy) continue;

    const reason = String(position.exitReason || '').toUpperCase();
    if (!reason.startsWith('STOP_LOSS')) continue;

    const closedAtMs = new Date(position.closedAt || 0).getTime();
    if (!Number.isFinite(closedAtMs) || closedAtMs < cutoff) continue;

    const symbol = String(position.symbol || '').toUpperCase().trim();
    if (symbol) set.add(symbol);
  }

  return set;
}

function strategyUsage(state, strategy) {
  const openPositions = state.positions.filter(p => activePosition(p) && p.strategy === strategy);
  const pendingBuys = state.orders.filter(o => activeOrder(o) && o.strategy === strategy && o.side === 'BUY');

  const invested = openPositions.reduce(
    (sum, p) => sum + Number(p.entryPrice || 0) * Number(p.quantity || 0), 0
  );
  const pending = pendingBuys.reduce(
    (sum, o) => sum + Number(o.limitPrice || 0) * Number(o.quantity || 0), 0
  );

  return {
    openPositions,
    pendingBuys,
    invested: round(invested, 2),
    pending: round(pending, 2),
    used: round(invested + pending, 2),
    slotCount: openPositions.length + pendingBuys.length
  };
}

function globalUsage(state) {
  const invested = state.positions.filter(activePosition).reduce(
    (sum, p) => sum + Number(p.entryPrice || 0) * Number(p.quantity || 0), 0
  );
  const pending = state.orders.filter(o => activeOrder(o) && o.side === 'BUY').reduce(
    (sum, o) => sum + Number(o.limitPrice || 0) * Number(o.quantity || 0), 0
  );
  return round(invested + pending, 2);
}

function strategyBudget(strategy, settings, paperCapital = currentPaperCapital()) {
  const strategySetting = settings?.strategies?.[strategy];
  const rate = Number(strategySetting?.strategyMaxInvestmentRate ?? strategySetting?.allocationRate ?? 0);
  return round(Number(paperCapital || 0) * Math.max(0, rate) / 100, 2);
}

function masterInvestmentLimit(settings, paperCapital = currentPaperCapital()) {
  const maxRate = Math.max(0, Math.min(100, Number(settings?.masterMaxInvestmentRate ?? 100)));
  const minCashRate = Math.max(0, Math.min(100, Number(settings?.minimumCashRate ?? 0)));
  const byMaxRate = paperCapital * maxRate / 100;
  const byMinCash = paperCapital * Math.max(0, 100 - minCashRate) / 100;
  return round(Math.min(byMaxRate, byMinCash), 2);
}

function todayBuyCount(state, strategy) {
  const today = nyDateKey();
  return state.orders.filter(o =>
    o.strategy === strategy &&
    o.side === 'BUY' &&
    o.tradingDate === today &&
    o.status !== 'REJECTED'
  ).length;
}

async function accountHolding(exchange, symbol) {
  const result = await kiwoom.getHoldings({ exchange, symbol });
  const row = (result.holdings || []).find(item =>
    item && String(item.stk_cd || '').toUpperCase() === String(symbol || '').toUpperCase()
  );
  return {
    quantity: Number(row?.poss_qty || 0),
    sellableQuantity: Number(row?.sell_alowq || row?.poss_qty || 0),
    averagePrice: typeof kiwoom.holdingAveragePrice === 'function' ? kiwoom.holdingAveragePrice(row) : Number(row?.frgn_stk_book_uv || 0),
    marketValue: typeof kiwoom.holdingMarketValue === 'function' ? kiwoom.holdingMarketValue(row) : Number(row?.evlt_amt || 0),
    row: row || null
  };
}

async function currentPrice(exchange, symbol) {
  const raw = await kiwoom.getQuote(exchange, symbol);
  const price = Number(raw.cur_prc || 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${symbol} 현재가 조회 실패`);
  return { price, raw };
}

function makeOrderId(side, strategy, symbol) {
  return `${Date.now()}-${side}-${strategy}-${symbol}-${Math.random().toString(36).slice(2, 8)}`;
}

function ageMs(iso) {
  const t = new Date(iso || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - t);
}

async function submitAutoBuy(strategy, candidate, budgetInfo) {
  const exchange = String(candidate.exchange || '').toUpperCase();
  const symbol = String(candidate.symbol || '').toUpperCase();
  const quote = await currentPrice(exchange, symbol);
  const limitPrice = round(quote.price, 2);

  const budgetScale = candidate.status === 'STRONG_READY'
    ? STRONG_READY_BUDGET_SCALE
    : 1.0;
  const effectiveBudget = Number(budgetInfo.perStockBudget || 0) * budgetScale;
  const quantity = Math.floor(effectiveBudget / limitPrice);
  if (quantity <= 0) return { ok: false, reason: 'BUDGET_TOO_SMALL', symbol, limitPrice };

  const holdingBefore = await accountHolding(exchange, symbol);
  if (holdingBefore.quantity > 0) {
    return { ok: false, reason: 'ACCOUNT_ALREADY_HOLDS_SYMBOL', symbol, quantity: holdingBefore.quantity };
  }

  // v1.6.8:
  // 종목가격이 낮다는 이유로 100주에 묶이지 않도록
  // 계산된 예산 범위의 전체 수량을 사용한다.
  // 실제 BUY 위험한도는 주문클라이언트의 $10,000 금액상한이 담당한다.
  const safeQty = quantity;

  const order = await orderClient.submitBuy({
    exchange, symbol, quantity: safeQty, price: limitPrice, orderType: '00'
  });

  const state = loadState();
  const row = {
    id: makeOrderId('BUY', strategy, symbol),
    side: 'BUY',
    strategy,
    exchange,
    symbol,
    name: candidate.name || symbol,
    quantity: safeQty,
    limitPrice,
    initialLimitPrice: limitPrice,
    estimatedNotional: round(limitPrice * safeQty, 2),
    beforeQuantity: holdingBefore.quantity,
    orderNo: order.orderNo || '',
    score: Number(candidate.score || 0),
    signalStatus: candidate.status || 'READY',
    budgetScale,

    // 진입 당시 시장/종목 상태를 포지션까지 보존한다.
    entryQqqChangeRate: Number(candidate.qqqChangeRate || 0),
    entryQqqVwapGapRate: Number(candidate.qqqVwapGapRate || 0),
    entryTrendPersistence: Number(candidate.trendPersistence || 0),
    entryVwapGapRate: Number(candidate.vwapGapRate || 0),

    candidateReason: candidate.reason || '',
    tradingDate: nyDateKey(),
    submittedAt: nowIso(),
    lastActionAt: nowIso(),
    modifyCount: 0,
    status: 'PENDING_FILL'
  };
  state.orders.push(row);
  await saveState(state);

  console.log(
    `[US-${strategy} AUTO BUY 제출]`,
    `${symbol} ${row.quantity}주 @ ${limitPrice}`,
    `예상 $${row.estimatedNotional}`,
    row.signalStatus === 'STRONG_READY' ? `STRONG_READY ${Math.round(budgetScale * 100)}%` : 'READY 100%',
    `orderNo=${row.orderNo || '-'}`
  );
  return { ok: true, order: row };
}

async function processReadyCandidatesUnlocked(strategyId, candidates = []) {
  const strategy = normalizeStrategy(strategyId);
  if (!strategy) return { ok: false, reason: 'UNKNOWN_STRATEGY' };

  const gate = strategySettings.isBuyAllowed(strategy);
  if (!gate.allowed) return { ok: true, skipped: true, reason: gate.reason };

  const settings = gate.settings;
  const strategySetting = gate.strategy || {};
  const account = await refreshAccountSnapshot({ force: true });

  // v1.6.5 안전장치:
  // 키움 PAPER 계좌의 실제 스냅샷을 확인하기 전에는
  // ENV fallback 자본으로 신규 BUY를 절대 실행하지 않는다.
  const accountReady =
    String(account?.source || '') === 'KIWOOM_PAPER_ACCOUNT' &&
    Number(account?.totalAsset || 0) > 0 &&
    Boolean(account?.fetchedAt);

  if (!accountReady) {
    console.warn(
      `[US-${strategy} AUTO BUY 차단]`,
      'KIWOOM_ACCOUNT_NOT_READY',
      `source=${account?.source || '-'}`,
      `totalAsset=${Number(account?.totalAsset || 0)}`,
      `fetchedAt=${account?.fetchedAt || '-'}`
    );

    return {
      ok: true,
      skipped: true,
      reason: 'KIWOOM_ACCOUNT_NOT_READY',
      accountSource: account?.source || null,
      accountFetchedAt: account?.fetchedAt || null
    };
  }

  const paperCapital = currentPaperCapital();
  const state = loadState();
  const usage = strategyUsage(state, strategy);
  const budget = strategyBudget(strategy, settings, paperCapital);

  const maxHoldings = Math.max(1, Number(strategySetting.maxHoldings || 1));
  const remainingSlots = Math.max(0, maxHoldings - usage.slotCount);
  const remainingStrategyCash = Math.max(0, budget - usage.used);
  const masterLimit = masterInvestmentLimit(settings, paperCapital);
  const syRemainingGlobalCash = Math.max(0, masterLimit - globalUsage(state));
  const kiwoomOrderAvailable = Math.max(0, Number(account?.orderAvailable || 0));
  const remainingGlobalCash = Math.min(syRemainingGlobalCash, kiwoomOrderAvailable);
  const baseDailyMax = Math.max(
    1,
    Number(strategySetting.dailyMaxNewBuys || maxHoldings)
  );

  // FAST PAPER 테스트:
  // 기본 일일 신규매수 한도는 설정값(현재 4회).
  // 당일 FAST STOP_LOSS 체결이 하나라도 있으면 추가 1회,
  // 단 절대 최대는 5회까지만 허용한다.
  const fastStopLossBonus =
    strategy === 'FAST' &&
    state.positions.some(position =>
      position &&
      position.status === 'CLOSED' &&
      position.strategy === 'FAST' &&
      position.tradingDate === nyDateKey() &&
      String(position.exitReason || '')
        .toUpperCase()
        .startsWith('STOP_LOSS')
    )
      ? 1
      : 0;

  const dailyMax =
    strategy === 'FAST'
      ? Math.min(5, baseDailyMax + fastStopLossBonus)
      : baseDailyMax;

  const buyCountToday = todayBuyCount(state, strategy);
  const remainingDailyBuys = Math.max(
    0,
    dailyMax - buyCountToday
  );

  if (
    strategy === 'FAST' &&
    fastStopLossBonus > 0 &&
    buyCountToday >= baseDailyMax &&
    remainingDailyBuys > 0
  ) {
    console.log(
      '[US-FAST AUTO 손절추가매수권]',
      `오늘매수 ${buyCountToday}회 / 기본 ${baseDailyMax}회`,
      `/ STOP_LOSS 확인 → 최대 ${dailyMax}회`
    );
  }

  if (remainingSlots <= 0) return { ok: true, skipped: true, reason: 'NO_REMAINING_SLOT' };
  if (remainingDailyBuys <= 0) return { ok: true, skipped: true, reason: 'DAILY_BUY_LIMIT' };
  if (remainingStrategyCash <= 0 || remainingGlobalCash <= 0) {
    return { ok: true, skipped: true, reason: 'NO_REMAINING_CASH' };
  }

  // v1.6.6 종목당 매수예산:
  // 기존 '남은 전략자금 ÷ 남은 슬롯' 방식 대신
  // 전략설정의 singleBuyRate를 실제 주문예산에 적용한다.
  const singleBuyRate = Math.max(
    0,
    Number(strategySetting.singleBuyRate || 0)
  );

  const configuredPerStockBudget =
    paperCapital * singleBuyRate / 100;

  // 미체결 가격정정 시 추격상한까지 올라가더라도
  // 키움 1회 주문 $10,000 제한을 넘지 않도록 여유를 둔다.
  const maxChaseRate = Number(
    buyRepricePolicy(strategy)?.maxChaseRate || 0
  );

  const maxOrderBudgetWithChaseHeadroom =
    MAX_AUTO_ORDER_USD / (1 + maxChaseRate / 100);

  const perStockBudget = Math.max(
    0,
    Math.min(
      configuredPerStockBudget,
      remainingStrategyCash,
      remainingGlobalCash,
      Number(account?.orderAvailable || 0),
      maxOrderBudgetWithChaseHeadroom
    )
  );

  const ready = (Array.isArray(candidates) ? candidates : [])
    .filter(row => row && ['READY', 'STRONG_READY'].includes(row.status))
    .sort((a, b) => {
      const priority = status => status === 'READY' ? 2 : status === 'STRONG_READY' ? 1 : 0;
      return priority(b.status) - priority(a.status) || Number(b.score || 0) - Number(a.score || 0);
    });

  if (!ready.length) return { ok: true, skipped: true, reason: 'NO_READY' };

  const blockedSymbols = openOrPendingSymbols(state);
  const stopLossCooldownSymbols = recentStopLossSymbols(state, strategy);
  const results = [];
  const maxOrders = Math.max(1, Math.min(MAX_AUTO_BUYS_PER_SCAN, remainingSlots, remainingDailyBuys));
  let submittedCount = 0;

  for (const candidate of ready) {
    if (submittedCount >= maxOrders) break;
    const symbol = String(candidate.symbol || '').toUpperCase();
    if (!symbol || blockedSymbols.has(symbol)) continue;

    if (stopLossCooldownSymbols.has(symbol)) {
      console.log(
        `[US-${strategy} AUTO BUY 차단]`,
        `${symbol} 최근 STOP_LOSS 후 ${Math.round(STOP_LOSS_REENTRY_COOLDOWN_MS / 60000)}분 재진입 금지`
      );
      results.push({
        ok: false,
        skipped: true,
        symbol,
        reason: 'STOP_LOSS_REENTRY_COOLDOWN'
      });
      continue;
    }

    try {
      const result = await submitAutoBuy(strategy, candidate, {
        budget, remainingStrategyCash, remainingSlots, perStockBudget
      });
      results.push(result);
      if (result.ok) {
        blockedSymbols.add(symbol);
        submittedCount += 1;
      }
    } catch (error) {
      console.error(`[US-${strategy} AUTO BUY 오류]`, symbol, error.message);
      results.push({ ok: false, symbol, error: error.message });
    }
  }

  return {
    ok: true,
    strategy,
    paperCapital,
    strategyBudget: budget,
    used: usage.used,
    remainingStrategyCash,
    remainingSlots,
    singleBuyRate,
    configuredPerStockBudget: round(configuredPerStockBudget, 2),
    maxAutoOrderUsd: MAX_AUTO_ORDER_USD,
    maxOrderBudgetWithChaseHeadroom: round(maxOrderBudgetWithChaseHeadroom, 2),
    perStockBudget: round(perStockBudget, 2),
    results
  };
}

function processReadyCandidates(strategyId, candidates = []) {
  return runExclusive(() => processReadyCandidatesUnlocked(strategyId, candidates));
}

async function reconcilePendingOrders() {
  const state = loadState();
  let changed = false;

  for (const order of state.orders.filter(activeOrder)) {
    try {
      const holding = await accountHolding(order.exchange, order.symbol);

      if (order.side === 'BUY') {
        const target = Number(order.beforeQuantity || 0) + Number(order.quantity || 0);
        if (holding.quantity >= target) {
          order.status = 'FILLED';
          order.filledAt = nowIso();

          const exists = state.positions.some(p =>
            activePosition(p) && p.strategy === order.strategy && p.symbol === order.symbol
          );

          if (!exists) {
            const actualEntryPrice = Number(holding.averagePrice || order.limitPrice || 0);
            state.positions.push({
              id: `${order.id}-POSITION`,
              strategy: order.strategy,
              exchange: order.exchange,
              symbol: order.symbol,
              name: order.name || order.symbol,
              quantity: Number(order.quantity || 0),
              entryPrice: actualEntryPrice,
              entryPriceSource: Number(holding.averagePrice || 0) > 0 ? 'KIWOOM_BOOK_AVG' : 'ORDER_LIMIT_FALLBACK',
              entryNotional: round(actualEntryPrice * Number(order.quantity || 0), 2),
              openedAt: order.filledAt,
              tradingDate: order.tradingDate,
              status: 'OPEN',
              highestPrice: Math.max(actualEntryPrice, Number(order.limitPrice || 0)),

              // CORE 초기보호 판단용 진입시점 정보
              entryQqqChangeRate: Number(order.entryQqqChangeRate || 0),
              entryQqqVwapGapRate: Number(order.entryQqqVwapGapRate || 0),
              entryTrendPersistence: Number(order.entryTrendPersistence || 0),
              entryVwapGapRate: Number(order.entryVwapGapRate || 0),

              buyOrderNo: order.orderNo || ''
            });
          }
          changed = true;
          console.log(`[US-${order.strategy} AUTO BUY 체결확인]`, `${order.symbol} ${order.quantity}주`);
        }
      } else if (order.side === 'SELL') {
        const expectedMax = Math.max(0, Number(order.beforeQuantity || 0) - Number(order.quantity || 0));
        if (holding.quantity <= expectedMax) {
          order.status = 'FILLED';
          order.filledAt = nowIso();

          const position = state.positions.find(p =>
            activePosition(p) && p.strategy === order.strategy && p.symbol === order.symbol
          );

          if (position) {
            position.status = 'CLOSED';
            position.closedAt = order.filledAt;
            position.exitPrice = Number(order.limitPrice || 0);
            position.exitPriceSource = 'ORDER_LIMIT_FALLBACK';
            position.exitReason = order.exitReason || 'AUTO_EXIT';
            position.realizedProfit = round(
              (position.exitPrice - Number(position.entryPrice || 0)) * Number(position.quantity || 0),
              2
            );
            position.realizedProfitRate = Number(position.entryPrice || 0) > 0
              ? round((position.exitPrice - position.entryPrice) / position.entryPrice * 100, 2)
              : 0;
            position.sellOrderNo = order.orderNo || '';

            try {
              const dashboard = activityStore.getDashboardActivity();
              const alreadyRecorded = (dashboard.sellHistory || []).some(item =>
                String(item.strategy || '').toUpperCase() === String(position.strategy || '').toUpperCase() &&
                String(item.symbol || '').toUpperCase() === String(position.symbol || '').toUpperCase() &&
                String(item.soldAt || '') === String(position.closedAt || '')
              );

              if (!alreadyRecorded) {
                activityStore.recordSell({
                  strategy: position.strategy,
                  symbol: position.symbol,
                  name: position.name || position.symbol,
                  quantity: Number(position.quantity || 0),
                  buyPrice: Number(position.entryPrice || 0),
                  sellPrice: Number(position.exitPrice || 0),
                  realizedProfit: Number(position.realizedProfit || 0),
                  profitRate: Number(position.realizedProfitRate || 0),
                  reason: position.exitReason || 'AUTO_EXIT',
                  soldAt: position.closedAt
                });

                console.log(
                  `[US-${order.strategy} AUTO 매도내역 기록]`,
                  `${order.symbol} ${order.quantity}주`,
                  `${position.realizedProfitRate}%`
                );
              }
            } catch (dashboardError) {
              console.error(
                `[US-${order.strategy} AUTO 매도내역 기록 오류]`,
                order.symbol,
                dashboardError.message
              );
            }
          }

          changed = true;
          console.log(`[US-${order.strategy} AUTO SELL 체결확인]`, `${order.symbol} ${order.quantity}주`, order.exitReason || '');
        }
      }
    } catch (error) {
      console.error('[US AUTO 주문체결 확인 오류]', `${order.strategy}:${order.symbol}`, error.message);
    }
  }

  if (changed) await saveState(state);
  return state;
}

async function modifyPendingOrder(order, nextPrice) {
  const result = await orderClient.modifyOrder({
    origOrderNo: order.orderNo,
    exchange: order.exchange,
    symbol: order.symbol,
    price: round(nextPrice, 2),
    stopPrice: ''
  });

  order.orderNo = result.orderNo || order.orderNo;
  order.limitPrice = round(nextPrice, 2);
  order.estimatedNotional = round(Number(order.quantity || 0) * Number(order.limitPrice || 0), 2);
  order.modifyCount = Number(order.modifyCount || 0) + 1;
  order.lastModifyAt = nowIso();
  order.lastActionAt = order.lastModifyAt;
  order.status = 'PENDING_FILL';

  console.log(`[US-${order.strategy} AUTO ${order.side} 정정]`, `${order.symbol} @ ${order.limitPrice}`, `회수=${order.modifyCount}`, `orderNo=${order.orderNo || '-'}`);
}

async function managePendingOrders() {
  const state = loadState();
  let changed = false;

  for (const order of state.orders.filter(activeOrder)) {
    if (!order.orderNo) continue;

    const buyPolicy = order.side === 'BUY'
      ? buyRepricePolicy(order.strategy)
      : null;

    const threshold = order.side === 'SELL'
      ? SELL_MODIFY_AFTER_MS
      : buyPolicy.afterMs;

    const modifyCooldown = order.side === 'SELL'
      ? MODIFY_COOLDOWN_MS
      : Math.min(MODIFY_COOLDOWN_MS, buyPolicy.afterMs);

    const count = Number(order.modifyCount || 0);
    const maxCount = order.side === 'SELL' ? MAX_SELL_MODIFY_COUNT : MAX_BUY_MODIFY_COUNT;
    const sinceAction = ageMs(order.lastActionAt || order.submittedAt);

    if (count >= maxCount) {
      if (order.status !== 'STALE_PENDING') {
        order.status = 'STALE_PENDING';
        order.staleAt = nowIso();
        changed = true;
        console.warn(
          `[US-${order.strategy} AUTO ${order.side} 미체결 주의]`,
          order.symbol,
          `정정 ${count}/${maxCount}회`,
          '자동 취소+신규주문은 중복체결 위험 때문에 실행하지 않음'
        );
      }
      continue;
    }

    if (sinceAction < threshold) continue;
    if (ageMs(order.lastModifyAt || order.submittedAt) < modifyCooldown) continue;

    try {
      const holding = await accountHolding(order.exchange, order.symbol);

      if (order.side === 'BUY') {
        const target = Number(order.beforeQuantity || 0) + Number(order.quantity || 0);
        if (holding.quantity >= target) continue;
      } else {
        const expectedMax = Math.max(0, Number(order.beforeQuantity || 0) - Number(order.quantity || 0));
        if (holding.quantity <= expectedMax) continue;
      }

      const q = await currentPrice(order.exchange, order.symbol);
      const nextPrice = Number(q.price || 0);

      if (!(nextPrice > 0)) {
        order.lastActionAt = nowIso();
        changed = true;
        continue;
      }

      if (order.side === 'BUY') {
        const initialPrice = Number(
          order.initialLimitPrice ||
          order.limitPrice ||
          0
        );

        const maxChaseRate = Number(buyPolicy?.maxChaseRate || 0);
        const maxChasePrice = initialPrice > 0
          ? initialPrice * (1 + maxChaseRate / 100)
          : 0;

        if (
          initialPrice > 0 &&
          maxChasePrice > 0 &&
          nextPrice > maxChasePrice
        ) {
          order.lastActionAt = nowIso();
          order.lastChaseBlockedAt = order.lastActionAt;
          order.lastChaseBlockedPrice = round(nextPrice, 2);
          order.maxChasePrice = round(maxChasePrice, 2);
          changed = true;

          console.log(
            `[US-${order.strategy} AUTO BUY 추격보류]`,
            order.symbol,
            `최초 ${round(initialPrice, 2)}`,
            `현재 ${round(nextPrice, 2)}`,
            `상한 ${round(maxChasePrice, 2)}`,
            `(+${maxChaseRate}%)`,
            '기존 지정가 유지'
          );

          continue;
        }
      }

      if (round(nextPrice, 2) === round(order.limitPrice, 2)) {
        order.lastActionAt = nowIso();
        changed = true;
        continue;
      }

      await modifyPendingOrder(order, nextPrice);
      changed = true;
    } catch (error) {
      order.lastModifyError = error.message;
      order.lastModifyErrorAt = nowIso();
      changed = true;
      console.error(`[US-${order.strategy} AUTO ${order.side} 정정 오류]`, order.symbol, error.message);
    }
  }

  if (changed) await saveState(state);
  return state;
}

function holdMinutes(position) {
  const start = new Date(position.openedAt || 0).getTime();
  if (!Number.isFinite(start) || start <= 0) return 0;
  return Math.max(0, (Date.now() - start) / 60000);
}

async function submitAutoSell(position, reason, quotePrice) {
  const state = loadState();

  const alreadyPending = state.orders.some(o =>
    activeOrder(o) && o.side === 'SELL' && o.strategy === position.strategy && o.symbol === position.symbol
  );
  if (alreadyPending) return { ok: false, reason: 'SELL_ALREADY_PENDING' };

  const holding = await accountHolding(position.exchange, position.symbol);
  const quantity = Math.min(Number(position.quantity || 0), Number(holding.sellableQuantity || 0));
  if (quantity <= 0) return { ok: false, reason: 'NO_SELLABLE_QUANTITY' };

  const limitPrice = round(quotePrice, 2);
  const result = await orderClient.submitSell({
    exchange: position.exchange,
    symbol: position.symbol,
    quantity,
    price: limitPrice,
    orderType: '00'
  });

  const row = {
    id: makeOrderId('SELL', position.strategy, position.symbol),
    side: 'SELL',
    strategy: position.strategy,
    exchange: position.exchange,
    symbol: position.symbol,
    name: position.name || position.symbol,
    quantity,
    limitPrice,
    beforeQuantity: holding.quantity,
    orderNo: result.orderNo || '',
    exitReason: reason,
    tradingDate: nyDateKey(),
    submittedAt: nowIso(),
    lastActionAt: nowIso(),
    modifyCount: 0,
    status: 'PENDING_FILL'
  };
  state.orders.push(row);
  await saveState(state);

  console.log(`[US-${position.strategy} AUTO SELL 제출]`, `${position.symbol} ${quantity}주 @ ${limitPrice}`, reason, `orderNo=${row.orderNo || '-'}`);
  return { ok: true, order: row };
}

async function monitorOpenPositions() {
  const snapshot = loadState();
  const highestById = new Map();

  for (const position of snapshot.positions.filter(activePosition)) {
    try {
      const q = await currentPrice(position.exchange, position.symbol);
      const price = q.price;
      const highest = Math.max(Number(position.highestPrice || 0), price);
      highestById.set(position.id, {
        highestPrice: highest,
        currentPrice: price,
        lastPriceAt: nowIso()
      });

      const entry = Number(position.entryPrice || 0);
      if (entry <= 0) continue;

      const profitRate = (price - entry) / entry * 100;
      const rules = EXIT_RULES[position.strategy] || EXIT_RULES.CORE;

      const peakProfitRate = (highest - entry) / entry * 100;

      let exitReason = null;

      // ======================================================
      // CORE 초기보호 v1
      // ======================================================
      if (position.strategy === 'CORE') {
        const heldMinutes = holdMinutes(position);
        const entryQqqChangeRate =
          Number(position.entryQqqChangeRate || 0);

        const initialProtectEnabled =
          entryQqqChangeRate >
          Number(rules.initialProtectQqqMinRate ?? -0.5);

        const inInitialProtectWindow =
          initialProtectEnabled &&
          heldMinutes <
          Number(rules.initialProtectMinutes || 30);

        let activeStopLossRate =
          Number(rules.stopLossRate || -1.8);

        if (inInitialProtectWindow) {
          activeStopLossRate =
            Number(rules.initialEmergencyStopRate || -3.2);
        } else if (
          heldMinutes <
            Number(rules.initialProtectMinutes || 30) &&
          !initialProtectEnabled
        ) {
          // 약한 시장에서 진입한 CORE는 보호모드를 적용하지 않는다.
          activeStopLossRate =
            Number(rules.weakMarketStopRate || -1.5);
        }

        if (profitRate <= activeStopLossRate) {
          const mode = inInitialProtectWindow
            ? 'CORE_INITIAL_EMERGENCY'
            : (
                heldMinutes < Number(rules.initialProtectMinutes || 30)
                  ? 'CORE_WEAK_MARKET'
                  : 'CORE_NORMAL'
              );

          exitReason =
            `STOP_LOSS ${round(profitRate, 2)}%` +
            ` / ${mode}` +
            ` / QQQ_ENTRY ${round(entryQqqChangeRate, 2)}%` +
            ` / HOLD ${Math.floor(heldMinutes)}m`;
        }
      } else if (profitRate <= rules.stopLossRate) {
        exitReason = `STOP_LOSS ${round(profitRate, 2)}%`;
      }

      if (!exitReason && (
        Number(rules.trailTriggerRate || 0) > 0 &&
        peakProfitRate >= Number(rules.trailTriggerRate || 0) &&
        profitRate <= peakProfitRate - Number(rules.trailGapRate || 0)
      )) {
        exitReason = `TRAILING_STOP ${round(profitRate, 2)}% / PEAK ${round(peakProfitRate, 2)}%`;
      } else if (!exitReason && (
        Number(rules.protectTriggerRate || 0) > 0 &&
        peakProfitRate >= Number(rules.protectTriggerRate || 0) &&
        profitRate <= Number(rules.protectFloorRate || 0)
      )) {
        exitReason = `PROFIT_PROTECT ${round(profitRate, 2)}% / PEAK ${round(peakProfitRate, 2)}%`;
      } else if (!exitReason && (
        Number.isFinite(Number(rules.takeProfitRate)) &&
        Number(rules.takeProfitRate) > 0 &&
        profitRate >= Number(rules.takeProfitRate)
      )) {
        exitReason = `TAKE_PROFIT ${round(profitRate, 2)}%`;
      } else if (!exitReason && rules.maxHoldMinutes > 0 && holdMinutes(position) >= rules.maxHoldMinutes) {
        exitReason = `MAX_HOLD ${Math.floor(holdMinutes(position))}m`;
      } else if (!exitReason && rules.forceExitEt && position.tradingDate === nyDateKey() && nyClock() >= rules.forceExitEt) {
        exitReason = `TIME_EXIT ${rules.forceExitEt} ET`;
      }

      if (exitReason) await submitAutoSell(position, exitReason, price);
    } catch (error) {
      console.error(`[US-${position.strategy} AUTO SELL 감시 오류]`, position.symbol, error.message);
    }
  }

  if (highestById.size > 0) {
    const latest = loadState();
    let changed = false;

    for (const position of latest.positions.filter(activePosition)) {
      if (!highestById.has(position.id)) continue;

      const market = highestById.get(position.id) || {};
      const nextHighest = Number(market.highestPrice || 0);
      const nextPrice = Number(market.currentPrice || 0);
      const entryPrice = Number(position.entryPrice || 0);
      const quantity = Number(position.quantity || 0);

      if (nextHighest > Number(position.highestPrice || 0)) {
        position.highestPrice = nextHighest;
        changed = true;
      }

      if (nextPrice > 0) {
        position.currentPrice = nextPrice;
        position.currentValue = round(nextPrice * quantity, 2);
        position.unrealizedProfit = round(
          (nextPrice - entryPrice) * quantity,
          2
        );
        position.unrealizedProfitRate = entryPrice > 0
          ? round((nextPrice - entryPrice) / entryPrice * 100, 2)
          : 0;
        position.lastPriceAt = market.lastPriceAt || nowIso();
        changed = true;
      }
    }

    if (changed) await saveState(latest);
  }
}

async function cancelPendingOrderById(id) {
  const state = loadState();
  const order = state.orders.find(o => o.id === id && activeOrder(o));
  if (!order) throw new Error('active pending order not found');
  if (!order.orderNo) throw new Error('orderNo not found');

  const result = await orderClient.cancelOrder({
    origOrderNo: order.orderNo,
    exchange: order.exchange,
    symbol: order.symbol
  });

  order.status = 'CANCEL_REQUESTED';
  order.cancelRequestedAt = nowIso();
  order.cancelResultOrderNo = result.orderNo || '';
  order.lastActionAt = order.cancelRequestedAt;
  await saveState(state);

  console.log(`[US-${order.strategy} AUTO ${order.side} 취소요청]`, order.symbol, `orderNo=${order.orderNo}`);
  return { ok: true, order };
}

async function monitorOnceUnlocked() {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    await refreshAccountSnapshot({ force: true });
    await reconcilePendingOrders();
    await managePendingOrders();
    await reconcilePendingOrders();
    await monitorOpenPositions();
    await reconcilePendingOrders();
  } finally {
    monitorRunning = false;
  }
}

function monitorOnce() {
  return runExclusive(() => monitorOnceUnlocked());
}

// v1.6.7 미체결 전용 빠른 감시
// 활성 미체결 주문이 있을 때만 계좌보유/현재가 API를 조회한다.
function pendingMonitorOnce() {
  return runExclusive(async () => {
    const state = loadState();
    const hasPending = state.orders.some(activeOrder);

    if (!hasPending) return;

    await reconcilePendingOrders();
    await managePendingOrders();
    await reconcilePendingOrders();
  });
}

function startAutoTrader() {
  if (monitorTimer) return monitorTimer;

  monitorTimer = setInterval(() => {
    monitorOnce().catch(error => console.error('[US AUTO TRADER 감시 오류]', error.message));
  }, MONITOR_INTERVAL_MS);

  if (typeof monitorTimer.unref === 'function') monitorTimer.unref();

  pendingTimer = setInterval(() => {
    pendingMonitorOnce().catch(error =>
      console.error('[US AUTO TRADER 미체결감시 오류]', error.message)
    );
  }, PENDING_MONITOR_INTERVAL_MS);

  if (typeof pendingTimer.unref === 'function') pendingTimer.unref();

  const initial = setTimeout(() => {
    monitorOnce().catch(error => console.error('[US AUTO TRADER 초기감시 오류]', error.message));
  }, 10000);
  if (typeof initial.unref === 'function') initial.unref();

  console.log(
    '[US AUTO TRADER v1.6.8]',
    `PAPER 계좌연동 / fallback $${FALLBACK_PAPER_CAPITAL.toLocaleString('en-US')}`,
    '/ MASTER=키움 USD예수금+보유평가액',
    '/ READY 100% + STRONG_READY 50% BUY',
    '/ 손절·익절 SELL',
    '/ BUY 미체결 재정정 FAST 8s / VOLUME 12s / WAVE 20s / CORE 25s',
    `/ 미체결 감시주기 ${PENDING_MONITOR_INTERVAL_MS / 1000}s`,
    `/ SELL 미체결 ${SELL_MODIFY_AFTER_MS / 1000}s 후 가격정정`
  );

  return monitorTimer;
}

function getStatus() {
  const settings = strategySettings.getSettings();
  const state = loadState();
  const strategyBudgets = {};
  const paperCapital = currentPaperCapital();

  const closedPositions = state.positions.filter(p => p && p.status === 'CLOSED');
  const openPositions = state.positions.filter(activePosition);

  const realizedProfit = round(
    closedPositions.reduce(
      (sum, p) => sum + Number(p.realizedProfit || 0),
      0
    ),
    2
  );

  const unrealizedProfit = round(
    openPositions.reduce(
      (sum, p) => sum + Number(p.unrealizedProfit || 0),
      0
    ),
    2
  );

  const netProfit = round(realizedProfit + unrealizedProfit, 2);
  const totalAsset = paperCapital;
  const baseline = Number(state.startingCapital || state.paperCapital || paperCapital);
  const profitRate = baseline > 0
    ? round(netProfit / baseline * 100, 4)
    : 0;

  for (const id of STRATEGIES) {
    const usage = strategyUsage(state, id);
    const budget = strategyBudget(id, settings, paperCapital);
    const maxHoldings = Number(settings?.strategies?.[id]?.maxHoldings || 0);
    strategyBudgets[id] = {
      allocationRate: Number(settings?.strategies?.[id]?.strategyMaxInvestmentRate || 0),
      budget,
      used: usage.used,
      remaining: round(Math.max(0, budget - usage.used), 2),
      maxHoldings,
      usedSlots: usage.slotCount,
      remainingSlots: Math.max(0, maxHoldings - usage.slotCount)
    };
  }

  return {
    ok: true,
    version: '1.6.8',
    mode: 'PAPER',
    paperCapital,
    startingCapital: baseline,
    realizedProfit,
    unrealizedProfit,
    netProfit,
    totalAsset,
    profitRate,
    globalUsed: globalUsage(state),
    masterInvestmentLimit: masterInvestmentLimit(settings, paperCapital),
    kiwoomAccount: accountSnapshot,
    kiwoomAccountReady:
      String(accountSnapshot?.source || '') === 'KIWOOM_PAPER_ACCOUNT' &&
      Number(accountSnapshot?.totalAsset || 0) > 0 &&
      Boolean(accountSnapshot?.fetchedAt),
    globalRemaining: round(Math.max(0, Math.min(
      masterInvestmentLimit(settings, paperCapital) - globalUsage(state),
      Number(accountSnapshot?.orderAvailable || 0)
    )), 2),
    monitorRunning,
    monitorIntervalMs: MONITOR_INTERVAL_MS,
    pendingMonitorIntervalMs: PENDING_MONITOR_INTERVAL_MS,
    maxAutoBuysPerScan: MAX_AUTO_BUYS_PER_SCAN,
    strongReadyBudgetScale: STRONG_READY_BUDGET_SCALE,
    engineSerialization: true,
    stateOverwriteProtection: true,
    stopLossReentryCooldownMs: STOP_LOSS_REENTRY_COOLDOWN_MS,
    stopLossReentryCooldownMinutes: round(STOP_LOSS_REENTRY_COOLDOWN_MS / 60000, 0),
    stopLossReentryScope: 'SAME_STRATEGY_ONLY',
    pendingManagement: {
      buyModifyAfterMs: BUY_MODIFY_AFTER_MS,
      sellModifyAfterMs: SELL_MODIFY_AFTER_MS,
      modifyCooldownMs: MODIFY_COOLDOWN_MS,
      maxBuyModifyCount: MAX_BUY_MODIFY_COUNT,
      maxSellModifyCount: MAX_SELL_MODIFY_COUNT,
      autoCancelAfterMaxModify: false,
      note: '최대 정정횟수 후 STALE_PENDING 유지. 자동 취소+신규주문은 중복체결 위험 때문에 하지 않음.'
    },
    exitRules: EXIT_RULES,
    strategies: strategyBudgets,
    openPositions,
    closedPositions,
    pendingOrders: state.orders.filter(activeOrder),
    cancelRequestedOrders: state.orders.filter(o => o.status === 'CANCEL_REQUESTED'),
    updatedAt: state.updatedAt
  };
}

module.exports = {
  FALLBACK_PAPER_CAPITAL,
  currentPaperCapital,
  refreshAccountSnapshot,
  EXIT_RULES,
  processReadyCandidates,
  reconcilePendingOrders,
  managePendingOrders,
  monitorOnce,
  startAutoTrader,
  cancelPendingOrderById,
  getStatus,
  recentStopLossSymbols
};
