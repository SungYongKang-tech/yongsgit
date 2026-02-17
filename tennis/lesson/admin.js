import { db } from "../firebase.js";
import {
  ref, set, push, onValue, remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const $ = id => document.getElementById(id);

/* ======================
   PIN
====================== */
$("#savePinBtn").addEventListener("click", async ()=>{
  const p1 = $("#pin1").value.trim();
  const p2 = $("#pin2").value.trim();
  if(p1 !== p2) return alert("PIN 불일치");
  await set(ref(db,"lesson/config/pin"), p1);
  alert("PIN 저장 완료");
});

/* ======================
   레슨자 멤버
====================== */
const coachRef = ref(db,"lesson/coaches");

$("#addCoachBtn").addEventListener("click", async ()=>{
  const name = $("#coachName").value.trim();
  if(!name) return;
  await push(coachRef,{name});
  $("#coachName").value="";
});

onValue(coachRef,(snap)=>{
  const data = snap.val()||{};
  $("#coachList").innerHTML="";
  Object.entries(data).forEach(([k,v])=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      ${v.name}
      <button onclick="delCoach('${k}')" class="btn danger">삭제</button>
    `;
    $("#coachList").appendChild(div);
  });
});

window.delCoach = async (key)=>{
  await remove(ref(db,"lesson/coaches/"+key));
};

/* ======================
   안내문
====================== */
const guideRef = ref(db,"lesson/guide");

$("#saveGuideBtn").addEventListener("click", async ()=>{
  await set(guideRef, $("#guideText").value);
  alert("저장 완료");
});

onValue(guideRef,(snap)=>{
  $("#guideText").value = snap.val()||"";
});

/* ======================
   시간표
====================== */
const scheduleRef = ref(db,"lesson/schedule");

$("#saveScheduleBtn").addEventListener("click", async ()=>{
  await set(scheduleRef, $("#scheduleText").value);
  alert("저장 완료");
});

onValue(scheduleRef,(snap)=>{
  $("#scheduleText").value = snap.val()||"";
});

/* ======================
   대기자
====================== */
const waitingRef = ref(db,"lesson/waiting");

$("#addWaitingBtn").addEventListener("click", async ()=>{
  const name=$("#waitingName").value.trim();
  if(!name) return;
  await push(waitingRef,{name});
  $("#waitingName").value="";
});

onValue(waitingRef,(snap)=>{
  const data=snap.val()||{};
  $("#waitingList").innerHTML="";
  Object.entries(data).forEach(([k,v])=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      ${v.name}
      <button onclick="delWaiting('${k}')" class="btn danger">삭제</button>
    `;
    $("#waitingList").appendChild(div);
  });
});

window.delWaiting = async (key)=>{
  await remove(ref(db,"lesson/waiting/"+key));
};