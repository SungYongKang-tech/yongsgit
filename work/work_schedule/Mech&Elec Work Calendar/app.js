import { db } from "./firebase.js";
import {
  ref, onValue, push, set, update, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/* =========================
   DOM helper (✅ 반드시 최상단)
========================= */
const $ = (id) => document.getElementById(id);

/* =========================
   LocalStorage keys / Types
========================= */
const LS_NAME  = "mecal_selected_name";
const LS_TYPES = "mecal_selected_types";

// ✅ 화면/필터에 사용할 최종 분야(관리자 설정 우선)
let TYPE_LIST = ["근태", "회사일정", "작업일정"]; // 기본값(관리자 설정이 없을 때)

/* =========================
   DOM refs
========================= */
const typeBar    = $("typeBar");
const memberBar  = $("memberBar");
const monthTitle = $("monthTitle");
const calGrid    = $("calGrid");

const modalBack  = $("modalBack");
const modalTitle = $("modalTitle");
const fDate      = $("fDate");
const fEndDate   = $("fEndDate");
const fType      = $("fType");
const fStart     = $("fStart");
const fEnd       = $("fEnd");
const fOwner     = $("fOwner");
const fTitle     = $("fTitle");
const fDetail    = $("fDetail");
const saveBtn    = $("saveBtn");
const deleteBtn  = $("deleteBtn");
const closeBtn   = $("closeBtn");
const editHint   = $("editHint");

/* =========================
   State
========================= */
let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);

let membersAll = [];
let members = [];
let selectedName = localStorage.getItem(LS_NAME) || "";

let eventsAll = {};     // { "YYYY-MM-DD": {eventId: evObj} }
let eventsByDate = {};  // 현재월 startDate 기준 필터

let editing = { dateKey: null, eventId: null };

/* =========================
   ✅ Types from Admin (config/types)
========================= */
let typesFromAdmin = []; // ["근태","회사일정",...]

function subscribeTypes(){
  onValue(ref(db, "config/types"), (snap)=>{
    const obj = snap.val() || {};
    const list = Object.entries(obj)
      .map(([id,v])=>({ id, ...v }))
      .filter(x => x.active !== false)
      .sort((a,b)=>(a.order ?? 999)-(b.order ?? 999))
      .map(x => (x.name || "").trim())
      .filter(Boolean);

    typesFromAdmin = list;
    if(typesFromAdmin.length){
      TYPE_LIST = typesFromAdmin;
    } else {
      TYPE_LIST = ["근태", "회사일정", "작업일정"];
    }

    // ✅ 선택된 타입 중 삭제된 것 정리
    selectedTypes = new Set([...selectedTypes].filter(t => TYPE_LIST.includes(t)));
    saveSelectedTypes();

    renderTypeButtons();
    renderCalendar();
  });
}

/* =========================
   ✅ Admin Holidays (config/holidays)
========================= */
let adminHolidayMap = {}; // { "YYYY-MM-DD": {name, note} }

function subscribeAdminHolidays(){
  onValue(ref(db, "config/holidays"), (snap)=>{
    adminHolidayMap = snap.val() || {};
    applyMonthFilterAndRender(); // holidayMap merge 포함
  });
}

/* =========================
   Selected Types (필터)
   - 0개면 전체 표시
========================= */
function loadSelectedTypes(){
  try{
    const raw = localStorage.getItem(LS_TYPES);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  }catch{
    return new Set();
  }
}
let selectedTypes = loadSelectedTypes();

function saveSelectedTypes(){
  localStorage.setItem(LS_TYPES, JSON.stringify([...selectedTypes]));
}

/* =========================
   Type Buttons
========================= */
function renderTypeButtons(){
  if(!typeBar) return;

  typeBar.innerHTML = "";
  TYPE_LIST.forEach(type=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "type-btn" + (selectedTypes.has(type) ? " active" : "");
    btn.textContent = type;

    btn.onclick = ()=>{
      if(selectedTypes.has(type)) selectedTypes.delete(type);
      else selectedTypes.add(type);

      saveSelectedTypes();
      renderTypeButtons();
      renderCalendar();
    };

    typeBar.appendChild(btn);
  });
}

