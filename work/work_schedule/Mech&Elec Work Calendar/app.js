import { db } from "./firebase.js";
import {
  ref, onValue, push, set, update, remove, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/* =========================
   DOM helper (✅ 반드시 최상단)
========================= */
const $ = (id) => document.getElementById(id);

/* =========================
   LocalStorage keys / Types
========================= */
const LS_NAME = "mecal_selected_name";
const LS_TYPES = "mecal_selected_types";
const LS_UNLOCK = "mecal_unlocked_members"; // ✅ PIN 통과한 멤버들

// ✅ 화면/필터에 사용할 최종 분야(관리자 설정 우선)
let TYPE_LIST = ["근태", "회사일정", "작업일정"]; // 기본값(관리자 설정이 없을 때)

/* =========================
   DOM refs
========================= */
const typeBar = $("typeBar");
const memberBar = $("memberBar");
const monthTitle = $("monthTitle");
const calGrid = $("calGrid");

const modalBack = $("modalBack");
const modalTitle = $("modalTitle");
const fDate = $("fDate");
const fEndDate = $("fEndDate");
const fType = $("fType");
const fStart = $("fStart");
const fEnd = $("fEnd");
const fOwner = $("fOwner");
const fTitle = $("fTitle");
const fDetail = $("fDetail");
const saveBtn = $("saveBtn");
const deleteBtn = $("deleteBtn");
const closeBtn = $("closeBtn");
const editHint = $("editHint");
const colorPicker = $("colorPicker");
const fColor = $("fColor");

// ✅ 종일 체크박스(HTML에 id="allDayChk" 필요)
const allDayChk = $("allDayChk");

const COLOR_PRESETS = [
  "#93c5fd", // 파랑
  "#86efac", // 초록
  "#fcd34d", // 노랑
  "#fca5a5", // 빨강
  "#f9a8d4", // 분홍
  "#c4b5fd", // 보라
  "#7dd3fc", // 하늘
  "#d1d5db"  // 회색
];

/* =========================
   State
========================= */
let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);

let membersAll = [];
let members = [];
let memberColorMap = {}; // ✅ 관리자모드에서 설정한 멤버 색상 맵
let selectedName = localStorage.getItem(LS_NAME) || "";

let eventsAll = {}; // { "YYYY-MM-DD": {eventId: evObj} }
let eventsByDate = {}; // 현재월 startDate 기준 필터

let editing = { dateKey: null, eventId: null, originalDateKey: null };

/* =========================
   ✅ Types from Admin (config/types)
========================= */
let typesFromAdmin = []; // ["근태","회사일정",...]

/* =========================
   Selected Types (필터)
   - 0개면 전체 표시
========================= */
function loadSelectedTypes() {
  try {
    const raw = localStorage.getItem(LS_TYPES);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
let selectedTypes = loadSelectedTypes();

function saveSelectedTypes() {
  localStorage.setItem(LS_TYPES, JSON.stringify([...selectedTypes]));
}

function subscribeTypes() {
  onValue(ref(db, "config/types"), (snap) => {
    const obj = snap.val() || {};
    const list = Object.entries(obj)
      .map(([id, v]) => ({ id, ...v }))
      .filter((x) => x.active !== false)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((x) => (x.name || "").trim())
      .filter(Boolean);

    typesFromAdmin = list;

    if (typesFromAdmin.length) TYPE_LIST = typesFromAdmin;
    else TYPE_LIST = ["근태", "회사일정", "작업일정"];

    // ✅ 선택된 타입 중 삭제된 것 정리 + 저장
    selectedTypes = new Set([...selectedTypes].filter((t) => TYPE_LIST.includes(t)));
    saveSelectedTypes();

    renderTypeButtons();
    renderTypeSelectOptions();
    renderCalendar();
  });
}

/* =========================
   ✅ Admin Holidays (config/holidays)
========================= */
let adminHolidayMap = {}; // { "YYYY-MM-DD": {name, note} }

function subscribeAdminHolidays() {
  onValue(ref(db, "config/holidays"), (snap) => {
    adminHolidayMap = snap.val() || {};
    applyMonthFilterAndRender();
  });
}

/* =========================
   Type Buttons
========================= */
function renderTypeButtons() {
  if (!typeBar) return;

  typeBar.innerHTML = "";

  TYPE_LIST.forEach((type) => {
    const btn = document.createElement("button");
    const active = selectedTypes.has(type);

    btn.type = "button";
    btn.className = "type-btn" + (active ? " active" : "");
    btn.textContent = type;

    const color = getTypeColor(type);

    if (active) {
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = "#111";
      btn.style.boxShadow = `0 6px 16px ${color}55`;
    } else {
      btn.style.background = "#fff";
      btn.style.borderColor = color;
      btn.style.color = "#111";
      btn.style.boxShadow = "none";
    }

    btn.onclick = () => {
      if (selectedTypes.has(type)) selectedTypes.delete(type);
      else selectedTypes.add(type);

      saveSelectedTypes();
      renderTypeButtons();
      renderCalendar();
    };

    typeBar.appendChild(btn);
  });
}

function renderTypeSelectOptions(selected = "") {
  if (!fType) return;

  const prev = selected || fType.value || "";

  fType.innerHTML = "";
  TYPE_LIST.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    fType.appendChild(opt);
  });

  if (TYPE_LIST.includes(prev)) fType.value = prev;
  else fType.value = TYPE_LIST[0] || "";
}

