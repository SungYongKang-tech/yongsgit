'use strict';

const US_API_BASE = '/us-api/api';
const US_DAILY_BASELINE_KEY = 'syquant-us-dashboard-daily-baseline-v1';

let currentDashboardData = null;
let activeTab = 'holdings';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(value, signed = false) {
  const n = toNumber(value);
  const absolute = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  if (!signed) return `${n < 0 ? '-' : ''}$${absolute}`;
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}$${absolute}`;
}

function formatUsdCompact(value) {
  const n = toNumber(value);
  if (n === 0) return '0';

  const abs = Math.abs(n);
  if (abs >= 1000) {
    return `${n > 0 ? '+' : '-'}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  }

  return `${n > 0 ? '+' : '-'}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function formatRate(value) {
  const n = toNumber(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatPercent(value) {
  const n = toNumber(value);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

function profitClass(value) {
  const n = toNumber(value);
  return n > 0 ? 'plus' : n < 0 ? 'minus' : '';
}

function setMetric(id, text, valueForClass = null) {
  const el = document.getElementById(id);
  if (!el) return;

  el.textContent = text;
  el.classList.remove('plus', 'minus');

  if (valueForClass !== null) {
    const cls = profitClass(valueForClass);
    if (cls) el.classList.add(cls);
  }
}

function formatTime(value) {
  if (!value) return '갱신 완료';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '갱신 완료';

  return '갱신 ' + new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function usDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function strategyCssClass(id) {
  const normalized = String(id || '').toLowerCase();
  return ['open', 'core', 'volume', 'wave', 'fast'].includes(normalized)
    ? `strategy-${normalized}`
    : '';
}

function normalizeStrategyId(value) {
  return String(value || '')
    .replace(/^US-/i, '')
    .trim()
    .toUpperCase();
}

function getCurrentStrategyText(data = {}) {
  const holdings = Array.isArray(data.details?.holdings)
    ? data.details.holdings
    : [];

  if (!holdings.length) return '없음';

  const strategyNames = [...new Set(
    holdings
      .map(item => normalizeStrategyId(
        item.strategy ||
        item.strategyId ||
        item.strategyGroup ||
        item.ownerStrategy
      ))
      .filter(Boolean)
  )];

  if (strategyNames.length) {
    return strategyNames
      .map(name => `${name}`)
      .join(' · ');
  }

  return `보유 ${holdings.length}종목`;
}

function getTodayRealized(data = {}) {
  const today = usDateKey();
  const dates = Array.isArray(data.recent7Days?.dates)
    ? data.recent7Days.dates
    : [];
  const rows = Array.isArray(data.recent7Days?.rows)
    ? data.recent7Days.rows
    : [];

  const index = dates.findIndex(item => String(item.key || '') === today);
  if (index < 0) return 0;

  return rows.reduce((sum, row) => {
    const values = Array.isArray(row.values) ? row.values : [];
    return sum + toNumber(values[index]);
  }, 0);
}

function loadDailyBaseline() {
  try {
    const text = localStorage.getItem(US_DAILY_BASELINE_KEY);
    return text ? JSON.parse(text) : {};
  } catch (_) {
    return {};
  }
}

function saveDailyBaseline(value) {
  try {
    localStorage.setItem(US_DAILY_BASELINE_KEY, JSON.stringify(value));
  } catch (_) {}
}

/*
 * US 서버는 현재 일중 시작자산을 별도 필드로 내려주지 않는다.
 * 그래서 화면은 미국 거래일별 첫 조회 자산을 시작자산으로 보관한다.
 * 서버에서 todayProfit/todayRealizedProfit/todayUnrealizedChange가 생기면
 * 그 값을 최우선으로 사용하도록 만들어 두었다.
 */
function getTodayPerformance(data = {}) {
  const overall = data.overall || {};

  if (
    Number.isFinite(Number(overall.todayProfit)) ||
    Number.isFinite(Number(overall.todayRealizedProfit))
  ) {
    const todayProfit = toNumber(overall.todayProfit);
    const todayRealized = toNumber(overall.todayRealizedProfit);
    const todayHoldingChange = Number.isFinite(Number(overall.todayUnrealizedChange))
      ? toNumber(overall.todayUnrealizedChange)
      : todayProfit - todayRealized;

    const startAsset = toNumber(
      overall.dailyStartAsset ||
      overall.todayStartAsset ||
      overall.initialCapital
    );

    const todayProfitRate = Number.isFinite(Number(overall.todayProfitRate))
      ? toNumber(overall.todayProfitRate)
      : startAsset > 0
        ? (todayProfit / startAsset) * 100
        : 0;

    return {
      todayProfit,
      todayRealized,
      todayHoldingChange,
      todayProfitRate
    };
  }

  const today = usDateKey();
  const currentAsset = toNumber(overall.totalAsset);
  const initialCapital = toNumber(overall.initialCapital);
  const todayRealized = getTodayRealized(data);

  const recentDates = Array.isArray(data.recent7Days?.dates)
    ? data.recent7Days.dates
    : [];

  const isTradingDate = recentDates.some(item => String(item.key || '') === today);

  if (!isTradingDate) {
    return {
      todayProfit: 0,
      todayRealized: 0,
      todayHoldingChange: 0,
      todayProfitRate: 0
    };
  }

  const saved = loadDailyBaseline();
  let startAsset = 0;

  if (saved.date === today && toNumber(saved.startAsset) > 0) {
    startAsset = toNumber(saved.startAsset);
  } else {
    startAsset = currentAsset || initialCapital;
  }

  saveDailyBaseline({
    date: today,
    startAsset,
    lastAsset: currentAsset,
    updatedAt: new Date().toISOString()
  });

  const todayProfit = currentAsset - startAsset;
  const todayHoldingChange = todayProfit - todayRealized;
  const todayProfitRate = startAsset > 0
    ? (todayProfit / startAsset) * 100
    : 0;

  return {
    todayProfit,
    todayRealized,
    todayHoldingChange,
    todayProfitRate
  };
}

function recentRowMap(data = {}) {
  const rows = Array.isArray(data.recent7Days?.rows)
    ? data.recent7Days.rows
    : [];

  return new Map(
    rows.map(row => [normalizeStrategyId(row.id || row.label), row])
  );
}

function buildSparkline(values = []) {
  const daily = Array.isArray(values)
    ? values.map(toNumber).slice(-7)
    : [];

  while (daily.length < 7) daily.unshift(0);

  let cumulative = 0;
  const series = daily.map(value => {
    cumulative += value;
    return cumulative;
  });

  const width = 210;
  const height = 42;
  const padding = 4;
  const centerY = height / 2;
  const maxAbs = Math.max(1, ...series.map(value => Math.abs(value)));

  const points = series.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(1, series.length - 1);
    const y = centerY - (value / maxAbs) * (centerY - padding);
    return { x, y, value };
  });

  const pointText = points
    .map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ');

  const last = points[points.length - 1];
  const finalValue = series[series.length - 1] || 0;
  const color = finalValue > 0
    ? '#4ade80'
    : finalValue < 0
      ? '#f87171'
      : '#94a3b8';

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="최근 7거래일 실현손익 흐름">
      <line x1="${padding}" y1="${centerY}" x2="${width-padding}" y2="${centerY}" class="spark-base"></line>
      <polyline points="${pointText}" class="spark-line" style="stroke:${color}"></polyline>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.1" style="fill:${color}"></circle>
    </svg>`;
}

