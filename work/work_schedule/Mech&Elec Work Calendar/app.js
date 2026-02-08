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

// ✅ 화면/필터에 사용할 최종 분야 3개
let TYPE_LIST = ["근태", "회사일정", "작업일정"]; // 기본값(관리자 설정이 없을 때)


/* =========================
   DOM refs
========================= */
// ✅ 기존 “휴가/작업/공정” 버튼이 들어있던 영역(컨테이너) id가 typeBar 라고 가정
const typeBar   = $("typeBar");

const memberBar = $("memberBar");
const monthTitle= $("monthTitle");
const calGrid   = $("calGrid");

const modalBack = $("modalBack");
const modalTitle= $("modalTitle");
const fDate     = $("fDate");
const fEndDate  = $("fEndDate");
const fType     = $("fType");
const fStart    = $("fStart");
const fEnd      = $("fEnd");
const fOwner    = $("fOwner");
const fTitle    = $("fTitle");
const fDetail   = $("fDetail");
const saveBtn   = $("saveBtn");
const deleteBtn = $("deleteBtn");
const closeBtn  = $("closeBtn");
const editHint  = $("editHint");

/* =========================
   State
========================= */
let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);

let membersAll = [];
let members = [];
let selectedName = localStorage.getItem(LS_NAME) || "";

let eventsAll = {};    // { "YYYY-MM-DD": {eventId: evObj} }
let eventsByDate = {}; // 현재월 startDate 기준 필터

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

    // 관리자가 하나라도 설정해두면 그걸 우선 사용
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
    // 현재 달 다시 렌더(holidayMap merge 포함)
    applyMonthFilterAndRender();
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
   ✅ 기존 버튼 재활용(휴가/작업/공정 버튼)
   - HTML에 이미 3개의 버튼이 있다고 가정하고 텍스트만 바꿔서 씁니다.
   - 만약 버튼이 없으면(0개) 자동으로 3개 만들어서 붙입니다.
========================= */
function getTypeButtons(){
  if(!typeBar) return [];
  // ✅ 기존 버튼이 <button>이라면 이걸로 잡힙니다.
  // 버튼이 a/div이면 selector를 바꾸셔야 합니다.
  return Array.from(typeBar.querySelectorAll("button"));
}

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
   Holidays
========================= */
let holidayMap = {}; // { "YYYY-MM-DD": { localName, name } }
const holidayCache = {}; // { "2026": holidayMap... }

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
        name: h.name || h.localName || "Holiday"
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

// ✅ 색상은 작성자 기준 (분야와 무관)
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

// 멀티(바)용: 9자 이상이면 7자+… (총 8자)
function compactTitleMulti(title){
  const full = (title || "(제목없음)").trim();
  return (full.length >= 9) ? (full.slice(0, 7) + "…") : full;
}