/* =========================
   Holidays (API + Admin merge)
========================= */
let holidayMap = {}; // { "YYYY-MM-DD": { localName, name, note, source } }
const holidayCache = {}; // { "2026": holidayMap... }

async function loadKoreanHolidays(year) {
  if (holidayCache[year]) {
    holidayMap = { ...holidayCache[year] };
    return;
  }

  const url = `https://date.nager.at/api/v3/publicholidays/${year}/KR`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`holiday fetch failed: ${res.status}`);
    const arr = await res.json();

    const map = {};
    for (const h of arr || []) {
      if (!h?.date) continue;
      map[h.date] = {
        localName: h.localName || h.name || "공휴일",
        name: h.name || h.localName || "Holiday",
        note: "",
        source: "api",
      };
    }
    holidayMap = { ...map };
    holidayCache[year] = { ...map };
  } catch (e) {
    console.warn("공휴일 로드 실패:", e);
    holidayMap = {};
  }
}

/* =========================
   Utils
========================= */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isMobileNow() {
  return window.matchMedia("(max-width: 640px)").matches;
}

/* ✅ CSS var -> px 숫자 */
function cssPx(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ✅ 모바일에서 칸 안 좌우 여백 */
function getBarInsetPx() {
  return isMobileNow() ? { sidePad: 1, sideSub: 2 } : { sidePad: 2, sideSub: 4 };
}

/* ✅ 관리자모드(config/members)의 color 값 사용 */
function getMemberColor(name) {
  const n = (name || "").trim();
  return memberColorMap[n] || "#1f6feb";
}

function getTypeColor(type) {
  const TYPE_COLOR_MAP = {
    "근태": "#55B7FF",
    "회사일정": "#FF6FAE",
    "작업일정": "#67D96E",
    "에너지 이용량": "#F59E0B",
    "코엔서비스": "#7C3AED",
    "업무공유": "#10B981",
  };
  return TYPE_COLOR_MAP[type] || "#1f6feb";
}

function monthRangeKeys() {
  const start = new Date(current);
  start.setDate(1);
  const end = new Date(current);
  end.setMonth(end.getMonth() + 1);
  end.setDate(0);
  return { startKey: ymd(start), endKey: ymd(end) };
}

function toEventList() {
  const list = [];
  Object.entries(eventsByDate || {}).forEach(([startDate, objs]) => {
    Object.entries(objs || {}).forEach(([eventId, ev]) => {
      const s = startDate;
      const e = ev.endDate || startDate;
      list.push({ ...ev, eventId, startDate: s, endDate: e });
    });
  });
  return list;
}

// ✅ PC(기본) 싱글 표시용: 16자까지 / 17자부터 15자+…
function compactTitleSingle(title) {
  const full = (title || "(제목없음)").trim();
  return full.length >= 17 ? full.slice(0, 15) + "…" : full;
}

/* =========================
   일정 색상 유틸
========================= */
function getTextColor(bg) {
  if (!bg) return "#111";
  const hex = bg.replace("#", "");
  if (hex.length !== 6) return "#111";

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  return brightness > 160 ? "#111" : "#fff";
}

function normalizeColor(color) {
  const c = (color || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return "";
}

function getEventColor(ev) {
  const saved = normalizeColor(ev?.color);
  if (saved) return saved;

  const ownerColor = normalizeColor(getMemberColor(ev?.owner));
  if (ownerColor) return ownerColor;

  return "#dbeafe";
}

function applyItemColor(target, ev, alphaHex = "") {
  if (!target) return;

  const base = getEventColor(ev);
  const text = getTextColor(base);

  target.style.borderColor = base;
  target.style.background = alphaHex ? `${base}${alphaHex}` : base;
  target.style.color = text;
}

function renderColorPicker(selected = "#dbeafe") {
  if (!colorPicker || !fColor) return;

  const safeSelected = normalizeColor(selected) || "#dbeafe";

  colorPicker.innerHTML = "";
  fColor.value = safeSelected;

  COLOR_PRESETS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-chip" + (color === safeSelected ? " active" : "");
    btn.style.background = color;
    btn.title = color;

    btn.addEventListener("click", () => {
      fColor.value = color;
      [...colorPicker.querySelectorAll(".color-chip")].forEach((el) => {
        el.classList.remove("active");
      });
      btn.classList.add("active");
    });

    colorPicker.appendChild(btn);
  });
}

