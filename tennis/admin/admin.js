import { db, auth } from "../firebase.js";

import {
  ref,
  onValue,
  get,
  set,
  update,
  remove,
  push
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

import {
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

/* =========================
   Helpers
========================= */
const $ = (id) => document.getElementById(id);

function toast(msg){
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>el.classList.remove("show"), 1600);
}

// ⚠️ 보안용 해시가 아니라 "간단 잠금"용입니다.
function simpleHash(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h>>>0).toString(16);
}

function sortYmdDesc(keys){
  return keys.sort((a,b)=> (a>b ? -1 : a<b ? 1 : 0));
}

const GRADE_WEIGHT = { A:4, B:3, C:2, D:1 };

/* =========================
   State
========================= */
let unlocked = false;
let pinHashOnDB = null;

const PATH = {
  adminPinHash: "config/adminPinHash",
  holidays: "config/holidays",        // { "YYYY-MM-DD": {title, off, updatedAt, byUid} }
  categories: "config/categories",    // ["공지","레슨",...]
  members: "members"                 // {id:{name,grade,weight,...}}
};

function requireUnlock(){
  if(!unlocked){
    toast("잠금 해제 후 사용 가능합니다.");
    return false;
  }
  return true;
}

function setLockUI(){
  const pill = $("lockPill");
  if(unlocked){
    pill.classList.remove("off");
    pill.classList.add("on");
    pill.textContent = "해제됨";
  }else{
    pill.classList.remove("on");
    pill.classList.add("off");
    pill.textContent = "잠금";
  }

  const lock = !unlocked;

  // 주요 버튼 잠금
  $("saveHolidayBtn").disabled = lock;
  $("addCatBtn").disabled = lock;
  $("addMemberBtn").disabled = lock;
}

/* =========================
   Tabs
========================= */
const tabButtons = document.querySelectorAll(".tab");
const tabSections = {
  lock: $("tab-lock"),
  holidays: $("tab-holidays"),
  categories: $("tab-categories"),
  members: $("tab-members")
};

function showTab(key){
  tabButtons.forEach(b=>{
    b.classList.toggle("active", b.dataset.tab===key);
  });
  Object.entries(tabSections).forEach(([k,sec])=>{
    sec.classList.toggle("hide", k!==key);
  });
}

tabButtons.forEach(btn=>{
  btn.addEventListener("click", ()=> showTab(btn.dataset.tab));
});

/* =========================
   Auth + status
========================= */
async function initAuth(){
  $("statusText").textContent = "익명 로그인 중…";
  const cred = await signInAnonymously(auth);
  $("uidText").textContent = cred.user?.uid || "-";
  $("statusText").textContent = "Firebase 연결됨";
}

/* =========================
   PIN load + unlock
========================= */
function bindPin(){
  onValue(ref(db, PATH.adminPinHash), (snap)=>{
    pinHashOnDB = snap.exists() ? snap.val() : null;
    $("pinSetText").textContent = pinHashOnDB ? "설정됨" : "미설정(최초 설정 가능)";
  });
}

async function setOrChangePin(){
  const p1 = $("pinInput").value.trim();
  const p2 = $("pinInput2").value.trim();

  if(p1.length < 4){
    toast("PIN은 4자리 이상 권장입니다.");
    return;
  }
  if(p1 !== p2){
    toast("PIN 확인이 일치하지 않습니다.");
    return;
  }

  // 최초 미설정이면 잠금 없이 설정 가능, 설정된 상태에서 변경은 해제 필요
  if(pinHashOnDB && !unlocked){
    toast("변경은 잠금 해제 후 가능합니다.");
    return;
  }

  const h = simpleHash(p1);
  await set(ref(db, PATH.adminPinHash), h);

  toast(pinHashOnDB ? "PIN 변경 완료" : "PIN 설정 완료");

  // 설정 후 자동 해제(편의)
  unlocked = true;
  setLockUI();
}

function unlock(){
  const p = $("pinInput").value.trim();
  if(!pinHashOnDB){
    toast("PIN이 아직 미설정입니다. 먼저 설정하세요.");
    return;
  }
  if(simpleHash(p) !== pinHashOnDB){
    toast("PIN이 올바르지 않습니다.");
    return;
  }
  unlocked = true;
  setLockUI();
  toast("잠금 해제됨");
}