function renderRecent7Days(data = {}) {
  const head = document.getElementById('recentHead');
  const body = document.getElementById('recentBody');
  const mobileHead = document.getElementById('recentMobileHead');
  const mobileBody = document.getElementById('recentMobileBody');

  const dates = Array.isArray(data.recent7Days?.dates)
    ? data.recent7Days.dates
    : [];
  const rows = Array.isArray(data.recent7Days?.rows)
    ? data.recent7Days.rows
    : [];

  if (head) {
    head.innerHTML = `
      <tr>
        <th>전략</th>
        ${dates.map(item => `<th>${escapeHtml(item.label)}</th>`).join('')}
      </tr>`;
  }

  if (body) {
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8">실현손익 자료가 없습니다.</td></tr>';
    } else {
      body.innerHTML = rows.map(row => `
        <tr>
          <td>${escapeHtml(row.icon || '')} ${escapeHtml(normalizeStrategyId(row.label || row.id))}</td>
          ${(Array.isArray(row.values) ? row.values : [])
            .map(value => `<td class="${profitClass(value)}">${formatUsdCompact(value)}</td>`)
            .join('')}
        </tr>`
      ).join('');
    }
  }

  const ids = ['OPEN', 'CORE', 'VOLUME', 'WAVE', 'FAST'];
  const classMap = {
    OPEN: 'flow-open',
    CORE: 'flow-core',
    VOLUME: 'flow-volume',
    WAVE: 'flow-wave',
    FAST: 'flow-fast'
  };

  const rowMap = recentRowMap(data);

  if (mobileHead) {
    mobileHead.innerHTML = `
      <tr>
        <th>날짜</th>
        ${ids.map(id => `<th class="${classMap[id]}">${id === 'VOLUME' ? 'VOL' : id}</th>`).join('')}
      </tr>`;
  }

  if (mobileBody) {
    mobileBody.innerHTML = dates.map((dateItem, dateIndex) => {
      const cells = ids.map(id => {
        const row = rowMap.get(id);
        const value = toNumber(row?.values?.[dateIndex]);
        return `<td class="${profitClass(value)}">${formatUsdCompact(value)}</td>`;
      }).join('');

      return `<tr><td>${escapeHtml(dateItem.label || '')}</td>${cells}</tr>`;
    }).join('');
  }
}

