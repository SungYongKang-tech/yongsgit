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
function isoTomorrow(){
  const d = new Date(); d.setDate(d.getDate()+1);
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

// ✅ 내일 작업사항(기계/전기) 일괄 복사
async function copyTomorrowPlanToClipboard(){
  const btn = document.getElementById("copyTomorrowBtn");
  if (!btn) return;

  // “내일 작업”은 오늘(ISO_TODAY)에 저장된 tomorrowWork 값
  const mechSnap = await get(ref(db, pathMECH(ISO_TODAY)));
  const elecSnap = await get(ref(db, pathELEC(ISO_TODAY)));

  const mech = (mechSnap.val()?.tomorrowWork || "").trim();
  const elec = (elecSnap.val()?.tomorrowWork || "").trim();

  // 표시용 “내일 날짜”
  const dt = new Date();
  dt.setDate(dt.getDate()+1);
  const tomorrowPretty = prettyKFromDate(dt);

  const lines = [];
  lines.push(`📌 내일 작업사항 (${tomorrowPretty})`);
  lines.push("");

  lines.push("■ 기계설비");
  lines.push(mech ? mech : "- (내용 없음)");
  lines.push("");

  lines.push("■ 전기설비");
  lines.push(elec ? elec : "- (내용 없음)");

  const text = lines.join("\n");

  // 클립보드 복사(HTTPS에서 동작)
  try{
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "복사 완료!";
    setTimeout(()=> btn.textContent = old, 900);
  }catch(e){
    // 일부 환경 대비(권한/브라우저 제한)
    window.prompt("아래 내용을 복사하세요 (Ctrl+C)", text);
  }
}

document.getElementById("copyTomorrowBtn")?.addEventListener("click", copyTomorrowPlanToClipboard);

function startMidnightWatcher(){
  setInterval(async ()=>{
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

// ---- init
let currentTab = "IBS";
refreshDateUI();
rebindAll(currentTab);

tabs.forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    tabs.forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    await rebindAll(currentTab);
  });
});

startMidnightWatcher();