/* =========================
   Legacy Type Mapping
========================= */
function mapLegacyType(t) {
  if (!t) return "";
  if (t === "휴가") return "근태";
  if (t === "작업") return "작업일정";
  if (t === "공정") return "회사일정";
  if (TYPE_LIST.includes(t)) return t;
  return t;
}

/* =========================
   ✅ 모바일 싱글바 규칙
========================= */
function getSingleBarRule(title) {
  const full = (title || "(제목없음)").trim();
  const isMobile = isMobileNow();

  if (isMobile) {
    const hasSpace = /\s/.test(full);
    const hasPunc = /[()[\]{}·•,./\\\-_:;!?]/.test(full);
    const longEnough = full.length > 4;   // ✅ 4자까지는 1줄

    const wantTwo = longEnough || hasSpace || hasPunc;
    return {
      rows: wantTwo ? 2 : 1,
      textClamp: wantTwo ? 3 : 1,
      display: full,
    };
  }

  const wantTwo = full.length >= 12;
  return {
    rows: wantTwo ? 2 : 1,
    textClamp: wantTwo ? 2 : 1,
    display: full,
  };
}

/* =========================
   ✅ 종일/시간 입력 UX
========================= */
function setAllDay(isAllDay) {
  if (!allDayChk) return;

  allDayChk.checked = isAllDay;

  const timeDisabled = isAllDay;
  if (fStart) fStart.disabled = timeDisabled;
  if (fEnd) fEnd.disabled = timeDisabled;

  document.querySelectorAll(".tbtn").forEach((b) => {
    b.disabled = timeDisabled;
  });

  if (isAllDay) {
    if (fStart) fStart.value = "";
    if (fEnd) fEnd.value = "";
  }
}

allDayChk?.addEventListener("change", () => {
  setAllDay(allDayChk.checked);
});

function autoEnableTime() {
  if (!allDayChk) return;
  if (allDayChk.checked) setAllDay(false);
}
fStart?.addEventListener("input", autoEnableTime);
fEnd?.addEventListener("input", autoEnableTime);

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tbtn");
  if (!btn) return;

  autoEnableTime();

  const s = btn.dataset.s ?? "";
  const ed = btn.dataset.e ?? "";
  if (fStart) fStart.value = s;
  if (fEnd) fEnd.value = ed;

  if (!s && !ed) setAllDay(true);
});

