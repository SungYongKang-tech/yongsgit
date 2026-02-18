// lesson/admin.js
import { db } from "../firebase.js";
import {
  ref, set, push, onValue, remove, update
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const $ = id => document.getElementById(id);

/* =========================================================
   1) 레슨자 멤버: 회원(/members)에서 클릭 추가 + 전체 저장
   - 목록 표시: 강성용(A)
   - 개별 저장 버튼 없음
========================================================= */
const membersRef = ref(db, "members");          // 전체 회원(테니스 공용)
const coachRef   = ref(db, "lesson/coaches");   // 레슨자 목록

let membersCache = {};  // { memberKey: {name, grade, ...} }

// 화면에서 편집 중인 임시 데이터(전체 저장용)
let coachDraft = {};      // { coachKey: { name, grade, memberKey? } }
let coachOrder = [];      // 렌더링 순서

function normGrade(g){
  const G = (g || "B").toUpperCase();
  return ["A","B","C","D"].includes(G) ? G : "B";
}

/* --- 회원 버튼 렌더링 (클릭하면 레슨자에 추가) --- */
function renderMemberButtons(){
  const wrap = $("#memberSelectList");
  if(!wrap) return; // HTML에 없으면 그냥 무시
  wrap.innerHTML = "";

  const entries = Object.entries(membersCache || {});
  if(entries.length === 0){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "회원 목록이 없습니다. /members 데이터를 먼저 등록하세요.";
    wrap.appendChild(empty);
    return;
  }

  // 이름순 정렬
  entries.sort((a,b)=>{
    const na = (a[1]?.name || "").trim();
    const nb = (b[1]?.name || "").trim();
    return na.localeCompare(nb);
  });

  entries.forEach(([memberKey, m])=>{
    const name = (m?.name || "").trim();
    if(!name) return;
    const grade = normGrade(m?.grade);

    const btn = document.createElement("button");
    btn.className = "btn";
    btn.type = "button";
    btn.textContent = `${name}(${grade})`;

    btn.addEventListener("click", async ()=>{
      // 레슨자 중복 등록 방지(같은 memberKey 또는 같은 name)
      const exists = Object.values(coachDraft).some(v=>{
        if(!v) return false;
        if(v.memberKey && v.memberKey === memberKey) return true;
        return (v.name || "").trim() === name;
      });
      if(exists){
        alert("이미 레슨자로 등록되어 있습니다.");
        return;
      }

      await push(coachRef, { memberKey, name, grade });
    });

    wrap.appendChild(btn);
  });
}

/* --- 레슨자 목록 렌더링 (등급변경은 draft에만 반영) --- */
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

    // 왼쪽: 이름(등급)
    const left = document.createElement("div");
    left.style.fontWeight = "800";
    left.style.whiteSpace = "nowrap";
    left.style.overflow = "hidden";
    left.style.textOverflow = "ellipsis";
    left.textContent = `${v.name}(${normGrade(v.grade)})`;

    // 오른쪽: 등급 선택 + 삭제
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    const sel = document.createElement("select");
    sel.className = "input";     // 기존 스타일 재사용
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
      coachDraft[key].grade = sel.value; // ✅ draft에만 저장
      left.textContent = `${v.name}(${sel.value})`;
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.type = "button";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", async ()=>{
      await remove(ref(db, `lesson/coaches/${key}`));
    });

    right.appendChild(sel);
    right.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(right);
    listEl.appendChild(item);
  });
}

/* --- DB → draft 로드(레슨자) --- */
onValue(coachRef, (snap)=>{
  const data = snap.val() || {};

  coachDraft = {};
  coachOrder = Object.keys(data);

  // 정렬: 등급 A→D, 이름순
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
      memberKey: v.memberKey || null,
      name: (v.name || "").trim(),
      grade: normGrade(v.grade)
    };
  });

  renderCoaches();
});

/* --- DB → cache 로드(회원) --- */
onValue(membersRef, (snap)=>{
  membersCache = snap.val() || {};
  renderMemberButtons();
});

/* --- (옵션) 이름 직접 입력 추가 버튼이 HTML에 남아있다면 동작은 유지하되 권장X --- */
const addCoachBtn = $("#addCoachBtn");
if(addCoachBtn){
  addCoachBtn.addEventListener("click", async ()=>{
    const input = $("#coachName");
    if(!input) return;
    const name = input.value.trim();
    if(!name) return;

    // 중복 방지
    const exists = Object.values(coachDraft).some(v => (v?.name||"").trim() === name);
    if(exists){
      alert("이미 레슨자로 등록되어 있습니다.");
      return;
    }

    await push(coachRef, { name, grade: "B" });
    input.value = "";
  });
}

/* --- ✅ 전체 저장(등급 변경분만 저장) --- */
$("#saveCoachesBtn")?.addEventListener("click", async ()=>{
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


/* =========================================================
   2) 안내문 (텍스트 저장)
========================================================= */
const guideRef = ref(db, "lesson/guide");

$("#saveGuideBtn")?.addEventListener("click", async ()=>{
  await set(guideRef, $("#guideText").value);
  alert("저장 완료");
});

onValue(guideRef, (snap)=>{
  const el = $("#guideText");
  if(el) el.value = snap.val() || "";
});


/* =========================================================
   3) 시간표 (현재는 텍스트 저장 유지)
   - 표 형태(아침/점심/저녁 × 요일)는 다음 단계에서
     schedule 데이터를 객체로 바꿔서 구현 권장
========================================================= */
const scheduleRef = ref(db, "lesson/scheduleText");

$("#saveScheduleBtn")?.addEventListener("click", async ()=>{
  await set(scheduleRef, $("#scheduleText").value);
  alert("저장 완료");
});

onValue(scheduleRef, (snap)=>{
  const el = $("#scheduleText");
  if(el) el.value = snap.val() || "";
});


/* =========================================================
   4) 대기자
========================================================= */
const waitingRef = ref(db, "lesson/waiting");

$("#addWaitingBtn")?.addEventListener("click", async ()=>{
  const name = $("#waitingName").value.trim();
  if(!name) return;
  await push(waitingRef, { name });
  $("#waitingName").value = "";
});

onValue(waitingRef, (snap)=>{
  const data = snap.val() || {};
  const list = $("#waitingList");
  if(!list) return;

  list.innerHTML = "";
  Object.entries(data).forEach(([k,v])=>{
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      ${v.name || ""}
      <button class="btn danger" data-key="${k}">삭제</button>
    `;
    div.querySelector("button")?.addEventListener("click", async ()=>{
      await remove(ref(db, `lesson/waiting/${k}`));
    });
    list.appendChild(div);
  });
});