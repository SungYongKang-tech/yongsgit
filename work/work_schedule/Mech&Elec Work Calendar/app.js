import { db } from "./firebase.js";
import {
  ref, onValue, push, set, update, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const LS_NAME = "mecal_selected_name";

let current = new Date();
current.setDate(1);

let members = [];            // active members only
let membersAll = [];         // includes inactive
let selectedName = localStorage.getItem(LS_NAME) || "";

let eventsByDate = {};       // { "YYYY-MM-DD": {eventId: eventObj} }

const $ = (id) => document.getElementById(id);

const memberBar = $("memberBar");
const selectedNameView = document.getElementById("selectedNameView"); // 없을 수도 있음

const monthTitle = $("monthTitle");
const calTable = $("calTable");

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
function ymd(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
// 작성자 이름 → 색상 찾기
function getMemberColor(name){
  const m = membersAll.find(x => x.name === name);
  return m?.color || "#1f6feb";
}

// ✅ eventsByDate(현재월의 시작일키 구조) → 이벤트 리스트로 평탄화
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

// ✅ 주 시작(일)~주 끝(토) 범위의 YYYY-MM-DD 배열
function weekDates(weekStartDateObj) {
  const arr = [];
  const d = new Date(weekStartDateObj);
  for (let i=0;i<7;i++){
    arr.push(ymd(d));
    d.setDate(d.getDate()+1);
  }
  return arr;
}

// ✅ 한 이벤트를 "해당 주 범위"에 맞춰 segStart~segEnd로 잘라 반환
function splitIntoWeekSegments(ev, weekStartKey, weekEndKey) {
  const s = ev.startDate;
  const e = ev.endDate;
  if (e < weekStartKey || s > weekEndKey) return null;

  const segStart = (s < weekStartKey) ? weekStartKey : s;
  const segEnd   = (e > weekEndKey)   ? weekEndKey   : e;

  return { ...ev, segStart, segEnd };
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

  // 종료일 기본값 = 시작일
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
  } else {
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
  editing = { dateKey: null, eventId: null };
}

modalBack.addEventListener("click", (e)=>{ if(e.target === modalBack) closeModal(); });
closeBtn.addEventListener("click", closeModal);

function renderMemberButtons(){
  memberBar.innerHTML = "";
  if(selectedNameView) selectedNameView.textContent = selectedName || "-";

  members.forEach(m=>{
    const btn = document.createElement("button");
    btn.className = "member-btn" + (m.name === selectedName ? " active" : "");
    btn.textContent = m.name;
    const color = m.color || "#1f6feb";

btn.style.borderColor = color;

if(m.name === selectedName){
  btn.style.background = color;
  btn.style.color = "#fff";
  btn.style.boxShadow = `0 6px 16px ${color}55`;
}else{
  btn.style.background = "#fff";
  btn.style.color = "#1f2330";
}

    if(m.name === selectedName){
      btn.style.background = "linear-gradient(180deg, #fff, #f7f8ff)";
      btn.style.boxShadow = `0 10px 24px rgba(0,0,0,.08)`;
    }
    btn.onclick = ()=>{
      selectedName = m.name;
      localStorage.setItem(LS_NAME, selectedName);
      renderMemberButtons();
      if(selectedNameView) selectedNameView.textContent = selectedName;
    };
    memberBar.appendChild(btn);
  });

  // 선택된 이름이 목록에 없으면 자동으로 첫 활성 멤버로
  if(!selectedName && members.length){
    selectedName = members[0].name;
    localStorage.setItem(LS_NAME, selectedName);
    if(selectedNameView) selectedNameView.textContent = selectedName;
    renderMemberButtons();
  }
}

function monthRangeKeys(){
  const start = new Date(current);
  start.setDate(1);
  const end = new Date(current);
  end.setMonth(end.getMonth()+1);
  end.setDate(0); // last day
  return { startKey: ymd(start), endKey: ymd(end) };
}

function renderCalendar(){
  const y = current.getFullYear();
  const m = current.getMonth();
  monthTitle.textContent = `${y}.${pad2(m+1)}`;

  // calendar grid start (Sun)
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  const last = new Date(y, m+1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - last.getDay()));

  const days = ["일","월","화","수","목","금","토"];
  calTable.innerHTML = "";

  // thead
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  days.forEach(d=>{
    const th = document.createElement("th");
    th.textContent = d;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  calTable.appendChild(thead);

  const tbody = document.createElement("tbody");

  const allEvents = toEventList(); // {startDate,endDate,eventId,...}

  let cursor = new Date(start);
  while(cursor <= end){
    const weekStart = new Date(cursor); // 이번 주 일요일
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate()+6);

    const weekStartKey = ymd(weekStart);
    const weekEndKey = ymd(weekEnd);
    const wdays = weekDates(weekStart);

    const tr = document.createElement("tr");

    // ✅ 7칸 생성
    const tds = [];
    for(let i=0;i<7;i++){
      const td = document.createElement("td");
      const inMonth = (cursor.getMonth() === m);
      if(!inMonth) td.classList.add("day-muted");

      const dateKey = ymd(cursor);

      // td 내부 컨테이너
      const cell = document.createElement("div");
      cell.className = "day-cell";

      // 날짜 상단
      const top = document.createElement("div");
      top.className = "day-top";
      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();
      top.appendChild(num);

      // 하루짜리 일정 표시 영역
      const items = document.createElement("div");
      items.className = "day-items";
      items.dataset.dateKey = dateKey;

      cell.appendChild(top);
      cell.appendChild(items);
      td.appendChild(cell);

      // 날짜 클릭 → 추가
      td.addEventListener("click", (e)=>{
        if(e.target.closest(".mbar")) return;    // 바 클릭은 바에서 처리
        if(e.target.closest(".day-item")) return; // day-item 클릭은 item에서 처리
        openModal({ dateKey });
      });

      tr.appendChild(td);
      tds.push(td);

      cursor.setDate(cursor.getDate()+1);
    }

    // ✅ (1) 하루짜리 일정: 해당 날짜 칸 안에만 표시
    // - 기준: startDate == endDate 인 이벤트
    for(const ev of allEvents){
      const s = ev.startDate;
      const e = ev.endDate || ev.startDate;

      if(s === e && s >= weekStartKey && s <= weekEndKey){
        const dayIndex = wdays.indexOf(s);
        if(dayIndex < 0) continue;

        const items = tds[dayIndex].querySelector(".day-items");
        if(!items) continue;

        const item = document.createElement("div");
        item.className = "day-item";
        item.textContent = ev.title || "(제목없음)";

        // 작성자 색상(이미 getMemberColor 함수가 있다면 더 좋고, 없으면 기본)
        const userColor = (typeof getMemberColor === "function")
          ? getMemberColor(ev.owner)
          : "#1f6feb";
        item.style.borderColor = userColor;
        item.style.color = userColor;
        item.style.background = userColor + "12";

        item.addEventListener("click", (e)=>{
          e.stopPropagation();
          openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
        });

        items.appendChild(item);
      }
    }

    // ✅ (2) 2일 이상 일정: "칸 안에서 옆칸까지 이어지는 바"로 표시 (중복 없음)
    // - 이번 주에 걸치는 이벤트를 segStart~segEnd로 잘라서 주 단위로 배치
    const segments = [];
    for(const ev of allEvents){
      const seg = splitIntoWeekSegments(ev, weekStartKey, weekEndKey);
      if(!seg) continue;

      // 멀티데이만 바로 표현
      if(seg.startDate !== seg.endDate){
        segments.push(seg);
      }
    }

    // 정렬(시작이 빠른 것부터)
    segments.sort((a,b)=> a.segStart.localeCompare(b.segStart));

    // 레인 배치(겹치면 다음 줄)
    const lanes = []; // lanes[row] = Array(7).fill(false)
    function canPlace(lane, sIdx, eIdx){
      for(let k=sIdx;k<=eIdx;k++) if(lane[k]) return false;
      return true;
    }
    function occupy(lane, sIdx, eIdx){
      for(let k=sIdx;k<=eIdx;k++) lane[k] = true;
    }

    // 주 레이어 생성 (tr 전체 위에 1개)
    const layer = document.createElement("div");
    layer.className = "week-layer";
    const grid = document.createElement("div");
    grid.className = "week-layer-grid";
    layer.appendChild(grid);

    segments.forEach(seg=>{
      const colStart = wdays.indexOf(seg.segStart); // 0~6
      const colEnd = wdays.indexOf(seg.segEnd);     // 0~6
      if(colStart < 0 || colEnd < 0) return;

      let rowIndex = -1;
      for(let r=0;r<lanes.length;r++){
        if(canPlace(lanes[r], colStart, colEnd)){ rowIndex = r; break; }
      }
      if(rowIndex === -1){
        lanes.push(new Array(7).fill(false));
        rowIndex = lanes.length - 1;
      }
      occupy(lanes[rowIndex], colStart, colEnd);

      const bar = document.createElement("div");
      bar.className = "mbar";
      bar.style.gridColumn = `${colStart+1} / span ${colEnd-colStart+1}`;
      bar.style.gridRow = `${rowIndex+1}`;

      // 작성자 색상 적용
      const userColor = (typeof getMemberColor === "function")
        ? getMemberColor(seg.owner)
        : "#1f6feb";
      bar.style.borderColor = userColor;
      bar.style.background = userColor + "18";
      bar.style.color = userColor;

      // 바 텍스트: 제목만 (원하면 작성자도 추가 가능)
      bar.textContent = seg.title || "(제목없음)";

      bar.addEventListener("click", (e)=>{
        e.stopPropagation();
        openModal({ dateKey: seg.startDate, eventId: seg.eventId, event: seg });
      });

      grid.appendChild(bar);
    });

    // ✅ 레이어를 "첫 번째 td"에 붙이고, absolute로 주 전체 폭 덮게 함
    // 테이블 구조상 tr 위에 직접 올리기 어려워서 첫 td에 붙이고 폭을 주 전체로 사용
    // (td position:relative + layer absolute)
    const firstTd = tr.children[0];
    if(firstTd){
      firstTd.style.position = "relative";
      // layer가 주 전체 너비를 덮게 하기
      layer.style.left = "0";
      layer.style.width = "calc(100% * 7)"; // 7칸 전체
      layer.style.pointerEvents = "none";
      // grid 안 바만 pointerEvents=true (CSS에서 처리)
      firstTd.appendChild(layer);
    }

    tbody.appendChild(tr);
  }

  calTable.appendChild(tbody);
}


function subscribeMembers(){
  onValue(ref(db, "config/members"), (snap)=>{
    const obj = snap.val() || {};
    const list = Object.entries(obj).map(([id, v])=>({ id, ...v }));
    list.sort((a,b)=>(a.order ?? 999) - (b.order ?? 999));
    membersAll = list;
    members = list.filter(x=>x.active !== false);

    // selectedName이 비활성/삭제되면 자동으로 첫 활성으로
    if(selectedName && !members.some(m=>m.name === selectedName)){
      selectedName = members[0]?.name || "";
      localStorage.setItem(LS_NAME, selectedName);
    }
    renderMemberButtons();
  });
}

function subscribeEventsForCurrentMonth(){
  const { startKey, endKey } = monthRangeKeys();

  onValue(ref(db, "events"), (snap)=>{
    const all = snap.val() || {};
    eventsByDate = {};

    // ✅ 현재월 범위만 추림 (startDate 키 기준)
    Object.keys(all).forEach(dateKey=>{
      if(dateKey >= startKey && dateKey <= endKey){
        eventsByDate[dateKey] = all[dateKey];
      }
    });

    renderCalendar();
  });
}

saveBtn.addEventListener("click", async ()=>{
  const dateKey = editing.dateKey;
  if(!dateKey) return;

  // ✅ endDate 계산 (없으면 시작일)
  const endDate = (fEndDate?.value || dateKey).trim() || dateKey;

  if (endDate < dateKey) {
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
    endDate,                 // ✅ 정상 반영
    createdAt: serverTimestamp()
  };

  if(!payload.title){
    alert("제목은 필수입니다.");
    return;
  }

  // edit
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
  } else {
    // new
    const newRef = push(ref(db, `events/${dateKey}`));
    await set(newRef, payload);
  }

  closeModal();
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

  await remove(ref(db, `events/${dateKey}/${eventId}`));
  closeModal();
});

// nav buttons
$("prevBtn").addEventListener("click", ()=>{
  current.setMonth(current.getMonth()-1);
  // subscribeEventsForCurrentMonth()는 onValue를 다시 걸기 때문에 1차 버전에서는 그대로 두되,
  // 누적 구독이 걱정되면 'unsubscribe' 구조로 개선 가능
  subscribeEventsForCurrentMonth();
  renderCalendar();
});

$("nextBtn").addEventListener("click", ()=>{
  current.setMonth(current.getMonth()+1);
  subscribeEventsForCurrentMonth();
  renderCalendar();
});

$("todayBtn").addEventListener("click", ()=>{
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  subscribeEventsForCurrentMonth();
  renderCalendar();
});

// start
subscribeMembers();
subscribeEventsForCurrentMonth();
renderMemberButtons();
renderCalendar();
