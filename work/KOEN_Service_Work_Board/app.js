import { db } from "./firebase.js";
import {
  ref, onValue, update, get, set, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const tabs = document.querySelectorAll(".tab");

/* =========================
   Date helpers
========================= */
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

function prettyK(iso){
  const [Y,M,D] = iso.split("-").map(Number);
  const dt = new Date(Y, M-1, D);
  const yy = String(Y).slice(2);
  return `${yy}.${pad2(M)}.${pad2(D)}(${wday[dt.getDay()]})`;
}

/* =========================
   ✅ Admin PIN (초기 1225) - DB에 없으면 생성
   - admin.html에서도 동일 경로 사용
========================= */
const ADMIN_SETTINGS_PATH = "admin/settings"; // { pin: "1225", updatedAt: ... }

async function ensureAdminPin(){
  try{
    const snap = await get(ref(db, ADMIN_SETTINGS_PATH));
    const v = snap.val();
    if (!v || !v.pin){
      await set(ref(db, ADMIN_SETTINGS_PATH), {
        pin: "1225",
        updatedAt: serverTimestamp()
      });
    }
  }catch(e){
    // 운영에 치명적이지 않게 조용히 무시(네트워크 등)
    // console.warn(e);
  }
}

/* ==========================
   Rich Text (Bold / Red / Blue)
   - textarea 숨기고 contenteditable 사용
   - DB에는 HTML로 저장
   - ✅ 상단 고정 툴바(Top Bar) 1개만 사용
========================== */
function looksLikeHtml(s){
  if (!s) return false;
  return /<\/?[a-z][\s\S]*>/i.test(s);
}
function escapeHtml(s){
  return (s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function htmlToText(html){
  const div = document.createElement("div");
  div.innerHTML = html || "";
  div.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  div.querySelectorAll("p,div").forEach(el => {
    if (el !== div) el.appendChild(document.createTextNode("\n"));
  });
  return div.textContent.replace(/\n{3,}/g, "\n\n").trim();
}

/* ✅ 마지막으로 편집/터치한 에디터 기억 */
let ACTIVE_RICH_BOX = null;

function applyToActiveRich(cmd){
  const box = ACTIVE_RICH_BOX;
  if (!box) return;

  box.focus();

  try{
    if (cmd === "bold") document.execCommand("bold");
    if (cmd === "red")  document.execCommand("foreColor", false, "#dc2626");
    if (cmd === "blue") document.execCommand("foreColor", false, "#2563eb");
  }catch(e){}

  const ta = box._ta;
  if (ta) syncRichToTextarea(ta);
}

function attachTopToolbar(){
  const bar = document.getElementById("topRtBar");
  if (!bar) return;

  bar.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-cmd]");
    if (!btn) return;
    applyToActiveRich(btn.dataset.cmd);
  });
}

function enhanceTextareaToRich(id){
  const ta = document.getElementById(id);
  if (!ta) return;
  if (ta.dataset.rich === "1") return;

  const wrap = document.createElement("div");
  wrap.className = "rtWrap";

  const box = document.createElement("div");
  box.className = "rtBox";
  box.contentEditable = "true";
  box.setAttribute("role", "textbox");
  box.setAttribute("aria-label", "rich editor");

  const raw = ta.value || "";
  box.innerHTML = looksLikeHtml(raw) ? raw : escapeHtml(raw).replaceAll("\n","<br>");

  ta.style.display = "none";
  ta.dataset.rich = "1";
  ta._richBox = box;

  box._ta = ta;

  ta.parentNode.insertBefore(wrap, ta);
  wrap.appendChild(ta);
  wrap.appendChild(box);

  box.addEventListener("focusin", ()=>{ ACTIVE_RICH_BOX = box; });
  box.addEventListener("pointerdown", ()=>{ ACTIVE_RICH_BOX = box; });
  box.addEventListener("touchstart", ()=>{ ACTIVE_RICH_BOX = box; }, {passive:true});

  box.addEventListener("input", ()=>{
    syncRichToTextarea(ta);
  });

  box.addEventListener("paste", (e)=>{
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
    syncRichToTextarea(ta);
  });

  if (!ACTIVE_RICH_BOX) ACTIVE_RICH_BOX = box;
}

function syncRichToTextarea(ta){
  if (!ta || !ta._richBox) return;

  ta.value = ta._richBox.innerHTML;
  ta.dispatchEvent(new Event("input", { bubbles:true }));
  autoSizeRich(ta._richBox);
}

