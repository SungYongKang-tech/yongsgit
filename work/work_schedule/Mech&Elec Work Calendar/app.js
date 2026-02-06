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
const selectedNameView = $("selectedNameView");
const monthTitle = $("monthTitle");
const calTable = $("calTable");

const modalBack = $("modalBack");
const modalTitle = $("modalTitle");
const fDate = $("fDate");
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
function ym(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
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

  if(event){
    modalTitle.textContent = "일정 수정";
    fType.value = event.type || "작업";
    fStart.value = event.start || "";
    fEnd.value = event.end || "";
    fTitle.value = event.title || "";
    fDetail.value = event.detail || "";
    fOwner.value = event.owner || selectedName;

    const canEdit = (event.owner === selectedName);
    saveBtn.disabled = !canEdit;
    deleteBtn.style.display = canEdit ? "inline-block" : "none";
    editHint.textContent = canEdit ? "작성자 본인 일정입니다. 수정/삭제 가능합니다." : "작성자 본인만 수정/삭제할 수 있습니다.";
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
  selectedNameView.textContent = selectedName || "-";

  members.forEach(m=>{
    const btn = document.createElement("button");
    btn.className = "member-btn" + (m.name === selectedName ? " active" : "");
    btn.textContent = m.name;
    btn.style.borderColor = m.color || "#e6e8ef";
    if(m.name === selectedName){
      btn.style.background = "linear-gradient(180deg, #fff, #f7f8ff)";
      btn.style.boxShadow = `0 10px 24px rgba(0,0,0,.08)`;
    }
    btn.onclick = ()=>{
      selectedName = m.name;
      localStorage.setItem(LS_NAME, selectedName);
      renderMemberButtons();
      selectedNameView.textContent = selectedName;
    };
    memberBar.appendChild(btn);
  });

  // 선택된 이름이 목록에 없으면 자동으로 첫 활성 멤버로
  if(!selectedName && members.length){
    selectedName = members[0].name;
    localStorage.setItem(LS_NAME, selectedName);
    selectedNameView.textContent = selectedName;
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

  let cursor = new Date(start);
  while(cursor <= end){
    const tr = document.createElement("tr");
    for(let i=0;i<7;i++){
      const td = document.createElement("td");
      const inMonth = (cursor.getMonth() === m);
      if(!inMonth) td.classList.add("day-muted");

      const dateKey = ymd(cursor);

      const top = document.createElement("div");
      top.className = "day-top";
      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();
      const add = document.createElement("div");
      add.className = "badge";
      add.textContent = "추가";
      top.appendChild(num);
      top.appendChild(add);

      td.appendChild(top);

      // events
      const dayEvents = eventsByDate[dateKey] || {};
      Object.entries(dayEvents).forEach(([eventId, ev])=>{
        const box = document.createElement("div");
        box.className = "event";
        box.dataset.eventId = eventId;

        const t = document.createElement("div");
        t.className = "t";
        t.textContent = ev.title || "(제목없음)";

        const m1 = document.createElement("div");
        m1.className = "m";
        m1.textContent = (ev.detail || "").slice(0, 40);

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.innerHTML = `
          <span class="chip">${ev.type || "작업"}</span>
          <span class="chip">${ev.owner || "-"}</span>
          ${(ev.start||ev.end) ? `<span class="chip">${ev.start||""}${ev.end?`~${ev.end}`:""}</span>` : ""}
        `;

        box.appendChild(t);
        if(ev.detail) box.appendChild(m1);
        box.appendChild(meta);

        box.onclick = ()=>{
          openModal({ dateKey, eventId, event: ev });
        };
        td.appendChild(box);
      });

      // click day to add
      td.addEventListener("click",(e)=>{
        // 이벤트 박스 클릭이면 위 onclick이 처리 (버블 방지)
        if(e.target.closest(".event")) return;
        openModal({ dateKey });
      });

      tr.appendChild(td);
      cursor.setDate(cursor.getDate()+1);
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
  // month 전체를 한번에 구독: events 밑에서 해당 월 범위만 필터링은 RTDB에서 쿼리(정렬키) 없으면 어렵습니다.
  // 1차 버전은 events 전체 구독 대신 "현재월" 날짜들을 렌더링할 때만 사용.
  // 다만 규모가 커지면 /eventsByMonth/2026-02 형태로 구조 개선 추천.
  onValue(ref(db, "events"), (snap)=>{
    const all = snap.val() || {};
    // current month range만 추림
    eventsByDate = {};
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

  const payload = {
    type: fType.value,
    title: (fTitle.value || "").trim(),
    detail: (fDetail.value || "").trim(),
    owner: selectedName,
    start: (fStart.value || "").trim(),
    end: (fEnd.value || "").trim(),
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
