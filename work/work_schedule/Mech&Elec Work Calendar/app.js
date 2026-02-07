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

function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

// 작성자 이름 → 고정 색상 매핑
function getMemberColor(name){

  const COLOR_MAP = {
    "성용": "#55B7FF", // 하늘색
    "서진": "#FF6FAE", // 분홍
    "무성": "#67D96E"  // 연두
  };

  // 등록된 사람이면 해당 색
  if (COLOR_MAP[name]) {
    return COLOR_MAP[name];
  }

  // 혹시 다른 이름 생기면 기본색
  return "#1f6feb";
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
    editHint.textContent = canEdit ? "작성자 본인 일정입니다. 수정/삭제 가능합니다." : "작성자 본인만 수정/삭제할 수 있습니다.";
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
  btn.style.color = "#111";   // ✅ 선택돼도 글씨 검정
  btn.style.boxShadow = `0 6px 16px ${color}55`;
} else {
  btn.style.background = "#fff";
  btn.style.borderColor = color;
  btn.style.color = "#111";   // ✅ 항상 검정
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
    renderCalendar(); // 색상 반영
  });
}

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
  const lanes = []; // lanes[i] = [{sIdx,eIdx,seg}, ...] 형태 대신, 점유표로 관리
  const occ = [];   // occ[i] = Array(7).fill(false)

  function canPlace(row, sIdx, eIdx){
    for(let k=sIdx;k<=eIdx;k++) if(occ[row][k]) return false;
    return true;
  }
  function occupy(row, sIdx, eIdx){
    for(let k=sIdx;k<=eIdx;k++) occ[row][k] = true;
  }

  const placed = []; // {row, sIdx, eIdx, seg}

  for(const seg of segments){
    let row = 0;
    while(true){
      if(!occ[row]){
        occ[row] = new Array(7).fill(false);
      }
      if(canPlace(row, seg.sIdx, seg.eIdx)){
        occupy(row, seg.sIdx, seg.eIdx);
        placed.push({ row, ...seg });
        break;
      }
      row++;
    }
  }

  return { placed, lanesCount: occ.length };
}

