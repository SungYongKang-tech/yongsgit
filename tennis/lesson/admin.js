import { db, auth } from "../firebase.js";
import {
  ref, onValue, get, set, update, push, remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

/* =========================
   Helpers
========================= */
const $ = (id) => document.getElementById(id);

function toast(msg){
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.classList.remove("show"), 1500);
}

const days = ()=> (["mon","tue","wed","thu","fri"]);
const dayLabel = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금" };
const slotRows = [
  { key:"morning", label:"아침" },
  { key:"lunch", label:"점심" },
  { key:"evening", label:"저녁" }
];

function nameOnly(v){
  return (v?.name || "").trim();
}

/* =========================
   Paths (✅ 여기만 바꾸면 전체 회원 경로 변경 가능)
========================= */
const PATH = {
  allMembers: "members",          // ✅ 전체 테니스 회원 (필요시 tennis/members 등으로 변경)
  coaches: "lesson/coaches",      // 레슨자(회원 중 선택된 사람)
  schedule: "lesson/schedule",    // 시간표
  guide: "lesson/guide",          // 안내문
  waiting: "lesson/waiting"       // 대기자
};

/* =========================
   State
========================= */
let members = {};   // 전체 회원 (id -> {name, grade?})
let coaches = {};   // 레슨자 (memberId -> {name})
let schedule = null;

/* =========================
   Auth
========================= */
async function initAuth(){
  $("statusText").textContent = "익명 로그인 중…";
  await signInAnonymously(auth);
  $("statusText").textContent = "Firebase 연결됨";
}

/* =========================
   Bind: members / coaches / schedule / guide / waiting
========================= */
function bindAllMembers(){
  onValue(ref(db, PATH.allMembers), (snap)=>{
    members = snap.exists() ? snap.val() : {};
    renderMemberGrid();
  });
}

function bindCoaches(){
  onValue(ref(db, PATH.coaches), (snap)=>{
    coaches = snap.exists() ? snap.val() : {};
    renderCoachChips();
    renderScheduleTable(); // 레슨자 목록이 바뀌면 시간표 select도 갱신
    renderMemberGrid();    // 모달 버튼 on/off 갱신
  });
}

function ensureScheduleShape(){
  schedule = schedule || {};
  schedule.times = schedule.times || { morning:"", lunch:"", evening:"" };
  schedule.slots = schedule.slots || {
    morning:{}, lunch:{}, evening:{}
  };

  slotRows.forEach(r=>{
    schedule.slots[r.key] = schedule.slots[r.key] || {};
    days().forEach(d=>{
      if(schedule.slots[r.key][d] === undefined) schedule.slots[r.key][d] = "";
    });
  });
}

function bindSchedule(){
  onValue(ref(db, PATH.schedule), (snap)=>{
    schedule = snap.exists() ? snap.val() : null;
    ensureScheduleShape();
    renderScheduleTable();
  });
}

function bindGuide(){
  onValue(ref(db, PATH.guide), (snap)=>{
    $("guideText").value = snap.exists() ? (snap.val() || "") : "";
  });
}

function bindWaiting(){
  onValue(ref(db, PATH.waiting), (snap)=>{
    const data = snap.exists() ? snap.val() : {};
    renderWaiting(data);
  });
}

/* =========================
   Lesson Coaches: select from members
========================= */
function openPicker(){
  $("pickerBack").classList.add("show");
  $("memberSearch").value = "";
  renderMemberGrid();
  $("memberSearch").focus();
}
function closePicker(){
  $("pickerBack").classList.remove("show");
}

function isCoach(memberId){
  return !!coaches?.[memberId];
}

async function toggleCoach(memberId){
  const m = members?.[memberId];
  if(!m) return;

  if(isCoach(memberId)){
    // 레슨자 해제: coaches에서 제거 + 시간표에 배정된 것도 제거(선택사항)
    await remove(ref(db, `${PATH.coaches}/${memberId}`));

    // 시간표에서 해당 레슨자 들어간 칸 비우기
    if(schedule){
      ensureScheduleShape();
      let changed = false;
      slotRows.forEach(r=>{
        days().forEach(d=>{
          if(schedule.slots[r.key][d] === memberId){
            schedule.slots[r.key][d] = "";
            changed = true;
          }
        });
      });
      if(changed) await set(ref(db, PATH.schedule), schedule);
    }

    toast("레슨자 해제");
  }else{
    await set(ref(db, `${PATH.coaches}/${memberId}`), {
      name: nameOnly(m)
    });
    toast("레슨자 등록");
  }
}

/* 칩(레슨자 목록) */
function renderCoachChips(){
  const el = $("coachChips");
  el.innerHTML = "";

  const ids = Object.keys(coaches || {});
  if(ids.length === 0){
    el.innerHTML = `<div class="mut">아직 레슨자가 없습니다. [회원에서 선택]으로 지정하세요.</div>`;
    return;
  }

  // 이름순
  ids.sort((a,b)=> (nameOnly(coaches[a]) || "").localeCompare(nameOnly(coaches[b]) || ""));

  ids.forEach(id=>{
    const c = coaches[id] || {};
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = nameOnly(c) || "(이름없음)";
    const sm = document.createElement("small");
    sm.textContent = "해제";
    chip.appendChild(sm);
    chip.addEventListener("click", ()=> toggleCoach(id));
    el.appendChild(chip);
  });
}