/* =========================
   Holidays (API + Admin merge)
========================= */
let holidayMap = {};          // { "YYYY-MM-DD": { localName, name, note, source } }
const holidayCache = {};      // { "2026": holidayMap... }

async function loadKoreanHolidays(year){
  if(holidayCache[year]) {
    holidayMap = holidayCache[year];
    return;
  }

  const url = `https://date.nager.at/api/v3/publicholidays/${year}/KR`;

  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error(`holiday fetch failed: ${res.status}`);
    const arr = await res.json();

    const map = {};
    for(const h of (arr || [])){
      if(!h?.date) continue;
      map[h.date] = {
        localName: h.localName || h.name || "공휴일",
        name: h.name || h.localName || "Holiday",
        note: "",
        source: "api"
      };
    }
    holidayMap = map;
    holidayCache[year] = map;
  }catch(e){
    console.warn("공휴일 로드 실패:", e);
    holidayMap = {};
  }
}

/* =========================
   Utils
========================= */
function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

function isMobileNow(){
  return window.matchMedia("(max-width: 640px)").matches;
}

/* ✅ 모바일에서 칸 안 좌우 여백을 더 확보하기 위한 left/width inset */
function getBarInsetPx(){
  // 기존: +2px / -4px
  // 모바일: +1px / -2px (더 넓게)
  return isMobileNow() ? { sidePad: 1, sideSub: 2 } : { sidePad: 2, sideSub: 4 };
}

function getMemberColor(name){
  const COLOR_MAP = {
    "성용": "#55B7FF",
    "서진": "#FF6FAE",
    "무성": "#67D96E"
  };
  return COLOR_MAP[name] || "#1f6feb";
}

function monthRangeKeys(){
  const start = new Date(current);
  start.setDate(1);
  const end = new Date(current);
  end.setMonth(end.getMonth()+1);
  end.setDate(0);
  return { startKey: ymd(start), endKey: ymd(end) };
}

function toEventList(){
  const list = [];
  Object.entries(eventsByDate || {}).forEach(([startDate, objs])=>{
    Object.entries(objs || {}).forEach(([eventId, ev])=>{
      const s = startDate;
      const e = ev.endDate || startDate;
      list.push({ ...ev, eventId, startDate: s, endDate: e });
    });
  });
  return list;
}

function compactTitleMulti(title){
  const full = (title || "(제목없음)").trim();
  return (full.length >= 9) ? (full.slice(0, 7) + "…") : full;
}

// ✅ PC(기본) 싱글 표시용: 16자까지 / 17자부터 15자+…
function compactTitleSingle(title){
  const full = (title || "(제목없음)").trim();
  return (full.length >= 17) ? (full.slice(0, 15) + "…") : full;
}

/* =========================
   Legacy Type Mapping
========================= */
function mapLegacyType(t){
  if(!t) return "";
  if(t === "휴가") return "근태";
  if(t === "작업") return "작업일정";
  if(t === "공정") return "회사일정";
  if(TYPE_LIST.includes(t)) return t;
  return t;
}

/* =========================
   ✅ 모바일 싱글바 규칙 (핵심)
   - 레인 점유는 최대 2칸(rows:1~2)
   - 글씨 줄수는 최대 3줄(textClamp:1~3)
   - 모바일:
     * 5~15자: 2레인 + 2줄
     * 16자 이상: 2레인 + 3줄 + 15자+…
========================= */
function getSingleBarRule(title){
  const full = (title || "(제목없음)").trim();
  const isMobile = isMobileNow();

  if(isMobile){
    // ✅ 9자 이상이면: 2레인 + 3줄 + 8자+… (마지막에 … 보장)
    if(full.length >= 9){
      return { rows: 2, textClamp: 3, display: full.slice(0, 8) + "…" };
    }
    // ✅ 5~8자: 2레인 + 2줄 (그대로)
    if(full.length >= 5){
      return { rows: 2, textClamp: 2, display: full };
    }
    // ✅ 1~4자: 1레인 + 1줄
    return { rows: 1, textClamp: 1, display: full };
  }

  // PC는 기존 유지
  const wantTwo = full.length >= 12;
  return {
    rows: wantTwo ? 2 : 1,
    textClamp: wantTwo ? 2 : 1,
    display: compactTitleSingle(full)
  };
}

