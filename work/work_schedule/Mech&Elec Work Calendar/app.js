import { db } from "./firebase.js";
import { ref, onValue, push, set, update, remove, serverTimestamp } from
  "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const LS_NAME = "mecal_selected_name";

let current = new Date();
current.setDate(1);

let members = [];
let membersAll = [];
let selectedName = localStorage.getItem(LS_NAME) || "";

let eventsAll = {}; // { "YYYY-MM-DD": {eventId: evObj} }

const $ = (id) => document.getElementById(id);

const memberBar = $("memberBar");
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

// -------- utils --------
function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function normalizeDate(s){
  const t = (s||"").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
}
function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}
function getMemberColor(name){
  const m = membersAll.find(x => x.name === name);
  return m?.color || "#1f6feb";
}

function getVisibleRange(){
  const y = current.getFullYear();
  const m = current.getMonth();
  const first = new Date(y, m, 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay()); // Sun
  const last = new Date(y, m+1, 0);
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay())); // Sat
  return { gridStart, gridEnd, gridStartKey: ymd(gridStart), gridEndKey: ymd(gridEnd) };
}
function weekDates(weekStart){
  const arr = [];
  const d = new Date(weekStart);
  for(let i=0;i<7;i++){
    arr.push(ymd(d));
    d.setDate(d.getDate()+1);
  }
  return arr;
}

function toVisibleEventList(){
  const { gridStartKey, gridEndKey } = getVisibleRange();
  const list = [];
  Object.entries(eventsAll || {}).forEach(([startDate, objs])=>{
    Object.entries(objs || {}).forEach(([eventId, ev])=>{
      const s = normalizeDate(startDate) || startDate;
      const e = normalizeDate(ev?.endDate) || s;
      if(e < gridStartKey || s > gridEndKey) return;
      list.push({ ...ev, eventId, startDate: s, endDate: e });
    });
  });
  return list;
}

function splitIntoWeekSegment(ev, weekStartKey, weekEndKey){
  const s = ev.startDate;
  const e = ev.endDate;
  if(e < weekStartKey || s > weekEndKey) return null;
  const segStart = (s < weekStartKey) ? weekStartKey : s;
  const segEnd   = (e > weekEndKey)   ? weekEndKey   : e;
  return { ...ev, segStart, segEnd };
}

