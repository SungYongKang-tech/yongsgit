'use strict';

const KR_HOLIDAY_CACHE = new Map();
const US_HOLIDAY_CACHE = new Map();

// 선거일·임시공휴일처럼 규칙만으로 계산할 수 없는 거래소 휴장일.
// 새 임시휴장 공지가 나오면 이 목록만 추가하면 된다.
const KR_SPECIAL_CLOSURES = new Set([
  '2026-06-03' // 제9회 전국동시지방선거
]);

const US_SPECIAL_CLOSURES = new Set([
  '2025-01-09' // Jimmy Carter national day of mourning
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

function marketTodayKey(market, now = new Date()) {
  const id = String(market || '').toUpperCase();
  return dateKeyInTimeZone(now, id === 'US' ? 'America/New_York' : 'Asia/Seoul');
}

function nthWeekdayOfMonth(year, month, targetWeekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const delta = (targetWeekday - first.getUTCDay() + 7) % 7;
  return keyFromUtcDate(new Date(Date.UTC(year, month - 1, 1 + delta + (nth - 1) * 7, 12)));
}

function lastWeekdayOfMonth(year, month, targetWeekday) {
  const last = new Date(Date.UTC(year, month, 0, 12));
  const delta = (last.getUTCDay() - targetWeekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - delta);
  return keyFromUtcDate(last);
}

function easterSundayKey(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addObservedFixedHoliday(set, year, month, day, options = {}) {
  const key = `${year}-${pad2(month)}-${pad2(day)}`;
  const wd = weekday(key);
  set.add(key);
  if (wd === 6 && options.observeSaturday !== false) set.add(addDaysKey(key, -1));
  if (wd === 0 && options.observeSunday !== false) set.add(addDaysKey(key, 1));
}

function buildUsHolidaySet(year) {
  if (US_HOLIDAY_CACHE.has(year)) return US_HOLIDAY_CACHE.get(year);
  const set = new Set();

  // NYSE 공식 캘린더 기준. 1월 1일이 토요일이면 전날 휴장으로 당기지 않는다.
  addObservedFixedHoliday(set, year, 1, 1, { observeSaturday: false });
  set.add(nthWeekdayOfMonth(year, 1, 1, 3));
  set.add(nthWeekdayOfMonth(year, 2, 1, 3));
  set.add(addDaysKey(easterSundayKey(year), -2));
  set.add(lastWeekdayOfMonth(year, 5, 1));
  if (year >= 2022) addObservedFixedHoliday(set, year, 6, 19);
  addObservedFixedHoliday(set, year, 7, 4);
  set.add(nthWeekdayOfMonth(year, 9, 1, 1));
  set.add(nthWeekdayOfMonth(year, 11, 4, 4));
  addObservedFixedHoliday(set, year, 12, 25);

  for (const key of US_SPECIAL_CLOSURES) {
    if (Number(key.slice(0, 4)) === year) set.add(key);
  }

  US_HOLIDAY_CACHE.set(year, set);
  return set;
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

function isUsTradingDay(key) {
  if (isWeekend(key)) return false;
  const year = Number(String(key).slice(0, 4));
  return !buildUsHolidaySet(year).has(key);
}

function isTradingDay(market, key) {
  return String(market || '').toUpperCase() === 'US'
    ? isUsTradingDay(key)
    : isKrTradingDay(key);
}

function getRecentTradingDates(market, count = 7, now = new Date()) {
  const id = String(market || '').toUpperCase();
  const target = Math.max(1, Math.trunc(Number(count) || 7));
  const result = [];
  let key = marketTodayKey(id, now);
  let guard = 0;

  while (result.length < target && guard < 60) {
    if (isTradingDay(id, key)) {
      const [, month, day] = key.split('-').map(Number);
      result.push({ key, label: `${month}/${day}` });
    }
    key = addDaysKey(key, -1);
    guard += 1;
  }

  return result.reverse();
}

function getRecentTradingDateKeys(market, count = 7, now = new Date()) {
  return getRecentTradingDates(market, count, now).map(item => item.key);
}

module.exports = {
  marketTodayKey,
  dateKeyInTimeZone,
  isTradingDay,
  isKrTradingDay,
  isUsTradingDay,
  getRecentTradingDates,
  getRecentTradingDateKeys
};
