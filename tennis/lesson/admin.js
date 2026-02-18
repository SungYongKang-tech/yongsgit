import { db, auth } from "../firebase.js";
import {
  ref, onValue, get, set, update, remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

const $ = (id) => document.getElementById(id);

function toast(msg){
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>el.classList.remove("show"), 1400);
}

/* =========================
   Firebase paths
========================= */
const PATH = {
  members: "members",               // 전체 테니스 회원(이미 사용 중)
  coaches: "lesson/coaches",         // 레슨자(선택된 회원들)
  guide: "lesson/guide",             // 안내문
  schedule: "lesson/schedule",       // 시간표(아침/점심/저녁)
  waiting: "lesson/waiting"          // 대기자
};

/* =========================
   In-memory caches
========================= */
let members = {};    // {memberId:{name,grade,...}}
let coaches = {};    // {memberId:{name,grade}}  (members에서 선택된 것만)
let schedule = {};   // {morning:{mon:memberId,...}, lunch..., evening...}

/* =========================
   Auth init (rules: auth != null)
========================= */
async function initAuth(){
  $("statusText").textContent = "익명 로그인 중…";
  await signInAnonymously(auth);
  $("statusText").textContent = "Firebase 연결됨";
}

/* =========================
   Helpers
========================= */
function normGrade(g){
  const G = (g || "B").toUpperCase();
  return ["A","B","C","D"].includes(G) ? G : "B";
}
function nameWithGrade(obj){
  const n = (obj?.name || "").trim();
  const g = normGrade(obj?.grade);
  return n ? `${n}(${g})` : "(이름없음)";
}
function days(){
  // 월~금
  return ["mon","tue","wed","thu","fri"];
}
function dayLabel(key){
  return ({mon:"월",tue:"화",wed:"수",thu:"목",fri:"금"})[key] || key;
}

/* =========================
   Coaches UI
   - 선택된 레슨자는 chips로 표시
   - chip 클릭하면 해제(= coaches에서 제거)
========================= */
function renderCoachChips(){
  const el = $("coachChips");
  el.innerHTML = "";

  const ids = Object.keys(coaches || {});
  if(ids.length === 0){
    el.innerHTML = `<div class="mut">레슨자가 아직 없습니다. [회원에서 선택]으로 지정하세요.</div>`;
    // 시간표 렌더에서 드롭다운도 갱신
    renderScheduleTable();
    return;
  }

  // A→D, 이름순 정렬
  const order = {A:1,B:2,C:3,D:4};
  ids.sort((a,b)=>{
    const va = coaches[a] || {};
    const vb = coaches[b] || {};
    const ga = order[normGrade(va.grade)] || 99;
    const gb = order[normGrade(vb.grade)] || 99;
    if(ga !== gb) return ga - gb;
    return (va.name||"").localeCompare(vb.name||"");
  });

  ids.forEach((id)=>{
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = nameWithGrade(coaches[id]);
    chip.title = "클릭하면 레슨자에서 제외됩니다.";
    chip.addEventListener("click", async ()=>{
      // coaches에서 제거
      await remove(ref(db, `${PATH.coaches}/${id}`));

      // 시간표에서 이 사람이 설정된 칸은 비우기(데이터 꼬임 방지)
      const cleared = clearScheduleMember(id);
      if(cleared) await set(ref(db, PATH.schedule), schedule);

      toast("레슨자 해제");
    });
    el.appendChild(chip);
  });

  // 시간표 드롭다운 갱신
  renderScheduleTable();
}

/* =========================
   Member picker (modal)
   - 전체 회원을 버튼으로 표시
   - 클릭하면 coaches에 등록/해제(토글)
========================= */
function openPicker(){
  $("pickerBack").classList.add("show");
  $("memberSearch").value = "";
  renderMemberGrid("");
  $("memberSearch").focus();
}
function closePicker(){
  $("pickerBack").classList.remove("show");
}

function isCoach(memberId){
  return !!(coaches && coaches[memberId]);
}

