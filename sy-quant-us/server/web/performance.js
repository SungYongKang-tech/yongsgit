'use strict';

const US_API_BASE = '/us-api/api';

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

function formatRate(value) {
  const n = toNumber(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
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
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function renderStrategies(data = {}) {
  const grid = document.getElementById('strategyGrid');
  const note = document.getElementById('strategyNote');
  if (!grid) return;

  const rows = Array.isArray(data.strategies) ? data.strategies : [];
  if (note) note.textContent = data.calculationNote || '전략별 누적성과';

  if (!rows.length) {
    grid.innerHTML = '<div class="empty">미국 전략은 아직 준비 중입니다. 전략을 추가하면 이곳에 전략별 수익이 자동 표시됩니다.</div>';
    return;
  }

  grid.innerHTML = rows.map(item => {
    const netProfit = toNumber(item.netProfit);
    const profitRate = toNumber(item.profitRate);
    const realizedProfit = toNumber(item.realizedProfit);
    const unrealizedProfit = toNumber(item.unrealizedProfit);
    return `
      <article class="strategy-card">
        <div class="strategy-head">
          <div class="strategy-name">${escapeHtml(item.icon || '📈')} ${escapeHtml(item.label || item.id || 'STRATEGY')}</div>
          <div class="strategy-status">${escapeHtml(item.status || 'ACTIVE')}</div>
        </div>
        <div class="strategy-profit ${profitClass(netProfit)}">${formatUsd(netProfit, true)}</div>
        <div class="strategy-sub"><span>수익률</span><b class="${profitClass(profitRate)}">${formatRate(profitRate)}</b></div>
        <div class="strategy-sub"><span>확정 / 보유</span><b>${formatUsd(realizedProfit, true)} / ${formatUsd(unrealizedProfit, true)}</b></div>
      </article>`;
  }).join('');
}

function renderHoldings(data = {}) {
  const list = document.getElementById('holdingList');
  const count = document.getElementById('holdingCount');
  if (!list) return;

  const rows = Array.isArray(data.details?.holdings) ? data.details.holdings : [];
  if (count) count.textContent = `${rows.length}종목`;

  if (!rows.length) {
    list.innerHTML = '<div class="empty">현재 보유종목이 없습니다.</div>';
    return;
  }

  list.innerHTML = rows.map(item => {
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
  }).join('');
}

function renderDashboard(data = {}) {
  const overall = data.overall || {};
  setMetric('totalAsset', formatUsd(overall.totalAsset));
  setMetric('netProfit', formatUsd(overall.netProfit, true), overall.netProfit);
  setMetric('profitRate', formatRate(overall.profitRate), overall.profitRate);
  setMetric('totalExposure', formatUsd(overall.totalExposure));
  setMetric('unrealizedProfit', formatUsd(overall.unrealizedProfit, true), overall.unrealizedProfit);
  setMetric('totalCash', formatUsd(overall.totalCash));

  renderStrategies(data);
  renderHoldings(data);

  const status = document.getElementById('apiStatus');
  if (status) {
    status.textContent = 'API 정상';
    status.className = 'status-pill ok';
  }
  const updatedAt = document.getElementById('updatedAt');
  if (updatedAt) updatedAt.textContent = formatTime(data.updatedAt);
}

async function loadDashboard() {
  const status = document.getElementById('apiStatus');
  try {
    if (status) {
      status.textContent = 'API 조회 중';
      status.className = 'status-pill';
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
      status.className = 'status-pill bad';
    }
    const updatedAt = document.getElementById('updatedAt');
    if (updatedAt) updatedAt.textContent = error.message || '갱신 실패';
  }
}

window.loadDashboard = loadDashboard;
loadDashboard();
setInterval(loadDashboard, 30000);