function lock(){
  unlocked = false;
  setLockUI();
  toast("잠금 상태");
}

/* =========================
   Holidays
========================= */
function bindHolidays(){
  onValue(ref(db, PATH.holidays), (snap)=>{
    const data = snap.exists() ? snap.val() : {};
    renderHolidayList(data);
  });
}

function renderHolidayList(data){
  const list = $("holidayList");
  list.innerHTML = "";

  const keys = sortYmdDesc(Object.keys(data || {}));
  if(keys.length === 0){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "등록된 휴무일이 없습니다.";
    list.appendChild(empty);
    return;
  }

  keys.forEach(k=>{
    const v = data[k];
    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    left.className = "meta";

    const title = document.createElement("div");
    title.className = "k";
    title.textContent = `${k} · ${v?.title || "(제목 없음)"}`;

    const sub = document.createElement("div");
    sub.className = "s";
    sub.textContent =
      (v?.off ? "휴무(OFF)" : "휴일(표시만)") +
      (v?.byUid ? ` · by ${v.byUid}` : "");

    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "row";
    right.style.gap = "8px";

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "삭제";
    del.disabled = !unlocked;
    del.addEventListener("click", async ()=>{
      if(!requireUnlock()) return;
      await remove(ref(db, `${PATH.holidays}/${k}`));
      toast("삭제 완료");
    });

    right.appendChild(del);
    item.appendChild(left);
    item.appendChild(right);
    list.appendChild(item);
  });
}

async function saveHoliday(){
  if(!requireUnlock()) return;

  const date = $("hDate").value;
  const title = $("hTitle").value.trim();
  const off = $("hOff").checked;

  if(!date){
    toast("날짜를 선택하세요.");
    return;
  }
  if(!title){
    toast("제목을 입력하세요.");
    return;
  }

  await set(ref(db, `${PATH.holidays}/${date}`), {
    title,
    off,
    updatedAt: Date.now(),
    byUid: auth.currentUser?.uid || null
  });

  toast("저장 완료");
  $("hTitle").value = "";
}

/* =========================
   Categories
========================= */
function bindCategories(){
  onValue(ref(db, PATH.categories), (snap)=>{
    const arr = snap.exists() ? snap.val() : [];
    const list = Array.isArray(arr) ? arr : [];
    renderCategoryList(list);
  });
}

function renderCategoryList(list){
  const el = $("catList");
  el.innerHTML = "";

  if(list.length === 0){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "등록된 분류가 없습니다.";
    el.appendChild(empty);
    return;
  }

  list.forEach((name, idx)=>{
    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    left.className = "meta";

    const k = document.createElement("div");
    k.className = "k";
    k.textContent = name;

    const s = document.createElement("div");
    s.className = "s";
    s.textContent = `순서: ${idx+1}`;

    left.appendChild(k);
    left.appendChild(s);

    const right = document.createElement("div");
    right.className = "row";
    right.style.gap = "8px";
    right.style.flexWrap = "nowrap";

    const up = document.createElement("button");
    up.className = "btn";
    up.textContent = "▲";
    up.disabled = !unlocked || idx === 0;
    up.addEventListener("click", async ()=>{
      if(!requireUnlock()) return;
      const newList = [...list];
      [newList[idx-1], newList[idx]] = [newList[idx], newList[idx-1]];
      await set(ref(db, PATH.categories), newList);
      toast("이동 완료");
    });

    const down = document.createElement("button");
    down.className = "btn";
    down.textContent = "▼";
    down.disabled = !unlocked || idx === list.length - 1;
    down.addEventListener("click", async ()=>{
      if(!requireUnlock()) return;
      const newList = [...list];
      [newList[idx], newList[idx+1]] = [newList[idx+1], newList[idx]];
      await set(ref(db, PATH.categories), newList);
      toast("이동 완료");
    });

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "삭제";
    del.disabled = !unlocked;
    del.addEventListener("click", async ()=>{
      if(!requireUnlock()) return;
      const newList = list.filter((_,i)=>i!==idx);
      await set(ref(db, PATH.categories), newList);
      toast("삭제 완료");
    });

    right.appendChild(up);
    right.appendChild(down);
    right.appendChild(del);

    item.appendChild(left);
    item.appendChild(right);
    el.appendChild(item);
  });
}

