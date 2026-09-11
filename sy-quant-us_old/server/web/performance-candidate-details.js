'use strict';

(function installUsCandidateDetailView() {
  const styleId = 'usCandidateDetailStyle';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .activity-card.candidate { align-items:start; }
      .candidate-extra {
        grid-column:1 / -1;
        display:grid;
        grid-template-columns:repeat(6,minmax(0,1fr));
        gap:7px;
        padding-top:8px;
        margin-top:2px;
        border-top:1px solid #293548;
      }
      .candidate-extra .metric { text-align:right; }
      .candidate-blocks {
        grid-column:1 / -1;
        color:#fbbf24;
        font-size:11px;
        text-align:right;
      }
      @media (max-width:760px) {
        .candidate-extra { grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
        .candidate-extra .metric { text-align:left; }
        .candidate-blocks { text-align:left; }
      }
    `;
    document.head.appendChild(style);
  }

  function candidateTime(value) {
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

  function signedRate(value) {
    const n = toNumber(value);
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
  }

  function candidateDetailHtml(item) {
    const blocks = Array.isArray(item.blocks) ? item.blocks.filter(Boolean) : [];
    const trendRate = toNumber(item.trendPersistence) * 100;
    const sources = Array.isArray(item.sources) ? item.sources.join('+') : '';
    return `
      <article class="activity-card candidate">
        <div>
          <div class="holding-name">${escapeHtml(item.name || item.symbol || '-')}</div>
          <div class="holding-sub">${escapeHtml(item.symbol || '')} · ${escapeHtml(item.exchange || '')} · ${escapeHtml(item.strategy || '')}${sources ? ' · ' + escapeHtml(sources) : ''}</div>
        </div>
        <div class="metric"><span>상태</span><b>${escapeHtml(item.status || 'WATCH')}</b></div>
        <div class="metric"><span>점수</span><b>${Math.round(toNumber(item.score))}</b></div>
        <div class="metric"><span>현재가</span><b>${formatUsd(item.price)}</b></div>
        <div class="metric"><span>시가대비</span><b class="${profitClass(item.changeRate)}">${signedRate(item.changeRate)}</b></div>

        <div class="candidate-extra">
          <div class="metric"><span>VWAP 대비</span><b class="${profitClass(item.vwapGapRate)}">${signedRate(item.vwapGapRate)}</b></div>
          <div class="metric"><span>RVOL</span><b>${toNumber(item.rvol).toFixed(2)}x</b></div>
          <div class="metric"><span>당일위치</span><b>${Math.round(toNumber(item.dayPositionRate))}%</b></div>
          <div class="metric"><span>추세지속</span><b>${Math.round(trendRate)}%</b></div>
          <div class="metric"><span>QQQ</span><b class="${profitClass(item.qqqChangeRate)}">${signedRate(item.qqqChangeRate)}</b></div>
          <div class="metric"><span>발견시각(KST)</span><b>${escapeHtml(candidateTime(item.updatedAt))}</b></div>
          ${blocks.length ? `<div class="candidate-blocks">차단/관찰사유: ${escapeHtml(blocks.join(' · '))}</div>` : ''}
        </div>
      </article>`;
  }

  window.candidateHtml = candidateDetailHtml;

  if (typeof window.renderActivityPanel === 'function') {
    window.renderActivityPanel();
  }
})();
