import { db } from "./firebase.js";
import { ref, onValue, push, set, update, remove, serverTimestamp } from
  "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const LS_NAME = "mecal_selected_name";

let current = new Date();
current = new Date(current.getFullYear(), current.getMonth(), 1);

let members = [];
let membersAll = [];
let selectedName = localStorage.getItem(LS_NAME) || "";

let eventsAll = {}; // { "YYYY-MM-DD": {eventId: evObj} }

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

// ---------- utils ----------
function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseYmd(s){
  if(!s) return null;
  const t = String(s).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [Y,M,D] = t.split("-").map(Number);
  const dt = new Date(Y, M-1, D);
  // 방어: JS가 자동 보정하는 경우 차단
  if(dt.getFullYear() !== Y || dt.getMonth() !== M-1 || dt.getDate() !== D) return null;
  return dt;
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

function monthTitleText(){
  return `${current.getFullYear()}.${pad2(current.getMonth()+1)}`;
}

function getGridRange(){
  const y = current.getFullYear();
  const m = current.getMonth();
  const first = new Date(y, m, 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay()); // Sun

  const last = new Date(y, m+1, 0);
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay())); // Sat

  return { gridStart, gridEnd };
}

function toVisibleEventList(){
  const { gridStart, gridEnd } = getGridRange();
  const gridStartKey = ymd(gridStart);
  const gridEndKey = ymd(gridEnd);

  const list = [];
  Object.entries(eventsAll || {}).forEach(([startKey, objs])=>{
    Object.entries(objs || {}).forEach(([eventId, ev])=>{
      const s = startKey;
      const e = (ev?.endDate && String(ev.endDate).trim()) ? String(ev.endDate).trim() : startKey;

      if(e < gridStartKey || s > gridEndKey) return;

      list.push({
        ...ev,
        eventId,
        startDate: s,
        endDate: e
      });
    });
  });
  return list;
}

function splitToWeekSegment(ev, weekStartKey, weekEndKey){
  const s = ev.startDate;
  const e = ev.endDate;
  if(e < weekStartKey || s > weekEndKey) return null;

  const segStart = (s < weekStartKey) ? weekStartKey : s;
  const segEnd   = (e > weekEndKey)   ? weekEndKey   : e;

  return { ...ev, segStart, segEnd };
}

