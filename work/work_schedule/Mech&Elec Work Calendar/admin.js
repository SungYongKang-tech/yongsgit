import { db } from "./firebase.js";
import {
  ref, onValue, push, set, update, remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

/* =========================
   Helpers
========================= */
const $ = (id) => document.getElementById(id);

/* =========================
   ✅ 멤버 관리 (기존)
========================= */
const list = $("list");

const modalBack = $("modalBack");
const modalTitle = $("modalTitle");
const mName = $("mName");
const mOrder = $("mOrder");
const mColor = $("mColor");
const mActive = $("mActive");
const mPin = $("mPin"); // ✅ 추가
const saveBtn = $("saveBtn");
const delBtn = $("delBtn");
const closeBtn = $("closeBtn");

let editingId = null;
let members = [];

function openModal(member = null) {
  modalBack.classList.add("show");
  if (member) {
    modalTitle.textContent = "멤버 수정";
    editingId = member.id;
    mName.value = member.name || "";
    mOrder.value = member.order ?? "";
    mColor.value = member.color || "#1f6feb";
    mActive.value = (member.active === false) ? "false" : "true";
    mPin.value = member.pin || ""; // ✅ 추가
    delBtn.style.display = "inline-block";
  } else {
    modalTitle.textContent = "멤버 추가";
    editingId = null;
    mName.value = "";
    mOrder.value = "";
    mColor.value = "#1f6feb";
    mActive.value = "true";
    mPin.value = ""; // ✅ 추가
    delBtn.style.display = "none";
  }
}

function closeModal() {
  modalBack.classList.remove("show");
  editingId = null;
}

modalBack?.addEventListener("click", (e) => { if (e.target === modalBack) closeModal(); });
closeBtn?.addEventListener("click", closeModal);

$("addBtn")?.addEventListener("click", () => openModal(null));

function renderMembers() {
  list.innerHTML = "";
  if (!members.length) {
    list.innerHTML = `<div class="small">등록된 인원이 없습니다. “추가”를 눌러 등록하세요.</div>`;
    return;
  }

  members.forEach((m) => {
    const row = document.createElement("div");
    row.className = "card";
    row.style.margin = "10px 0";
    row.style.padding = "10px";

    row.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${m.color || "#ddd"}"></span>
            ${m.name || "(이름없음)"}
            ${m.pin ? `<span class="chip">PIN</span>` : ``}
            ${m.active === false ? `<span class="chip">비활성</span>` : `<span class="chip">활성</span>`}
          </div>
          <div class="small">순서: ${m.order ?? "-"}</div>
        </div>
        <button class="btn" type="button">수정</button>
      </div>
    `;

    row.querySelector("button").onclick = () => openModal(m);
    list.appendChild(row);
  });
}

onValue(ref(db, "config/members"), (snap) => {
  const obj = snap.val() || {};
  members = Object.entries(obj)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  renderMembers();
});

saveBtn?.addEventListener("click", async () => {
  const name = (mName.value || "").trim();
  if (!name) {
    alert("이름은 필수입니다.");
    return;
  }

  // ✅ PIN 추가
  const pin = (mPin?.value || "").trim();

  // ✅ 정책: 빈 값 허용 / 입력했다면 4자 이상 (원하면 숫자만으로 바꿀 수 있음)
  if (pin && pin.length < 4) {
    alert("비밀번호(PIN)는 4자 이상으로 입력해 주세요.");
    return;
  }

  const payload = {
    name,
    order: Number(mOrder.value || 999),
    color: (mColor.value || "").trim() || "#1f6feb",
    active: mActive.value === "true",
    pin, // ✅ 저장
  };

  try {
    if (editingId) {
      await update(ref(db, `config/members/${editingId}`), payload);
    } else {
      const newRef = push(ref(db, `config/members`));
      await set(newRef, payload);
    }
    closeModal();
  } catch (err) {
    console.error(err);
    alert("저장 실패: " + (err?.message || err));
  }
});

delBtn?.addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm("이 멤버를 삭제하시겠습니까?")) return;

  try {
    await remove(ref(db, `config/members/${editingId}`));
    closeModal();
  } catch (err) {
    console.error(err);
    alert("삭제 실패: " + (err?.message || err));
  }
});



/* =========================
   ✅ 분류(Types) 관리 추가
========================= */
const typeList = $("typeList");

const typeModalBack = $("typeModalBack");
const typeModalTitle = $("typeModalTitle");
const tName = $("tName");
const tOrder = $("tOrder");
const tActive = $("tActive");
const typeSaveBtn = $("typeSaveBtn");
const typeDelBtn = $("typeDelBtn");
const typeCloseBtn = $("typeCloseBtn");

let editingTypeId = null;
let types = [];

function openTypeModal(type = null) {
  typeModalBack.classList.add("show");
  if (type) {
    typeModalTitle.textContent = "분류 수정";
    editingTypeId = type.id;
    tName.value = type.name || "";
    tOrder.value = type.order ?? "";
    tActive.value = (type.active === false) ? "false" : "true";
    typeDelBtn.style.display = "inline-block";
  } else {
    typeModalTitle.textContent = "분류 추가";
    editingTypeId = null;
    tName.value = "";
    tOrder.value = "";
    tActive.value = "true";
    typeDelBtn.style.display = "none";
  }
}
function closeTypeModal() {
  typeModalBack.classList.remove("show");
  editingTypeId = null;
}

typeModalBack?.addEventListener("click", (e) => { if (e.target === typeModalBack) closeTypeModal(); });
typeCloseBtn?.addEventListener("click", closeTypeModal);
$("addTypeBtn")?.addEventListener("click", () => openTypeModal(null));

function renderTypes() {
  if (!typeList) return;
  typeList.innerHTML = "";

  if (!types.length) {
    typeList.innerHTML = `<div class="small">등록된 분류가 없습니다. “추가”를 눌러 등록하세요.</div>`;
    return;
  }

  types.forEach(t => {
    const row = document.createElement("div");
    row.className = "card";
    row.style.margin = "10px 0";
    row.style.padding = "10px";

    row.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900; display:flex; align-items:center; gap:8px">
            ${t.name || "(이름없음)"}
            ${t.active === false ? `<span class="chip">미사용</span>` : `<span class="chip">사용</span>`}
          </div>
          <div class="small">순서: ${t.order ?? "-"}</div>
        </div>
        <button class="btn">수정</button>
      </div>
    `;
    row.querySelector("button").onclick = () => openTypeModal(t);
    typeList.appendChild(row);
  });
}

onValue(ref(db, "config/types"), (snap) => {
  const obj = snap.val() || {};
  types = Object.entries(obj).map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  renderTypes();
});

typeSaveBtn?.addEventListener("click", async () => {
  const name = (tName.value || "").trim();
  if (!name) { alert("분류명은 필수입니다."); return; }

  const payload = {
    name,
    order: Number(tOrder.value || 999),
    active: (tActive.value === "true")
  };

  try {
    if (editingTypeId) {
      await update(ref(db, `config/types/${editingTypeId}`), payload);
    } else {
      const newRef = push(ref(db, `config/types`));
      await set(newRef, payload);
    }
    closeTypeModal();
  } catch (err) {
    console.error(err);
    alert("저장 실패: " + (err?.message || err));
  }
});

typeDelBtn?.addEventListener("click", async () => {
  if (!editingTypeId) return;
  if (!confirm("이 분류를 삭제하시겠습니까?")) return;

  try {
    await remove(ref(db, `config/types/${editingTypeId}`));
    closeTypeModal();
  } catch (err) {
    console.error(err);
    alert("삭제 실패: " + (err?.message || err));
  }
});


/* =========================
   ✅ 휴무일(Holidays) 관리 추가
========================= */
const holidayList = $("holidayList");

const holidayModalBack = $("holidayModalBack");
const holidayModalTitle = $("holidayModalTitle");
const hDate = $("hDate");
const hName = $("hName");
const hNote = $("hNote");
const holidaySaveBtn = $("holidaySaveBtn");
const holidayDelBtn = $("holidayDelBtn");
const holidayCloseBtn = $("holidayCloseBtn");

let editingHolidayKey = null;
let holidays = {}; // { "YYYY-MM-DD": {name, note} }

function openHolidayModal(dateKey = null, data = null) {
  holidayModalBack.classList.add("show");
  if (dateKey && data) {
    holidayModalTitle.textContent = "휴무일 수정";
    editingHolidayKey = dateKey;
    hDate.value = dateKey;
    hName.value = data.name || "";
    hNote.value = data.note || "";
    holidayDelBtn.style.display = "inline-block";
    hDate.disabled = true; // ✅ 키(날짜) 변경 방지
  } else {
    holidayModalTitle.textContent = "휴무일 추가";
    editingHolidayKey = null;
    hDate.value = "";
    hName.value = "";
    hNote.value = "";
    holidayDelBtn.style.display = "none";
    hDate.disabled = false;
  }
}
function closeHolidayModal() {
  holidayModalBack.classList.remove("show");
  editingHolidayKey = null;
}

holidayModalBack?.addEventListener("click", (e) => { if (e.target === holidayModalBack) closeHolidayModal(); });
holidayCloseBtn?.addEventListener("click", closeHolidayModal);
$("addHolidayBtn")?.addEventListener("click", () => openHolidayModal(null, null));

function renderHolidays() {
  if (!holidayList) return;
  holidayList.innerHTML = "";

  const entries = Object.entries(holidays || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    holidayList.innerHTML = `<div class="small">등록된 휴무일이 없습니다. “추가”를 눌러 등록하세요.</div>`;
    return;
  }

  entries.forEach(([dateKey, h]) => {
    const row = document.createElement("div");
    row.className = "card";
    row.style.margin = "10px 0";
    row.style.padding = "10px";

    row.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div>
          <div style="font-weight:900">${dateKey} · ${h?.name || "(이름없음)"}</div>
          ${h?.note ? `<div class="small">메모: ${h.note}</div>` : `<div class="small">메모: -</div>`}
        </div>
        <button class="btn">수정</button>
      </div>
    `;
    row.querySelector("button").onclick = () => openHolidayModal(dateKey, h);
    holidayList.appendChild(row);
  });
}

onValue(ref(db, "config/holidays"), (snap) => {
  holidays = snap.val() || {};
  renderHolidays();
});

holidaySaveBtn?.addEventListener("click", async () => {
  const dateKey = (hDate.value || "").trim();
  const name = (hName.value || "").trim();
  const note = (hNote.value || "").trim();

  if (!dateKey) { alert("날짜는 필수입니다."); return; }
  if (!name) { alert("휴무일 이름은 필수입니다."); return; }

  const payload = { name, note };

  try {
    // ✅ 날짜를 key로 저장: config/holidays/YYYY-MM-DD
    await set(ref(db, `config/holidays/${dateKey}`), payload);
    closeHolidayModal();
  } catch (err) {
    console.error(err);
    alert("저장 실패: " + (err?.message || err));
  }
});

holidayDelBtn?.addEventListener("click", async () => {
  const key = editingHolidayKey;
  if (!key) return;
  if (!confirm("이 휴무일을 삭제하시겠습니까?")) return;

  try {
    await remove(ref(db, `config/holidays/${key}`));
    closeHolidayModal();
  } catch (err) {
    console.error(err);
    alert("삭제 실패: " + (err?.message || err));
  }
});