function renderCalendar(){
  const y = current.getFullYear();
  const m = current.getMonth();
  monthTitle.textContent = `${y}.${pad2(m+1)}`;

  // 달력 시작(일) ~ 끝(토)
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

  // bar-row px
  const barRowPx = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--bar-row")) || 24;

  let cursor = new Date(start);
  while(cursor <= end){
    const weekRow = document.createElement("div");
    weekRow.className = "week-row";

    // 주 바 레이어
    const weekBars = document.createElement("div");
    weekBars.className = "week-bars";
    weekRow.appendChild(weekBars);

    // 7일 칸
    const dayEls = [];
    const dateKeys = [];
    for(let i=0;i<7;i++){
      const dateKey = ymd(cursor);
      dateKeys.push(dateKey);

      const day = document.createElement("div");
      day.className = "day";

      const inMonth = (cursor.getMonth() === m);
      if(!inMonth) day.classList.add("muted");

      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();

      const items = document.createElement("div");
      items.className = "day-items";

      day.appendChild(num);
      day.appendChild(items);

      // 날짜 클릭 → 추가
      day.addEventListener("click", (e)=>{
        if(e.target.closest(".mbar")) return;
        if(e.target.closest(".day-item")) return;
        openModal({ dateKey });
      });

      weekRow.appendChild(day);
      dayEls.push(day);

      cursor.setDate(cursor.getDate()+1);
    }

    // ===== (1) 하루짜리 이벤트 (start==end) 각 날짜 칸 안 표시
    for(const ev of allEvents){
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;
      if(s !== e) continue; // 하루짜리만

      const idx = dateKeys.indexOf(s);
      if(idx < 0) continue;

      const items = dayEls[idx].querySelector(".day-items");
      const item = document.createElement("div");
      item.className = "day-item";
      item.textContent = ev.title || "(제목없음)";

      const c = getMemberColor(ev.owner);
      item.style.borderColor = c;
item.style.background = c + "12";
item.style.color = "#111";  // ✅ 글씨 검정 고정

      item.addEventListener("click",(e2)=>{
        e2.stopPropagation();
        openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
      });

      items.appendChild(item);
    }

    // ===== (2) 멀티데이 이벤트 (start<end) → 주 단위로 잘라서 bar로 스팬 표시
    // 주 범위
    const weekStartKey = dateKeys[0];
    const weekEndKey = dateKeys[6];

    const segments = [];
    for(const ev of allEvents){
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;
      if(s === e) continue; // 멀티만

      // 이번 주와 겹치지 않으면 skip
      if(e < weekStartKey || s > weekEndKey) continue;

      const segStart = (s < weekStartKey) ? weekStartKey : s;
      const segEnd = (e > weekEndKey) ? weekEndKey : e;

      const sIdx = dateKeys.indexOf(segStart);
      const eIdx = dateKeys.indexOf(segEnd);
      if(sIdx < 0 || eIdx < 0) continue;

      segments.push({ sIdx, eIdx, ev });
    }

    // 시작 빠른 순 정렬(겹침 레인 배치 안정)
    segments.sort((a,b)=>{
      if(a.sIdx !== b.sIdx) return a.sIdx - b.sIdx;
      return a.eIdx - b.eIdx;
    });

    const { placed, lanesCount } = placeInLanes(segments);

    // ✅ 이 주에 멀티바가 있으면 그 줄수만큼만 공간 확보
    const barSpace = lanesCount ? (lanesCount * barRowPx) : 0;
    dayEls.forEach(day => day.style.setProperty("--barSpace", `${barSpace}px`));
    weekBars.style.setProperty("--barSpace", `${barSpace}px`);

    // 바 생성 (absolute)
    // left/width는 7칸 기준 퍼센트로 계산
    placed.forEach(p=>{
      const { row, sIdx, eIdx, ev } = p;
      const span = (eIdx - sIdx + 1);

      const bar = document.createElement("div");
      bar.className = "mbar";

      // grid 기준: 7칸 → 100% / 7
      const colW = (100 / 7);
      bar.style.left = `calc(${sIdx * colW}% + 2px)`;
bar.style.width = `calc(${span * colW}% - 4px)`;

      bar.style.top = `${row * barRowPx}px`;

      const c = getMemberColor(ev.owner);
      bar.style.borderColor = c;
bar.style.background = c + "18";
bar.style.color = "#111";   // ✅ 글씨 검정 고정

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

/* ===== 저장/삭제 ===== */
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

/* ===== 네비게이션 ===== */
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


// ==================== Swipe to change month (mobile + desktop drag) ====================
(function enableSwipeMonth(){
  const el = document.getElementById("calGrid"); // 캘린더 전체 영역
  if(!el) return;

  // 스와이프 기준(가로 이동 px)
  const THRESHOLD = 60;

  let startX = 0;
  let startY = 0;
  let dragging = false;

  // 모바일 스크롤(세로)과 충돌 방지용
  let locked = null; // null | "h" | "v"

  function goPrev(){
    current = new Date(current.getFullYear(), current.getMonth()-1, 1);
    applyMonthFilterAndRender();
  }
  function goNext(){
    current = new Date(current.getFullYear(), current.getMonth()+1, 1);
    applyMonthFilterAndRender();
  }

  // --- Touch events ---
  el.addEventListener("touchstart", (e)=>{
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    dragging = true;
    locked = null;
  }, { passive: true });

  el.addEventListener("touchmove", (e)=>{
    if(!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    // 방향 잠금(처음 움직임 방향 기준)
    if(locked === null){
      locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }

    // 가로 스와이프면 세로 스크롤 방지
    if(locked === "h"){
      e.preventDefault();
    }
  }, { passive: false });

  el.addEventListener("touchend", (e)=>{
    if(!dragging) return;
    dragging = false;

    // 터치 종료 시 마지막 이동량 계산
    // touchend에는 touches가 비어있을 수 있어 changedTouches 사용
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if(Math.abs(dx) >= THRESHOLD && Math.abs(dx) > Math.abs(dy)){
      if(dx > 0) goPrev();  // 오른쪽으로 밀기 = 이전달
      else goNext();        // 왼쪽으로 밀기 = 다음달
    }
  });

  // --- Mouse drag (optional, for PC) ---
  el.addEventListener("mousedown", (e)=>{
    // 일정 클릭/드래그와 충돌 방지: 바/아이템/모달 트리거는 제외
    if(e.target.closest(".mbar") || e.target.closest(".day-item")) return;

    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    locked = null;
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


/* ===== start ===== */
subscribeMembers();
subscribeEvents();
renderMemberButtons();
renderCalendar();