// -------- modal --------
function openModal({dateKey, eventId=null, event=null}){
  if(!selectedName){
    alert("상단에서 이름을 먼저 선택해 주세요.");
    return;
  }
  editing = { dateKey, eventId };

  modalBack.classList.add("show");
  fDate.value = dateKey;
  fOwner.value = selectedName;

  if(event){
    modalTitle.textContent = "일정 수정";
    fType.value = event.type || "작업";
    fStart.value = event.start || "";
    fEnd.value = event.end || "";
    fTitle.value = event.title || "";
    fDetail.value = event.detail || "";
    fEndDate.value = (event.endDate && event.endDate !== event.startDate) ? event.endDate : "";

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
    fEndDate.value = "";
    fEndDate.min = dateKey;

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

// -------- members --------
function renderMemberButtons(){
  memberBar.innerHTML = "";
  if(!members.length) return;

  if(!selectedName){
    selectedName = members[0].name;
    localStorage.setItem(LS_NAME, selectedName);
  }

  members.forEach(m=>{
    const btn = document.createElement("button");
    btn.className = "member-btn" + (m.name === selectedName ? " active" : "");
    btn.textContent = m.name;

    const c = m.color || "#1f6feb";
    btn.style.borderColor = c;

    if(m.name === selectedName){
      btn.style.background = c;
      btn.style.color = "#fff";
      btn.style.boxShadow = `0 6px 16px ${c}55`;
    }else{
      btn.style.background = "#fff";
      btn.style.color = "#1f2330";
      btn.style.boxShadow = "none";
    }

    btn.onclick = ()=>{
      selectedName = m.name;
      localStorage.setItem(LS_NAME, selectedName);
      renderMemberButtons();
    };

    memberBar.appendChild(btn);
  });
}

function subscribeMembers(){
  onValue(ref(db, "config/members"), (snap)=>{
    const obj = snap.val() || {};
    const list = Object.entries(obj).map(([id,v])=>({id, ...v}));
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

// -------- events --------
function subscribeEvents(){
  onValue(ref(db, "events"), (snap)=>{
    eventsAll = snap.val() || {};
    renderCalendar();
  });
}

// -------- render --------
function renderCalendar(){
  const y = current.getFullYear();
  const m = current.getMonth();
  monthTitle.textContent = `${y}.${pad2(m+1)}`;

  const { gridStart, gridEnd } = getVisibleRange();

  calTable.innerHTML = "";

  const days = ["일","월","화","수","목","금","토"];
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
  const allEvents = toVisibleEventList();

  let cursor = new Date(gridStart);

  while(cursor <= gridEnd){
    const weekStart = new Date(cursor);
    const weekEnd = addDays(weekStart, 6);

    const weekStartKey = ymd(weekStart);
    const weekEndKey = ymd(weekEnd);
    const wdays = weekDates(weekStart);

    const tr = document.createElement("tr");
    const tds = [];

    // 7칸 만들기 (칸 내부에 bar-slot 추가)
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

      const barSlot = document.createElement("div");
      barSlot.className = "bar-slot";
      barSlot.dataset.weekStartKey = weekStartKey; // 디버그용

      const items = document.createElement("div");
      items.className = "day-items";
      items.dataset.dateKey = dateKey;

      cell.appendChild(top);
      cell.appendChild(barSlot);
      cell.appendChild(items);
      td.appendChild(cell);

      td.addEventListener("click", (e)=>{
        if(e.target.closest(".mbar")) return;
        if(e.target.closest(".day-item")) return;
        openModal({ dateKey });
      });

      tr.appendChild(td);
      tds.push(td);

      cursor.setDate(cursor.getDate()+1);
    }

    tbody.appendChild(tr);

    // ---- 하루짜리(칸 안) ----
    for(const ev of allEvents){
      if(ev.startDate !== ev.endDate) continue;
      const s = ev.startDate;
      if(s < weekStartKey || s > weekEndKey) continue;

      const idx = wdays.indexOf(s);
      if(idx < 0) continue;

      const items = tds[idx].querySelector(".day-items");
      if(!items) continue;

      const item = document.createElement("div");
      item.className = "day-item";
      item.textContent = ev.title || "(제목없음)";

      const c = getMemberColor(ev.owner);
      item.style.borderColor = c;
      item.style.color = c;
      item.style.background = c + "12";

      item.addEventListener("click", (e2)=>{
        e2.stopPropagation();
        openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
      });

      items.appendChild(item);
    }

    // ---- 멀티데이(바): “이 주의 첫칸(일요일)” bar-slot에 bar-wrap 올리기 ----
    const sundaySlot = tds[0].querySelector(".bar-slot");
    if(!sundaySlot) continue;

    const segments = [];
    for(const ev of allEvents){
      if(ev.startDate === ev.endDate) continue;
      const seg = splitIntoWeekSegment(ev, weekStartKey, weekEndKey);
      if(seg && seg.segStart !== seg.segEnd) segments.push(seg);
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

    const placed = [];
    segments.forEach(seg=>{
      const colStart = wdays.indexOf(seg.segStart);
      const colEnd   = wdays.indexOf(seg.segEnd);
      if(colStart < 0 || colEnd < 0) return;

      let row = -1;
      for(let r=0;r<lanes.length;r++){
        if(canPlace(lanes[r], colStart, colEnd)){ row = r; break; }
      }
      if(row === -1){
        lanes.push(new Array(7).fill(false));
        row = lanes.length - 1;
      }
      occupy(lanes[row], colStart, colEnd);

      placed.push({ seg, colStart, colEnd, row });
    });

    // bar-wrap 생성(레인 없으면 만들지 않음)
    if(placed.length){
      const barWrap = document.createElement("div");
      barWrap.className = "bar-wrap";
      sundaySlot.appendChild(barWrap);

      const rowH = window.matchMedia("(max-width:640px)").matches ? 20 : 22;
      const needH = Math.max(1, lanes.length) * (rowH + 2);
      sundaySlot.style.height = `${needH + 2}px`; // ✅ slot 높이 확장

      placed.forEach(({seg, colStart, colEnd, row})=>{
        const bar = document.createElement("div");
        bar.className = "mbar";

        const c = getMemberColor(seg.owner);
        bar.style.borderColor = c;
        bar.style.background = c + "18";
        bar.style.color = c;

        const leftPct = (colStart * 100) / 7;
        const widthPct = ((colEnd - colStart + 1) * 100) / 7;

        bar.style.left = `calc(${leftPct}% + 2px)`;
        bar.style.width = `calc(${widthPct}% - 4px)`;
        bar.style.top = `${row * (rowH + 2)}px`;

        bar.textContent = seg.title || "(제목없음)";

        bar.addEventListener("click", (e2)=>{
          e2.stopPropagation();
          openModal({ dateKey: seg.startDate, eventId: seg.eventId, event: seg });
        });

        barWrap.appendChild(bar);
      });
    }
  }

  calTable.appendChild(tbody);
}

// -------- save/delete --------
saveBtn.addEventListener("click", async ()=>{
  const startKey = normalizeDate(fDate.value);
  if(!startKey){
    alert("시작일이 올바르지 않습니다.");
    return;
  }

  const rawEnd = normalizeDate(fEndDate.value);
  const endDate = rawEnd || startKey;

  if(endDate < startKey){
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

  if(editing.eventId){
    const exist = eventsAll?.[editing.dateKey]?.[editing.eventId];
    if(!exist){
      alert("데이터를 찾을 수 없습니다.");
      return;
    }
    if(exist.owner !== selectedName){
      alert("작성자 본인만 수정할 수 있습니다.");
      return;
    }

    if(startKey !== editing.dateKey){
      const newRef = push(ref(db, `events/${startKey}`));
      await set(newRef, payload);
      await remove(ref(db, `events/${editing.dateKey}/${editing.eventId}`));
    }else{
      await update(ref(db, `events/${editing.dateKey}/${editing.eventId}`), payload);
    }
  }else{
    const newRef = push(ref(db, `events/${startKey}`));
    await set(newRef, payload);
  }

  closeModal();
});

deleteBtn.addEventListener("click", async ()=>{
  const { dateKey, eventId } = editing;
  if(!dateKey || !eventId) return;

  const exist = eventsAll?.[dateKey]?.[eventId];
  if(!exist){
    alert("데이터를 찾을 수 없습니다.");
    return;
  }
  if(exist.owner !== selectedName){
    alert("작성자 본인만 삭제할 수 있습니다.");
    return;
  }
  if(!confirm("삭제하시겠습니까?")) return;

  await remove(ref(db, `events/${dateKey}/${eventId}`));
  closeModal();
});

// -------- nav --------
$("prevBtn").addEventListener("click", ()=>{
  current.setMonth(current.getMonth()-1);
  renderCalendar();
});
$("nextBtn").addEventListener("click", ()=>{
  current.setMonth(current.getMonth()+1);
  renderCalendar();
});
$("todayBtn").addEventListener("click", ()=>{
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  renderCalendar();
});

// -------- start --------
subscribeMembers();
subscribeEvents();
renderMemberButtons();
renderCalendar();