/* =========================
   Modal
========================= */
function syncEndDateMin() {
  const s = (fDate?.value || "").trim();
  if (!s || !fEndDate) return;

  fEndDate.min = s;

  if (!fEndDate.value || fEndDate.value < s) fEndDate.value = s;
}

function openModal({ dateKey, eventId = null, event = null }) {
  if (!selectedName) {
    alert("상단에서 이름을 먼저 선택해 주세요.");
    return;
  }

  renderTypeSelectOptions();

  const startKey = event?.startDate || dateKey;

  editing = {
    dateKey: startKey,
    eventId,
    originalDateKey: event?.startDate || dateKey,
  };

  if (fDate) {
    fDate.disabled = false;
    fDate.value = startKey;
  }

  const modalOwnerText = document.getElementById("modalOwnerText");
if (modalOwnerText) modalOwnerText.textContent = `작성: ${selectedName}`;

  if (fEndDate) fEndDate.value = event?.endDate || startKey;
  syncEndDateMin();

  setAllDay(true);

  if (event) {
    modalTitle.textContent = "일정 수정";
    const rawType = (event.type || "").trim();
    const mappedType = mapLegacyType(rawType) || TYPE_LIST[0] || "작업일정";

    if (fType) fType.value = mappedType;
    if (fStart) fStart.value = event.start || "";
    if (fEnd) fEnd.value = event.end || "";
    if (fTitle) fTitle.value = event.title || "";
    if (fDetail) fDetail.value = event.detail || "";
    if (fOwner) fOwner.value = event.owner || selectedName;

    if (((event.start || "").trim()) || ((event.end || "").trim())) {
      setAllDay(false);
    }

    renderColorPicker(getEventColor(event));

    const canEdit = event.owner === selectedName;
    if (saveBtn) saveBtn.disabled = !canEdit;
    if (deleteBtn) deleteBtn.style.display = canEdit ? "inline-block" : "none";
    if (editHint) {
      editHint.textContent = canEdit
        ? "작성자 본인 일정입니다. 수정/삭제 가능합니다."
        : "작성자 본인만 수정/삭제할 수 있습니다.";
    }
  } else {
    modalTitle.textContent = "일정 입력";
    if (fType) fType.value = TYPE_LIST[0] || "작업일정";
    if (fStart) fStart.value = "";
    if (fEnd) fEnd.value = "";
    if (fTitle) fTitle.value = "";
    if (fDetail) fDetail.value = "";
    renderColorPicker("#dbeafe");

    if (saveBtn) saveBtn.disabled = false;
    if (deleteBtn) deleteBtn.style.display = "none";
    if (editHint) editHint.textContent = "";
  }

  modalBack?.classList.add("show");
}

fDate?.addEventListener("change", () => {
  const s = (fDate.value || "").trim();
  if (!s) return;
  editing.dateKey = s;
  syncEndDateMin();
});

fEndDate?.addEventListener("change", () => {
  syncEndDateMin();
});

function closeModal() {
  modalBack?.classList.remove("show");
  editing = { dateKey: null, eventId: null, originalDateKey: null };
}

modalBack?.addEventListener("click", (e) => {
  if (e.target === modalBack) closeModal();
});
closeBtn?.addEventListener("click", closeModal);