/* =========================
   Modal
========================= */
function openModal({dateKey, eventId=null, event=null}){
  if(!selectedName){
    alert("상단에서 이름을 먼저 선택해 주세요.");
    return;
  }

  editing = { dateKey, eventId };
  modalBack.classList.add("show");

  fDate.value = dateKey;
  fOwner.value = selectedName;
  if (fEndDate) fEndDate.value = dateKey;

  if(event){
    modalTitle.textContent = "일정 수정";

    const rawType = (event.type || "").trim();
    const mappedType = mapLegacyType(rawType) || TYPE_LIST[0] || "작업일정";

    fType.value  = mappedType;
    fStart.value = event.start || "";
    fEnd.value   = event.end || "";
    fTitle.value = event.title || "";
    fDetail.value= event.detail || "";
    if (fEndDate) fEndDate.value = (event.endDate || dateKey);
    fOwner.value = event.owner || selectedName;

    const canEdit = (event.owner === selectedName);
    saveBtn.disabled = !canEdit;
    deleteBtn.style.display = canEdit ? "inline-block" : "none";
    editHint.textContent = canEdit
      ? "작성자 본인 일정입니다. 수정/삭제 가능합니다."
      : "작성자 본인만 수정/삭제할 수 있습니다.";
  }else{
    modalTitle.textContent = "일정 입력";

    fType.value  = TYPE_LIST[0] || "작업일정";
    fStart.value = "";
    fEnd.value   = "";
    fTitle.value = "";
    fDetail.value= "";

    saveBtn.disabled = false;
    deleteBtn.style.display = "none";
    editHint.textContent = "";
  }
}

function closeModal(){
  modalBack.classList.remove("show");
  editing = { dateKey:null, eventId:null };
}

modalBack?.addEventListener("click",(e)=>{ if(e.target===modalBack) closeModal(); });
closeBtn?.addEventListener("click", closeModal);

