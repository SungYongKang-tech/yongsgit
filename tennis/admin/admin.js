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

const $ = id => document.getElementById(id);

function simpleHash(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h>>>0).toString(16);
}

const PATH = {
  adminPass: "config/adminPassword",
  members: "members"
};

let loggedIn = false;
let memberCache = {};
let savedHash = null;

const GRADE_WEIGHT = { A:4, B:3, C:2, D:1 };

/* =======================
   Init
======================= */
(async function(){
  await signInAnonymously(auth);

  onValue(ref(db, PATH.adminPass), snap=>{
    savedHash = snap.exists() ? snap.val() : null;
  });

  bindMembers();
})();

/* =======================
   로그인
======================= */
$("loginBtn").onclick = async ()=>{
  const pw = $("loginPassword").value.trim();
  if(!savedHash){
    alert("관리자 비밀번호가 아직 설정되지 않았습니다.\n초기 설정을 위해 비밀번호를 입력하세요.");
    await set(ref(db, PATH.adminPass), simpleHash(pw));
    savedHash = simpleHash(pw);
  }

  if(simpleHash(pw) === savedHash){
    loggedIn = true;
    $("loginSection").style.display="none";
    $("adminSection").style.display="block";
  }else{
    $("loginError").textContent="비밀번호가 올바르지 않습니다.";
  }
};

$("logoutBtn").onclick = ()=>{
  loggedIn=false;
  $("adminSection").style.display="none";
  $("loginSection").style.display="block";
};

/* =======================
   비밀번호 변경
======================= */
$("changePassBtn").onclick = async ()=>{
  const p1 = $("newPass1").value.trim();
  const p2 = $("newPass2").value.trim();

  if(p1.length<4) return alert("4자리 이상 입력");
  if(p1!==p2) return alert("비밀번호 불일치");

  await set(ref(db, PATH.adminPass), simpleHash(p1));
  savedHash = simpleHash(p1);
  alert("비밀번호 변경 완료");
};

/* =======================
   멤버 관리
======================= */
function bindMembers(){
  onValue(ref(db, PATH.members), snap=>{
    memberCache = snap.exists()? snap.val():{};
    renderMembers();
  });
}

function renderMembers(){
  const el = $("memberList");
  el.innerHTML="";

  Object.entries(memberCache).forEach(([key,val])=>{
    const btn = document.createElement("button");
    btn.className="btn";
    btn.style.margin="4px";
    btn.textContent=`${val.name}(${val.grade})`;

    btn.onclick = ()=>{
      if(!loggedIn) return;

      const newGrade = prompt("등급 수정 (A/B/C/D)",val.grade);
      if(!newGrade) return;

      update(ref(db,`members/${key}`),{
        grade:newGrade,
        weight:GRADE_WEIGHT[newGrade]
      });
    };

    el.appendChild(btn);
  });
}

$("addMemberBtn").onclick = async ()=>{
  if(!loggedIn) return;

  const name=$("mName").value.trim();
  const grade=$("mGrade").value;

  if(!name) return;

  await push(ref(db,"members"),{
    name,
    grade,
    weight:GRADE_WEIGHT[grade]
  });

  $("mName").value="";
};