/* =========================
   PIN Unlock
========================= */
function loadUnlocked() {
  try {
    const raw = localStorage.getItem(LS_UNLOCK);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
let unlockedMembers = loadUnlocked();

function saveUnlocked() {
  localStorage.setItem(LS_UNLOCK, JSON.stringify([...unlockedMembers]));
}

async function ensureMemberUnlocked(member) {
  const pin = (member?.pin || "").trim();
  if (!pin) return true;

  if (unlockedMembers.has(member.id)) return true;

  const input = prompt(`${member.name} 비밀번호(PIN)를 입력해 주세요.`);
  if (input === null) return false;
  if (String(input).trim() !== pin) {
    alert("비밀번호가 일치하지 않습니다.");
    return false;
  }

  unlockedMembers.add(member.id);
  saveUnlocked();
  return true;
}

/* =========================
   Members
========================= */
function renderMemberButtons() {
  if (!memberBar) return;
  memberBar.innerHTML = "";

  if ((!selectedName || !members.some((m) => m.name === selectedName)) && members.length) {
    selectedName = members[0].name;
    localStorage.setItem(LS_NAME, selectedName);
  }

  members.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "member-btn" + (m.name === selectedName ? " active" : "");
    btn.textContent = m.name;

    const color = getMemberColor(m.name);

    if (m.name === selectedName) {
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = "#111";
      btn.style.boxShadow = `0 6px 16px ${color}55`;
    } else {
      btn.style.background = "#fff";
      btn.style.borderColor = color;
      btn.style.color = "#111";
      btn.style.boxShadow = "none";
    }

    btn.onclick = async () => {
      const ok = await ensureMemberUnlocked(m);
      if (!ok) return;

      selectedName = m.name;
      localStorage.setItem(LS_NAME, selectedName);
      renderMemberButtons();
      renderCalendar();
    };

    memberBar.appendChild(btn);
  });
}

function subscribeMembers() {
  onValue(ref(db, "config/members"), (snap) => {
    const obj = snap.val() || {};

    const list = Object.entries(obj).map(([id, v]) => ({
      id,
      ...(v || {}),
      pin: (v?.pin || "").toString().trim(),
      name: (v?.name || "").toString().trim(),
      color: (v?.color || "").toString().trim(),
    }));

    list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    membersAll = list;
    members = list.filter((x) => x.active !== false);

    memberColorMap = {};
    membersAll.forEach((m) => {
      const name = (m.name || "").trim();
      const color = (m.color || "").trim();
      if (name) {
        memberColorMap[name] = color || "#1f6feb";
      }
    });

    renderMemberButtons();
    renderCalendar();
  });
}

/* =========================
   Events
========================= */
function subscribeEvents() {
  onValue(ref(db, "events"), (snap) => {
    eventsAll = snap.val() || {};
    applyMonthFilterAndRender();
  });
}

async function applyMonthFilterAndRender() {
  await loadKoreanHolidays(current.getFullYear());

  for (const [dateKey, h] of Object.entries(adminHolidayMap || {})) {
    if (!dateKey) continue;
    holidayMap[dateKey] = {
      localName: (h?.name || "휴무일").trim(),
      name: (h?.name || "Holiday").trim(),
      note: (h?.note || "").trim(),
      source: "admin",
    };
  }

  const { startKey, endKey } = monthRangeKeys();
  eventsByDate = {};
  Object.keys(eventsAll).forEach((dateKey) => {
    if (dateKey >= startKey && dateKey <= endKey) {
      eventsByDate[dateKey] = eventsAll[dateKey];
    }
  });

  renderCalendar();
}

/* ===== 멀티바 레인 배치(겹침 방지) ===== */
function placeInLanes(segments) {
  const occ = [];

  function ensureRow(row) {
    if (!occ[row]) occ[row] = new Array(7).fill(false);
  }

  function canPlace(row, sIdx, eIdx) {
    ensureRow(row);
    for (let k = sIdx; k <= eIdx; k++) {
      if (occ[row][k]) return false;
    }
    return true;
  }

  function occupy(row, sIdx, eIdx) {
    ensureRow(row);
    for (let k = sIdx; k <= eIdx; k++) occ[row][k] = true;
  }

  const placed = [];
  for (const seg of segments) {
    let row = 0;
    while (true) {
      if (canPlace(row, seg.sIdx, seg.eIdx)) {
        occupy(row, seg.sIdx, seg.eIdx);
        placed.push({ row, ...seg });
        break;
      }
      row++;
    }
  }
  return { placed, occ };
}

