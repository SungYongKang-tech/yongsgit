const assert = require("assert");
const portfolio = require("./portfolio-manager");

function freshState() {
  return portfolio.ensureMasterState({
    initialCapital: 100000000,
    totalCash: 100000000,
    holdings: [],
    tradeLogs: []
  });
}

// 1. 초기 MASTER 계좌
{
  const state = freshState();
  const summary = portfolio.getPortfolioSummary(state);

  assert.strictEqual(summary.totalCash, 100000000);
  assert.strictEqual(summary.totalAsset, 100000000);
  assert.strictEqual(summary.exposureLimit, 90000000);
  assert.strictEqual(summary.reserveCash, 10000000);
  assert.strictEqual(summary.availableCash, 90000000);
}

// 2. FAST가 1천만원 매수
{
  const state = freshState();

  const result = portfolio.requestBuy(state, {
    strategy: "FAST",
    code: "005930",
    name: "삼성전자",
    price: 50000,
    requestedAmount: 10000000,
    holding: { name: "삼성전자" }
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.qty, 200);
  assert.strictEqual(result.buyAmount, 10000000);
  assert.strictEqual(state.totalCash, 90000000);
  assert.strictEqual(state.holdings.length, 1);
  assert.strictEqual(state.holdings[0].strategyGroup, "FAST");
}

// 3. 같은 종목을 OPEN이 중복매수하려 하면 차단
{
  const state = freshState();

  portfolio.requestBuy(state, {
    strategy: "FAST",
    code: "005930",
    price: 50000,
    requestedAmount: 10000000
  });

  const second = portfolio.requestBuy(state, {
    strategy: "OPEN",
    code: "005930",
    price: 50000,
    requestedAmount: 10000000
  });

  assert.strictEqual(second.ok, false);
  assert.match(second.reason, /중복보유 차단/);
}

// 4. 전체 90% 노출 한도
{
  const state = freshState();

  for (let i = 0; i < 9; i++) {
    const code = String(100000 + i);
    const result = portfolio.requestBuy(state, {
      strategy: i % 2 === 0 ? "CORE" : "WAVE",
      code,
      price: 10000,
      requestedAmount: 10000000
    });
    assert.strictEqual(result.ok, true);
  }

  const blocked = portfolio.requestBuy(state, {
    strategy: "FAST",
    code: "200000",
    price: 10000,
    requestedAmount: 1000000
  });

  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.reason, /가용현금 없음|가용한도 초과/);
}

// 5. 전략 PAUSED
{
  const state = freshState();

  portfolio.setStrategyControl(state, "VOLUME", {
    status: "PAUSED"
  });

  const blocked = portfolio.requestBuy(state, {
    strategy: "VOLUME",
    code: "123456",
    price: 10000,
    requestedAmount: 10000000
  });

  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.reason, /PAUSED/);
}

// 6. 전략별 비중 강제 적용
{
  const state = freshState();

  state.portfolioControl.strategyAllocationEnforced = true;
  portfolio.setStrategyControl(state, "OPEN", {
    allocationRate: 0.20
  });

  const first = portfolio.requestBuy(state, {
    strategy: "OPEN",
    code: "111111",
    price: 10000,
    requestedAmount: 20000000
  });

  assert.strictEqual(first.ok, true);

  const second = portfolio.requestBuy(state, {
    strategy: "OPEN",
    code: "111112",
    price: 10000,
    requestedAmount: 10000
  });

  assert.strictEqual(second.ok, false);
}

// 7. 매도 후 현금/손익 복구
{
  const state = freshState();

  const buy = portfolio.requestBuy(state, {
    strategy: "WAVE",
    code: "333333",
    price: 10000,
    requestedAmount: 10000000
  });

  assert.strictEqual(buy.ok, true);

  const sell = portfolio.requestSell(state, {
    strategy: "WAVE",
    code: "333333",
    price: 11000,
    logType: "WAVE_TEST_SELL",
    reason: "테스트"
  });

  assert.strictEqual(sell.ok, true);
  assert.strictEqual(sell.profit, 1000000);
  assert.strictEqual(state.totalCash, 101000000);
  assert.strictEqual(state.holdings.length, 0);
}



// 8. MASTER 전체 신규매수 PAUSED / 기존 보유 매도는 계속 허용
{
  const state = freshState();

  const buy = portfolio.requestBuy(state, {
    strategy: "WAVE",
    code: "444444",
    price: 10000,
    requestedAmount: 10000000
  });
  assert.strictEqual(buy.ok, true);

  const pause = portfolio.setAllStrategyStatus(state, "PAUSED");
  assert.strictEqual(pause.ok, true);

  const blocked = portfolio.requestBuy(state, {
    strategy: "FAST",
    code: "555555",
    price: 10000,
    requestedAmount: 10000000
  });
  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.reason, /PAUSED/);

  // 신규매수가 PAUSED여도 기존 보유종목의 위험관리/매도는 계속 가능해야 한다.
  const sell = portfolio.requestSell(state, {
    strategy: "WAVE",
    code: "444444",
    price: 10500,
    reason: "PAUSED 상태 매도 허용 테스트"
  });
  assert.strictEqual(sell.ok, true);
  assert.strictEqual(state.holdings.length, 0);
}

console.log("portfolio-manager tests: PASS");