function renderStrategies(data = {}) {
  const grid = document.getElementById('strategyGrid');
  const note = document.getElementById('strategyNote');
  if (!grid) return;

  const rows = Array.isArray(data.strategies)
    ? data.strategies
    : [];

  const overall = data.overall || {};
  const initialCapital = Math.max(0, toNumber(overall.initialCapital));
  const recentMap = recentRowMap(data);

  if (note) {
    note.textContent = data.calculationNote || '전략별 누적성과';
  }

  if (!rows.length) {
    grid.innerHTML = '<div class="empty">미국 전략은 아직 준비 중입니다.</div>';
    return;
  }

  const ordered = ['OPEN', 'CORE', 'VOLUME', 'WAVE', 'FAST']
    .map(id => rows.find(item => normalizeStrategyId(item.id) === id))
    .filter(Boolean);

  grid.innerHTML = ordered.map(item => {
    const id = normalizeStrategyId(item.id);
    const netProfit = toNumber(item.netProfit);
    const realizedProfit = toNumber(item.realizedProfit);
    const unrealizedProfit = toNumber(item.unrealizedProfit);

    const masterRate = initialCapital > 0
      ? (netProfit / initialCapital) * 100
      : toNumber(item.profitRate);

    const singleBuyRate = toNumber(item.singleBuyRate);
    const strategyMaxRate = toNumber(
      item.strategyMaxInvestmentRate ?? item.allocationRate
    );
    const dailyMaxNewBuys = toNumber(
      item.dailyMaxNewBuys ?? item.maxHoldings
    );

    const buyText = item.buyEnabled ? 'ON' : 'OFF';
    const implementedText = item.implemented ? '운영' : '준비중';
    const recent = recentMap.get(id);
    const sparkline = buildSparkline(recent?.values || []);

    return `
      <article class="strategy-card ${strategyCssClass(id)}">
        <div class="strategy-head">
          <div class="strategy-name">
            ${escapeHtml(item.icon || '📈')} ${escapeHtml(item.label || `US-${id}`)}
          </div>
          <div class="strategy-status">${escapeHtml(item.status || 'BUY OFF')}</div>
        </div>

        <div class="strategy-net-label">이 전략이 만든 누적손익</div>
        <div class="strategy-profit ${profitClass(netProfit)}">${formatUsd(netProfit, true)}</div>

        <div class="strategy-rate-row">
          <span>MASTER 대비 손익률</span>
          <b class="${profitClass(masterRate)}">${formatRate(masterRate)}</b>
        </div>

        <div class="strategy-mini-grid">
          <div class="strategy-mini-item">
            <div class="strategy-mini-label">확정 / 보유손익</div>
            <div class="strategy-mini-value">
              <span class="${profitClass(realizedProfit)}">${formatUsdCompact(realizedProfit)}</span>
              /
              <span class="${profitClass(unrealizedProfit)}">${formatUsdCompact(unrealizedProfit)}</span>
            </div>
          </div>

          <div class="strategy-mini-item">
            <div class="strategy-mini-label">1종목 / 전략한도</div>
            <div class="strategy-mini-value">${formatPercent(singleBuyRate)} / ${formatPercent(strategyMaxRate)}</div>
          </div>

          <div class="strategy-mini-item">
            <div class="strategy-mini-label">최대종목 / 일일매수</div>
            <div class="strategy-mini-value">${toNumber(item.maxHoldings)}종목 / ${dailyMaxNewBuys}회</div>
          </div>

          <div class="strategy-mini-item">
            <div class="strategy-mini-label">매수허용 / 상태</div>
            <div class="strategy-mini-value">${buyText} / ${implementedText}</div>
          </div>
        </div>

        <div class="strategy-sparkline">${sparkline}</div>
        <div class="strategy-footer">최근 7거래일 실현손익 흐름</div>
      </article>`;
  }).join('');
}

