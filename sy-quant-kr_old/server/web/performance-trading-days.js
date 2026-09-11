(function () {
  'use strict';

  const KR_SPECIAL_CLOSURES = new Set([
    '2026-06-03' // 제9회 전국동시지방선거
  ]);
  const holidayCache = new Map();

  function pad2(value) { return String(value).padStart(2, '0'); }
  function parseKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  }
  function keyFromDate(date) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }
  function addDays(key, days) {
    const d = parseKey(key);
    d.setUTCDate(d.getUTCDate() + days);
    return keyFromDate(d);
  }
  function weekday(key) { return parseKey(key).getUTCDay(); }
  function isWeekend(key) { const d = weekday(key); return d === 0 || d === 6; }
  function todayKstKey() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }

  const lunarFormatter = new Intl.DateTimeFormat('en-u-ca-chinese', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric'
  });

  function lunarParts(key) {
    const parts = lunarFormatter.formatToParts(parseKey(key));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return { year: Number(p.relatedYear || p.year), month: Number(p.month), day: Number(p.day) };
  }

  function findLunarDate(year, month, day) {
    let key = `${year}-01-01`;
    const end = `${year}-12-31`;
    while (key <= end) {
      const lunar = lunarParts(key);
      if (lunar.year === year && lunar.month === month && lunar.day === day) return key;
      key = addDays(key, 1);
    }
    return null;
  }

  function buildKrHolidays(year) {
    if (holidayCache.has(year)) return holidayCache.get(year);
    const groups = [];
    const addGroup = (name, dates, rule = 'none') => groups.push({ name, dates: dates.filter(Boolean), rule });

    addGroup('신정', [`${year}-01-01`]);
    addGroup('삼일절', [`${year}-03-01`], 'weekend');
    if (year >= 2026) addGroup('제헌절', [`${year}-07-17`], 'weekend');
    addGroup('광복절', [`${year}-08-15`], 'weekend');
    addGroup('개천절', [`${year}-10-03`], 'weekend');
    addGroup('한글날', [`${year}-10-09`], 'weekend');

    const seollal = findLunarDate(year, 1, 1);
    addGroup('설날', [addDays(seollal, -1), seollal, addDays(seollal, 1)], 'sunday');
    addGroup('부처님오신날', [findLunarDate(year, 4, 8)], 'weekend');
    addGroup('노동절', [`${year}-05-01`], year >= 2026 ? 'weekend' : 'none');
    addGroup('어린이날', [`${year}-05-05`], 'weekend');
    addGroup('현충일', [`${year}-06-06`]);
    const chuseok = findLunarDate(year, 8, 15);
    addGroup('추석', [addDays(chuseok, -1), chuseok, addDays(chuseok, 1)], 'sunday');
    addGroup('성탄절', [`${year}-12-25`], 'weekend');

    const holidays = new Set();
    const counts = new Map();
    groups.forEach(group => group.dates.forEach(key => {
      holidays.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }));
    KR_SPECIAL_CLOSURES.forEach(key => {
      if (Number(key.slice(0, 4)) === year) holidays.add(key);
    });

    const triggers = new Map();
    groups.forEach(group => {
      let trigger = null;
      const overlap = group.dates.find(key => !isWeekend(key) && (counts.get(key) || 0) > 1);
      if (overlap && group.rule !== 'none') trigger = `overlap:${overlap}`;
      if (!trigger && group.rule === 'weekend') {
        const hit = group.dates.find(isWeekend);
        if (hit) trigger = `${group.name}:${hit}`;
      }
      if (!trigger && group.rule === 'sunday') {
        const hit = group.dates.find(key => weekday(key) === 0);
        if (hit) trigger = `${group.name}:${hit}`;
      }
      if (!trigger) return;
      const end = group.dates.slice().sort().at(-1);
      if (!triggers.has(trigger)) triggers.set(trigger, end);
    });

    triggers.forEach(end => {
      let candidate = addDays(end, 1);
      while (isWeekend(candidate) || holidays.has(candidate)) candidate = addDays(candidate, 1);
      holidays.add(candidate);
    });

    let yearEnd = `${year}-12-31`;
    while (isWeekend(yearEnd) || holidays.has(yearEnd)) yearEnd = addDays(yearEnd, -1);
    holidays.add(yearEnd);

    holidayCache.set(year, holidays);
    return holidays;
  }

  function isKrTradingDay(key) {
    if (isWeekend(key)) return false;
    return !buildKrHolidays(Number(key.slice(0, 4))).has(key);
  }

  function recentKrTradingKeys(count = 7) {
    const result = [];
    let key = todayKstKey();
    let guard = 0;
    while (result.length < count && guard < 60) {
      if (isKrTradingDay(key)) result.push(key);
      key = addDays(key, -1);
      guard += 1;
    }
    return result.reverse();
  }

  function profitMapFromRecentSells(recentSells, dates) {
    const allowed = new Set(dates);
    const maps = new Map(['OPEN', 'CORE', 'VOLUME', 'WAVE', 'FAST'].map(id => [id, new Map()]));
    (Array.isArray(recentSells) ? recentSells : []).forEach(row => {
      const id = String(row.strategyGroup || row.strategy || '').toUpperCase();
      const date = String(row.date || '').slice(0, 10);
      if (!maps.has(id) || !allowed.has(date)) return;
      const map = maps.get(id);
      map.set(date, Number(map.get(date) || 0) + Number(row.profit || row.realizedProfit || 0));
    });
    return maps;
  }

  window.renderStrategyFlowTable = function (_strategies = [], _dateKeys = []) {
    const box = document.getElementById('strategyFlowTable');
    if (!box) return;

    const dates = recentKrTradingKeys(7);
    const recentSells = latestStrategyDashboardData?.details?.recentSells || [];
    const maps = profitMapFromRecentSells(recentSells, dates);
    const meta = {
      OPEN: { icon: '🚀', label: 'OPEN', short: 'OPEN', cls: 'flow-open' },
      CORE: { icon: '🛡️', label: 'CORE', short: 'CORE', cls: 'flow-core' },
      VOLUME: { icon: '📊', label: 'VOLUME', short: 'VOL', cls: 'flow-volume' },
      WAVE: { icon: '🌊', label: 'WAVE', short: 'WAVE', cls: 'flow-wave' },
      FAST: { icon: '⚡', label: 'FAST', short: 'FAST', cls: 'flow-fast' }
    };
    const ids = ['OPEN', 'CORE', 'VOLUME', 'WAVE', 'FAST'];

    const desktopHeader = dates.map(date => {
      const [, m, d] = date.split('-').map(Number);
      return `<th>${m}/${d}</th>`;
    }).join('');
    const desktopRows = ids.map(id => {
      const cells = dates.map(date => {
        const profit = Number(maps.get(id)?.get(date) || 0);
        return `<td class="${dashboardProfitClass(profit)}">${formatCompactWon(profit)}</td>`;
      }).join('');
      return `<tr><td><b>${meta[id].icon} ${meta[id].label}</b></td>${cells}</tr>`;
    }).join('');

    const mobileHeader = ids.map(id => `<th class="${meta[id].cls}">${meta[id].short}</th>`).join('');
    const mobileRows = dates.map(date => {
      const [, m, d] = date.split('-').map(Number);
      const cells = ids.map(id => {
        const profit = Number(maps.get(id)?.get(date) || 0);
        return `<td class="${dashboardProfitClass(profit)}">${formatCompactWon(profit)}</td>`;
      }).join('');
      return `<tr><td>${m}/${d}</td>${cells}</tr>`;
    }).join('');

    box.innerHTML = `
      <div class="strategy-flow-desktop">
        <table class="strategy-flow-table">
          <thead><tr><th>전략</th>${desktopHeader}</tr></thead>
          <tbody>${desktopRows}</tbody>
        </table>
      </div>
      <div class="strategy-flow-mobile">
        <table class="strategy-flow-mobile-table" aria-label="최근 7거래일 전략별 실현손익">
          <thead><tr><th>날짜</th>${mobileHeader}</tr></thead>
          <tbody>${mobileRows}</tbody>
        </table>
      </div>`;
  };

  const title = document.querySelector('.strategy-flow-title');
  if (title) title.textContent = '최근 7거래일 전략별 실현손익';

  // performance.js의 첫 API 요청이 먼저 끝났더라도 거래일 기준으로 다시 그린다.
  setTimeout(() => {
    if (typeof loadStrategyDashboardSummary === 'function') loadStrategyDashboardSummary();
  }, 0);
})();
