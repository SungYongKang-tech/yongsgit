// ✅ pingpong_main 전용 firebase.js만 사용 (완전 분리)
import { db, auth } from "../firebase.js";

import {
  ref,
  onValue,
  set,
  update,
  remove,
  push
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const $ = (id) => document.getElementById(id);

/* =======================
   Hash (관리자 로그인용)
======================= */
function simpleHash(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h>>>0).toString(16);
}

/* =======================
   탁구 전용 DB 경로
======================= */
const PATH = {
  adminPass: "config/adminPassword",     // 관리자 로그인 비번(hash)
  deletePass: "config/deletePassword",   // 경기 삭제 비번(4자리 원문)
  members: "members"                    // 선수 목록
};

let loggedIn = false;
let memberCache = {};
let savedHash = null;

/* =======================
   부수 규칙
   - 숫자 낮을수록 강함
======================= */
const MAX_BU = 14;
function buToStrength(bu){
  const n = Number(bu);
  if(!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, (MAX_BU + 1) - n);
}

/* =======================
   Init
======================= */
(async function init(){
  try{
    await signInAnonymously(auth);

    $("statusText").textContent = "연결됨";
    $("uidText").textContent = auth?.currentUser?.uid || "-";

    // ✅ 분리 확인용 (콘솔에서 projectId 꼭 확인)
    console.log("PINGPONG projectId:", auth?.app?.options?.projectId);
    console.log("PINGPONG databaseURL:", auth?.app?.options?.databaseURL);

    onValue(ref(db, PATH.adminPass), snap=>{
      savedHash = snap.exists() ? snap.val() : null;
    });

    onValue(ref(db, PATH.deletePass), snap=>{
      const v = snap.exists() ? String(snap.val()) : "";
      $("deletePwInput").value = v;
    });

    bindHeaderButtons();
    bindAdminPasswordUI();
    bindLoginPasswordUI();
    bindDeletePasswordUI();
    bindMembers();
  }catch(e){
    console.error(e);
    $("statusText").textContent = "연결 실패";
    alert("Firebase 연결/로그인 실패. 콘솔을 확인하세요.");
  }
})();

/* =======================
   Header
======================= */
function bindHeaderButtons(){
  $("refreshBtn").onclick = ()=> location.reload();
}

/* =======================
   로그인
======================= */
$("loginBtn").onclick = async ()=>{
  const pw = ($("loginPassword").value || "").trim();
  if(!pw) return alert("비밀번호를 입력하세요.");
  if(!/^\d{4}$/.test(pw)) return alert("관리자 비밀번호는 숫자 4자리로 입력하세요.");

  if(!savedHash){
    alert("관리자 비밀번호가 아직 설정되지 않았습니다.\n입력한 비밀번호로 초기 설정합니다.");
    const h = simpleHash(pw);
    await set(ref(db, PATH.adminPass), h);
    savedHash = h;
  }

  if(simpleHash(pw) === savedHash){
    loggedIn = true;
    $("loginSection").style.display = "none";
    $("adminSection").style.display = "block";
    $("loginError").textContent = "";
  }else{
    $("loginError").textContent = "비밀번호가 올바르지 않습니다.";
  }
};

$("logoutBtn").onclick = ()=>{
  loggedIn = false;
  $("adminSection").style.display = "none";
  $("loginSection").style.display = "block";
  $("loginPassword").value = "";
};

/* =======================
   관리자 비밀번호 변경
======================= */
$("changePassBtn").onclick = async ()=>{
  if(!loggedIn) return alert("로그인 후 변경 가능합니다.");

  const p1 = ($("newPass1").value || "").trim();
  if(!/^\d{4}$/.test(p1)) return alert("관리자 비밀번호는 숫자 4자리로 입력하세요.");

  const h = simpleHash(p1);
  await set(ref(db, PATH.adminPass), h);
  savedHash = h;

  $("newPass1").value = "";
  alert("관리자 비밀번호 저장 완료");
};

function bindAdminPasswordUI(){
  const input = $("newPass1");
  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\D/g, "").slice(0,4);
  });
}

function bindLoginPasswordUI(){
  const input = $("loginPassword");
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("pattern", "[0-9]*");
  input.setAttribute("maxlength", "4");
  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\D/g, "").slice(0,4);
  });
}

