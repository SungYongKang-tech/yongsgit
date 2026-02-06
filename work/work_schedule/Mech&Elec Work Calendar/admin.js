import { db } from "./firebase.js";
import {
  ref, onValue, push, set, update, remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const $ = (id)=>document.getElementById(id);
const list = $("list");

const modalBack = $("modalBack");
const modalTitle = $("modalTitle");
const mName = $("mName");
const mOrder = $("mOrder");
const mColor = $("mColor");
const mActive = $("mActive");
const saveBtn = $("saveBtn");
const delBtn = $("delBtn");
const closeBtn = $("closeBtn");

let editingId = null;
let members = [];

function openModal(member=null){
  modalBack.classList.add("show");
  if(member){
    modalTitle.textContent = "멤버 수정";
    editingId = member.id;
    mName.value = member.name || "";
    mOrder.value = member.order ?? "";
    mColor.value = member.color || "";
    mActive.value = (member.active === false) ? "false" : "true";
    delBtn.style.display = "inline-block";
  } else {
    modalTitle.textContent = "멤버 추가";
    editingId = null;
    mName.value = "";
    mOrder.value = "";
    mColor.value = "#1f6feb";
    mActive.value = "true";
    delBtn.style.display = "none";
  }
}
function closeModal(){
  modalBack.classList.remove("show");
  editingId = null;
}
modalBack.addEventListener("click",(e)=>{ if(e.target===modalBack) closeModal(); });
closeBtn.addEventListener("click", closeModal);

$("addBtn").addEventListener("click", ()=>openModal(null));

function render(){
  list.innerHTML = "";
  if(!members.length){
    list.innerHTML = `<div class="small">등록된 인원이 없습니다. “추가”를 눌러 등록하세요.</div>`;
    return;
  }

  members.forEach(m=>{
    const row = document.createElement("div");
    row.className = "card";
    row.style.margin = "10px 0";
    row.style.padding = "10px";

    row.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900; display:flex; align-items:center; gap:8px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${m.color||"#ddd"}"></span>
            ${m.name || "(이름없음)"}
            ${m.active === false ? `<span class="chip">비활성</span>` : `<span class="chip">활성</span>`}
          </div>
          <div class="small">순서: ${m.order ?? "-"}</div>
        </div>
        <button class="btn" data-id="${m.id}">수정</button>
      </div>
    `;
    row.querySelector("button").onclick = ()=>openModal(m);

    list.appendChild(row);
  });
}

onValue(ref(db, "config/members"), (snap)=>{
  const obj = snap.val() || {};
  members = Object.entries(obj).map(([id, v])=>({ id, ...v }))
    .sort((a,b)=>(a.order ?? 999)-(b.order ?? 999));
  render();
});

saveBtn.addEventListener("click", async ()=>{
  const name = (mName.value || "").trim();
  if(!name){ alert("이름은 필수입니다."); return; }

  const payload = {
    name,
    order: Number(mOrder.value || 999),
    color: (mColor.value || "").trim() || "#1f6feb",
    active: (mActive.value === "true")
  };

  if(editingId){
    await update(ref(db, `config/members/${editingId}`), payload);
  } else {
    const newRef = push(ref(db, `config/members`));
    await set(newRef, payload);
  }
  closeModal();
});

delBtn.addEventListener("click", async ()=>{
  if(!editingId) return;
  if(!confirm("이 멤버를 삭제하시겠습니까?")) return;
  await remove(ref(db, `config/members/${editingId}`));
  closeModal();
});