/* =========================
   Render Calendar
========================= */
function renderCalendar() {
  if (!calGrid || !monthTitle) return;

  const y = current.getFullYear();
  const m = current.getMonth();
  monthTitle.textContent = `${y}.${pad2(m + 1)}`;

  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  const last = new Date(y, m + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));

  const allEventsRaw = toEventList();

  const allEventsNormalized = allEventsRaw.map((ev) => {
    const t = mapLegacyType((ev.type || "").trim()) || (TYPE_LIST[0] || "작업일정");
    return { ...ev, type: t };
  });

  const allEvents =
    selectedTypes.size === 0
      ? allEventsNormalized
      : allEventsNormalized.filter((ev) => selectedTypes.has(ev.type));

  calGrid.innerHTML = "";

  const dow = document.createElement("div");
  dow.className = "dow";
  ["일", "월", "화", "수", "목", "금", "토"].forEach((d) => {
    const el = document.createElement("div");
    el.textContent = d;
    dow.appendChild(el);
  });
  calGrid.appendChild(dow);

  const barRowPx = cssPx("--bar-row", 24);
  const todayKey = ymd(new Date());

  let cursor = new Date(start);
  while (cursor <= end) {
    const weekRow = document.createElement("div");
    weekRow.className = "week-row";

    const weekBars = document.createElement("div");
    weekBars.className = "week-bars";
    weekRow.appendChild(weekBars);

    const dayEls = [];
    const dateKeys = [];

    for (let i = 0; i < 7; i++) {
      const dateKey = ymd(cursor);
      dateKeys.push(dateKey);

      const day = document.createElement("div");
      day.className = "day";
      day.classList.add(`dow-${i}`);

      if (holidayMap[dateKey]) day.classList.add("holiday");
      if (dateKey === todayKey) day.classList.add("today");

      const inMonth = cursor.getMonth() === m;
      if (!inMonth) day.classList.add("muted");

      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();

      const items = document.createElement("div");
      items.className = "day-items";

      day.appendChild(num);
      day.appendChild(items);

      day.addEventListener("click", (e) => {
        if (e.target.closest(".mbar") || e.target.closest(".sbar")) return;
        openModal({ dateKey });
      });

      weekRow.appendChild(day);
      dayEls.push(day);

      cursor.setDate(cursor.getDate() + 1);
    }

    const weekStartKey = dateKeys[0];
    const weekEndKey = dateKeys[6];

    const segments = [];
    for (const ev of allEvents) {
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;
      if (s === e) continue;

      if (e < weekStartKey || s > weekEndKey) continue;

      const segStart = s < weekStartKey ? weekStartKey : s;
      const segEnd = e > weekEndKey ? weekEndKey : e;

      const sIdx = dateKeys.indexOf(segStart);
      const eIdx = dateKeys.indexOf(segEnd);
      if (sIdx < 0 || eIdx < 0) continue;

      segments.push({ sIdx, eIdx, ev });
    }

    segments.sort((a, b) => {
      if (a.sIdx !== b.sIdx) return a.sIdx - b.sIdx;
      return a.eIdx - b.eIdx;
    });

    const { placed, occ } = placeInLanes(segments);

    function ensureRow(r) {
      if (!occ[r]) occ[r] = new Array(7).fill(false);
    }

    const singleBars = [];

    for (const ev of allEvents) {
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;
      if (s !== e) continue;

      const col = dateKeys.indexOf(s);
      if (col < 0) continue;

      const rule = getSingleBarRule(ev.title || "");
      const rows = rule.rows;
      const textClamp = rule.textClamp;
      const display = rule.display;

      let row = 0;
      while (true) {
        ensureRow(row);

        if (!occ[row][col]) {
          if (rows === 1) break;

          ensureRow(row + 1);
          if (!occ[row + 1][col]) break;
        }
        row++;
      }

      occ[row][col] = true;
      if (rows === 2) {
        ensureRow(row + 1);
        occ[row + 1][col] = true;
      }

      singleBars.push({
        row,
        col,
        ev,
        rows,
        textClamp,
        display,
        isHoliday: false,
      });
    }

    for (let i = 0; i < 7; i++) {
      const dateKey = dateKeys[i];
      const h = holidayMap[dateKey];
      if (!h) continue;

      const title = (h.localName || "휴무일").trim();
      const tooltip = h.note ? `${title} - ${h.note}` : title;

      const isFestival = /설날|추석/.test(title) || /연휴/.test(title);
      const display = compactTitleSingle(title);

      let row = 0;
      while (true) {
        ensureRow(row);
        if (!occ[row][i]) break;
        row++;
      }
      occ[row][i] = true;

      singleBars.push({
        row,
        col: i,
        ev: { title },
        rows: 1,
        textClamp: 1,
        display,
        isHoliday: true,
        isFestival,
        tooltip,
      });
    }

    const lanesCountFinal = occ.length;
    weekBars.style.height = `${lanesCountFinal * barRowPx}px`;

    const perDayRows = new Array(7).fill(0);
    for (let r = 0; r < occ.length; r++) {
      for (let c = 0; c < 7; c++) {
        if (occ[r][c]) perDayRows[c] = Math.max(perDayRows[c], r + 1);
      }
    }
    dayEls.forEach((day, i) => {
      day.style.setProperty("--barSpaceDay", `${perDayRows[i] * barRowPx}px`);
    });

    const { sidePad, sideSub } = getBarInsetPx();
    const colW = 100 / 7;

    // --- 멀티바 렌더 ---
    placed.forEach((p) => {
      const { row, sIdx, eIdx, ev } = p;
      const span = eIdx - sIdx + 1;

      const bar = document.createElement("div");
      bar.className = "mbar";

      bar.style.left = `calc(${sIdx * colW}% + ${sidePad}px)`;
      bar.style.width = `calc(${span * colW}% - ${sideSub}px)`;
      bar.style.top = `${row * barRowPx}px`;

      applyItemColor(bar, ev, "2b");

      bar.textContent = (ev.title || "(제목없음)").trim();
      bar.title = (ev.title || "").trim();

      bar.addEventListener("click", (e2) => {
        e2.stopPropagation();
        openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
      });

      weekBars.appendChild(bar);
    });

    // --- 싱글바 렌더 ---
    singleBars.forEach((p) => {
      const bar = document.createElement("div");

      let cls = "sbar";
      if (!p.isHoliday && p.rows === 2) cls += " two-row";
      if (!p.isHoliday && p.textClamp === 3) cls += " three-text";
      bar.className = cls;

      bar.style.left = `calc(${p.col * colW}% + ${sidePad}px)`;
      bar.style.width = `calc(${colW}% - ${sideSub}px)`;
      bar.style.top = `${p.row * barRowPx}px`;

      if (!p.isHoliday && p.rows === 2) {
        bar.style.height = `calc((var(--bar-h) * 2) + var(--bar-gap))`;
        bar.style.lineHeight = "12px";
      }

      if (p.isHoliday) {
        bar.style.borderColor = p.isFestival ? "#b91c1c" : "#ef4444";
        bar.style.background = p.isFestival ? "#fecaca" : "#fee2e2";
        bar.style.color = p.isFestival ? "#7f1d1d" : "#991b1b";
        bar.style.fontWeight = "900";
        bar.title = p.tooltip || p.ev?.title || "휴무일";
        bar.addEventListener("click", (e2) => e2.stopPropagation());
      } else {
        applyItemColor(bar, p.ev, "1f");

        bar.addEventListener("click", (e2) => {
          e2.stopPropagation();
          openModal({ dateKey: p.ev.startDate, eventId: p.ev.eventId, event: p.ev });
        });
      }

      bar.textContent = p.display;
      bar.title = (p.ev?.title || "").trim();
      weekBars.appendChild(bar);
    });

    calGrid.appendChild(weekRow);
  }
}

