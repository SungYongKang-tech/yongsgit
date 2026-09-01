'use strict';

const fs = require('fs');
const path = require('path');

const kiwoom = require('./kiwoom-us-client');
const orderClient = require('./kiwoom-us-order-client');
const strategySettings = require('./strategy-settings-store');
const activityStore = require('./us-dashboard-activity-store');

const STATE_FILE = path.join(__dirname, 'us-paper-auto-state.json');

const PAPER_CAPITAL = Number(process.env.US_PAPER_CAPITAL || 40000);
const MONITOR_INTERVAL_MS = Number(process.env.US_AUTO_MONITOR_INTERVAL_MS || 60000);
const MAX_AUTO_BUYS_PER_SCAN = Number(process.env.US_MAX_AUTO_BUYS_PER_SCAN || 1);

const BUY_MODIFY_AFTER_MS = Number(process.env.US_BUY_MODIFY_AFTER_MS || 45000);
const SELL_MODIFY_AFTER_MS = Number(process.env.US_SELL_MODIFY_AFTER_MS || 15000);
const MODIFY_COOLDOWN_MS = Number(process.env.US_MODIFY_COOLDOWN_MS || 20000);
const MAX_BUY_MODIFY_COUNT = Number(process.env.US_MAX_BUY_MODIFY_COUNT || 3);
const MAX_SELL_MODIFY_COUNT = Number(process.env.US_MAX_SELL_MODIFY_COUNT || 6);

const STRATEGIES = new Set(['CORE', 'FAST', 'VOLUME', 'WAVE']);

const EXIT_RULES = Object.freeze({
  CORE:   { stopLossRate: -1.5, takeProfitRate: 3.0, forceExitEt: '15:50', maxHoldMinutes: 0 },
  FAST:   { stopLossRate: -1.0, takeProfitRate: 2.0, forceExitEt: '15:45', maxHoldMinutes: 90 },
  VOLUME: { stopLossRate: -1.3, takeProfitRate: 2.5, forceExitEt: '15:45', maxHoldMinutes: 0 },
  WAVE:   { stopLossRate: -2.5, takeProfitRate: 5.0, forceExitEt: null, maxHoldMinutes: 0 }
});

let monitorTimer = null;
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

function defaultState() {
  return { version: 2, market: 'US', paperCapital: PAPER_CAPITAL, positions: [], orders: [], updatedAt: null };
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
  const payload = { ...nextState, version: 2, market: 'US', paperCapital: PAPER_CAPITAL, updatedAt: nowIso() };
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

function strategyBudget(strategy, settings) {
  const strategySetting = settings?.strategies?.[strategy];
  const rate = Number(strategySetting?.strategyMaxInvestmentRate ?? strategySetting?.allocationRate ?? 0);
  return round(PAPER_CAPITAL * Math.max(0, rate) / 100, 2);
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

  const quantity = Math.floor(Number(budgetInfo.perStockBudget || 0) / limitPrice);
  if (quantity <= 0) return { ok: false, reason: 'BUDGET_TOO_SMALL', symbol, limitPrice };

  const holdingBefore = await accountHolding(exchange, symbol);
  if (holdingBefore.quantity > 0) {
    return { ok: false, reason: 'ACCOUNT_ALREADY_HOLDS_SYMBOL', symbol, quantity: holdingBefore.quantity };
  }

  const safeQty = Math.min(quantity, 100);
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
    estimatedNotional: round(limitPrice * safeQty, 2),
    beforeQuantity: holdingBefore.quantity,
    orderNo: order.orderNo || '',
    score: Number(candidate.score || 0),
    candidateReason: candidate.reason || '',
    tradingDate: nyDateKey(),
    submittedAt: nowIso(),
    lastActionAt: nowIso(),
    modifyCount: 0,
    status: 'PENDING_FILL'
  };
  state.orders.push(row);
  await saveState(state);

  console.log(`[US-${strategy} AUTO BUY 제출]`, `${symbol} ${row.quantity}주 @ ${limitPrice}`, `예상 $${row.estimatedNotional}`, `orderNo=${row.orderNo || '-'}`);
  return { ok: true, order: row };
}

