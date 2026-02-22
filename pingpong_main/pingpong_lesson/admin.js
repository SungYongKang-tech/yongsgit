// ✅ pingpong_main/firebase.js 사용 (레슨 폴더에서 ../firebase.js 가 맞음)
import { db, auth } from "../firebase.js";

// ✅ Firebase SDK 버전 통일: 9.22.2 → 10.12.4
import {
  ref, onValue, get, set, update, push, remove
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

/* =========================
   ✅ Guard (2중 방어)
   - 인증값 없으면 admin 페이지 사용 불가
========================= */
if (localStorage.getItem("koenAdminAuth") !== "ok") {
  alert("관리자 인증이 필요합니다.");
  location.href = "./index.html";
}

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

const DAYS = ["mon","tue","wed","thu","fri"];
const dayLabel = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금" };
const SLOTS = [
  { key:"morning", label:"아침" },
  { key:"lunch", label:"점심" },
  { key:"evening", label:"저녁" }
];

function nameOnly(v){
  return (v?.name || "").trim();
}

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/* =========================
   Paths (✅ 회원 경로 필요시 여기만 수정)
========================= */
const PATH = {
  allMembers: "members",
  coaches: "lesson/coaches",
  schedule: "lesson/schedule",
  guide: "lesson/guide",
  waiting: "lesson/waiting"
};

/* =========================
   State
========================= */
let members = {};
let coaches = {};
let schedule = null; // { slots: {morning:[{id,time,assign:{mon:coachId..}}], ...} }

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
    renderScheduleUI();
    renderMemberGrid();
  });
}

function ensureScheduleShape(){
  if(!schedule) schedule = {};
  if(!schedule.slots) schedule.slots = {};
  SLOTS.forEach(s=>{
    if(!Array.isArray(schedule.slots[s.key])) schedule.slots[s.key] = [];
  });

  // 각 타임의 assign 보정
  SLOTS.forEach(s=>{
    schedule.slots[s.key].forEach(t=>{
      if(!t.id) t.id = uid();
      if(typeof t.time !== "string") t.time = "";
      if(!t.assign) t.assign = {};
      DAYS.forEach(d=>{
        if(t.assign[d] === undefined) t.assign[d] = "";
      });
    });
  });
}

function bindSchedule(){
  onValue(ref(db, PATH.schedule), (snap)=>{
    schedule = snap.exists() ? snap.val() : null;
    ensureScheduleShape();
    renderScheduleUI();
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
   Coaches: select from members
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
    // 레슨자 해제
    await remove(ref(db, `${PATH.coaches}/${memberId}`));

    // 시간표 배정에서 제거
    if(schedule){
      ensureScheduleShape();
      let changed = false;
      SLOTS.forEach(s=>{
        schedule.slots[s.key].forEach(t=>{
          DAYS.forEach(d=>{
            if(t.assign[d] === memberId){
              t.assign[d] = "";
              changed = true;
            }
          });
        });
      });
      if(changed) await set(ref(db, PATH.schedule), schedule);
    }

    toast("레슨자 해제");
  }else{
    await set(ref(db, `${PATH.coaches}/${memberId}`), { name: nameOnly(m) });
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

  ids.sort((a,b)=> (nameOnly(coaches[a])||"").localeCompare(nameOnly(coaches[b])||""));

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
    .map(([id,v])=>({id, name:nameOnly(v)}))
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
    b.textContent = x.name; // 등급 표시 없음
    b.addEventListener("click", ()=> toggleCoach(x.id));
    grid.appendChild(b);
  });
}