/* =========================
   Members
========================= */
function renderMemberButtons(){
  if(!memberBar) return;
  memberBar.innerHTML = "";

  members.forEach(m=>{
    const btn = document.createElement("button");
    btn.className = "member-btn" + (m.name === selectedName ? " active" : "");
    btn.textContent = m.name;

    const color = getMemberColor(m.name);

    if(m.name === selectedName){
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

    btn.onclick = ()=>{
      selectedName = m.name;
      localStorage.setItem(LS_NAME, selectedName);
      renderMemberButtons();
    };

    memberBar.appendChild(btn);
  });

  if(!selectedName && members.length){
    selectedName = members[0].name;
    localStorage.setItem(LS_NAME, selectedName);
    renderMemberButtons();
  }
}

function subscribeMembers(){
  onValue(ref(db, "config/members"), (snap)=>{
    const obj = snap.val() || {};
    const list = Object.entries(obj).map(([id,v])=>({ id, ...v }));
    list.sort((a,b)=>(a.order ?? 999) - (b.order ?? 999));
    membersAll = list;
    members = list.filter(x => x.active !== false);

    if(selectedName && !members.some(m=>m.name===selectedName)){
      selectedName = members[0]?.name || "";
      localStorage.setItem(LS_NAME, selectedName);
    }

    renderMemberButtons();
    renderCalendar();
  });
}

/* =========================
   Events
========================= */
function subscribeEvents(){
  onValue(ref(db, "events"), (snap)=>{
    eventsAll = snap.val() || {};
    applyMonthFilterAndRender();
  });
}

async function applyMonthFilterAndRender(){
  await loadKoreanHolidays(current.getFullYear());

  // ✅ 관리자 휴무일 merge (우선 적용)
  for(const [dateKey, h] of Object.entries(adminHolidayMap || {})){
    if(!dateKey) continue;
    holidayMap[dateKey] = {
      localName: (h?.name || "휴무일").trim(),
      name: (h?.name || "Holiday").trim(),
      note: (h?.note || "").trim(),
      source: "admin"
    };
  }

  const { startKey, endKey } = monthRangeKeys();
  eventsByDate = {};
  Object.keys(eventsAll).forEach(dateKey=>{
    if(dateKey >= startKey && dateKey <= endKey){
      eventsByDate[dateKey] = eventsAll[dateKey];
    }
  });

  renderCalendar();
}

/* ===== 멀티바 레인 배치(겹침 방지) ===== */
function placeInLanes(segments){
  const occ = [];

  function ensureRow(row){
    if(!occ[row]) occ[row] = new Array(7).fill(false);
  }
  function canPlace(row, sIdx, eIdx){
    ensureRow(row);
    for(let k=sIdx;k<=eIdx;k++) if(occ[row][k]) return false;
    return true;
  }
  function occupy(row, sIdx, eIdx){
    ensureRow(row);
    for(let k=sIdx;k<=eIdx;k++) occ[row][k] = true;
  }

  const placed = [];
  for(const seg of segments){
    let row = 0;
    while(true){
      if(canPlace(row, seg.sIdx, seg.eIdx)){
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
function renderCalendar(){
  if(!calGrid || !monthTitle) return;

  const y = current.getFullYear();
  const m = current.getMonth();
  monthTitle.textContent = `${y}.${pad2(m+1)}`;

  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  const last = new Date(y, m+1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));

  const allEventsRaw = toEventList();

  // ✅ 타입 정규화(과거 타입 매핑)
  const allEventsNormalized = allEventsRaw.map(ev=>{
    const t = mapLegacyType((ev.type || "").trim()) || (TYPE_LIST[0] || "작업일정");
    return { ...ev, type: t };
  });

  // ✅ 선택 0개면 전체, 있으면 선택된 것만
  const allEvents = (selectedTypes.size === 0)
    ? allEventsNormalized
    : allEventsNormalized.filter(ev => selectedTypes.has(ev.type));

  calGrid.innerHTML = "";

  // 요일 헤더
  const dow = document.createElement("div");
  dow.className = "dow";
  ["일","월","화","수","목","금","토"].forEach(d=>{
    const el = document.createElement("div");
    el.textContent = d;
    dow.appendChild(el);
  });
  calGrid.appendChild(dow);

  const barRowPx = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bar-row")) || 24;
  const todayKey = ymd(new Date());

  let cursor = new Date(start);
  while(cursor <= end){
    const weekRow = document.createElement("div");
    weekRow.className = "week-row";

    const weekBars = document.createElement("div");
    weekBars.className = "week-bars";
    weekRow.appendChild(weekBars);

    const dayEls = [];
    const dateKeys = [];

    // 7일 칸 생성
    for(let i=0;i<7;i++){
      const dateKey = ymd(cursor);
      dateKeys.push(dateKey);

      const day = document.createElement("div");
      day.className = "day";
      day.classList.add(`dow-${i}`);

      // ✅ 공휴일 날짜 숫자도 색 반영
      if(holidayMap[dateKey]) day.classList.add("holiday");

      if(dateKey === todayKey) day.classList.add("today");

      const inMonth = (cursor.getMonth() === m);
      if(!inMonth) day.classList.add("muted");

      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();

      const items = document.createElement("div");
      items.className = "day-items";

      day.appendChild(num);
      day.appendChild(items);

      day.addEventListener("click", (e)=>{
        if(e.target.closest(".mbar") || e.target.closest(".sbar")) return;
        openModal({ dateKey });
      });

      weekRow.appendChild(day);
      dayEls.push(day);

      cursor.setDate(cursor.getDate()+1);
    }

    // --- 멀티데이 세그먼트 만들기 ---
    const weekStartKey = dateKeys[0];
    const weekEndKey = dateKeys[6];

    const segments = [];
    for(const ev of allEvents){
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;
      if(s === e) continue; // 멀티만

      if(e < weekStartKey || s > weekEndKey) continue;

      const segStart = (s < weekStartKey) ? weekStartKey : s;
      const segEnd   = (e > weekEndKey)   ? weekEndKey   : e;

      const sIdx = dateKeys.indexOf(segStart);
      const eIdx = dateKeys.indexOf(segEnd);
      if(sIdx < 0 || eIdx < 0) continue;

      segments.push({ sIdx, eIdx, ev });
    }

    segments.sort((a,b)=>{
      if(a.sIdx !== b.sIdx) return a.sIdx - b.sIdx;
      return a.eIdx - b.eIdx;
    });

    const { placed, occ } = placeInLanes(segments);

    // --- 싱글(하루) 레인 점유 ---
    function ensureRow(r){
      if(!occ[r]) occ[r] = new Array(7).fill(false);
    }

    const singleBars = [];

    // ✅ 1) 기존 일정(하루짜리)
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
        isHoliday: false
      });
    }

    // ✅ 2) 휴무일/명절 (1칸 점유 + 툴팁만, 클릭 금지)
    for(let i=0;i<7;i++){
      const dateKey = dateKeys[i];
      const h = holidayMap[dateKey];
      if(!h) continue;

      const title = (h.localName || "휴무일").trim();
      const tooltip = (h.note ? `${title} - ${h.note}` : title);

      const isFestival = /설날|추석/.test(title) || /연휴/.test(title);
      const display = compactTitleSingle(title);

      let row = 0;
      while(true){
        ensureRow(row);
        if(!occ[row][i]) break;
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
        tooltip
      });
    }

    // --- weekBars 높이 ---
    const lanesCountFinal = occ.length;
    weekBars.style.height = `${lanesCountFinal * barRowPx}px`;

    // --- day-items 내려주기 (여백) ---
    const perDayRows = new Array(7).fill(0);
    for(let r=0; r<occ.length; r++){
      for(let c=0; c<7; c++){
        if(occ[r][c]) perDayRows[c] = Math.max(perDayRows[c], r+1);
      }
    }
    dayEls.forEach((day, i)=>{
      day.style.setProperty("--barSpaceDay", `${perDayRows[i] * barRowPx}px`);
    });

    const { sidePad, sideSub } = getBarInsetPx();
    const colW = (100/7);

    // --- 멀티바 렌더 ---
    placed.forEach(p=>{
      const { row, sIdx, eIdx, ev } = p;
      const span = (eIdx - sIdx + 1);

      const bar = document.createElement("div");
      bar.className = "mbar";

      bar.style.left  = `calc(${sIdx * colW}% + ${sidePad}px)`;
      bar.style.width = `calc(${span * colW}% - ${sideSub}px)`;
      bar.style.top   = `${row * barRowPx}px`;

      const c = getMemberColor(ev.owner);
      bar.style.borderColor = c;
      bar.style.background  = c + "18";
      bar.style.color       = "#111";

      bar.textContent = compactTitleMulti(ev.title || "(제목없음)");

      bar.addEventListener("click",(e2)=>{
        e2.stopPropagation();
        openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
      });

      weekBars.appendChild(bar);
    });

    // --- 싱글바 렌더 ---
    singleBars.forEach(p => {
      const bar = document.createElement("div");

      let cls = "sbar";
      if(!p.isHoliday && p.rows === 2) cls += " two-row";
      if(!p.isHoliday && p.textClamp === 2) cls += " two-text";
      if(!p.isHoliday && p.textClamp === 3) cls += " three-text";
      bar.className = cls;

      bar.style.left  = `calc(${p.col * colW}% + ${sidePad}px)`;
      bar.style.width = `calc(${colW}% - ${sideSub}px)`;
      bar.style.top   = `${p.row * barRowPx}px`;

      if(p.isHoliday){
        bar.style.borderColor = p.isFestival ? "#b91c1c" : "#ef4444";
        bar.style.background  = p.isFestival ? "#fecaca" : "#fee2e2";
        bar.style.color       = p.isFestival ? "#7f1d1d" : "#991b1b";
        bar.style.fontWeight  = "900";

        bar.title = p.tooltip || p.ev?.title || "휴무일";
        bar.addEventListener("click", (e2) => e2.stopPropagation());
      } else {
        const c = getMemberColor(p.ev.owner);
        bar.style.borderColor = c;
        bar.style.background  = c + "12";
        bar.style.color       = "#111";

        bar.addEventListener("click", (e2) => {
          e2.stopPropagation();
          openModal({ dateKey: p.ev.startDate, eventId: p.ev.eventId, event: p.ev });
        });
      }

      bar.textContent = p.display;
      weekBars.appendChild(bar);
    });

    calGrid.appendChild(weekRow);
  }
}