async function addCategory(){
  if(!requireUnlock()) return;

  const name = $("catName").value.trim();
  if(!name){
    toast("분류 이름을 입력하세요.");
    return;
  }

  const snap = await get(ref(db, PATH.categories));
  const list = snap.exists() && Array.isArray(snap.val()) ? snap.val() : [];

  if(list.includes(name)){
    toast("이미 존재하는 분류입니다.");
    return;
  }

  list.push(name);
  await set(ref(db, PATH.categories), list);

  $("catName").value = "";
  toast("추가 완료");
}

/* =========================
   Members (name + grade + weight)
========================= */
function bindMembers(){
  onValue(ref(db, PATH.members), (snap)=>{
    const data = snap.exists() ? snap.val() : {};
    renderMemberList(data);
  });
}

function renderMemberList(data){
  const el = $("memberList");
  el.innerHTML = "";

  const entries = Object.entries(data || {});
  if(entries.length === 0){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "등록된 멤버가 없습니다.";
    el.appendChild(empty);
    return;
  }

  const order = { A:1, B:2, C:3, D:4 };
  entries.sort((a,b)=>{
    const va = a[1] || {}, vb = b[1] || {};
    const ga = order[va.grade] || 99;
    const gb = order[vb.grade] || 99;
    if(ga !== gb) return ga - gb;
    return (va.name||"").localeCompare(vb.name||"");
  });

  entries.forEach(([key, val])=>{
    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    left.className = "meta";

    const name = document.createElement("div");
    name.className = "k";
    name.textContent = val.name || "(이름없음)";

    const sub = document.createElement("div");
    sub.className = "s";
    sub.textContent = `등급: ${val.grade || "-"} / 점수: ${val.weight ?? (GRADE_WEIGHT[val.grade] ?? "-")}`;

    left.appendChild(name);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "row";
    right.style.gap = "8px";
    right.style.flexWrap = "nowrap";

    const sel = document.createElement("select");
    sel.className = "select";
    sel.style.maxWidth = "140px";
    ["A","B","C","D"].forEach(g=>{
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      if((val.grade||"B") === g) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.disabled = !unlocked;

    const save = document.createElement("button");
    save.className = "btn ok";
    save.textContent = "저장";
    save.disabled = !unlocked;
    save.addEventListener("click", async ()=>{
      if(!requireUnlock()) return;
      const g = sel.value;
      await update(ref(db, `${PATH.members}/${key}`), {
        grade: g,
        weight: GRADE_WEIGHT[g] ?? 1,
        updatedAt: Date.now()
      });
      toast("등급 저장 완료");
    });

    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "삭제";
    del.disabled = !unlocked;
    del.addEventListener("click", async ()=>{
      if(!requireUnlock()) return;
      await remove(ref(db, `${PATH.members}/${key}`));
      toast("삭제 완료");
    });

    right.appendChild(sel);
    right.appendChild(save);
    right.appendChild(del);

    item.appendChild(left);
    item.appendChild(right);
    el.appendChild(item);
  });
}

async function addMember(){
  if(!requireUnlock()) return;

  const name = $("mName").value.trim();
  const grade = $("mGrade").value;

  if(!name){
    toast("이름을 입력하세요.");
    return;
  }

  const memberRef = push(ref(db, PATH.members));
  await set(memberRef, {
    name,
    grade,
    weight: GRADE_WEIGHT[grade] ?? 1,
    createdAt: Date.now()
  });

  $("mName").value = "";
  toast("멤버 추가 완료");
}

/* =========================
   Wire up
========================= */
$("refreshBtn").addEventListener("click", ()=> location.reload());

$("setPinBtn").addEventListener("click", setOrChangePin);
$("unlockBtn").addEventListener("click", unlock);
$("lockBtn").addEventListener("click", lock);

$("saveHolidayBtn").addEventListener("click", saveHoliday);

$("addCatBtn").addEventListener("click", addCategory);

$("addMemberBtn").addEventListener("click", addMember);

/* =========================
   Init
========================= */
(async function main(){
  try{
    await initAuth();
    bindPin();
    bindHolidays();
    bindCategories();
    bindMembers();
    setLockUI();
  }catch(e){
    console.error(e);
    $("statusText").textContent = "오류: 콘솔 확인";
    toast("연결 오류");
  }
})();