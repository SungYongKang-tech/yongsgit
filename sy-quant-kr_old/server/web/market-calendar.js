'use strict';

const KR_HOLIDAY_CACHE = new Map();

// 선거일·임시공휴일처럼 규칙만으로 계산할 수 없는 KRX 휴장일.
// 새 임시휴장 공지가 나오면 이 목록만 추가하면 된다.
const KR_SPECIAL_CLOSURES = new Set([
  '2026-06-03' // 제9회 전국동시지방선거
]);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function keyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDaysKey(key, days) {
  const date = parseKey(key);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return keyFromUtcDate(date);
}

function weekday(key) {
  return parseKey(key).getUTCDay();
}

function isWeekend(key) {
  const day = weekday(key);
  return day === 0 || day === 6;
}

function dateKeyInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date instanceof Date ? date : new Date(date));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function marketTodayKey(now = new Date()) {
  return dateKeyInTimeZone(now, 'Asia/Seoul');
}

const CHINESE_LUNAR_FORMATTER = new Intl.DateTimeFormat('en-u-ca-chinese', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
});

function chineseLunarParts(key) {
  const parts = CHINESE_LUNAR_FORMATTER.formatToParts(parseKey(key));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.relatedYear || values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function findLunarDate(year, lunarMonth, lunarDay) {
  let key = `${year}-01-01`;
  const end = `${year}-12-31`;
  while (key <= end) {
    const lunar = chineseLunarParts(key);
    if (lunar.year === year && lunar.month === lunarMonth && lunar.day === lunarDay) return key;
    key = addDaysKey(key, 1);
  }
  throw new Error(`음력 날짜 계산 실패: ${year} ${lunarMonth}/${lunarDay}`);
}

function buildKrHolidaySet(year) {
  if (KR_HOLIDAY_CACHE.has(year)) return KR_HOLIDAY_CACHE.get(year);

  const groups = [];
  const addGroup = (name, dates, substituteRule = 'none') => {
    groups.push({ name, dates: dates.filter(Boolean), substituteRule });
  };

  addGroup('신정', [`${year}-01-01`]);
  addGroup('삼일절', [`${year}-03-01`], 'weekend');
  if (year >= 2026) addGroup('제헌절', [`${year}-07-17`], 'weekend');
  addGroup('광복절', [`${year}-08-15`], 'weekend');
  addGroup('개천절', [`${year}-10-03`], 'weekend');
  addGroup('한글날', [`${year}-10-09`], 'weekend');

  const lunarNewYear = findLunarDate(year, 1, 1);
  addGroup('설날', [addDaysKey(lunarNewYear, -1), lunarNewYear, addDaysKey(lunarNewYear, 1)], 'sunday');

  addGroup('부처님오신날', [findLunarDate(year, 4, 8)], 'weekend');
  addGroup('노동절', [`${year}-05-01`], year >= 2026 ? 'weekend' : 'none');
  addGroup('어린이날', [`${year}-05-05`], 'weekend');
  addGroup('현충일', [`${year}-06-06`]);

  const chuseok = findLunarDate(year, 8, 15);
  addGroup('추석', [addDaysKey(chuseok, -1), chuseok, addDaysKey(chuseok, 1)], 'sunday');
  addGroup('성탄절', [`${year}-12-25`], 'weekend');

  const base = new Set();
  const counts = new Map();
  for (const group of groups) {
    for (const key of group.dates) {
      base.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  for (const key of KR_SPECIAL_CLOSURES) {
    if (Number(key.slice(0, 4)) === year) base.add(key);
  }

  const holidays = new Set(base);
  const triggers = new Map();

  for (const group of groups) {
    let triggerKey = null;
    const overlap = group.dates.find(key => !isWeekend(key) && (counts.get(key) || 0) > 1);
    if (overlap && group.substituteRule !== 'none') triggerKey = `overlap:${overlap}`;

    if (!triggerKey && group.substituteRule === 'weekend') {
      const hit = group.dates.find(key => isWeekend(key));
      if (hit) triggerKey = `${group.name}:${hit}`;
    }
    if (!triggerKey && group.substituteRule === 'sunday') {
      const hit = group.dates.find(key => weekday(key) === 0);
      if (hit) triggerKey = `${group.name}:${hit}`;
    }
    if (!triggerKey) continue;

    const groupEnd = group.dates.slice().sort().at(-1);
    if (!triggers.has(triggerKey)) triggers.set(triggerKey, groupEnd);
  }

  for (const groupEnd of triggers.values()) {
    let candidate = addDaysKey(groupEnd, 1);
    while (isWeekend(candidate) || holidays.has(candidate)) candidate = addDaysKey(candidate, 1);
    holidays.add(candidate);
  }

  // KRX는 12월 31일 또는 그 직전 거래일을 연말 휴장일로 둔다.
  let yearEndClosure = `${year}-12-31`;
  while (isWeekend(yearEndClosure) || holidays.has(yearEndClosure)) {
    yearEndClosure = addDaysKey(yearEndClosure, -1);
  }
  holidays.add(yearEndClosure);

  KR_HOLIDAY_CACHE.set(year, holidays);
  return holidays;
}

function isKrTradingDay(key) {
  if (isWeekend(key)) return false;
  const year = Number(String(key).slice(0, 4));
  return !buildKrHolidaySet(year).has(key);
}

function getRecentTradingDateKeys(count = 7, now = new Date()) {
  const target = Math.max(1, Math.trunc(Number(count) || 7));
  const result = [];
  let key = marketTodayKey(now);
  let guard = 0;

  while (result.length < target && guard < 60) {
    if (isKrTradingDay(key)) result.push(key);
    key = addDaysKey(key, -1);
    guard += 1;
  }

  return result.reverse();
}

module.exports = {
  marketTodayKey,
  isKrTradingDay,
  getRecentTradingDateKeys
};