// ---------- modal ----------
function openModal({dateKey, eventId=null, event=null}){
  if(!selectedName){
    alert("상단에서 이름을 먼저 선택해 주세요.");
    return;
  }
  editing = { dateKey, eventId };

  modalBack.classList.add("show");

  // 신규/수정 모두 시작일 입력 가능(멀티 일정 생성/수정 용이)
  fDate.value = dateKey;
  fDate.min = ""; // 필요시 제한 가능
  fOwner.value = selectedName;

  // 종료일 min은 시작일
  fEndDate.min = dateKey;

  if(event){
    modalTitle.textContent = "일정 수정";
    fType.value = event.type || "작업";
    fStart.value = event.start || "";
    fEnd.value = event.end || "";
    fTitle.value = event.title || "";
    fDetail.value = event.detail || "";

    // 멀티면 종료일 표시, 아니면 비움(=하루)
    fEndDate.value = (event.endDate && event.endDate !== event.startDate) ? event.endDate : "";

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
    fEndDate.value = "";

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

// ---------- members ----------
function renderMemberButtons(){
  memberBar.innerHTML = "";
  if(!members.length) return;

  if(selectedName && !members.some(m=>m.name === selectedName)){
    selectedName = "";
  }
  if(!selectedName){
    selectedName = members[0].name;
    localStorage.setItem(LS_NAME, selectedName);
  }

  members.forEach(m=>{
    const btn = document.createElement("button");
    btn.className = "member-btn";
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
    const list = Object.entries(obj).map(([id,v])=>({ id, ...v }));
    list.sort((a,b)=>(a.order ?? 999) - (b.order ?? 999));
    membersAll = list;
    members = list.filter(x=>x.active !== false);
    renderMemberButtons();
    renderCalendar();
  });
}

// ---------- events ----------
function subscribeEvents(){
  onValue(ref(db, "events"), (snap)=>{
    eventsAll = snap.val() || {};
    renderCalendar();
  });
}

// ---------- render ----------
function renderCalendar(){
  monthTitle.textContent = monthTitleText();
  calGrid.innerHTML = "";

  // 요일 헤더
  const dow = document.createElement("div");
  dow.className = "dow";
  ["일","월","화","수","목","금","토"].forEach(d=>{
    const x = document.createElement("div");
    x.textContent = d;
    dow.appendChild(x);
  });
  calGrid.appendChild(dow);

  const { gridStart, gridEnd } = getGridRange();
  const allEvents = toVisibleEventList();

  // 날짜→칸 DOM 빠르게 찾기 위한 map
  const cellMap = new Map(); // dateKey -> dayEl
  const weeks = []; // week containers

  let cursor = new Date(gridStart);
  while(cursor <= gridEnd){
    const weekStart = new Date(cursor);
    const weekStartKey = ymd(weekStart);
    const weekEndKey = ymd(addDays(weekStart, 6));

    const weekRow = document.createElement("div");
    weekRow.className = "week-row";
    weekRow.dataset.weekStart = weekStartKey;

    // 멀티바 레이어(주 전체)
    const barsLayer = document.createElement("div");
    barsLayer.className = "week-bars";
    weekRow.appendChild(barsLayer);

    // 7일 칸
    for(let col=0; col<7; col++){
      const dateKey = ymd(cursor);
      const day = document.createElement("div");
      day.className = "day";
      day.dataset.dateKey = dateKey;
      day.dataset.col = String(col);

      const inMonth = (cursor.getMonth() === current.getMonth());
      if(!inMonth) day.classList.add("muted");

      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = cursor.getDate();

      const items = document.createElement("div");
      items.className = "day-items";

      day.appendChild(num);
      day.appendChild(items);

      day.addEventListener("click",(e)=>{
        if(e.target.closest(".mbar")) return;
        if(e.target.closest(".day-item")) return;
        openModal({ dateKey });
      });

      weekRow.appendChild(day);
      cellMap.set(dateKey, day);

      cursor = addDays(cursor, 1);
    }

    calGrid.appendChild(weekRow);
    weeks.push({ weekRow, barsLayer, weekStartKey, weekEndKey });
  }

  // 1) 하루 일정(칸 안)
  for(const ev of allEvents){
    if(ev.startDate !== ev.endDate) continue;
    const cell = cellMap.get(ev.startDate);
    if(!cell) continue;

    const items = cell.querySelector(".day-items");
    const item = document.createElement("div");
    item.className = "day-item";
    item.textContent = ev.title || "(제목없음)";

    const c = getMemberColor(ev.owner);
    item.style.borderColor = c;
    item.style.color = c;
    item.style.background = c + "12";

    item.addEventListener("click",(e)=>{
      e.stopPropagation();
      openModal({ dateKey: ev.startDate, eventId: ev.eventId, event: ev });
    });

    items.appendChild(item);
  }

  // 2) 멀티 일정(주 단위 “한 줄 스팬 바”)
  for(const wk of weeks){
    const { barsLayer, weekStartKey, weekEndKey, weekRow } = wk;

    // 이 주에 걸치는 멀티 이벤트 세그먼트
    const segs = [];
    for(const ev of allEvents){
      if(ev.startDate === ev.endDate) continue;
      const seg = splitToWeekSegment(ev, weekStartKey, weekEndKey);
      if(seg) segs.push(seg);
    }
    if(!segs.length) continue;

    segs.sort((a,b)=> a.segStart.localeCompare(b.segStart));

    // 레인 배치 (겹치면 다음 줄)
    const lanes = []; // lanes[row][col]=true
    const placed = [];

    const canPlace = (lane, s, e)=>{
      for(let k=s;k<=e;k++) if(lane[k]) return false;
      return true;
    };
    const occupy = (lane, s, e)=>{
      for(let k=s;k<=e;k++) lane[k] = true;
    };

    for(const seg of segs){
      const sCell = weekRow.querySelector(`.day[data-date-key="${seg.segStart}"]`);
      const eCell = weekRow.querySelector(`.day[data-date-key="${seg.segEnd}"]`);
      if(!sCell || !eCell) continue;

      const sCol = Number(sCell.dataset.col);
      const eCol = Number(eCell.dataset.col);

      let row = -1;
      for(let r=0;r<lanes.length;r++){
        if(canPlace(lanes[r], sCol, eCol)){ row = r; break; }
      }
      if(row === -1){
        lanes.push(new Array(7).fill(false));
        row = lanes.length - 1;
      }
      occupy(lanes[row], sCol, eCol);
      placed.push({ seg, sCol, eCol, row });
    }

    const isMobile = window.matchMedia("(max-width:640px)").matches;
    const rowH = isMobile ? 20 : 22;
    const gapY = 2;

    // 바를 그린다(주 전체 폭 기준 %)
    for(const p of placed){
      const { seg, sCol, eCol, row } = p;
      const span = (eCol - sCol + 1);

      const bar = document.createElement("div");
      bar.className = "mbar";

      const leftPct = (sCol / 7) * 100;
      const widthPct = (span / 7) * 100;

      bar.style.left = `calc(${leftPct}% + 6px)`;     // 칸 패딩 보정
      bar.style.width = `calc(${widthPct}% - 12px)`;  // 양쪽 패딩 보정
      bar.style.top = `${row * (rowH + gapY)}px`;

      const c = getMemberColor(seg.owner);
      bar.style.borderColor = c;
      bar.style.background = c + "18";
      bar.style.color = c;

      // ✅ 멀티일정은 “한 줄 바”에 텍스트 길게 표시
      bar.textContent = seg.title || "(제목없음)";

      bar.addEventListener("click",(e)=>{
        e.stopPropagation();
        openModal({ dateKey: seg.startDate, eventId: seg.eventId, event: seg });
      });

      barsLayer.appendChild(bar);
    }

    // 주 높이(칸 높이)는 그대로 두되, 바가 많아도 잘 보이게 최소 높이 확보
    const needH = (lanes.length) * (rowH + gapY) + 26;
    const oneDay = weekRow.querySelector(".day");
    const minH = Math.max(92, needH + 56); // 보기 좋게
    weekRow.querySelectorAll(".day").forEach(d=>{
      d.style.minHeight = `${minH}px`;
    });
  }
}

// ---------- save/delete ----------
saveBtn.addEventListener("click", async ()=>{
  if(!selectedName){
    alert("상단에서 이름을 먼저 선택해 주세요.");
    return;
  }

  const startDt = parseYmd(fDate.value);
  if(!startDt){
    alert("시작일이 올바르지 않습니다.");
    return;
  }
  const startKey = ymd(startDt);

  const endDt = parseYmd(fEndDate.value);
  const endKey = endDt ? ymd(endDt) : startKey;

  if(endKey < startKey){
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
    endDate: endKey,
    createdAt: serverTimestamp()
  };

  if(!payload.title){
    alert("제목은 필수입니다.");
    return;
  }

  // 수정
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

    // 시작일 변경 시 key 이동
    if(startKey !== editing.dateKey){
      const newRef = push(ref(db, `events/${startKey}`));
      await set(newRef, payload);
      await remove(ref(db, `events/${editing.dateKey}/${editing.eventId}`));
    }else{
      await update(ref(db, `events/${editing.dateKey}/${editing.eventId}`), payload);
    }
  } else {
    // 신규
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

// ---------- nav ----------
$("prevBtn").addEventListener("click", ()=>{
  current = new Date(current.getFullYear(), current.getMonth()-1, 1);
  renderCalendar();
});
$("nextBtn").addEventListener("click", ()=>{
  current = new Date(current.getFullYear(), current.getMonth()+1, 1);
  renderCalendar();
});
$("todayBtn").addEventListener("click", ()=>{
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  renderCalendar();
});

// 회전/리사이즈 시 스팬 계산 재렌더
window.addEventListener("resize", ()=> renderCalendar());

// ---------- start ----------
subscribeMembers();
subscribeEvents();
renderMemberButtons();
renderCalendar();