function setFieldValue(id, v){
  const el = document.getElementById(id);
  if (!el) return;

  el.value = v ?? "";

  if (el._richBox){
    const raw = el.value || "";
    el._richBox.innerHTML = looksLikeHtml(raw) ? raw : escapeHtml(raw).replaceAll("\n","<br>");
    autoSizeRich(el._richBox);
  }
}

function autoSizeRich(box){
  if (!box) return;
  box.style.height = "auto";
  box.style.height = Math.min(box.scrollHeight, window.innerHeight * 0.70) + "px";
}

/* ==========================
   Paths
========================== */
const pathIBS  = (iso)=>`daily/IBS/${iso}`;
const pathMECH = (iso)=>`daily/MECH/${iso}`;
const pathELEC = (iso)=>`daily/ELEC/${iso}`;

/* ==========================
   Auto-save (debounce)
========================== */
const timers = new Map();
function setSaving(elStatus){ elStatus.textContent = "저장 중…"; }
function scheduleSave(key, fn){
  if (timers.has(key)) clearTimeout(timers.get(key));
  timers.set(key, setTimeout(fn, 800));
}

/* ==========================
   Auto height (textarea + rtBox)
========================== */
function autoSize(el){
  if (!el) return;

  if (el.classList && el.classList.contains("rtBox")){
    autoSizeRich(el);
    return;
  }

  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.70) + "px";
}
function autoSizeAll(){
  document.querySelectorAll("textarea").forEach(autoSize);
  document.querySelectorAll(".rtBox").forEach(autoSize);
}

/* ==========================
   Live date labels + midnight refresh
========================== */
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

/* ==========================
   Bindings
========================== */
let unsubscribers = [];
function clearListeners(){
  unsubscribers.forEach(u=>{ try{u();}catch(e){} });
  unsubscribers = [];
}

