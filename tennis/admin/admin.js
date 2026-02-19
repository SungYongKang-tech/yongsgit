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
   Firebase paths
======================= */
const PATH = {
  adminPass: "config/adminPassword",     // 관리자 로그인 비번(hash)
  deletePass: "config/deletePassword",   // 경기 삭제 비번(원문 4자리)
  members: "members"
};

let loggedIn = false;
let memberCache = {};
let savedHash = null;
let deletePassword = null;

/* 등급 가중치 */
const GRADE_WEIGHT = { A:4, B:3, C:2, D:1 };

/* =======================
   Init
======================= */
(async function init(){
  try{
    await signInAnonymously(auth);

    // 상태표시
    if($("statusText")) $("statusText").textContent = "연결됨";
    if($("uidText")) $("uidText").textContent = auth?.currentUser?.uid || "-";

    // 관리자 비번(hash) 로드
    onValue(ref(db, PATH.adminPass), snap=>{
      savedHash = snap.exists() ? snap.val() : null;
    });

    // 경기 삭제 비번 로드(항상 최신)
    onValue(ref(db, PATH.deletePass), snap=>{
      deletePassword = snap.exists() ? String(snap.val()) : null;
      if($("deletePwInput")){
        $("deletePwInput").value = deletePassword ?? "";
      }
    });

    // ✅ 입력 제한 바인딩들
    bindAdminPasswordUI();      // 관리자 변경 비번 input (newPass1)
    bindLoginPasswordUI();      // (선택) 로그인 input (loginPassword)
    bindDeletePasswordUI();     // 삭제 비번 input (deletePwInput)

    bindMembers();
    bindHeaderButtons();
  }catch(e){
    console.error(e);
    if($("statusText")) $("statusText").textContent = "연결 실패";
    alert("Firebase 연결/로그인 실패. 콘솔을 확인하세요.");
  }
})();

/* =======================
   Header buttons
======================= */
function bindHeaderButtons(){
  if($("refreshBtn")){
    $("refreshBtn").onclick = ()=> location.reload();
  }
}

/* =======================
   로그인
======================= */
$("loginBtn").onclick = async ()=>{
  const pw = ($("loginPassword")?.value || "").trim();
  if(!pw) return alert("비밀번호를 입력하세요.");

  // ✅ 관리자 비번을 4자리 숫자로 통일
  if(!/^\d{4}$/.test(pw)) return alert("관리자 비밀번호는 숫자 4자리로 입력하세요.");

  // 최초 1회: adminPassword 없으면 지금 입력한 값으로 저장
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
    if($("loginError")) $("loginError").textContent = "";
  }else{
    if($("loginError")) $("loginError").textContent = "비밀번호가 올바르지 않습니다.";
  }
};

$("logoutBtn").onclick = ()=>{
  loggedIn = false;
  $("adminSection").style.display = "none";
  $("loginSection").style.display = "block";
  if($("loginPassword")) $("loginPassword").value = "";
};

/* =======================
   ✅ 관리자 비밀번호 변경 (4자리 숫자 1회 입력)
   - admin.html: newPass1 + changePassBtn 형태로 변경된 것 반영
======================= */
$("changePassBtn").onclick = async ()=>{
  if(!loggedIn) return alert("로그인 후 변경 가능합니다.");

  const p1 = ($("newPass1")?.value || "").trim();

  if(!/^\d{4}$/.test(p1)) return alert("관리자 비밀번호는 숫자 4자리로 입력하세요.");

  const h = simpleHash(p1);
  await set(ref(db, PATH.adminPass), h);
  savedHash = h;

  if($("newPass1")) $("newPass1").value = "";
  alert("관리자 비밀번호 저장 완료");
};

/* =======================
   ✅ 관리자 비번 입력칸(newPass1) 숫자 4자리 제한
======================= */
function bindAdminPasswordUI(){
  const input = $("newPass1");
  if(!input) return;

  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\D/g, "").slice(0,4);
  });
}

/* =======================
   ✅ (선택) 로그인 입력칸(loginPassword)도 숫자 4자리 제한
   - UI도 통일되고 오타 줄어듭니다.
======================= */
function bindLoginPasswordUI(){
  const input = $("loginPassword");
  if(!input) return;

  input.setAttribute("inputmode", "numeric");
  input.setAttribute("pattern", "[0-9]*");
  input.setAttribute("maxlength", "4");

  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\D/g, "").slice(0,4);
  });
}

/* =======================
   ✅ 경기 삭제 비밀번호(4자리) 설정
======================= */
function bindDeletePasswordUI(){
  const input = $("deletePwInput");
  const btn   = $("saveDeletePwBtn");
  if(!input || !btn) return;

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
   멤버 관리
======================= */
function bindMembers(){
  onValue(ref(db, PATH.members), snap=>{
    memberCache = snap.exists() ? snap.val() : {};
    renderMembers();
  });
}

function renderMembers(){
  const el = $("memberList");
  if(!el) return;
  el.innerHTML = "";

  Object.entries(memberCache).forEach(([key, val])=>{
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = `${val.name}(${val.grade})`;

    btn.onclick = async ()=>{
      if(!loggedIn) return;

      const action = prompt("선택: 1)수정  2)삭제\n숫자 입력", "1");
      if(action === null) return;

      // 삭제
      if(action.trim() === "2"){
        if(!confirm(`${val.name} 선수를 삭제하시겠습니까?`)) return;
        await remove(ref(db, `${PATH.members}/${key}`));
        return;
      }

      // 수정
      const newName = prompt("이름 수정", val.name);
      if(newName === null) return;
      const name = newName.trim();
      if(!name) return alert("이름은 비워둘 수 없습니다.");

      const newGradeRaw = prompt("등급 수정 (A/B/C/D)", val.grade);
      if(newGradeRaw === null) return;
      const grade = newGradeRaw.trim().toUpperCase();
      if(!GRADE_WEIGHT[grade]) return alert("등급은 A/B/C/D 중 하나여야 합니다.");

      await update(ref(db, `${PATH.members}/${key}`), {
        name,
        grade,
        weight: GRADE_WEIGHT[grade]
      });
    };

    el.appendChild(btn);
  });
}

/* 멤버 추가 */
$("addMemberBtn").onclick = async ()=>{
  if(!loggedIn) return;

  const name = ($("mName")?.value || "").trim();
  const grade = ($("mGrade")?.value || "D").toUpperCase();

  if(!name) return alert("이름을 입력하세요.");
  if(!GRADE_WEIGHT[grade]) return alert("등급이 올바르지 않습니다.");

  await push(ref(db, PATH.members), {
    name,
    grade,
    weight: GRADE_WEIGHT[grade]
  });

  $("mName").value = "";
};