/* =======================
   경기 삭제 비밀번호
======================= */
function bindDeletePasswordUI(){
  const input = $("deletePwInput");
  const btn   = $("saveDeletePwBtn");

  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\D/g, "").slice(0,4);
  });

  btn.addEventListener("click", async ()=>{
    if(!loggedIn) return alert("로그인 후 변경 가능합니다.");

    const v = (input.value || "").trim();
    if(!/^\d{4}$/.test(v)) return alert("삭제 비밀번호는 숫자 4자리로 입력하세요.");

    await set(ref(db, PATH.deletePass), v);
    alert("경기 삭제 비밀번호 저장 완료");
  });
}

/* =======================
   선수(부수) 관리
======================= */
function bindMembers(){
  onValue(ref(db, PATH.members), snap=>{
    memberCache = snap.exists() ? snap.val() : {};
    renderMembers();
  });
}

let openActionKey = null;
function closeMemberActions(){
  openActionKey = null;
  document.querySelectorAll(".chipActions").forEach(x=>x.remove());
}

function renderMembers(){
  const el = $("memberList");
  el.innerHTML = "";

  el.onclick = (e)=>{
    if(e.target.closest(".chipWrap")) return;
    closeMemberActions();
  };

  const list = Object.entries(memberCache)
    .map(([key,val])=>({ key, ...val }))
    .sort((a,b)=>{
      const abu = Number(a.bu ?? 999);
      const bbu = Number(b.bu ?? 999);
      if(abu !== bbu) return abu - bbu; // ✅ 낮을수록 강함
      return String(a.name||"").localeCompare(String(b.name||""), "ko");
    });

  list.forEach(({key, name, bu})=>{
    const wrap = document.createElement("span");
    wrap.className = "chipWrap";

    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = `${name}(${bu}부)`;

    chip.onclick = (e)=>{
      e.stopPropagation();
      if(!loggedIn) return;

      if(openActionKey === key){
        closeMemberActions();
        return;
      }

      closeMemberActions();
      openActionKey = key;

      const panel = document.createElement("div");
      panel.className = "chipActions";
      panel.onclick = (ev)=>ev.stopPropagation();

      const editBtn = document.createElement("button");
      editBtn.className = "btnMini primary";
      editBtn.type = "button";
      editBtn.textContent = "수정";
      editBtn.onclick = async ()=>{
        const newName = prompt("이름 수정", name);
        if(newName === null) return;
        const n = newName.trim();
        if(!n) return alert("이름은 비워둘 수 없습니다.");

        const newBuRaw = prompt("부수 수정 (숫자만, 예: 6)", String(bu ?? ""));
        if(newBuRaw === null) return;

        const buNum = Number(String(newBuRaw).trim().replace(/\D/g,""));
        if(!Number.isFinite(buNum) || buNum < 1 || buNum > 14)
          return alert("부수는 1~14 사이로 입력하세요.");
        await update(ref(db, `${PATH.members}/${key}`), {
          name: n,
          bu: buNum,
          strength: buToStrength(buNum)
        });

        closeMemberActions();
      };

      const delBtn = document.createElement("button");
      delBtn.className = "btnMini danger";
      delBtn.type = "button";
      delBtn.textContent = "삭제";
      delBtn.onclick = async ()=>{
        if(!confirm(`${name} 선수를 삭제하시겠습니까?`)) return;
        await remove(ref(db, `${PATH.members}/${key}`));
        closeMemberActions();
      };

      panel.appendChild(editBtn);
      panel.appendChild(delBtn);
      wrap.appendChild(chip);
      wrap.appendChild(panel);
    };

    wrap.appendChild(chip);
    el.appendChild(wrap);
  });
}

/* 선수 추가 */
$("addMemberBtn").onclick = async ()=>{
  if(!loggedIn) return;

  const name = ($("mName").value || "").trim();
  const buNum = Number(String($("mBu").value || "").replace(/\D/g,""));

  if(!name) return alert("이름을 입력하세요.");
  if(!Number.isFinite(buNum) || buNum < 1 || buNum > 14)
  return alert("부수는 1~14 사이로 입력하세요.");
  await push(ref(db, PATH.members), {
    name,
    bu: buNum,
    strength: buToStrength(buNum)
  });

  $("mName").value = "";
};