/* =========================
   Save / Delete
========================= */
saveBtn?.addEventListener("click", async () => {
  const startKey = (fDate?.value || editing.dateKey || "").trim();
  if (!startKey) return;

  const endDate = (fEndDate?.value || startKey).trim() || startKey;
  if (endDate < startKey) {
    alert("종료일은 시작일보다 빠를 수 없습니다.");
    return;
  }

  const rawType = (fType?.value || "").trim();
  const normalizedType = mapLegacyType(rawType) || (TYPE_LIST[0] || "작업일정");

  const isAllDay = !!allDayChk?.checked;
  const startVal = isAllDay ? "" : (fStart?.value || "").trim();
  const endVal = isAllDay ? "" : (fEnd?.value || "").trim();
  const selectedColor = normalizeColor(fColor?.value) || "#dbeafe";

  const payload = {
    type: normalizedType,
    title: (fTitle?.value || "").trim(),
    detail: (fDetail?.value || "").trim(),
    owner: selectedName,
    start: startVal,
    end: endVal,
    endDate,
    color: selectedColor,
    updatedAt: serverTimestamp(),
  };

  if (!payload.title) {
    alert("제목은 필수입니다.");
    return;
  }

  try {
    if (editing.eventId) {
      const oldKey = editing.originalDateKey;
      const newKey = startKey;

      const ev = eventsAll?.[oldKey]?.[editing.eventId];
      if (!ev) {
        alert("데이터를 찾을 수 없습니다.");
        return;
      }
      if (ev.owner !== selectedName) {
        alert("작성자 본인만 수정할 수 있습니다.");
        return;
      }

      if (newKey !== oldKey) {
        await set(ref(db, `events/${newKey}/${editing.eventId}`), {
          ...payload,
          createdAt: ev.createdAt || serverTimestamp(),
        });
        await remove(ref(db, `events/${oldKey}/${editing.eventId}`));
      } else {
        await update(ref(db, `events/${oldKey}/${editing.eventId}`), payload);
      }
    } else {
      const newRef = push(ref(db, `events/${startKey}`));
      await set(newRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }

    closeModal();
  } catch (err) {
    console.error(err);
    alert("저장 실패: " + (err?.message || err));
  }
});

deleteBtn?.addEventListener("click", async () => {
  const eventId = editing.eventId;
  const key = editing.originalDateKey;

  if (!key || !eventId) return;

  const ev = eventsAll?.[key]?.[eventId];
  if (!ev) {
    alert("데이터를 찾을 수 없습니다.");
    return;
  }
  if (ev.owner !== selectedName) {
    alert("작성자 본인만 삭제할 수 있습니다.");
    return;
  }
  if (!confirm("삭제하시겠습니까?")) return;

  try {
    await remove(ref(db, `events/${key}/${eventId}`));
    closeModal();
  } catch (err) {
    console.error(err);
    alert("삭제 실패: " + (err?.message || err));
  }
});

/* =========================
   Buttons
========================= */
$("todayBtn")?.addEventListener("click", () => {
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  applyMonthFilterAndRender();
});

/* =========================
   Swipe month
========================= */
(function enableSwipeMonth() {
  const el = document.getElementById("calGrid");
  if (!el) return;

  const THRESHOLD = 60;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let locked = null;

  function goPrev() {
    current = new Date(current.getFullYear(), current.getMonth() - 1, 1);
    applyMonthFilterAndRender();
  }

  function goNext() {
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
    applyMonthFilterAndRender();
  }

  el.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    dragging = true;
    locked = null;
  }, { passive: true });

  el.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (locked === null) locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    if (locked === "h") e.preventDefault();
  }, { passive: false });

  el.addEventListener("touchend", (e) => {
    if (!dragging) return;
    dragging = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (Math.abs(dx) >= THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) goPrev();
      else goNext();
    }
  });

  el.addEventListener("mousedown", (e) => {
    if (e.target.closest(".mbar") || e.target.closest(".sbar")) return;
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    locked = null;
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (locked === null) locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
  });

  window.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (Math.abs(dx) >= THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) goPrev();
      else goNext();
    }
  });
})();

/* =========================
   ✅ 세로/가로 전환 시 레이아웃 재계산
========================= */
(function bindRelayout() {
  let t = null;
  const relayout = () => {
    clearTimeout(t);
    t = setTimeout(() => renderCalendar(), 120);
  };
  window.addEventListener("resize", relayout, { passive: true });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => renderCalendar(), 200);
  }, { passive: true });
})();

/* =========================
   Start
========================= */
subscribeMembers();
subscribeEvents();
subscribeTypes();
subscribeAdminHolidays();

// 초기 렌더
renderMemberButtons();
renderTypeButtons();
renderTypeSelectOptions();
renderCalendar();