function holdingHtml(item) {
  const profit = toNumber(item.profitLoss);
  const rate = toNumber(item.profitLossRate);

  return `
    <article class="holding-card">
      <div>
        <div class="holding-name">${escapeHtml(item.name || item.symbol || '-')}</div>
        <div class="holding-sub">
          ${escapeHtml(item.symbol || '')}
          · ${escapeHtml(item.exchange || '')}
          · ${escapeHtml(item.currency || 'USD')}
        </div>
      </div>
      <div class="metric"><span>수량</span><b>${toNumber(item.quantity).toLocaleString()}주</b></div>
      <div class="metric"><span>매수가</span><b>${formatUsd(item.buyPrice)}</b></div>
      <div class="metric"><span>현재가</span><b>${formatUsd(item.currentPrice)}</b></div>
      <div class="metric"><span>평가금액</span><b>${formatUsd(item.evaluationAmount)}</b></div>
      <div class="metric"><span>보유손익</span><b class="${profitClass(profit)}">${formatUsd(profit, true)} · ${formatRate(rate)}</b></div>
    </article>`;
}

function candidateHtml(item) {
  return `
    <article class="activity-card candidate">
      <div>
        <div class="holding-name">${escapeHtml(item.name || item.symbol || '-')}</div>
        <div class="holding-sub">
          ${escapeHtml(item.symbol || '')}
          · ${escapeHtml(item.strategy || '')}
          ${item.reason ? ' · ' + escapeHtml(item.reason) : ''}
        </div>
      </div>
      <div class="metric"><span>상태</span><b>${escapeHtml(item.status || 'WATCH')}</b></div>
      <div class="metric"><span>점수</span><b>${Math.round(toNumber(item.score))}</b></div>
      <div class="metric"><span>현재가</span><b>${formatUsd(item.price)}</b></div>
      <div class="metric"><span>등락률</span><b class="${profitClass(item.changeRate)}">${formatRate(item.changeRate)}</b></div>
    </article>`;
}

function sellHtml(item) {
  const profit = toNumber(item.realizedProfit);

  return `
    <article class="activity-card sell">
      <div>
        <div class="holding-name">${escapeHtml(item.name || item.symbol || '-')}</div>
        <div class="holding-sub">
          ${escapeHtml(item.symbol || '')}
          · ${escapeHtml(item.strategy || '')}
          · ${escapeHtml(formatDateTime(item.soldAt))}
          ${item.reason ? ' · ' + escapeHtml(item.reason) : ''}
        </div>
      </div>
      <div class="metric"><span>수량</span><b>${toNumber(item.quantity).toLocaleString()}주</b></div>
      <div class="metric"><span>매수가</span><b>${formatUsd(item.buyPrice)}</b></div>
      <div class="metric"><span>매도가</span><b>${formatUsd(item.sellPrice)}</b></div>
      <div class="metric"><span>실현손익</span><b class="${profitClass(profit)}">${formatUsd(profit, true)}</b></div>
      <div class="metric"><span>수익률</span><b class="${profitClass(item.profitRate)}">${formatRate(item.profitRate)}</b></div>
    </article>`;
}