// 싱글(1일)용: 16자까지 / 17자부터 15자+…
function compactTitleSingle(title){
  const full = (title || "(제목없음)").trim();
  return (full.length >= 17) ? (full.slice(0, 15) + "…") : full;
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

    // ✅ 분야 기본값/호환: 기존 데이터가 휴가/작업/공정일 수도 있으니 매핑
    const rawType = (event.type || "").trim();
    const mappedType = mapLegacyType(rawType) || "작업일정";

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

    fType.value  = "작업일정";
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

modalBack.addEventListener("click",(e)=>{ if(e.target===modalBack) closeModal(); });
closeBtn.addEventListener("click", closeModal);

/* =========================
   ✅ 기존 타입(휴가/작업/공정) → 새 타입 매핑
   - 과거 데이터가 섞여 있어도 필터/표시가 되게 해줌
========================= */
function mapLegacyType(t){
  if(!t) return "";
  if(t === "휴가") return "근태";
  if(t === "작업") return "작업일정";
  if(t === "공정") return "회사일정";
  // 이미 새 타입이면 그대로
  if(TYPE_LIST.includes(t)) return t;
  return t; // 알 수 없는 값은 그대로 두되, 필터 선택에 없으면 안 보일 수 있음
}

/* =========================
   Members
========================= */
function renderMemberButtons(){
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

  // ✅ 관리자 휴무일 merge(관리자 등록이 우선)
  for(const [dateKey, h] of Object.entries(adminHolidayMap || {})){
    if(!dateKey) continue;
    holidayMap[dateKey] = {
      localName: (h?.name || "휴무일").trim(),
      name: (h?.name || "Holiday").trim()
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

  // ✅ 필터 적용(과거 타입도 매핑)
  const allEventsNormalized = allEventsRaw.map(ev=>{
    const t = mapLegacyType((ev.type || "").trim()) || "작업일정";
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

      if(dateKey === todayKey) day.classList.add("today");

      const inMonth = (cursor.getMonth() === m);
      if(!inMonth) day.classList.add("muted");

      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();

      const items = document.createElement("div");
      items.className = "day-items";

      // 공휴일 라벨
      const h = holidayMap[dateKey];
      if(h){
        day.classList.add("holiday");
        const badge = document.createElement("div");
        badge.className = "holiday-badge";
        badge.textContent = h.localName || "공휴일";
        items.prepend(badge);
      }

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

    const singleBars = []; // {row, col, ev, twoLine, display}

    for (const ev of allEvents) {
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;
      if (s !== e) continue;

      const col = dateKeys.indexOf(s);
      if (col < 0) continue;

      const full = (ev.title || "(제목없음)").trim();
      const display = compactTitleSingle(full);
      const wantTwoLine = full.length >= 5;

      let row = 0;
      while (true) {
        ensureRow(row);

        if (!occ[row][col]) {
          if (!wantTwoLine) break;

          ensureRow(row + 1);
          if (!occ[row + 1][col]) break;
        }
        row++;
      }

      occ[row][col] = true;
      if (wantTwoLine) {
        ensureRow(row + 1);
        occ[row + 1][col] = true;
      }

      singleBars.push({ row, col, ev, twoLine: wantTwoLine, display });
    }

    // --- weekBars 높이 ---
    const lanesCountFinal = occ.length;
    weekBars.style.height = `${lanesCountFinal * barRowPx}px`;

    // --- day-items 내려주기 ---
    const perDayRows = new Array(7).fill(0);
    for(let r=0; r<occ.length; r++){
      for(let c=0; c<7; c++){
        if(occ[r][c]) perDayRows[c] = Math.max(perDayRows[c], r+1);
      }
    }
    dayEls.forEach((day, i)=>{
      day.style.setProperty("--barSpaceDay", `${perDayRows[i] * barRowPx}px`);
    });

    // --- 멀티바 렌더 ---
    placed.forEach(p=>{
      const { row, sIdx, eIdx, ev } = p;
      const span = (eIdx - sIdx + 1);

      const bar = document.createElement("div");
      bar.className = "mbar";

      const colW = (100/7);
      bar.style.left  = `calc(${sIdx * colW}% + 2px)`;
      bar.style.width = `calc(${span * colW}% - 4px)`;
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
      const { row, col, ev, twoLine, display } = p;

      const bar = document.createElement("div");
      bar.className = "sbar" + (twoLine ? " two-line" : "");

      const colW = (100 / 7);
      bar.style.left  = `calc(${col * colW}% + 2px)`;
      bar.style.width = `calc(${colW}% - 4px)`;
      bar.style.top   = `${row * barRowPx}px`;

      const c = getMemberColor(ev.owner);
      bar.style.borderColor = c;
      bar.style.background  = c + "12";
      bar.style.color       = "#111";

      bar.textContent = display;

      bar.addEventListener("click", (e2) => {
        e2.stopPropagation();
        openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
      });

      weekBars.appendChild(bar);
    });

    calGrid.appendChild(weekRow);
  }
}

/* =========================
   Save / Delete
========================= */
saveBtn.addEventListener("click", async ()=>{
  const dateKey = editing.dateKey;
  if(!dateKey) return;

  const endDate = (fEndDate?.value || dateKey).trim() || dateKey;
  if(endDate < dateKey){
    alert("종료일은 시작일보다 빠를 수 없습니다.");
    return;
  }

  // ✅ 모달에서 넘어오는 타입도 과거값이면 저장 시 새 값으로 정리
  const rawType = (fType.value || "").trim();
  const normalizedType = mapLegacyType(rawType) || "작업일정";

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

deleteBtn.addEventListener("click", async ()=>{
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
