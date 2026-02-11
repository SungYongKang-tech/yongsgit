import { db } from "./firebase.js";
import { ref, onValue, update, get, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const tabs = document.querySelectorAll(".tab");

// ---- Date helpers
const pad2 = (n)=>String(n).padStart(2,"0");
const wday = ["일","월","화","수","목","금","토"];

function isoFromDate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function isoToday(){ return isoFromDate(new Date()); }
function isoYesterday(){
  const d = new Date(); d.setDate(d.getDate()-1);
  return isoFromDate(d);
}

function prettyKFromDate(d){
  return prettyK(isoFromDate(d));
}
function prettyK(iso){
  const [Y,M,D] = iso.split("-").map(Number);
  const dt = new Date(Y, M-1, D);
  const yy = String(Y).slice(2);
  return `${yy}.${pad2(M)}.${pad2(D)}(${wday[dt.getDay()]})`;
}

// ---- Paths
const pathIBS  = (iso)=>`daily/IBS/${iso}`;
const pathMECH = (iso)=>`daily/MECH/${iso}`;
const pathELEC = (iso)=>`daily/ELEC/${iso}`;

// ---- Auto-save (debounce)
const timers = new Map();
function setSaving(elStatus){ elStatus.textContent = "저장 중…"; }
function scheduleSave(key, fn){
  if (timers.has(key)) clearTimeout(timers.get(key));
  timers.set(key, setTimeout(fn, 800));
}

// ✅ textarea 자동 높이
function autoSize(el){
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.70) + "px";
}
function autoSizeAll(){
  document.querySelectorAll("textarea").forEach(autoSize);
}

// ---- Live date labels + midnight refresh
let ISO_TODAY = isoToday();
let ISO_YDAY  = isoYesterday();

function refreshDateUI(){
  $("clockLabel").textContent = new Date().toLocaleString("ko-KR");
  $("todayLabel").textContent = `오늘: ${prettyK(ISO_TODAY)}`;
  $("ydayLabel").textContent  = `어제: ${prettyK(ISO_YDAY)}`;

  $("ibsTDate").textContent = prettyK(ISO_TODAY);
  $("ibsYDate").textContent = prettyK(ISO_YDAY);

  $("mechTDate").textContent = prettyK(ISO_TODAY);
  $("mechYDate").textContent = prettyK(ISO_YDAY);

  $("elecTDate").textContent = prettyK(ISO_TODAY);
  $("elecYDate").textContent = prettyK(ISO_YDAY);
}

// ---- Bindings
let unsubscribers = [];
function clearListeners(){
  unsubscribers.forEach(u=>{ try{u();}catch(e){} });
  unsubscribers = [];
}