async function toggleCoach(memberId){
  const m = members[memberId];
  if(!m) return;

  if(isCoach(memberId)){
    await remove(ref(db, `${PATH.coaches}/${memberId}`));
    toast("레슨자 해제");
    // 시간표에서도 제거
    const cleared = clearScheduleMember(memberId);
    if(cleared) await set(ref(db, PATH.schedule), schedule);
  }else{
    // coaches는 memberId를 key로 저장하면 중복 방지 깔끔합니다
    await set(ref(db, `${PATH.coaches}/${memberId}`), {
      name: (m.name || "").trim(),
      grade: normGrade(m.grade)
    });
    toast("레슨자 등록");
  }
}

function renderMemberGrid(q){
  const grid = $("memberGrid");
  grid.innerHTML = "";

  const query = (q || "").trim();
  const ids = Object.keys(members || {});
  if(ids.length === 0){
    grid.innerHTML = `<div class="mut">회원 데이터(members)가 비어있습니다. 먼저 테니스 관리자에서 회원을 등록하세요.</div>`;
    return;
  }

  // 필터 + 정렬
  const order = {A:1,B:2,C:3,D:4};
  const filtered = ids
    .filter(id=>{
      const label = nameWithGrade(members[id]);
      return !query || label.includes(query);
    })
    .sort((a,b)=>{
      const va = members[a] || {};
      const vb = members[b] || {};
      const ga = order[normGrade(va.grade)] || 99;
      const gb = order[normGrade(vb.grade)] || 99;
      if(ga !== gb) return ga - gb;
      return (va.name||"").localeCompare(vb.name||"");
    });

  filtered.forEach((id)=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mbtn" + (isCoach(id) ? " on" : "");
    btn.textContent = nameWithGrade(members[id]);
    btn.addEventListener("click", async ()=>{
      await toggleCoach(id);
      // UI만 갱신(데이터는 onValue로 다시 들어오지만 체감속도 위해 즉시 반영)
      btn.classList.toggle("on");
    });
    grid.appendChild(btn);
  });
}

/* =========================
   Schedule (아침/점심/저녁 x 월~금)
   - 각 칸: 레슨자 memberId 저장
========================= */
function ensureScheduleShape(){
  schedule = schedule || {};
  schedule.morning = schedule.morning || {};
  schedule.lunch   = schedule.lunch   || {};
  schedule.evening = schedule.evening || {};
  days().forEach(d=>{
    if(schedule.morning[d] === undefined) schedule.morning[d] = "";
    if(schedule.lunch[d] === undefined)   schedule.lunch[d]   = "";
    if(schedule.evening[d] === undefined) schedule.evening[d] = "";
  });
}

function clearScheduleMember(memberId){
  let changed = false;
  ["morning","lunch","evening"].forEach(slot=>{
    days().forEach(d=>{
      if(schedule?.[slot]?.[d] === memberId){
        schedule[slot][d] = "";
        changed = true;
      }
    });
  });
  return changed;
}

function coachOptionsHTML(selectedId){
  // 첫 번째 옵션: 비우기
  let html = `<option value="">-</option>`;

  const ids = Object.keys(coaches || {});
  // A→D, 이름순
  const order = {A:1,B:2,C:3,D:4};
  ids.sort((a,b)=>{
    const va = coaches[a] || {};
    const vb = coaches[b] || {};
    const ga = order[normGrade(va.grade)] || 99;
    const gb = order[normGrade(vb.grade)] || 99;
    if(ga !== gb) return ga - gb;
    return (va.name||"").localeCompare(vb.name||"");
  });

  ids.forEach(id=>{
    const label = nameWithGrade(coaches[id]);
    const sel = (id === selectedId) ? "selected" : "";
    html += `<option value="${id}" ${sel}>${label}</option>`;
  });
  return html;
}