/* =========================
   ✅ Schedule: 멀티 타임 UI
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
    const label = nameOnly(coaches[id]) || "(이름없음)";
    html += `<option value="${id}" ${id===selectedId?"selected":""}>${label}</option>`;
  });
  return html;
}

function addTime(slotKey){
  ensureScheduleShape();
  schedule.slots[slotKey].push({
    id: uid(),
    time: "",
    assign: { mon:"",tue:"",wed:"",thu:"",fri:"" }
  });
  renderScheduleUI();
}

function deleteTime(slotKey, timeId){
  ensureScheduleShape();
  schedule.slots[slotKey] = schedule.slots[slotKey].filter(t=> t.id !== timeId);
  renderScheduleUI();
}

function renderScheduleUI(){
  const wrap = $("scheduleWrap");
  if(!wrap) return;

  ensureScheduleShape();
  wrap.innerHTML = "";

  const hasCoach = Object.keys(coaches||{}).length > 0;

  SLOTS.forEach(slot=>{
    const box = document.createElement("div");
    box.className = "slotCard";

    const hd = document.createElement("div");
    hd.className = "slotHd";
    hd.innerHTML = `
      <div>
        <div class="ttl">${slot.label}</div>
        <div class="mini">타임을 추가한 뒤, 요일별 레슨자를 선택하세요.</div>
      </div>
    `;

    const addBtn = document.createElement("button");
    addBtn.className = "btn ok";
    addBtn.type = "button";
    addBtn.textContent = "+ 타임 추가";
    addBtn.addEventListener("click", ()=> addTime(slot.key));
    hd.appendChild(addBtn);

    box.appendChild(hd);

    const table = document.createElement("table");
    table.className = "sTable";

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th style="width:140px">시간</th>
        <th>${dayLabel.mon}</th><th>${dayLabel.tue}</th><th>${dayLabel.wed}</th><th>${dayLabel.thu}</th><th>${dayLabel.fri}</th>
        <th style="width:84px">삭제</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    const list = schedule.slots[slot.key] || [];
    if(list.length === 0){
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" class="mini" style="padding:12px">타임이 없습니다. “+ 타임 추가”를 눌러 추가하세요.</td>`;
      tbody.appendChild(tr);
    }else{
      list.forEach(t=>{
        const tr = document.createElement("tr");

        const tdTime = document.createElement("td");
        const inp = document.createElement("input");
        inp.className = "time-input";
        inp.placeholder = "예: 07:00~08:00";
        inp.value = t.time || "";
        inp.addEventListener("input", ()=>{
          t.time = inp.value;
        });
        tdTime.appendChild(inp);
        tr.appendChild(tdTime);

        DAYS.forEach(d=>{
          const td = document.createElement("td");
          const sel = document.createElement("select");
          sel.innerHTML = coachOptionsHTML(t.assign?.[d] || "");
          sel.disabled = !hasCoach;
          sel.addEventListener("change", ()=>{
            t.assign[d] = sel.value || "";
          });
          td.appendChild(sel);
          tr.appendChild(td);
        });

        const tdDel = document.createElement("td");
        const del = document.createElement("button");
        del.className = "del-mini";
        del.type = "button";
        del.textContent = "삭제";
        del.addEventListener("click", ()=> deleteTime(slot.key, t.id));
        tdDel.appendChild(del);
        tr.appendChild(tdDel);

        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody);
    box.appendChild(table);
    wrap.appendChild(box);
  });
}

async function saveSchedule(){
  ensureScheduleShape();

  SLOTS.forEach(s=>{
    schedule.slots[s.key] = (schedule.slots[s.key] || []).filter(t=>{
      const timeHas = (t.time || "").trim().length > 0;
      const anyAssign = DAYS.some(d => (t.assign?.[d] || "").trim().length > 0);
      return timeHas || anyAssign;
    });
  });

  await set(ref(db, PATH.schedule), schedule);
  toast("시간표 저장 완료");
}

/* =========================
   Guide
========================= */
async function saveGuide(){
  await set(ref(db, PATH.guide), ($("guideText").value || ""));
  toast("안내문 저장 완료");
}

/* =========================
   Waiting list
========================= */
async function addWaiting(){
  const name = ($("waitingName").value || "").trim();
  if(!name) return toast("이름을 입력하세요.");

  await push(ref(db, PATH.waiting), { name, createdAt: Date.now() });
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

  entries.sort((a,b)=> (a[1]?.createdAt||0) - (b[1]?.createdAt||0));

  el.innerHTML = "";
  entries.forEach(([key, v], idx)=>{
    const name = (v?.name || "").trim();
    if(!name) return;

    const wrap = document.createElement("span");
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";

    const span = document.createElement("span");
    span.textContent = name;

    const del = document.createElement("button");
    del.className = "btn danger";
    del.type = "button";
    del.style.padding = "4px 8px";
    del.style.fontSize = "12px";
    del.textContent = "삭제";
    del.addEventListener("click", async ()=>{
      await remove(ref(db, `${PATH.waiting}/${key}`));
      toast("삭제 완료");
    });

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
   ✅ Logout (admin.html에 #logoutBtn이 있을 때)
========================= */
function wireLogout(){
  const btn = $("logoutBtn");
  if(!btn) return;
  btn.addEventListener("click", ()=>{
    localStorage.removeItem("koenAdminAuth");
    location.href = "./index.html";
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
    wireLogout();
    await initAuth();
    bindAllMembers();
    bindCoaches();
    bindSchedule();
    bindGuide();
    bindWaiting();
    renderScheduleUI();
  }catch(e){
    console.error(e);
    $("statusText").textContent = "오류(콘솔 확인)";
    toast("연결 오류");
  }
})();