function bindIBS(){
  const rY = ref(db, pathIBS(ISO_YDAY));
  const uY = onValue(rY, (snap)=>{
    const v = snap.val() || {};
    $("ibsY_handover").value = v.handover || "";
    $("ibsY_status").value   = v.status || "";
    $("ibsY_special").value  = v.special || "";
    const ts = v.updatedAt || null;
    $("ibsYStatus").textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const rT = ref(db, pathIBS(ISO_TODAY));
  const uT = onValue(rT, (snap)=>{
    const v = snap.val() || {};
    $("ibsT_handover").value = v.handover || "";
    $("ibsT_status").value   = v.status || "";
    $("ibsT_special").value  = v.special || "";
    const ts = v.updatedAt || null;
    $("ibsTStatus").textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const wire = (areaId, which, field) => {
    const ta = $(areaId);
    const statusEl = which === "Y" ? $("ibsYStatus") : $("ibsTStatus");
    ta.addEventListener("input", ()=>{
      autoSize(ta);
      setSaving(statusEl);
      const iso = which === "Y" ? ISO_YDAY : ISO_TODAY;
      const key = `IBS:${which}:${field}`;
      scheduleSave(key, async ()=>{
        await update(ref(db, pathIBS(iso)), {
          [field]: ta.value,
          updatedAt: serverTimestamp()
        });
      });
    });
  };

  wire("ibsY_handover","Y","handover");
  wire("ibsY_status","Y","status");
  wire("ibsY_special","Y","special");

  wire("ibsT_handover","T","handover");
  wire("ibsT_status","T","status");
  wire("ibsT_special","T","special");

  unsubscribers.push(uY, uT);
}

async function ensureCarryOver(areaTodayId, todayPathFn, statusTodayEl){
  const todayRef = ref(db, todayPathFn(ISO_TODAY));
  const ydayRef  = ref(db, todayPathFn(ISO_YDAY));
  const [todaySnap, ydaySnap] = await Promise.all([get(todayRef), get(ydayRef)]);
  const todayVal = todaySnap.val() || {};
  const ydayVal  = ydaySnap.val() || {};

  const todayTA = $(areaTodayId);
  const todayAlready = (todayVal.todayWork || "").trim();
  const fromPlan = (ydayVal.tomorrowWork || "").trim();

  if (!todayAlready && fromPlan){
    todayTA.value = fromPlan;
    statusTodayEl.textContent = "자동 반영(어제 내일작업 → 오늘 작업)…";
    await update(todayRef, {
      todayWork: fromPlan,
      updatedAt: serverTimestamp()
    });
  }
}

function bindTwoField(kind, yTodayId, yTomorrowId, tTodayId, tTomorrowId, yStatusId, tStatusId, pathFn){
  const yRef = ref(db, pathFn(ISO_YDAY));
  const tRef = ref(db, pathFn(ISO_TODAY));

  const yStatusEl = $(yStatusId);
  const tStatusEl = $(tStatusId);

  const uY = onValue(yRef, (snap)=>{
    const v = snap.val() || {};
    $(yTodayId).value    = v.todayWork || "";
    $(yTomorrowId).value = v.tomorrowWork || "";
    const ts = v.updatedAt || null;
    yStatusEl.textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const uT = onValue(tRef, (snap)=>{
    const v = snap.val() || {};
    $(tTodayId).value    = v.todayWork || "";
    $(tTomorrowId).value = v.tomorrowWork || "";
    const ts = v.updatedAt || null;
    tStatusEl.textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const wire = (areaId, which, field) => {
    const ta = $(areaId);
    const statusEl = which === "Y" ? yStatusEl : tStatusEl;
    ta.addEventListener("input", ()=>{
      autoSize(ta);
      setSaving(statusEl);
      const iso = which === "Y" ? ISO_YDAY : ISO_TODAY;
      const key = `${kind}:${which}:${field}:${areaId}`;
      scheduleSave(key, async ()=>{
        await update(ref(db, pathFn(iso)), {
          [field]: ta.value,
          updatedAt: serverTimestamp()
        });
      });
    });
  };

  wire(yTodayId, "Y", "todayWork");
  wire(yTomorrowId,"Y","tomorrowWork");
  wire(tTodayId, "T", "todayWork");
  wire(tTomorrowId,"T","tomorrowWork");

  unsubscribers.push(uY, uT);
}

async function bindMECH(){
  bindTwoField(
    "MECH",
    "mechY_today","mechY_tomorrow",
    "mechT_today","mechT_tomorrow",
    "mechYStatus","mechTStatus",
    pathMECH
  );
  await ensureCarryOver("mechT_today", pathMECH, $("mechTStatus"));
}

async function bindELEC(){
  bindTwoField(
    "ELEC",
    "elecY_today","elecY_tomorrow",
    "elecT_today","elecT_tomorrow",
    "elecYStatus","elecTStatus",
    pathELEC
  );
  await ensureCarryOver("elecT_today", pathELEC, $("elecTStatus"));
}

// ---- Tab switching
function showView(tab){
  $("viewIBS").style.display  = tab==="IBS"  ? "" : "none";
  $("viewMECH").style.display = tab==="MECH" ? "" : "none";
  $("viewELEC").style.display = tab==="ELEC" ? "" : "none";
}

async function rebindAll(forTab){
  clearListeners();
  refreshDateUI();
  showView(forTab);

  if (forTab==="IBS") bindIBS();
  if (forTab==="MECH") await bindMECH();
  if (forTab==="ELEC") await bindELEC();
}

/* ==========================
   ✅ 카톡용: 오늘/내일 작업 복사
========================== */

// ✅ 오늘 작업사항(기계/전기) 일괄 복사
async function copyTodayPlanToClipboard(){
  const btn = document.getElementById("copyTodayBtn");
  if (!btn) return;

  const mechSnap = await get(ref(db, pathMECH(ISO_TODAY)));
  const elecSnap = await get(ref(db, pathELEC(ISO_TODAY)));

  const mech = (mechSnap.val()?.todayWork || "").trim();
  const elec = (elecSnap.val()?.todayWork || "").trim();

  const todayPretty = prettyK(ISO_TODAY);

  const lines = [];
  lines.push(`📌 오늘 작업사항 (${todayPretty})`);
  lines.push("");

  lines.push("■ 기계설비");
  lines.push(mech ? mech : "- (내용 없음)");
  lines.push("");

  lines.push("■ 전기설비");
  lines.push(elec ? elec : "- (내용 없음)");

  const text = lines.join("\n");

  try{
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "복사 완료!";
    setTimeout(()=> btn.textContent = old, 900);
  }catch(e){
    window.prompt("아래 내용을 복사하세요 (Ctrl+C)", text);
  }
}

// ✅ 버튼 이벤트 연결
document.getElementById("copyTodayBtn")?.addEventListener("click", copyTodayPlanToClipboard);

/* ==========================
   ✅ 날짜 변경 감지
========================== */

function startMidnightWatcher(){
  setInterval(async ()=>{
    if (isHistoryMode) return;

    const nowToday = isoToday();
    if (nowToday !== ISO_TODAY){
      ISO_TODAY = nowToday;
      ISO_YDAY  = isoYesterday();
      await rebindAll(currentTab);
    } else {
      $("clockLabel").textContent = new Date().toLocaleString("ko-KR");
    }
  }, 10_000);
}

// ✅ 과거 조회 모드
let isHistoryMode = false;
let realISO_TODAY = ISO_TODAY;
let realISO_YDAY  = ISO_YDAY;

function setHistoryMode(isoSelected){
  // 선택 날짜를 “오늘”로 취급해서 화면 구성
  isHistoryMode = true;

  // 원래 오늘/어제를 백업
  realISO_TODAY = isoToday();
  realISO_YDAY  = isoYesterday();

  ISO_TODAY = isoSelected;

  const d = new Date(isoSelected);
  d.setDate(d.getDate()-1);
  ISO_YDAY = isoFromDate(d);

  refreshDateUI();
}

function clearHistoryMode(){
  isHistoryMode = false;
  ISO_TODAY = isoToday();
  ISO_YDAY  = isoYesterday();
  refreshDateUI();
}


const historyInput = document.getElementById("historyDate");
if (historyInput){
  // 기본값: 오늘
  historyInput.value = isoToday();

  historyInput.addEventListener("change", async ()=>{
    const iso = historyInput.value;
    if (!iso) return;

    setHistoryMode(iso);
    await rebindAll(currentTab);
  });
}

/* ==========================
   ✅ 작업내용 영역 좌/우 스와이프 탭 전환
   - 모바일: 터치 스와이프
   - PC: 마우스 드래그
========================== */

const TAB_ORDER = ["IBS","MECH","ELEC"];
const clamp = (n,min,max)=>Math.max(min, Math.min(max,n));

function selectTab(tab){
  const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (!btn) return;

  tabs.forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  currentTab = tab;
  rebindAll(currentTab);
}

function nextTab(dir){ // dir: +1 (왼쪽으로 밀면 다음), -1 (오른쪽으로 밀면 이전)
  const idx = TAB_ORDER.indexOf(currentTab);
  const next = TAB_ORDER[clamp(idx + dir, 0, TAB_ORDER.length-1)];
  if (next !== currentTab) selectTab(next);
}

function attachSwipeToContent(){
  // 스와이프를 받을 영역: 탭 아래 "콘텐츠 영역" (세 view를 감싸는 부모 wrap)
  // 현재 구조에서 두 번째 .wrap(본문) 전체에 적용하는게 안전합니다.
  const wraps = document.querySelectorAll(".wrap");
  const contentWrap = wraps[1] || wraps[0];
  if (!contentWrap) return;

  // textarea 내부 스크롤/선택 방해 최소화
  let sx=0, sy=0, dx=0, dy=0;
  let down=false, pointerId=null;
  let startedOnInput=false;

  const MIN_X = 60;        // 가로 이동 최소(px)
  const MAX_Y = 80;        // 세로 흔들림 허용(px)
  const EDGE_GUARD = 6;    // 화면 가장자리 제스처 충돌 방지(선택)

  // pointer events 사용(터치+마우스 통합)
  contentWrap.style.touchAction = "pan-y"; // 세로 스크롤은 허용, 가로는 우리가 처리

  contentWrap.addEventListener("pointerdown", (e)=>{
    // textarea/inputs에서 시작하면 스와이프 감지 안함(입력 방해 방지)
    const t = e.target;
    startedOnInput = !!(t && (t.tagName==="TEXTAREA" || t.tagName==="INPUT" || t.isContentEditable));
    if (startedOnInput) return;

    // 아주 가장자리에서 시작하는 경우는 무시(뒤로가기 제스처 등)
    if (e.clientX < EDGE_GUARD || (window.innerWidth - e.clientX) < EDGE_GUARD) return;

    down = true;
    pointerId = e.pointerId;
    sx = e.clientX; sy = e.clientY;
    dx = dy = 0;
    try{ contentWrap.setPointerCapture(pointerId); }catch(_){}
  }, {passive:true});

  contentWrap.addEventListener("pointermove", (e)=>{
    if (!down || startedOnInput) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;
  }, {passive:true});

  contentWrap.addEventListener("pointerup", (e)=>{
    if (!down) return;
    down = false;

    if (startedOnInput) { startedOnInput=false; return; }

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);

    // 가로 이동 충분 + 세로 흔들림 작으면 탭 전환
    if (ax >= MIN_X && ay <= MAX_Y){
      // 왼쪽으로 스와이프(dx<0) => 다음 탭, 오른쪽(dx>0) => 이전 탭
      nextTab(dx < 0 ? +1 : -1);
    }

    startedOnInput=false;
  }, {passive:true});

  contentWrap.addEventListener("pointercancel", ()=>{
    down=false; startedOnInput=false;
  }, {passive:true});
}


// ---- init
let currentTab = "IBS";
refreshDateUI();
rebindAll(currentTab);
attachSwipeToContent();

tabs.forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    tabs.forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    await rebindAll(currentTab);
  });
});

startMidnightWatcher();
