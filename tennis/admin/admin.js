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

const GRADE_WEIGHT = { A:4, B:3, C:2, D:1 };

/* =========================
   State
========================= */
let unlocked = false;
let pinHashOnDB = null;

const PATH = {
  adminPinHash: "config/adminPinHash",
  members: "members"
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

  // 멤버 추가 버튼 잠금
  $("addMemberBtn").disabled = !unlocked;
}

/* =========================
   Tabs
========================= */
const tabButtons = document.querySelectorAll(".tab");
const tabSections = {
  lock: $("tab-lock"),
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
   PIN
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

  await set(ref(db, PATH.adminPinHash), simpleHash(p1));
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
   Members
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

  // 등급(A→D), 이름순 정렬
  const order = { A:1, B:2, C:3, D:4 };
  entries.sort((a,b)=>{
    const va = a[1] || {}, vb = b[1] || {};
    const ga = order[va.grade] || 99;
    const gb = order[vb.grade] || 99;
    if(ga !== gb) return ga - gb;
    return (va.name||"").localeCompare(vb.name||"");
  });

  entries.forEach(([key, val])=>{
    const name = (val?.name || "(이름없음)").trim();
    const grade = (val?.grade || "B").toUpperCase();
    const weight = val?.weight ?? (GRADE_WEIGHT[grade] ?? 1);

    const item = document.createElement("div");
    item.className = "item";

    // 왼쪽: 강성용(A)
    const left = document.createElement("div");
    left.className = "meta";

    const title = document.createElement("div");
    title.className = "k";
    title.textContent = `${name}(${grade})`;

    const sub = document.createElement("div");
    sub.className = "s";
    sub.textContent = `점수: ${weight}`;

    left.appendChild(title);
    left.appendChild(sub);

    // 오른쪽: 등급 선택 + 수정 + 삭제
    const right = document.createElement("div");
    right.className = "row";
    right.style.gap = "8px";
    right.style.flexWrap = "nowrap";

    const sel = document.createElement("select");
    sel.className = "select";
    sel.style.maxWidth = "120px";
    sel.style.margin = "0";
    ["A","B","C","D"].forEach(g=>{
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      if(grade === g) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.disabled = !unlocked;

    const save = document.createElement("button");
    save.className = "btn ok";
    save.textContent = "수정";
    save.disabled = !unlocked;
    save.addEventListener("click", async ()=>{
      if(!requireUnlock()) return;
      const g = sel.value;

      await update(ref(db, `${PATH.members}/${key}`), {
        grade: g,
        weight: GRADE_WEIGHT[g] ?? 1,
        updatedAt: Date.now()
      });

      toast("수정 저장 완료");
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

  // (선택) 이름 중복 방지
  const snap = await get(ref(db, PATH.members));
  const data = snap.exists() ? snap.val() : {};
  const exists = Object.values(data || {}).some(v => (v?.name || "").trim() === name);
  if(exists){
    toast("이미 등록된 이름입니다.");
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

$("addMemberBtn").addEventListener("click", addMember);

/* =========================
   Init
========================= */
(async function main(){
  try{
    await initAuth();
    bindPin();
    bindMembers();
    setLockUI();
  }catch(e){
    console.error(e);
    $("statusText").textContent = "오류: 콘솔 확인";
    toast("연결 오류");
  }
})();