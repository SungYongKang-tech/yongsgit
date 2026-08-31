'use strict';

const US_API_BASE = '/us-api/api';
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
  const digits = Number.isInteger(n) ? 0 : 2;
  return `${n > 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
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

function strategyCssClass(id) {
  const normalized = String(id || '').toLowerCase();
  return ['open', 'core', 'volume', 'wave', 'fast'].includes(normalized)
    ? `strategy-${normalized}`
    : '';
}

function getCurrentStrategyText(data = {}) {
  const holdings = Array.isArray(data.details?.holdings) ? data.details.holdings : [];
  const strategies = Array.isArray(data.strategies) ? data.strategies : [];
  const buyEnabled = strategies.filter(item => item.buyEnabled);
  if (!holdings.length && !buyEnabled.length) return '없음';
  if (buyEnabled.length) {
    return buyEnabled
      .map(item => String(item.id || item.label || '').replace(/^US-/i, ''))
      .filter(Boolean)
      .join(' · ');
  }
  return holdings.length ? `기존 보유 ${holdings.length}종목` : '없음';
}

function renderRecent7Days(data = {}) {
  const head = document.getElementById('recentHead');
  const body = document.getElementById('recentBody');
  if (!head || !body) return;

  const dates = Array.isArray(data.recent7Days?.dates) ? data.recent7Days.dates : [];
  const rows = Array.isArray(data.recent7Days?.rows) ? data.recent7Days.rows : [];

  head.innerHTML = `<tr><th>전략</th>${dates.map(item => `<th>${escapeHtml(item.label)}</th>`).join('')}</tr>`;

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8">실현손익 자료가 없습니다.</td></tr>';
    return;
  }

  body.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.icon || '')} ${escapeHtml(String(row.label || row.id || '').replace(/^US-/i, ''))}</td>
      ${(Array.isArray(row.values) ? row.values : []).map(value => `<td class="${profitClass(value)}">${formatUsdCompact(value)}</td>`).join('')}
    </tr>`).join('');
}

function renderStrategies(data = {}) {
  const grid = document.getElementById('strategyGrid');
  const note = document.getElementById('strategyNote');
  if (!grid) return;

  const rows = Array.isArray(data.strategies) ? data.strategies : [];
  if (note) note.textContent = data.calculationNote || '전략별 누적성과';

  if (!rows.length) {
    grid.innerHTML = '<div class="empty">미국 전략은 아직 준비 중입니다.</div>';
    return;
  }

  grid.innerHTML = rows.map(item => {
    const netProfit = toNumber(item.netProfit);
    const profitRate = toNumber(item.profitRate);
    const realizedProfit = toNumber(item.realizedProfit);
    const unrealizedProfit = toNumber(item.unrealizedProfit);
    const buyText = item.buyEnabled ? 'ON' : 'OFF';
    const implementedText = item.implemented ? '구현완료' : '준비중';
    const singleBuyRate = item.singleBuyRate ?? 0;
    const strategyMaxRate = item.strategyMaxInvestmentRate ?? item.allocationRate ?? 0;
    const dailyMaxNewBuys = item.dailyMaxNewBuys ?? item.maxHoldings ?? 0;

    return `
      <article class="strategy-card ${strategyCssClass(item.id)}">
        <div class="strategy-head">
          <div class="strategy-name">${escapeHtml(item.icon || '📈')} ${escapeHtml(item.label || item.id || 'STRATEGY')}</div>
          <div class="strategy-status">${escapeHtml(item.status || 'BUY OFF')}</div>
        </div>
        <div class="strategy-profit ${profitClass(netProfit)}">${formatUsd(netProfit, true)}</div>
        <div class="strategy-sub"><span>1종목 / 전략한도</span><b>${formatPercent(singleBuyRate)} / ${formatPercent(strategyMaxRate)}</b></div>
        <div class="strategy-sub"><span>최대종목 / 일일매수</span><b>${toNumber(item.maxHoldings)}종목 / ${toNumber(dailyMaxNewBuys)}회</b></div>
        <div class="strategy-sub"><span>매수허용 / 상태</span><b>${buyText} / ${implementedText}</b></div>
        <div class="strategy-sub"><span>수익률</span><b class="${profitClass(profitRate)}">${formatRate(profitRate)}</b></div>
        <div class="strategy-sub"><span>확정 / 보유</span><b>${formatUsd(realizedProfit, true)} / ${formatUsd(unrealizedProfit, true)}</b></div>
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
        <div class="holding-sub">${escapeHtml(item.symbol || '')} · ${escapeHtml(item.exchange || '')} · ${escapeHtml(item.currency || 'USD')}</div>
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
        <div class="holding-sub">${escapeHtml(item.symbol || '')} · ${escapeHtml(item.strategy || '')}${item.reason ? ' · ' + escapeHtml(item.reason) : ''}</div>
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
        <div class="holding-sub">${escapeHtml(item.symbol || '')} · ${escapeHtml(item.strategy || '')} · ${escapeHtml(formatDateTime(item.soldAt))}${item.reason ? ' · ' + escapeHtml(item.reason) : ''}</div>
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

  const holdings = Array.isArray(currentDashboardData.details?.holdings) ? currentDashboardData.details.holdings : [];
  const candidates = Array.isArray(currentDashboardData.details?.candidates) ? currentDashboardData.details.candidates : [];
  const sells = Array.isArray(currentDashboardData.details?.sellHistory) ? currentDashboardData.details.sellHistory : [];

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
  setMetric('unrealizedProfit', formatUsd(overall.unrealizedProfit, true), overall.unrealizedProfit);

  renderRecent7Days(data);
  renderStrategies(data);
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
  if (updatedAt) updatedAt.textContent = formatTime(data.updatedAt);
}

async function loadDashboard() {
  const status = document.getElementById('apiStatus');
  try {
    if (status) {
      status.textContent = 'API 조회 중';
      status.className = '';
    }
    const response = await fetch(`${US_API_BASE}/strategy-dashboard-summary`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }
    renderDashboard(data);
  } catch (error) {
    console.error('SY Quant US dashboard error', error);
    if (status) {
      status.textContent = 'API 확인 필요';
      status.className = 'minus';
    }
    const updatedAt = document.getElementById('updatedAt');
    if (updatedAt) updatedAt.textContent = error.message || '갱신 실패';
  }
}

setupTabs();
window.loadDashboard = loadDashboard;
loadDashboard();
setInterval(loadDashboard, 30000);
