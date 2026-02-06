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

// ✅ events 원본/필터
let eventsAll = {};          // { "YYYY-MM-DD": {eventId: evObj} }
let eventsByDate = {};       // 현재 월(겹침 포함) 필터 결과

const $ = (id) => document.getElementById(id);

const memberBar = $("memberBar");
const selectedNameView = document.getElementById("selectedNameView"); // 없을 수도 있음

const monthTitle = $("monthTitle");
const calTable = $("calTable");

const modalBack = $("modalBack");
const modalTitle = $("modalTitle");
const fDate = $("fDate");         // (권장) HTML에서 type="date" disabled
const fEndDate = $("fEndDate");   // type="date"
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
function ymd(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function normalizeDate(v){
  if(!v) return "";
  const s = String(v).trim().slice(0,10).replaceAll(".", "-").replaceAll("/", "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

// 작성자 이름 → 색상 찾기
function getMemberColor(name){
  const m = membersAll.find(x => x.name === name);
  return m?.color || "#1f6feb";
}

// ✅ eventsByDate(시작일키 구조) → 이벤트 리스트로 평탄화
function toEventList() {
  const list = [];
  Object.entries(eventsByDate || {}).forEach(([startDate, objs]) => {
    Object.entries(objs || {}).forEach(([eventId, ev]) => {
      const s = normalizeDate(startDate) || startDate;
      const e = normalizeDate(ev?.endDate) || s; // ✅ endDate 강제
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

function monthRangeKeys(){
  const start = new Date(current);
  start.setDate(1);
  const end = new Date(current);
  end.setMonth(end.getMonth()+1);
  end.setDate(0); // last day
  return { startKey: ymd(start), endKey: ymd(end) };
}

// -------------------- modal --------------------
function openModal({dateKey, eventId=null, event=null}){
  if(!selectedName){
    alert("상단에서 이름을 먼저 선택해 주세요.");
    return;
  }
  editing = { dateKey, eventId };

  modalBack.classList.add("show");
  fDate.value = dateKey;       // 표시용
  fOwner.value = selectedName;

  // 종료일 기본값 = 시작일
  if (fEndDate){
    fEndDate.value = dateKey;
    fEndDate.min = dateKey; // ✅ 종료일은 시작일 이전 선택 불가
  }

  if(event){
    modalTitle.textContent = "일정 수정";
    fType.value = event.type || "작업";
    fStart.value = event.start || "";
    fEnd.value = event.end || "";
    fTitle.value = event.title || "";
    fDetail.value = event.detail || "";
    if (fEndDate) fEndDate.value = normalizeDate(event.endDate) || dateKey;
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

// -------------------- members --------------------
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
      btn.style.boxShadow = "none";
    }

    btn.onclick = ()=>{
      selectedName = m.name;
      localStorage.setItem(LS_NAME, selectedName);
      renderMemberButtons();
      if(selectedNameView) selectedNameView.textContent = selectedName;
    };

    memberBar.appendChild(btn);
  });

  if(!selectedName && members.length){
    selectedName = members[0].name;
    localStorage.setItem(LS_NAME, selectedName);
    if(selectedNameView) selectedNameView.textContent = selectedName;
    renderMemberButtons();
  }
}

function subscribeMembers(){
  onValue(ref(db, "config/members"), (snap)=>{
    const obj = snap.val() || {};
    const list = Object.entries(obj).map(([id, v])=>({ id, ...v }));
    list.sort((a,b)=>(a.order ?? 999) - (b.order ?? 999));
    membersAll = list;
    members = list.filter(x=>x.active !== false);

    if(selectedName && !members.some(m=>m.name === selectedName)){
      selectedName = members[0]?.name || "";
      localStorage.setItem(LS_NAME, selectedName);
    }
    renderMemberButtons();
  });
}

// -------------------- events subscribe/filter --------------------
// ✅ 핵심: "시작일이 이번달"이 아니라 "이번달과 겹치면" 포함
function applyMonthFilterAndRender(){
  const { startKey, endKey } = monthRangeKeys();
  eventsByDate = {};

  Object.entries(eventsAll || {}).forEach(([startDateKey, objs]) => {
    if(!objs) return;

    const s = normalizeDate(startDateKey) || startDateKey;

    // 이 시작일 아래에 이벤트가 여러개 있을 수 있으니 하나라도 겹치면 유지
    let keepAny = false;
    Object.values(objs).forEach((ev)=>{
      const e = normalizeDate(ev?.endDate) || s;
      // overlap: s <= endKey && e >= startKey
      if (s <= endKey && e >= startKey) keepAny = true;
    });

    if (keepAny) eventsByDate[startDateKey] = objs;
  });

  renderCalendar();
}

function subscribeEvents(){
  onValue(ref(db, "events"), (snap)=>{
    eventsAll = snap.val() || {};
    applyMonthFilterAndRender();
  });
}

// -------------------- calendar render --------------------
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

  const days = ["일","월","화","수","목","금","토"];
  calTable.innerHTML = "";

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
  const allEvents = toEventList();

  let cursor = new Date(start);
  while(cursor <= end){
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate()+6);

    const weekStartKey = ymd(weekStart);
    const weekEndKey = ymd(weekEnd);
    const wdays = weekDates(weekStart);

    const tr = document.createElement("tr");
    const tds = [];

    for(let i=0;i<7;i++){
      const td = document.createElement("td");
      const inMonth = (cursor.getMonth() === m);
      if(!inMonth) td.classList.add("day-muted");

      const dateKey = ymd(cursor);

      const cell = document.createElement("div");
      cell.className = "day-cell";

      const top = document.createElement("div");
      top.className = "day-top";
      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();
      top.appendChild(num);

      const items = document.createElement("div");
      items.className = "day-items";
      items.dataset.dateKey = dateKey;

      cell.appendChild(top);
      cell.appendChild(items);
      td.appendChild(cell);

      td.addEventListener("click", (e)=>{
        if(e.target.closest(".mbar")) return;
        if(e.target.closest(".day-item")) return;
        if(e.target.closest(".week-layer")) return;
        openModal({ dateKey });
      });

      tr.appendChild(td);
      tds.push(td);

      cursor.setDate(cursor.getDate()+1);
    }

    // (1) 하루짜리
    for(const ev of allEvents){
      const s = ev.startDate;
      const e = ev.endDate;

      if(s === e && s >= weekStartKey && s <= weekEndKey){
        const dayIndex = wdays.indexOf(s);
        if(dayIndex < 0) continue;

        const items = tds[dayIndex].querySelector(".day-items");
        if(!items) continue;

        const item = document.createElement("div");
        item.className = "day-item";
        item.textContent = ev.title || "(제목없음)";

        const userColor = getMemberColor(ev.owner);
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

    // (2) 멀티데이 바
    const segments = [];
    for(const ev of allEvents){
      const seg = splitIntoWeekSegments(ev, weekStartKey, weekEndKey);
      if(!seg) continue;
      if(seg.segStart !== seg.segEnd) segments.push(seg);
    }

    segments.sort((a,b)=> a.segStart.localeCompare(b.segStart));

    const lanes = [];
    function canPlace(lane, sIdx, eIdx){
      for(let k=sIdx;k<=eIdx;k++) if(lane[k]) return false;
      return true;
    }
    function occupy(lane, sIdx, eIdx){
      for(let k=sIdx;k<=eIdx;k++) lane[k] = true;
    }

    const layer = document.createElement("div");
    layer.className = "week-layer";
    const grid = document.createElement("div");
    grid.className = "week-layer-grid";
    layer.appendChild(grid);

    segments.forEach(seg=>{
      const colStart = wdays.indexOf(seg.segStart);
      const colEnd = wdays.indexOf(seg.segEnd);
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

      const userColor = getMemberColor(seg.owner);
      bar.style.borderColor = userColor;
      bar.style.background = userColor + "18";
      bar.style.color = userColor;

      bar.textContent = seg.title || "(제목없음)";

      bar.addEventListener("click", (e)=>{
        e.stopPropagation();
        openModal({ dateKey: seg.startDate, eventId: seg.eventId, event: seg });
      });

      grid.appendChild(bar);
    });

    const firstTd = tr.children[0];
    if(firstTd){
      firstTd.style.position = "relative";
      layer.style.left = "0";
      layer.style.width = "calc(100% * 7)";
      layer.style.pointerEvents = "none";
      firstTd.appendChild(layer);
    }

    tbody.appendChild(tr);
  }

  calTable.appendChild(tbody);
}

// -------------------- save/delete --------------------
saveBtn.addEventListener("click", async ()=>{
  const dateKey = editing.dateKey; // ✅ 시작일은 무조건 여기
  if(!dateKey) return;

  const endDate = normalizeDate(fEndDate?.value) || dateKey;

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
    endDate, // ✅ 멀티데이 핵심
    createdAt: serverTimestamp()
  };

  if(!payload.title){
    alert("제목은 필수입니다.");
    return;
  }

  try {
    if(editing.eventId){
      const ev = eventsByDate?.[dateKey]?.[editing.eventId];
      if(!ev) return alert("데이터를 찾을 수 없습니다.");
      if(ev.owner !== selectedName) return alert("작성자 본인만 수정할 수 있습니다.");
      await update(ref(db, `events/${dateKey}/${editing.eventId}`), payload);
    } else {
      const newRef = push(ref(db, `events/${dateKey}`));
      await set(newRef, payload);
    }

    // ✅ 성공했을 때만 닫기
    closeModal();
  } catch (err) {
    console.error(err);
    alert("저장 실패: " + (err?.message || err));
  }
});

deleteBtn.addEventListener("click", async ()=>{
  const { dateKey, eventId } = editing;
  if(!dateKey || !eventId) return;

  const ev = eventsByDate?.[dateKey]?.[eventId];
  if(!ev) return alert("데이터를 찾을 수 없습니다.");
  if(ev.owner !== selectedName) return alert("작성자 본인만 삭제할 수 있습니다.");
  if(!confirm("삭제하시겠습니까?")) return;

  try {
    await remove(ref(db, `events/${dateKey}/${eventId}`));
    closeModal();
  } catch (err) {
    console.error(err);
    alert("삭제 실패: " + (err?.message || err));
  }
});

// -------------------- nav buttons --------------------
$("prevBtn").addEventListener("click", ()=>{
  current.setMonth(current.getMonth()-1);
  applyMonthFilterAndRender();
});

$("nextBtn").addEventListener("click", ()=>{
  current.setMonth(current.getMonth()+1);
  applyMonthFilterAndRender();
});

$("todayBtn").addEventListener("click", ()=>{
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  applyMonthFilterAndRender();
});

// -------------------- start --------------------
subscribeMembers();
subscribeEvents();
renderMemberButtons();
renderCalendar();