async function processReadyCandidatesUnlocked(strategyId, candidates = []) {
  const strategy = normalizeStrategy(strategyId);
  if (!strategy) return { ok: false, reason: 'UNKNOWN_STRATEGY' };

  const gate = strategySettings.isBuyAllowed(strategy);
  if (!gate.allowed) return { ok: true, skipped: true, reason: gate.reason };

  const settings = gate.settings;
  const strategySetting = gate.strategy || {};
  const state = loadState();
  const usage = strategyUsage(state, strategy);
  const budget = strategyBudget(strategy, settings);

  const maxHoldings = Math.max(1, Number(strategySetting.maxHoldings || 1));
  const remainingSlots = Math.max(0, maxHoldings - usage.slotCount);
  const remainingStrategyCash = Math.max(0, budget - usage.used);
  const remainingGlobalCash = Math.max(0, PAPER_CAPITAL - globalUsage(state));
  const dailyMax = Math.max(1, Number(strategySetting.dailyMaxNewBuys || maxHoldings));
  const remainingDailyBuys = Math.max(0, dailyMax - todayBuyCount(state, strategy));

  if (remainingSlots <= 0) return { ok: true, skipped: true, reason: 'NO_REMAINING_SLOT' };
  if (remainingDailyBuys <= 0) return { ok: true, skipped: true, reason: 'DAILY_BUY_LIMIT' };
  if (remainingStrategyCash <= 0 || remainingGlobalCash <= 0) {
    return { ok: true, skipped: true, reason: 'NO_REMAINING_CASH' };
  }

  const perStockBudget = Math.min(remainingStrategyCash / remainingSlots, remainingGlobalCash);

  const ready = (Array.isArray(candidates) ? candidates : [])
    .filter(row => row && row.status === 'READY')
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  if (!ready.length) return { ok: true, skipped: true, reason: 'NO_READY' };

  const blockedSymbols = openOrPendingSymbols(state);
  const results = [];
  const maxOrders = Math.max(1, Math.min(MAX_AUTO_BUYS_PER_SCAN, remainingSlots, remainingDailyBuys));

  for (const candidate of ready) {
    if (results.length >= maxOrders) break;
    const symbol = String(candidate.symbol || '').toUpperCase();
    if (!symbol || blockedSymbols.has(symbol)) continue;

    try {
      const result = await submitAutoBuy(strategy, candidate, {
        budget, remainingStrategyCash, remainingSlots, perStockBudget
      });
      results.push(result);
      if (result.ok) blockedSymbols.add(symbol);
    } catch (error) {
      console.error(`[US-${strategy} AUTO BUY 오류]`, symbol, error.message);
      results.push({ ok: false, symbol, error: error.message });
    }
  }

  return {
    ok: true,
    strategy,
    paperCapital: PAPER_CAPITAL,
    strategyBudget: budget,
    used: usage.used,
    remainingStrategyCash,
    remainingSlots,
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
            state.positions.push({
              id: `${order.id}-POSITION`,
              strategy: order.strategy,
              exchange: order.exchange,
              symbol: order.symbol,
              name: order.name || order.symbol,
              quantity: Number(order.quantity || 0),
              entryPrice: Number(order.limitPrice || 0),
              entryNotional: round(Number(order.limitPrice || 0) * Number(order.quantity || 0), 2),
              openedAt: order.filledAt,
              tradingDate: order.tradingDate,
              status: 'OPEN',
              highestPrice: Number(order.limitPrice || 0),
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
            position.exitReason = order.exitReason || 'AUTO_EXIT';
            position.realizedProfit = round(
              (position.exitPrice - Number(position.entryPrice || 0)) * Number(position.quantity || 0),
              2
            );
            position.realizedProfitRate = Number(position.entryPrice || 0) > 0
              ? round((position.exitPrice - position.entryPrice) / position.entryPrice * 100, 2)
              : 0;
            position.sellOrderNo = order.orderNo || '';

            // AUTO 실제 매도 체결을 대시보드 매도내역에도 기록한다.
            // soldAt까지 비교해 재처리 시 중복 기록을 방지한다.
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

    const threshold = order.side === 'SELL' ? SELL_MODIFY_AFTER_MS : BUY_MODIFY_AFTER_MS;
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
    if (ageMs(order.lastModifyAt || order.submittedAt) < MODIFY_COOLDOWN_MS) continue;

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
      const nextPrice = q.price;

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
  // 중요한 원칙:
  // submitAutoSell()은 최신 state를 다시 읽고 SELL 주문을 저장한다.
  // 따라서 여기서 처음 읽은 오래된 state를 마지막에 통째로 저장하면
  // 방금 추가된 SELL 주문을 덮어쓸 수 있다.
  const snapshot = loadState();
  const highestById = new Map();

  for (const position of snapshot.positions.filter(activePosition)) {
    try {
      const q = await currentPrice(position.exchange, position.symbol);
      const price = q.price;
      const highest = Math.max(Number(position.highestPrice || 0), price);
      highestById.set(position.id, highest);

      const entry = Number(position.entryPrice || 0);
      if (entry <= 0) continue;

      const profitRate = (price - entry) / entry * 100;
      const rules = EXIT_RULES[position.strategy] || EXIT_RULES.CORE;

      let exitReason = null;
      if (profitRate <= rules.stopLossRate) exitReason = `STOP_LOSS ${round(profitRate, 2)}%`;
      else if (profitRate >= rules.takeProfitRate) exitReason = `TAKE_PROFIT ${round(profitRate, 2)}%`;
      else if (rules.maxHoldMinutes > 0 && holdMinutes(position) >= rules.maxHoldMinutes) {
        exitReason = `MAX_HOLD ${Math.floor(holdMinutes(position))}m`;
      } else if (rules.forceExitEt && position.tradingDate === nyDateKey() && nyClock() >= rules.forceExitEt) {
        exitReason = `TIME_EXIT ${rules.forceExitEt} ET`;
      }

      if (exitReason) await submitAutoSell(position, exitReason, price);
    } catch (error) {
      console.error(`[US-${position.strategy} AUTO SELL 감시 오류]`, position.symbol, error.message);
    }
  }

  // SELL 주문 저장 이후의 최신 state를 다시 읽어 최고가만 병합한다.
  // 주문/포지션 배열 자체는 절대 snapshot으로 되돌리지 않는다.
  if (highestById.size > 0) {
    const latest = loadState();
    let changed = false;

    for (const position of latest.positions.filter(activePosition)) {
      if (!highestById.has(position.id)) continue;
      const nextHighest = Number(highestById.get(position.id) || 0);
      if (nextHighest > Number(position.highestPrice || 0)) {
        position.highestPrice = nextHighest;
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

function startAutoTrader() {
  if (monitorTimer) return monitorTimer;

  monitorTimer = setInterval(() => {
    monitorOnce().catch(error => console.error('[US AUTO TRADER 감시 오류]', error.message));
  }, MONITOR_INTERVAL_MS);

  if (typeof monitorTimer.unref === 'function') monitorTimer.unref();

  const initial = setTimeout(() => {
    monitorOnce().catch(error => console.error('[US AUTO TRADER 초기감시 오류]', error.message));
  }, 10000);
  if (typeof initial.unref === 'function') initial.unref();

  console.log(
    '[US AUTO TRADER v1.2]',
    `PAPER 운용한도 $${PAPER_CAPITAL.toLocaleString('en-US')}`,
    '/ READY BUY',
    '/ 손절·익절 SELL',
    `/ BUY 미체결 ${BUY_MODIFY_AFTER_MS / 1000}s 후 가격정정`,
    `/ SELL 미체결 ${SELL_MODIFY_AFTER_MS / 1000}s 후 가격정정`
  );

  return monitorTimer;
}

function getStatus() {
  const settings = strategySettings.getSettings();
  const state = loadState();
  const strategyBudgets = {};

  for (const id of STRATEGIES) {
    const usage = strategyUsage(state, id);
    const budget = strategyBudget(id, settings);
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
    version: '1.2',
    mode: 'PAPER',
    paperCapital: PAPER_CAPITAL,
    globalUsed: globalUsage(state),
    globalRemaining: round(Math.max(0, PAPER_CAPITAL - globalUsage(state)), 2),
    monitorRunning,
    monitorIntervalMs: MONITOR_INTERVAL_MS,
    maxAutoBuysPerScan: MAX_AUTO_BUYS_PER_SCAN,
    engineSerialization: true,
    stateOverwriteProtection: true,
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
    openPositions: state.positions.filter(activePosition),
    pendingOrders: state.orders.filter(activeOrder),
    cancelRequestedOrders: state.orders.filter(o => o.status === 'CANCEL_REQUESTED'),
    updatedAt: state.updatedAt
  };
}

module.exports = {
  PAPER_CAPITAL,
  EXIT_RULES,
  processReadyCandidates,
  reconcilePendingOrders,
  managePendingOrders,
  monitorOnce,
  startAutoTrader,
  cancelPendingOrderById,
  getStatus
};