/* =========================
   Save / Delete
========================= */
saveBtn?.addEventListener("click", async ()=>{
  const dateKey = editing.dateKey;
  if(!dateKey) return;

  const endDate = (fEndDate?.value || dateKey).trim() || dateKey;
  if(endDate < dateKey){
    alert("종료일은 시작일보다 빠를 수 없습니다.");
    return;
  }

  const rawType = (fType.value || "").trim();
  const normalizedType = mapLegacyType(rawType) || (TYPE_LIST[0] || "작업일정");

  const payload = {
    type: normalizedType,
    title: (fTitle.value || "").trim(),
    detail: (fDetail.value || "").trim(),
    owner: selectedName,
    start: (fStart.value || "").trim(),
    end: (fEnd.value || "").trim(),
    endDate,
    createdAt: serverTimestamp()
  };

  if(!payload.title){
    alert("제목은 필수입니다.");
    return;
  }

  try{
    if(editing.eventId){
      const ev = eventsByDate?.[dateKey]?.[editing.eventId];
      if(!ev){
        alert("데이터를 찾을 수 없습니다.");
        return;
      }
      if(ev.owner !== selectedName){
        alert("작성자 본인만 수정할 수 있습니다.");
        return;
      }
      await update(ref(db, `events/${dateKey}/${editing.eventId}`), payload);
    }else{
      const newRef = push(ref(db, `events/${dateKey}`));
      await set(newRef, payload);
    }
    closeModal();
  }catch(err){
    console.error(err);
    alert("저장 실패: " + (err?.message || err));
  }
});

