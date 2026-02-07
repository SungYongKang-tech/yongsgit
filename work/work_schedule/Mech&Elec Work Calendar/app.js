import { db } from "./firebase.js";
import {
  ref, onValue, push, set, update, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const LS_NAME = "mecal_selected_name";

let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);

let membersAll = [];
let members = [];
let selectedName = localStorage.getItem(LS_NAME) || "";

let eventsAll = {};    // { "YYYY-MM-DD": {eventId: evObj} }
let eventsByDate = {}; // 현재월 startDate 기준 필터

const $ = (id) => document.getElementById(id);

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

let editing = { dateKey: null, eventId: null };

// -------------------- utils --------------------
function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

// 작성자 이름 → 고정 색상 매핑
function getMemberColor(name){
  const COLOR_MAP = {
    "성용": "#55B7FF", // 하늘색
    "서진": "#FF6FAE", // 분홍
    "무성": "#67D96E"  // 연두
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

// eventsByDate(현재월 필터) → 리스트 평탄화
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

// -------------------- modal --------------------
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
    fType.value = event.type || "작업";
    fStart.value = event.start || "";
    fEnd.value = event.end || "";
    fTitle.value = event.title || "";
    fDetail.value = event.detail || "";
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
    fType.value = "작업";
    fStart.value = "";
    fEnd.value = "";
    fTitle.value = "";
    fDetail.value = "";
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

// -------------------- members --------------------
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
      btn.style.color = "#111";      // 글씨 검정
      btn.style.boxShadow = `0 6px 16px ${color}55`;
    } else {
      btn.style.background = "#fff";
      btn.style.borderColor = color;
      btn.style.color = "#111";      // 글씨 검정
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

// -------------------- events --------------------
function subscribeEvents(){
  onValue(ref(db, "events"), (snap)=>{
    eventsAll = snap.val() || {};
    applyMonthFilterAndRender();
  });
}

function applyMonthFilterAndRender(){
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
  const occ = []; // occ[row] = Array(7).fill(false)

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

  const placed = []; // {row, sIdx, eIdx, ev}

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

// -------------------- render calendar --------------------
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

  const allEvents = toEventList();

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

    // --- 싱글(하루)도 레인 점유표(occ)에 넣어서 "빈칸 맨위" 사용 ---
    function ensureRow(r){
      if(!occ[r]) occ[r] = new Array(7).fill(false);
    }
    function firstFreeRow(col){
      let r = 0;
      while(true){
        ensureRow(r);
        if(!occ[r][col]) return r;
        r++;
      }
    }

    const singleBars = []; // {row, col, ev}
    for(const ev of allEvents){
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;
      if(s !== e) continue; // 하루짜리만

      const col = dateKeys.indexOf(s);
      if(col < 0) continue;

      const row = firstFreeRow(col);
      occ[row][col] = true;
      singleBars.push({ row, col, ev });
    }

    // --- weekBars 높이 = 최종 레인 수(멀티+싱글) ---
    const lanesCountFinal = occ.length;
    weekBars.style.height = `${lanesCountFinal * barRowPx}px`;

    // --- 각 날짜칸: 그 날짜에 바가 있는 레인 수만큼만 day-items를 내리기(있으면) ---
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
      bar.style.color       = "#111"; // 글씨 검정
      bar.textContent = ev.title || "(제목없음)";

      bar.addEventListener("click",(e2)=>{
        e2.stopPropagation();
        openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
      });

      weekBars.appendChild(bar);
    });

    // --- 싱글바(1칸짜리) 렌더: 빈 레인(row0) 있으면 위로 들어감 ---
    singleBars.forEach(p=>{
      const { row, col, ev } = p;

      const bar = document.createElement("div");
      bar.className = "sbar";

      const colW = (100/7);
      bar.style.left  = `calc(${col * colW}% + 2px)`;
      bar.style.width = `calc(${colW}% - 4px)`;
      bar.style.top   = `${row * barRowPx}px`;

      const c = getMemberColor(ev.owner);
      bar.style.borderColor = c;
      bar.style.background  = c + "12";
      bar.style.color       = "#111";
      bar.textContent = ev.title || "(제목없음)";

      bar.addEventListener("click",(e2)=>{
        e2.stopPropagation();
        openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
      });

      weekBars.appendChild(bar);
    });

    calGrid.appendChild(weekRow);
  }
}

// -------------------- save/delete --------------------
saveBtn.addEventListener("click", async ()=>{
  const dateKey = editing.dateKey;
  if(!dateKey) return;

  const endDate = (fEndDate?.value || dateKey).trim() || dateKey;
  if(endDate < dateKey){
    alert("종료일은 시작일보다 빠를 수 없습니다.");
    return;
  }

  const payload = {
    type: fType.value,
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

// -------------------- nav buttons --------------------
$("prevBtn").addEventListener("click", ()=>{
  current = new Date(current.getFullYear(), current.getMonth()-1, 1);
  applyMonthFilterAndRender();
});
$("nextBtn").addEventListener("click", ()=>{
  current = new Date(current.getFullYear(), current.getMonth()+1, 1);
  applyMonthFilterAndRender();
});
$("todayBtn").addEventListener("click", ()=>{
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  applyMonthFilterAndRender();
});

// -------------------- Swipe to change month --------------------
(function enableSwipeMonth(){
  const el = document.getElementById("calGrid");
  if(!el) return;

  const THRESHOLD = 60;
  let startX = 0, startY = 0, dragging = false;
  let locked = null; // null | "h" | "v"

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

// -------------------- start --------------------
subscribeMembers();
subscribeEvents();
renderMemberButtons();
renderCalendar();