function bindIBS(){
  const rY = ref(db, pathIBS(ISO_YDAY));
  const uY = onValue(rY, (snap)=>{
    const v = snap.val() || {};
    setFieldValue("ibsY_handover", v.handover || "");
    setFieldValue("ibsY_status",   v.status || "");
    setFieldValue("ibsY_special",  v.special || "");
    const ts = v.updatedAt || null;
    $("ibsYStatus").textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const rT = ref(db, pathIBS(ISO_TODAY));
  const uT = onValue(rT, (snap)=>{
    const v = snap.val() || {};
    setFieldValue("ibsT_handover", v.handover || "");
    setFieldValue("ibsT_status",   v.status || "");
    setFieldValue("ibsT_special",  v.special || "");
    const ts = v.updatedAt || null;
    $("ibsTStatus").textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const wire = (areaId, which, field) => {
    const ta = $(areaId);
    const statusEl = which === "Y" ? $("ibsYStatus") : $("ibsTStatus");

    // ✅ (중요) rebindAll 때마다 input 리스너가 중복으로 붙지 않게 "영역별+which+field" 키로 막기
    const tag = `wired_${which}_${field}_${areaId}`;
    if (ta.dataset[tag] === "1") return;
    ta.dataset[tag] = "1";

    ta.addEventListener("input", ()=>{
      autoSize(ta);
      setSaving(statusEl);
      const iso = which === "Y" ? ISO_YDAY : ISO_TODAY;
      const key = `IBS:${which}:${field}:${areaId}`;
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

  const todayAlready = (todayVal.todayWork || "").trim();
  const fromPlan = (ydayVal.tomorrowWork || "").trim();

  if (!todayAlready && fromPlan){
    setFieldValue(areaTodayId, fromPlan);
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
    setFieldValue(yTodayId,    v.todayWork || "");
    setFieldValue(yTomorrowId, v.tomorrowWork || "");
    const ts = v.updatedAt || null;
    yStatusEl.textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const uT = onValue(tRef, (snap)=>{
    const v = snap.val() || {};
    setFieldValue(tTodayId,    v.todayWork || "");
    setFieldValue(tTomorrowId, v.tomorrowWork || "");
    const ts = v.updatedAt || null;
    tStatusEl.textContent = ts ? `불러옴 (${new Date(ts).toLocaleString("ko-KR")})` : "불러옴";
    autoSizeAll();
  });

  const wire = (areaId, which, field) => {
    const ta = $(areaId);
    const statusEl = which === "Y" ? yStatusEl : tStatusEl;

    const tag = `wired_${kind}_${which}_${field}_${areaId}`;
    if (ta.dataset[tag] === "1") return;
    ta.dataset[tag] = "1";

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

/* ==========================
   Tab switching
========================== */
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
   카톡용: 오늘 작업 복사
========================== */
async function copyTodayPlanToClipboard(){
  const btn = document.getElementById("copyTodayBtn");
  if (!btn) return;

  const mechSnap = await get(ref(db, pathMECH(ISO_TODAY)));
  const elecSnap = await get(ref(db, pathELEC(ISO_TODAY)));

  const mech = htmlToText((mechSnap.val()?.todayWork || "")).trim();
  const elec = htmlToText((elecSnap.val()?.todayWork || "")).trim();

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

document.getElementById("copyTodayBtn")?.addEventListener("click", copyTodayPlanToClipboard);

/* ==========================
   ✅ 관리자 버튼 → admin.html 이동
========================== */
document.getElementById("adminBtn")?.addEventListener("click", ()=>{
  location.href = "./admin.html";
});

/* ==========================
   날짜 변경 감지
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

/* ==========================
   과거 조회 모드
========================== */
let isHistoryMode = false;

function setHistoryMode(isoSelected){
  isHistoryMode = true;

  ISO_TODAY = isoSelected;

  const d = new Date(isoSelected);
  d.setDate(d.getDate()-1);
  ISO_YDAY = isoFromDate(d);

  refreshDateUI();
}

const historyInput = document.getElementById("historyDate");
if (historyInput){
  historyInput.value = isoToday();

  historyInput.addEventListener("change", async ()=>{
    const iso = historyInput.value;
    if (!iso) return;

    setHistoryMode(iso);
    await rebindAll(currentTab);
  });
}

/* ==========================
   스와이프 탭 전환
========================== */
const TAB_ORDER = ["IBS","MECH","ELEC"];
const clamp = (n,min,max)=>Math.max(min, Math.min(max,n));

async function selectTab(tab){
  const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (!btn) return;

  tabs.forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  currentTab = tab;
  await rebindAll(currentTab);
}

async function nextTab(dir){
  const idx = TAB_ORDER.indexOf(currentTab);
  const next = TAB_ORDER[clamp(idx + dir, 0, TAB_ORDER.length-1)];
  if (next !== currentTab) await selectTab(next);
}

function attachSwipeToContent(){
  const contentWrap = document.querySelector("body > .wrap");
  if (!contentWrap) return;

  const MIN_X = 70;
  const MAX_Y = 90;

  let sx=0, sy=0, dx=0, dy=0;
  let down=false;

  contentWrap.style.touchAction = "pan-y";

  const shouldIgnoreStart = (target)=>{
    if (!target) return true;

    if (target.closest(".rtBox, textarea, input, select, button, a, label")) return true;
    if (target.closest("details.fold > summary")) return true;
    if (target.closest(".cardHead")) return true;

    return false;
  };

  const start = (x,y)=>{ sx=x; sy=y; dx=0; dy=0; down=true; };
  const move  = (x,y)=>{ if(!down) return; dx = x-sx; dy = y-sy; };
  const end   = async ()=>{
    if(!down) return;
    down=false;

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);

    if(ax >= MIN_X && ay <= MAX_Y){
      await nextTab(dx < 0 ? +1 : -1);
    }
  };

  contentWrap.addEventListener("pointerdown", (e)=>{
    if (shouldIgnoreStart(e.target)) return;
    start(e.clientX, e.clientY);
  }, {passive:true});

  contentWrap.addEventListener("pointermove", (e)=>{
    move(e.clientX, e.clientY);
  }, {passive:true});

  contentWrap.addEventListener("pointerup", async ()=>{
    await end();
  }, {passive:true});

  contentWrap.addEventListener("pointercancel", ()=>{
    down=false;
  }, {passive:true});

  contentWrap.addEventListener("touchstart", (e)=>{
    const t = e.touches?.[0];
    if (!t) return;
    if (shouldIgnoreStart(e.target)) return;
    start(t.clientX, t.clientY);
  }, {passive:true});

  contentWrap.addEventListener("touchmove", (e)=>{
    const t = e.touches?.[0];
    if (!t) return;
    move(t.clientX, t.clientY);
  }, {passive:true});

  contentWrap.addEventListener("touchend", async ()=>{
    await end();
  }, {passive:true});
}

/* ==========================
   init
========================== */
let currentTab = "IBS";
refreshDateUI();

// ✅ admin pin 기본값 보장(없으면 1225 생성)
ensureAdminPin();

// ✅ 모든 textarea를 리치에디터로 변환
document.querySelectorAll("textarea[id]").forEach(t => enhanceTextareaToRich(t.id));

// ✅ 상단 고정 툴바 이벤트 연결
attachTopToolbar();

rebindAll(currentTab);
attachSwipeToContent();

tabs.forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    await selectTab(btn.dataset.tab);
  });
});

startMidnightWatcher();

window.addEventListener("DOMContentLoaded", ()=>{
  checkAndShowPopupOnce();
});

