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
const $ = id => document.getElementById(id);

function toast(msg){
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>el.classList.remove("show"), 1600);
}

function simpleHash(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h>>>0).toString(16);
}

const GRADE_WEIGHT = { A:4, B:3, C:2, D:1 };

let unlocked = false;
let pinHashOnDB = null;
let memberCache = {};   // 🔥 캐시

const PATH = {
  adminPinHash: "config/adminPinHash",
  members: "members"
};

/* =========================
   Lock UI
========================= */
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

  $("addMemberBtn").disabled = !unlocked;

  // 🔥 다시 렌더만 실행 (bind 아님)
  renderMemberList(memberCache);
}

/* =========================
   Auth
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
  onValue(ref(db, PATH.adminPinHash), snap=>{
    pinHashOnDB = snap.exists() ? snap.val() : null;
    $("pinSetText").textContent =
      pinHashOnDB ? "설정됨" : "미설정(최초 설정 가능)";
  });
}

async function setOrChangePin(){
  const p1 = $("pinInput").value.trim();
  const p2 = $("pinInput2").value.trim();

  if(p1.length < 4){
    toast("PIN은 4자리 이상 권장");
    return;
  }
  if(p1 !== p2){
    toast("PIN 불일치");
    return;
  }

  if(pinHashOnDB && !unlocked){
    toast("잠금 해제 후 변경 가능");
    return;
  }

  await set(ref(db, PATH.adminPinHash), simpleHash(p1));
  unlocked = true;
  setLockUI();
  toast("PIN 저장 완료");
}

function unlock(){
  const p = $("pinInput").value.trim();

  if(!pinHashOnDB){
    toast("PIN 미설정");
    return;
  }
  if(simpleHash(p) !== pinHashOnDB){
    toast("PIN 오류");
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
  onValue(ref(db, PATH.members), snap=>{
    memberCache = snap.exists() ? snap.val() : {};
    renderMemberList(memberCache);
  });
}

function renderMemberList(data){
  const el = $("memberList");
  el.innerHTML = "";

  const entries = Object.entries(data || {});
  if(entries.length === 0){
    el.innerHTML = `<div class="hint">등록된 멤버가 없습니다.</div>`;
    return;
  }

  const order = { A:1, B:2, C:3, D:4 };
  entries.sort((a,b)=>{
    const ga = order[a[1].grade] || 99;
    const gb = order[b[1].grade] || 99;
    if(ga !== gb) return ga - gb;
    return a[1].name.localeCompare(b[1].name);
  });

  // 🔥 버튼 래퍼
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "8px";

  entries.forEach(([key,val])=>{

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.borderRadius = "20px";
    btn.style.padding = "8px 12px";
    btn.style.fontSize = "14px";
    btn.textContent = `${val.name}(${val.grade})`;

    // 클릭 시 수정 패널 열기
    btn.onclick = ()=>{
      if(!unlocked){
        toast("잠금 해제 후 수정 가능");
        return;
      }
      openEditPanel(key,val);
    };

    wrap.appendChild(btn);
  });

  el.appendChild(wrap);
}

function openEditPanel(key,val){

  // 기존 패널 제거
  const old = document.getElementById("editPanel");
  if(old) old.remove();

  const panel = document.createElement("div");
  panel.id = "editPanel";
  panel.className = "card";
  panel.style.marginTop = "12px";

  panel.innerHTML = `
    <h3>${val.name} (${val.grade})</h3>
  `;

  const sel = document.createElement("select");
  sel.className = "select";
  ["A","B","C","D"].forEach(g=>{
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    if(val.grade===g) opt.selected = true;
    sel.appendChild(opt);
  });

  const save = document.createElement("button");
  save.className="btn ok";
  save.textContent="수정";
  save.style.marginRight="8px";
  save.onclick = async ()=>{
    const g = sel.value;
    await update(ref(db,`members/${key}`),{
      grade:g,
      weight:GRADE_WEIGHT[g],
      updatedAt:Date.now()
    });
    toast("수정 완료");
    panel.remove();
  };

  const del = document.createElement("button");
  del.className="btn danger";
  del.textContent="삭제";
  del.onclick = async ()=>{
    await remove(ref(db,`members/${key}`));
    toast("삭제 완료");
    panel.remove();
  };

  panel.appendChild(sel);
  panel.appendChild(document.createElement("br"));
  panel.appendChild(document.createElement("br"));
  panel.appendChild(save);
  panel.appendChild(del);

  $("memberList").appendChild(panel);
}

async function addMember(){
  if(!unlocked) return toast("잠금 해제 필요");

  const name = $("mName").value.trim();
  const grade = $("mGrade").value;

  if(!name) return toast("이름 입력");

  const exists = Object.values(memberCache)
    .some(v=>v.name===name);

  if(exists) return toast("이미 등록된 이름");

  await push(ref(db,"members"),{
    name,
    grade,
    weight:GRADE_WEIGHT[grade],
    createdAt:Date.now()
  });

  $("mName").value="";
  toast("멤버 추가 완료");
}

/* =========================
   Init
========================= */
(async function(){
  try{
    await initAuth();
    bindPin();
    bindMembers();
    setLockUI();

    /* =========================
       Tabs (여기로 이동)
    ========================== */

    const tabButtons = document.querySelectorAll(".tab");
    const tabSections = {
      lock: $("tab-lock"),
      members: $("tab-members")
    };

    function showTab(key){
      tabButtons.forEach(btn=>{
        btn.classList.toggle("active", btn.dataset.tab === key);
      });

      Object.entries(tabSections).forEach(([k,sec])=>{
        sec.classList.toggle("hide", k !== key);
      });
    }

    tabButtons.forEach(btn=>{
      btn.addEventListener("click", ()=>{
        showTab(btn.dataset.tab);
      });
    });

  }catch(e){
    console.error(e);
    toast("Firebase 오류");
  }
})();

$("setPinBtn").onclick = setOrChangePin;
$("unlockBtn").onclick = unlock;
$("lockBtn").onclick = lock;
$("addMemberBtn").onclick = addMember;
$("refreshBtn").onclick = ()=>location.reload();

/* =========================
   Tabs
========================= */

const tabButtons = document.querySelectorAll(".tab");
const tabSections = {
  lock: $("tab-lock"),
  members: $("tab-members")
};

function showTab(key){
  tabButtons.forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.tab === key);
  });

  Object.entries(tabSections).forEach(([k,sec])=>{
    sec.classList.toggle("hide", k !== key);
  });
}

tabButtons.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    showTab(btn.dataset.tab);
  });
});