function renderActivityPanel() {
  const panel = document.getElementById('activityPanel');
  if (!panel || !currentDashboardData) return;

  const holdings = Array.isArray(currentDashboardData.details?.holdings)
    ? currentDashboardData.details.holdings
    : [];
  const candidates = Array.isArray(currentDashboardData.details?.candidates)
    ? currentDashboardData.details.candidates
    : [];
  const sells = Array.isArray(currentDashboardData.details?.sellHistory)
    ? currentDashboardData.details.sellHistory
    : [];

  document.getElementById('holdingsTabCount').textContent = holdings.length;
  document.getElementById('candidatesTabCount').textContent = candidates.length;
  document.getElementById('sellsTabCount').textContent = sells.length;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });

  if (activeTab === 'candidates') {
    panel.innerHTML = candidates.length
      ? candidates.map(candidateHtml).join('')
      : '<div class="empty">현재 전략 후보가 없습니다.</div>';
    return;
  }

  if (activeTab === 'sells') {
    panel.innerHTML = sells.length
      ? sells.map(sellHtml).join('')
      : '<div class="empty">아직 매도 내역이 없습니다.</div>';
    return;
  }

  panel.innerHTML = holdings.length
    ? holdings.map(holdingHtml).join('')
    : '<div class="empty">현재 보유종목이 없습니다.</div>';
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab || 'holdings';
      renderActivityPanel();
    });
  });
}

function renderDashboard(data = {}) {
  currentDashboardData = data;

  const overall = data.overall || {};

  setMetric('totalAsset', formatUsd(overall.totalAsset));
  setMetric('netProfit', formatUsd(overall.netProfit, true), overall.netProfit);
  setMetric('profitRate', formatRate(overall.profitRate), overall.profitRate);
  setMetric('currentStrategy', getCurrentStrategyText(data));
  setMetric('totalExposure', formatUsd(overall.totalExposure));
  setMetric(
    'unrealizedProfit',
    formatUsd(overall.unrealizedProfit, true),
    overall.unrealizedProfit
  );

  const today = getTodayPerformance(data);
  setMetric('todayProfit', formatUsd(today.todayProfit, true), today.todayProfit);
  setMetric('todayRealized', formatUsd(today.todayRealized, true), today.todayRealized);
  setMetric(
    'todayHoldingChange',
    formatUsd(today.todayHoldingChange, true),
    today.todayHoldingChange
  );
  setMetric(
    'todayProfitRate',
    formatRate(today.todayProfitRate),
    today.todayProfitRate
  );

  renderStrategies(data);
  renderRecent7Days(data);
  renderActivityPanel();

  const status = document.getElementById('apiStatus');
  if (status) {
    status.textContent = 'API 정상';
    status.className = 'status-ok';
  }

  const masterBuyStatus = document.getElementById('masterBuyStatus');
  if (masterBuyStatus) {
    const enabled = Boolean(data.strategyControl?.masterBuyEnabled);
    masterBuyStatus.textContent = enabled ? '전체 매수 ON' : '전체 매수 OFF';
    masterBuyStatus.className = enabled ? 'status-on' : 'status-off';
  }

  const updatedAt = document.getElementById('updatedAt');
  if (updatedAt) {
    updatedAt.textContent = formatTime(data.updatedAt);
  }
}

async function loadDashboard() {
  const status = document.getElementById('apiStatus');

  try {
    if (status) {
      status.textContent = 'API 조회 중';
      status.className = '';
    }

    const response = await fetch(
      `${US_API_BASE}/strategy-dashboard-summary`,
      { cache:'no-store' }
    );

    const data = await response.json();

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.error ||
        data.message ||
        `HTTP ${response.status}`
      );
    }

    renderDashboard(data);
  } catch (error) {
    console.error('SY Quant US dashboard error', error);

    if (status) {
      status.textContent = 'API 확인 필요';
      status.className = 'minus';
    }

    const updatedAt = document.getElementById('updatedAt');
    if (updatedAt) {
      updatedAt.textContent = error.message || '갱신 실패';
    }
  }
}

setupTabs();

window.loadDashboard = loadDashboard;

loadDashboard();
setInterval(loadDashboard, 30000);