/* 모달 회원 버튼 */
function renderMemberGrid(){
  const grid = $("memberGrid");
  if(!grid) return;
  grid.innerHTML = "";

  const q = ($("memberSearch")?.value || "").trim().toLowerCase();

  const entries = Object.entries(members || {})
    .map(([id,v])=>({id, name:nameOnly(v), raw:v}))
    .filter(x=> x.name)
    .filter(x=> !q || x.name.toLowerCase().includes(q))
    .sort((a,b)=> a.name.localeCompare(b.name));

  if(entries.length === 0){
    grid.innerHTML = `<div class="mut">표시할 회원이 없습니다.</div>`;
    return;
  }

  entries.forEach(x=>{
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mbtn" + (isCoach(x.id) ? " on" : "");
    b.textContent = x.name; // ✅ 등급 표시 없음
    b.addEventListener("click", ()=> toggleCoach(x.id));
    grid.appendChild(b);
  });
}

/* =========================
   Schedule (times + slots)
========================= */
function coachOptionsHTML(selectedId){
  let html = `<option value="">-</option>`;

  const ids = Object.keys(coaches || {});
  ids.sort((a,b)=>{
    const na = nameOnly(coaches[a]) || "";
    const nb = nameOnly(coaches[b]) || "";
    return na.localeCompare(nb);
  });

  ids.forEach(id=>{
    const label = nameOnly(coaches[id]) || "(이름없음)"; // ✅ 등급 제거
    const sel = (id === selectedId) ? "selected" : "";
    html += `<option value="${id}" ${sel}>${label}</option>`;
  });

  return html;
}

function renderScheduleTable(){
  const tbody = $("scheduleBody");
  if(!tbody) return;

  ensureScheduleShape();
  tbody.innerHTML = "";

  slotRows.forEach(r=>{
    const tr = document.createElement("tr");

    // 구분
    const th = document.createElement("th");
    th.textContent = r.label;
    tr.appendChild(th);

    // ✅ 시간 입력
    const tdTime = document.createElement("td");
    const timeInput = document.createElement("input");
    timeInput.className = "time-input";
    timeInput.placeholder = "예: 07:00~08:00";
    timeInput.value = schedule.times?.[r.key] || "";
    timeInput.addEventListener("input", ()=>{
      schedule.times[r.key] = timeInput.value;
    });
    tdTime.appendChild(timeInput);
    tr.appendChild(tdTime);

    // 월~금
    days().forEach(d=>{
      const td = document.createElement("td");
      const sel = document.createElement("select");

      sel.innerHTML = coachOptionsHTML(schedule.slots[r.key][d] || "");
      sel.disabled = (Object.keys(coaches||{}).length === 0);

      sel.addEventListener("change", ()=>{
        schedule.slots[r.key][d] = sel.value || "";
      });

      td.appendChild(sel);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

async function saveSchedule(){
  ensureScheduleShape();
  await set(ref(db, PATH.schedule), schedule);
  toast("시간표 저장 완료");
}

/* =========================
   Guide
========================= */
async function saveGuide(){
  const txt = ($("guideText").value || "");
  await set(ref(db, PATH.guide), txt);
  toast("안내문 저장 완료");
}

/* =========================
   Waiting list
========================= */
async function addWaiting(){
  const name = ($("waitingName").value || "").trim();
  if(!name) return toast("이름을 입력하세요.");

  await push(ref(db, PATH.waiting), {
    name,
    createdAt: Date.now()
  });

  $("waitingName").value = "";
  toast("대기자 추가");
}

function renderWaiting(data){
  const el = $("waitingList");
  const entries = Object.entries(data || {});
  if(entries.length === 0){
    el.textContent = "현재 대기자가 없습니다.";
    return;
  }

  // 등록 순서(혹은 이름순 원하면 바꿔도 됨)
  entries.sort((a,b)=> (a[1]?.createdAt||0) - (b[1]?.createdAt||0));

  // ✅ 공간 덜 차지: 한 줄 텍스트 + (삭제) 작게
  el.innerHTML = "";
  entries.forEach(([key, v], idx)=>{
    const name = (v?.name || "").trim();
    if(!name) return;

    const span = document.createElement("span");
    span.textContent = name;

    const del = document.createElement("button");
    del.className = "btn danger";
    del.style.padding = "4px 8px";
    del.style.fontSize = "12px";
    del.style.marginLeft = "6px";
    del.textContent = "삭제";
    del.addEventListener("click", async ()=>{
      await remove(ref(db, `${PATH.waiting}/${key}`));
      toast("삭제 완료");
    });

    const wrap = document.createElement("span");
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";

    wrap.appendChild(span);
    wrap.appendChild(del);

    el.appendChild(wrap);

    if(idx !== entries.length - 1){
      const sep = document.createElement("span");
      sep.textContent = "  ·  ";
      el.appendChild(sep);
    }
  });
}

/* =========================
   Wire
========================= */
$("refreshBtn").addEventListener("click", ()=> location.reload());

$("openPickerBtn").addEventListener("click", openPicker);
$("closePickerBtn").addEventListener("click", closePicker);
$("pickerBack").addEventListener("click", (e)=>{
  if(e.target === $("pickerBack")) closePicker();
});
$("memberSearch").addEventListener("input", renderMemberGrid);

$("saveScheduleBtn").addEventListener("click", saveSchedule);
$("saveGuideBtn").addEventListener("click", saveGuide);

$("addWaitingBtn").addEventListener("click", addWaiting);
$("waitingName").addEventListener("keydown", (e)=>{
  if(e.key === "Enter") addWaiting();
});

/* =========================
   Init
========================= */
(async function main(){
  try{
    await initAuth();
    bindAllMembers();
    bindCoaches();
    bindSchedule();
    bindGuide();
    bindWaiting();
  }catch(e){
    console.error(e);
    $("statusText").textContent = "오류(콘솔 확인)";
    toast("연결 오류");
  }
})();