deleteBtn?.addEventListener("click", async ()=>{
  const { dateKey, eventId } = editing;
  if(!dateKey || !eventId) return;

  const ev = eventsByDate?.[dateKey]?.[eventId];
  if(!ev){
    alert("데이터를 찾을 수 없습니다.");
    return;
  }
  if(ev.owner !== selectedName){
    alert("작성자 본인만 삭제할 수 있습니다.");
    return;
  }
  if(!confirm("삭제하시겠습니까?")) return;

  try{
    await remove(ref(db, `events/${dateKey}/${eventId}`));
    closeModal();
  }catch(err){
    console.error(err);
    alert("삭제 실패: " + (err?.message || err));
  }
});

/* =========================
   Buttons
========================= */
$("todayBtn")?.addEventListener("click", ()=>{
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  applyMonthFilterAndRender();
});

/* =========================
   Swipe month
========================= */
(function enableSwipeMonth(){
  const el = document.getElementById("calGrid");
  if(!el) return;

  const THRESHOLD = 60;
  let startX = 0, startY = 0, dragging = false;
  let locked = null;

  function goPrev(){
    current = new Date(current.getFullYear(), current.getMonth()-1, 1);
    applyMonthFilterAndRender();
  }
  function goNext(){
    current = new Date(current.getFullYear(), current.getMonth()+1, 1);
    applyMonthFilterAndRender();
  }

  el.addEventListener("touchstart", (e)=>{
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    dragging = true; locked = null;
  }, { passive:true });

  el.addEventListener("touchmove", (e)=>{
    if(!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if(locked === null){
      locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if(locked === "h") e.preventDefault();
  }, { passive:false });

  el.addEventListener("touchend", (e)=>{
    if(!dragging) return;
    dragging = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if(Math.abs(dx) >= THRESHOLD && Math.abs(dx) > Math.abs(dy)){
      if(dx > 0) goPrev();
      else goNext();
    }
  });

  el.addEventListener("mousedown", (e)=>{
    if(e.target.closest(".mbar") || e.target.closest(".sbar")) return;
    startX = e.clientX; startY = e.clientY;
    dragging = true; locked = null;
  });

  window.addEventListener("mousemove", (e)=>{
    if(!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if(locked === null){
      locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
  });

  window.addEventListener("mouseup", (e)=>{
    if(!dragging) return;
    dragging = false;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if(Math.abs(dx) >= THRESHOLD && Math.abs(dx) > Math.abs(dy)){
      if(dx > 0) goPrev();
      else goNext();
    }
  });
})();

/* =========================
   Start
========================= */
subscribeMembers();
subscribeEvents();
subscribeTypes();
subscribeAdminHolidays();

renderMemberButtons();
renderTypeButtons();
renderCalendar();