function renderScheduleTable(){
  ensureScheduleShape();

  const tbody = $("scheduleBody");
  tbody.innerHTML = "";

  const rows = [
    { key:"morning", label:"아침" },
    { key:"lunch",   label:"점심" },
    { key:"evening", label:"저녁" }
  ];

  rows.forEach(r=>{
    const tr = document.createElement("tr");

    const th = document.createElement("th");
    th.textContent = r.label;
    tr.appendChild(th);

    days().forEach(d=>{
      const td = document.createElement("td");
      const sel = document.createElement("select");
      sel.innerHTML = coachOptionsHTML(schedule[r.key][d] || "");

      // 레슨자가 0명이면 선택 자체를 막고 안내
      if(Object.keys(coaches||{}).length === 0){
        sel.disabled = true;
      }

      sel.addEventListener("change", ()=>{
        schedule[r.key][d] = sel.value || "";
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
  await set(ref(db, PATH.guide), $("guideText").value || "");
  toast("안내문 저장 완료");
}

/* =========================
   Waiting list
========================= */
function renderWaiting(data){
  const el = $("waitingList");
  const entries = Object.entries(data || {});
  if(entries.length === 0){
    el.textContent = "현재 대기자가 없습니다.";
    return;
  }
  // name만 뽑아 보기 좋게 표시
  const names = entries.map(([_,v])=> (v?.name||"").trim()).filter(Boolean);
  el.textContent = names.join(" · ");
}

async function addWaiting(){
  const name = ($("waitingName").value || "").trim();
  if(!name) return;

  // push id 생성은 set으로 간단히 구현
  const waitingRef = ref(db, PATH.waiting);
  const snap = await get(waitingRef);
  const cur = snap.exists() ? (snap.val()||{}) : {};
  // 새 키 만들기(간단 버전)
  const key = "w_" + Date.now();
  cur[key] = { name };
  await set(waitingRef, cur);

  $("waitingName").value = "";
  toast("대기자 추가");
}

/* =========================
   Bindings (onValue)
========================= */
function bindAll(){
  // 전체 회원
  onValue(ref(db, PATH.members), (snap)=>{
    members = snap.exists() ? snap.val() : {};
    // 모달이 열려 있으면 즉시 갱신
    if($("pickerBack").classList.contains("show")){
      renderMemberGrid($("memberSearch").value);
    }
  });

  // 레슨자
  onValue(ref(db, PATH.coaches), (snap)=>{
    coaches = snap.exists() ? snap.val() : {};
    renderCoachChips();
    // 모달이 열려 있으면 버튼 on/off 갱신
    if($("pickerBack").classList.contains("show")){
      renderMemberGrid($("memberSearch").value);
    }
  });

  // 시간표
  onValue(ref(db, PATH.schedule), (snap)=>{
    schedule = snap.exists() ? snap.val() : {};
    renderScheduleTable();
  });

  // 안내문
  onValue(ref(db, PATH.guide), (snap)=>{
    $("guideText").value = snap.exists() ? (snap.val() || "") : "";
  });

  // 대기자
  onValue(ref(db, PATH.waiting), (snap)=>{
    const data = snap.exists() ? snap.val() : {};
    renderWaiting(data);
  });
}

/* =========================
   Events
========================= */
$("refreshBtn").addEventListener("click", ()=> location.reload());

$("openPickerBtn").addEventListener("click", openPicker);
$("closePickerBtn").addEventListener("click", closePicker);
$("pickerBack").addEventListener("click", (e)=>{
  if(e.target === $("pickerBack")) closePicker();
});

$("memberSearch").addEventListener("input", (e)=>{
  renderMemberGrid(e.target.value);
});

$("saveScheduleBtn").addEventListener("click", saveSchedule);
$("saveGuideBtn").addEventListener("click", saveGuide);
$("addWaitingBtn").addEventListener("click", addWaiting);

/* =========================
   Init
========================= */
(async function main(){
  try{
    await initAuth();
    bindAll();
    renderScheduleTable();
  }catch(e){
    console.error(e);
    $("statusText").textContent = "오류(콘솔 확인)";
    toast("Firebase 오류");
  }
})();