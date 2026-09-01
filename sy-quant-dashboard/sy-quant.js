'use strict';

const KR_SUMMARY_URL = '/api/strategy-dashboard-summary';
const US_SUMMARY_URL = '/us-api/api/strategy-dashboard-summary';
const US_AUTO_STATUS_URL = '/us-api/api/us/auto-trader/status';

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

function profitClass(value) {
  const n = toNumber(value);
  return n > 0 ? 'plus' : n < 0 ? 'minus' : '';
}

function formatWon(value, signed = false) {
  const n = Math.round(toNumber(value));
  const abs = Math.abs(n).toLocaleString('ko-KR');
  return `${signed ? (n > 0 ? '+' : n < 0 ? '-' : '') : (n < 0 ? '-' : '')}${abs}원`;
}

function formatUsd(value, signed = false) {
  const n = toNumber(value);
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${signed ? (n > 0 ? '+' : n < 0 ? '-' : '') : (n < 0 ? '-' : '')}$${abs}`;
}

function formatRate(value) {
  const n = toNumber(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '갱신 완료';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function setValue(id, text, valueForClass = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('plus', 'minus');
  if (valueForClass !== null) {
    const cls = profitClass(valueForClass);
    if (cls) el.classList.add(cls);
  }
}

function setStatus(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `status ${ok ? 'ok' : 'bad'}`;
}

function renderStrategies(targetId, rows, currency) {
  const box = document.getElementById(targetId);
  if (!box) return;

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    box.innerHTML = '<div class="empty">전략이 아직 준비되지 않았습니다. 전략을 추가하면 전략별 수익이 자동 표시됩니다.</div>';
    return;
  }

  const money = currency === 'USD' ? formatUsd : formatWon;
  box.innerHTML = list.map(item => {
    const netProfit = toNumber(item.netProfit);
    const profitRate = toNumber(item.profitRate);
    return `
      <div class="strategy-row">
        <div class="strategy-name">${escapeHtml(item.icon || '')} ${escapeHtml(item.label || item.id || 'STRATEGY')}</div>
        <div class="strategy-profit ${profitClass(netProfit)}">${money(netProfit, true)}</div>
        <div class="strategy-rate ${profitClass(profitRate)}">${formatRate(profitRate)}</div>
      </div>`;
  }).join('');
}

function renderMarket(prefix, data, currency, overallOverride = null) {
  const overall = overallOverride || data.overall || {};
  const money = currency === 'USD' ? formatUsd : formatWon;
  const asset = overall.currentAsset ?? overall.totalAsset ?? 0;
  const profit = overall.netProfit ?? overall.totalProfitLoss ?? 0;
  const rate = overall.profitRate ?? overall.totalReturnRate ?? 0;

  setValue(`${prefix}Asset`, money(asset));
  setValue(`${prefix}Profit`, money(profit, true), profit);
  setValue(`${prefix}Rate`, formatRate(rate), rate);
  renderStrategies(`${prefix}Strategies`, data.strategies, currency);

  const updated = document.getElementById(`${prefix}Updated`);
  if (updated) updated.textContent = `갱신 ${formatTime(data.updatedAt)}`;
}

async function loadMarket({ prefix, url, currency, label, autoUrl = null }) {
  try {
    setStatus(`${prefix}Status`, '조회 중', true);

    const [summaryResponse, autoResponse] = await Promise.all([
      fetch(url, { cache: 'no-store' }),
      autoUrl ? fetch(`${autoUrl}?t=${Date.now()}`, { cache: 'no-store' }) : Promise.resolve(null)
    ]);

    const data = await summaryResponse.json();
    if (!summaryResponse.ok || data.ok === false) {
      throw new Error(data.error || data.message || `HTTP ${summaryResponse.status}`);
    }

    let overallOverride = null;

    if (autoResponse) {
      const autoData = await autoResponse.json().catch(() => null);
      if (autoResponse.ok && autoData && autoData.ok !== false) {
        overallOverride = {
          currentAsset: toNumber(autoData.totalAsset),
          totalAsset: toNumber(autoData.totalAsset),
          netProfit: toNumber(autoData.netProfit),
          profitRate: toNumber(autoData.profitRate)
        };
      }
    }

    renderMarket(prefix, data, currency, overallOverride);
    setStatus(`${prefix}Status`, '정상', true);
  } catch (error) {
    console.error(`${label} dashboard load error`, error);
    setStatus(`${prefix}Status`, '확인 필요', false);
    const box = document.getElementById(`${prefix}Strategies`);
    if (box) box.innerHTML = `<div class="empty">${escapeHtml(label)} 성과를 불러오지 못했습니다.<br>${escapeHtml(error.message)}</div>`;
  }
}

async function loadAll() {
  await Promise.all([
    loadMarket({ prefix: 'kr', url: KR_SUMMARY_URL, currency: 'KRW', label: '한국' }),
    loadMarket({
      prefix: 'us',
      url: US_SUMMARY_URL,
      currency: 'USD',
      label: '미국',
      autoUrl: US_AUTO_STATUS_URL
    })
  ]);
}

window.loadAll = loadAll;
loadAll();
setInterval(loadAll, 30000);
