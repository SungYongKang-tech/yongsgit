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
   레슨자 멤버 (이름 + 등급) + 전체 저장
   - 목록 표시: 강성용(A)
   - 개별 저장 버튼 없음
====================== */
const coachRef = ref(db, "lesson/coaches");

// 화면에서 편집 중인 임시 데이터(전체 저장용)
let coachDraft = {};      // { key: { name, grade } }
let coachOrder = [];      // 렌더링 순서

function normGrade(g){
  const G = (g || "B").toUpperCase();
  return ["A","B","C","D"].includes(G) ? G : "B";
}

function renderCoaches(){
  const listEl = $("#coachList");
  listEl.innerHTML = "";

  if (coachOrder.length === 0){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "등록된 레슨자가 없습니다.";
    listEl.appendChild(empty);
    return;
  }

  coachOrder.forEach((key)=>{
    const v = coachDraft[key];
    if(!v) return;

    const item = document.createElement("div");
    item.className = "item";

    // 왼쪽: "이름(A)" 표시
    const left = document.createElement("div");
    left.style.fontWeight = "800";
    left.textContent = `${v.name}(${normGrade(v.grade)})`;

    // 오른쪽: 등급 선택 + 삭제
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    const sel = document.createElement("select");
    sel.className = "input";           // 기존 스타일 그대로 쓰려고 input 클래스를 재사용
    sel.style.maxWidth = "90px";
    sel.style.margin = "0";
    ["A","B","C","D"].forEach(g=>{
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      if(normGrade(v.grade) === g) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", ()=>{
      coachDraft[key].grade = sel.value;    // ✅ 메모리에만 반영
      left.textContent = `${v.name}(${sel.value})`; // 즉시 표시 업데이트
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", async ()=>{
      // DB에서 즉시 삭제(삭제는 예외적으로 바로 반영)
      await remove(ref(db, `lesson/coaches/${key}`));
    });

    right.appendChild(sel);
    right.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(right);
    listEl.appendChild(item);
  });
}

// DB → draft로 로드
onValue(coachRef, (snap)=>{
  const data = snap.val() || {};

  coachDraft = {};
  coachOrder = Object.keys(data);

  // 정렬(선택): 등급 A→D, 이름순
  const orderMap = { A:1, B:2, C:3, D:4 };
  coachOrder.sort((a,b)=>{
    const va = data[a] || {}, vb = data[b] || {};
    const ga = orderMap[normGrade(va.grade)] || 99;
    const gb = orderMap[normGrade(vb.grade)] || 99;
    if(ga !== gb) return ga - gb;
    return (va.name || "").localeCompare(vb.name || "");
  });

  coachOrder.forEach((k)=>{
    const v = data[k] || {};
    coachDraft[k] = {
      name: (v.name || "").trim(),
      grade: normGrade(v.grade) // 예전 데이터에 grade 없으면 B로
    };
  });

  renderCoaches();
});

// 추가: 기본 등급 B로 넣기
$("#addCoachBtn").addEventListener("click", async ()=>{
  const name = $("#coachName").value.trim();
  if(!name) return;

  await push(coachRef, { name, grade: "B" });
  $("#coachName").value = "";
});

// ✅ 전체 저장: 현재 draft를 DB에 반영
$("#saveCoachesBtn").addEventListener("click", async ()=>{
  // draft를 객체로 재구성하여 set/update
  // 여기서는 전체 덮어쓰기보다 안전하게 "각 항목 update"로 갑니다.
  const updates = [];
  coachOrder.forEach((k)=>{
    const v = coachDraft[k];
    if(!v || !v.name) return;
    updates.push(
      update(ref(db, `lesson/coaches/${k}`), { grade: normGrade(v.grade) })
    );
  });

  await Promise.all(updates);
  alert("레슨자 등급 전체 저장 완료");
});

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