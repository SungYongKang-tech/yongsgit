// 모임 일정 달력 (LocalStorage 기반) - 기본형

const $ = (sel) => document.querySelector(sel);

const grid = $("#grid");
const monthLabel = $("#monthLabel");
const selectedLabel = $("#selectedLabel");

const prevBtn = $("#prevBtn");
const nextBtn = $("#nextBtn");
const todayBtn = $("#todayBtn");
const addBtn = $("#addBtn");
const quickAddBtn = $("#quickAddBtn");
const searchInput = $("#searchInput");

const eventList = $("#eventList");
const emptyList = $("#emptyList");
const listCount = $("#listCount");

const modal = $("#modal");
const modalBackdrop = $("#modalBackdrop");
const closeModalBtn = $("#closeModalBtn");
const cancelBtn = $("#cancelBtn");
const deleteBtn = $("#deleteBtn");
const eventForm = $("#eventForm");

const eventId = $("#eventId");
const dateInput = $("#dateInput");
const startInput = $("#startInput");
const endInput = $("#endInput");
const titleInput = $("#titleInput");
const placeInput = $("#placeInput");
const noteInput = $("#noteInput");
const tagInput = $("#tagInput");

const STORAGE_KEY = "koen_meeting_calendar_v1";

function pad2(n){ return String(n).padStart(2,"0"); }
function toISODate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function parseISODate(s){
  // YYYY-MM-DD
  const [y,m,dd] = s.split("-").map(Number);
  return new Date(y, m-1, dd);
}
function formatKoreanDate(iso){
  const d = parseISODate(iso);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
}
function isSameDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function uid(){
  return (crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
}

function loadEvents(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return [];
    const data = JSON.parse(raw);
    if(!Array.isArray(data)) return [];
    return data;
  }catch(e){
    console.warn("loadEvents failed:", e);
    return [];
  }
}
function saveEvents(events){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

let events = loadEvents();

// 상태
let current = new Date();                 // 현재 달력에 보여줄 기준(월)
current.setDate(1);
let selectedDateISO = toISODate(new Date());
let searchText = "";

// ---- 렌더링 ----
function render(){
  renderHeader();
  renderCalendar();
  renderSideList();
}

function renderHeader(){
  const y = current.getFullYear();
  const m = current.getMonth() + 1;
  monthLabel.textContent = `${y}년 ${m}월`;
  selectedLabel.textContent = formatKoreanDate(selectedDateISO);
}

function getMonthMatrix(base){
  const y = base.getFullYear();
  const m = base.getMonth();

  const first = new Date(y, m, 1);
  const startDay = first.getDay(); // 0=Sun
  const start = new Date(y, m, 1 - startDay); // 그리드 시작(일요일)

  const cells = [];
  for(let i=0;i<42;i++){
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function eventsByDate(){
  const map = new Map();
  for(const e of events){
    if(!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  // 같은 날짜 내 정렬(시간 -> 제목)
  for(const [k,list] of map.entries()){
    list.sort((a,b)=>{
      const ta = (a.start||"").localeCompare(b.start||"");
      if(ta!==0) return ta;
      return (a.title||"").localeCompare(b.title||"");
    });
  }
  return map;
}

function renderCalendar(){
  const cells = getMonthMatrix(current);
  const map = eventsByDate();
  const today = new Date();

  grid.innerHTML = "";

  const curMonth = current.getMonth();

  for(const d of cells){
    const iso = toISODate(d);
    const inMonth = d.getMonth() === curMonth;

    const cell = document.createElement("div");
    cell.className = "cell" + (inMonth ? "" : " muted") + (isSameDay(d,today) ? " today" : "");
    cell.dataset.date = iso;

    const top = document.createElement("div");
    top.className = "date-row";

    const num = document.createElement("div");
    num.className = "date-num";
    num.textContent = d.getDate();

    const dots = document.createElement("div");
    dots.className = "dot-wrap";

    const dayEvents = map.get(iso) || [];
    const dotCount = Math.min(3, dayEvents.length);
    for(let i=0;i<dotCount;i++){
      const dot = document.createElement("div");
      dot.className = "dot";
      dots.appendChild(dot);
    }
    if(dayEvents.length > 3){
      const more = document.createElement("div");
      more.className = "dot more";
      dots.appendChild(more);
    }

    top.appendChild(num);
    top.appendChild(dots);

    const preview = document.createElement("div");
    preview.className = "preview";

    // 미리보기 최대 2개
    dayEvents.slice(0,2).forEach(ev=>{
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = `${ev.start ? ev.start+" " : ""}${ev.title}`;
      preview.appendChild(chip);
    });

    cell.appendChild(top);
    cell.appendChild(preview);

    cell.addEventListener("click", () => {
      selectedDateISO = iso;
      renderSideList();
      renderHeader();
    });

    cell.addEventListener("dblclick", () => {
      selectedDateISO = iso;
      openCreateModal(iso);
    });

    grid.appendChild(cell);
  }
}

function matchesSearch(ev, q){
  if(!q) return true;
  const t = q.toLowerCase();
  const hay = `${ev.title||""} ${ev.place||""} ${ev.note||""} ${ev.tag||""}`.toLowerCase();
  return hay.includes(t);
}

function getFilteredEvents(){
  // 선택 날짜 + 검색
  const list = events
    .filter(e => e.date === selectedDateISO)
    .filter(e => matchesSearch(e, searchText))
    .sort((a,b)=>{
      const ta = (a.start||"").localeCompare(b.start||"");
      if(ta!==0) return ta;
      return (a.title||"").localeCompare(b.title||"");
    });
  return list;
}

function renderSideList(){
  const list = getFilteredEvents();
  eventList.innerHTML = "";
  listCount.textContent = String(list.length);
  emptyList.style.display = list.length ? "none" : "block";

  for(const ev of list){
    const card = document.createElement("div");
    card.className = "event-card";
    card.dataset.id = ev.id;

    const top = document.createElement("div");
    top.className = "event-top";

    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = ev.title || "(제목 없음)";

    const time = document.createElement("div");
    time.className = "event-time";
    const t = [ev.start, ev.end].filter(Boolean).join("~");
    time.textContent = t || "시간 없음";

    top.appendChild(title);
    top.appendChild(time);

    const meta = document.createElement("div");
    meta.className = "event-meta";

    const tag = (ev.tag||"").trim();
    const place = (ev.place||"").trim();
    const parts = [];
    if(tag) parts.push(`<span class="tag">${escapeHTML(tag)}</span>`);
    if(place) parts.push(`📍 ${escapeHTML(place)}`);
    meta.innerHTML = parts.join(" ");

    if(ev.note){
      const note = document.createElement("div");
      note.className = "event-meta";
      note.textContent = ev.note;
      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(note);
    }else{
      card.appendChild(top);
      card.appendChild(meta);
    }

    card.addEventListener("click", () => openEditModal(ev.id));

    eventList.appendChild(card);
  }

  // 달력에도 표시 업데이트
  renderCalendar();
}

function escapeHTML(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

// ---- 모달 ----
function openModal(){
  modal.classList.remove("hidden");
  modalBackdrop.classList.remove("hidden");
}
function closeModal(){
  modal.classList.add("hidden");
  modalBackdrop.classList.add("hidden");
  eventForm.reset();
  eventId.value = "";
  deleteBtn.classList.add("hidden");
}

function openCreateModal(dateISO){
  $("#modalTitle").textContent = "일정 추가";
  deleteBtn.classList.add("hidden");
  eventId.value = "";

  dateInput.value = dateISO || selectedDateISO;
  startInput.value = "";
  endInput.value = "";
  titleInput.value = "";
  placeInput.value = "";
  noteInput.value = "";
  tagInput.value = "";

  openModal();
  titleInput.focus();
}

function openEditModal(id){
  const ev = events.find(e => e.id === id);
  if(!ev) return;

  $("#modalTitle").textContent = "일정 수정";
  deleteBtn.classList.remove("hidden");

  eventId.value = ev.id;
  dateInput.value = ev.date;
  startInput.value = ev.start || "";
  endInput.value = ev.end || "";
  titleInput.value = ev.title || "";
  placeInput.value = ev.place || "";
  noteInput.value = ev.note || "";
  tagInput.value = ev.tag || "";

  openModal();
}

// ---- 이벤트 핸들러 ----
prevBtn.addEventListener("click", () => {
  current = new Date(current.getFullYear(), current.getMonth()-1, 1);
  render();
});
nextBtn.addEventListener("click", () => {
  current = new Date(current.getFullYear(), current.getMonth()+1, 1);
  render();
});
todayBtn.addEventListener("click", () => {
  const t = new Date();
  current = new Date(t.getFullYear(), t.getMonth(), 1);
  selectedDateISO = toISODate(t);
  render();
});

addBtn.addEventListener("click", () => openCreateModal(selectedDateISO));
quickAddBtn.addEventListener("click", () => openCreateModal(selectedDateISO));

closeModalBtn.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

searchInput.addEventListener("input", (e) => {
  searchText = e.target.value.trim();
  renderSideList();
});

eventForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = eventId.value || uid();
  const date = dateInput.value;
  const start = startInput.value.trim();
  const end = endInput.value.trim();
  const title = titleInput.value.trim();
  const place = placeInput.value.trim();
  const note = noteInput.value.trim();
  const tag = tagInput.value.trim();

  if(!date || !title){
    alert("날짜와 제목은 필수입니다.");
    return;
  }
  if(start && end && start > end){
    alert("종료 시간이 시작 시간보다 빠릅니다.");
    return;
  }

  const payload = { id, date, start, end, title, place, note, tag };

  const idx = events.findIndex(e2 => e2.id === id);
  if(idx >= 0) events[idx] = payload;
  else events.push(payload);

  saveEvents(events);

  selectedDateISO = date; // 저장한 날짜로 선택 이동
  // current 월도 맞춰 이동
  const d = parseISODate(date);
  current = new Date(d.getFullYear(), d.getMonth(), 1);

  closeModal();
  render();
});

deleteBtn.addEventListener("click", () => {
  const id = eventId.value;
  if(!id) return;
  const ok = confirm("이 일정을 삭제할까요?");
  if(!ok) return;

  events = events.filter(e => e.id !== id);
  saveEvents(events);

  closeModal();
  render();
});

// 초기 렌더
render();
