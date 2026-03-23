import { db, ref, onValue, set, remove, update, get } from "./firebase.js";

const ADMIN_PASSWORD = "koen1234";
const LOGIN_KEY = "koen_food_admin_login";
const editRequestList = document.getElementById("editRequestList");

let restaurants = [];
let currentId = null;
let selectedTags = [];
let selectedSubCategories = [];

// 기본 선택값
let categoryOptions = [
  "고기/구이",
  "한식/식사",
  "해산물/회",
  "면/국수",
  "양식",
  "일식",
  "중식/아시아",
  "술집/다찌"
];

let subCategoryMap = {
  "고기/구이": ["소고기", "돼지고기", "닭", "오리", "닭/오리", "양/특수육"],
  "한식/식사": ["한정식", "백반/정식", "찌개/탕", "해장", "두부/순두부", "보리밥/청국장"],
  "해산물/회": ["횟집", "물회", "복어", "장어", "생선구이", "어탕/추어탕", "해산물요리"],
  "면/국수": ["냉면", "국수/칼국수"],
  "양식": ["스테이크", "파스타", "피자", "브런치", "돈가스", "파스타/피자", "파스타/스테이크"],
  "일식": ["초밥", "라멘", "덮밥", "돈카츠", "참치/사시미", "코스요리", "이자카야", "해산물코스"],
  "중식/아시아": ["중식", "짬뽕", "중식코스", "중식요리", "베트남"],
  "술집/다찌": ["동동주", "다찌"]
};

let tagOptions = [
  "점심", "저녁", "회식", "가족식사", "데이트", "혼밥", "해장",
  "술한잔", "가성비", "고급", "유명맛집", "진주대표",
  "부모님추천", "룸있음", "단체가능", "주차편함"
];

const ratingOptions = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const loginSection = document.getElementById("loginSection");
const adminSection = document.getElementById("adminSection");
const adminPassword = document.getElementById("adminPassword");
const loginBtn = document.getElementById("loginBtn");
const loginMsg = document.getElementById("loginMsg");

const logoutBtn = document.getElementById("logoutBtn");
const newBtn = document.getElementById("newBtn");
const adminSearch = document.getElementById("adminSearch");
const restaurantList = document.getElementById("restaurantList");
const saveBtn = document.getElementById("saveBtn");
const deleteBtn = document.getElementById("deleteBtn");
const saveMsg = document.getElementById("saveMsg");

const fId = document.getElementById("fId");
const fName = document.getElementById("fName");
const fCategory = document.getElementById("fCategory");
const fSubCategory = document.getElementById("fSubCategory");
const fTags = document.getElementById("fTags");
const fBaseRating = document.getElementById("fBaseRating");
const fMenuType = document.getElementById("fMenuType");
const fMainMenus = document.getElementById("fMainMenus");
const fAddress = document.getElementById("fAddress");
const fAddressShort = document.getElementById("fAddressShort");
const fMapQuery = document.getElementById("fMapQuery");
const fDescription = document.getElementById("fDescription");

const categorySelectRow = document.getElementById("categorySelectRow");
const subCategorySelectRow = document.getElementById("subCategorySelectRow");
const tagSelectRow = document.getElementById("tagSelectRow");
const ratingSelectRow = document.getElementById("ratingSelectRow");
const selectedTagsPreview = document.getElementById("selectedTagsPreview");

const fCategoryCustom = document.getElementById("fCategoryCustom");
const fSubCategoryCustom = document.getElementById("fSubCategoryCustom");
const fTagCustom = document.getElementById("fTagCustom");

const addCategoryBtn = document.getElementById("addCategoryBtn");
const addSubCategoryBtn = document.getElementById("addSubCategoryBtn");
const addTagBtn = document.getElementById("addTagBtn");

function showLogin() {
  loginSection.classList.remove("hidden");
  adminSection.classList.add("hidden");
}

function showAdmin() {
  loginSection.classList.add("hidden");
  adminSection.classList.remove("hidden");
}

function setLoginState(isLoggedIn) {
  localStorage.setItem(LOGIN_KEY, isLoggedIn ? "true" : "false");
}

function checkLoginState() {
  return localStorage.getItem(LOGIN_KEY) === "true";
}

function parseCommaText(text) {
  return String(text || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function nextId() {
  if (!restaurants.length) return 1;
  return Math.max(...restaurants.map((r) => Number(r.id) || 0)) + 1;
}

function ensureOption(list, value) {
  const v = String(value || "").trim();
  if (!v) return;
  if (!list.includes(v)) list.push(v);
}

function ensureSubCategory(category, subCategory) {
  const c = String(category || "").trim();
  if (!c) return;

  if (!subCategoryMap[c]) subCategoryMap[c] = [];

  const items = Array.isArray(subCategory)
    ? subCategory
    : parseCommaText(subCategory);

  items.forEach((s) => {
    const value = String(s || "").trim();
    if (!value) return;
    if (!subCategoryMap[c].includes(value)) subCategoryMap[c].push(value);
  });
}

function renderChoiceButtons(target, items, selectedValue, onClick, multi = false, selectedArray = []) {
  target.innerHTML = items.map((item) => {
    const active = multi
      ? selectedArray.includes(item)
      : item === selectedValue;
    return `<button type="button" class="choice-btn ${active ? "active" : ""}" data-value="${item}">${item}</button>`;
  }).join("");

  target.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.addEventListener("click", () => onClick(btn.dataset.value));
  });
}

function renderCategoryOptions() {
  renderChoiceButtons(categorySelectRow, categoryOptions, fCategory.value, (value) => {
    fCategory.value = value;
    if (!subCategoryMap[value]) subCategoryMap[value] = [];

    selectedSubCategories = [];
    fSubCategory.value = "";

    renderCategoryOptions();
    renderSubCategoryOptions();
  });
}

function renderSubCategoryOptions() {
  const category = fCategory.value;
  const items = category ? (subCategoryMap[category] || []) : [];

  renderChoiceButtons(
    subCategorySelectRow,
    items,
    "",
    (value) => {
      if (selectedSubCategories.includes(value)) {
        selectedSubCategories = selectedSubCategories.filter((v) => v !== value);
      } else {
        selectedSubCategories.push(value);
      }

      fSubCategory.value = selectedSubCategories.join(", ");
      renderSubCategoryOptions();
    },
    true,
    selectedSubCategories
  );
}

function renderTagOptions() {
  renderChoiceButtons(
    tagSelectRow,
    tagOptions,
    "",
    (value) => {
      if (selectedTags.includes(value)) {
        selectedTags = selectedTags.filter((t) => t !== value);
      } else {
        selectedTags.push(value);
      }
      fTags.value = selectedTags.join(", ");
      renderTagOptions();
      renderSelectedTagsPreview();
    },
    true,
    selectedTags
  );
}

function renderSelectedTagsPreview() {
  selectedTagsPreview.innerHTML = selectedTags.length
    ? selectedTags.map((tag) => `<span class="selected-chip">#${tag}</span>`).join("")
    : `<span class="selected-empty">선택된 태그 없음</span>`;
}

function renderRatingOptions() {
  renderChoiceButtons(ratingSelectRow, ratingOptions.map(String), String(fBaseRating.value || ""), (value) => {
    fBaseRating.value = value;
    renderRatingOptions();
  });
}

function resetForm() {
  currentId = null;
  selectedTags = [];
  selectedSubCategories = [];

  fId.value = nextId();
  fName.value = "";
  fCategory.value = "";
  fSubCategory.value = "";
  fTags.value = "";
  fBaseRating.value = "";
  fMenuType.value = "";
  fMainMenus.value = "";
  fAddress.value = "";
  fAddressShort.value = "";
  fMapQuery.value = "";
  fDescription.value = "";
  fCategoryCustom.value = "";
  fSubCategoryCustom.value = "";
  fTagCustom.value = "";

  renderCategoryOptions();
  renderSubCategoryOptions();
  renderTagOptions();
  renderSelectedTagsPreview();
  renderRatingOptions();

  saveMsg.textContent = "새 식당 입력 상태입니다.";
}

function fillForm(item) {
  currentId = Number(item.id);
  fId.value = item.id ?? "";
  fName.value = item.name ?? "";
  fCategory.value = item.category ?? "";
  fSubCategory.value = item.subCategory ?? "";
  selectedSubCategories = parseCommaText(item.subCategory);

  selectedTags = Array.isArray(item.tags)
    ? [...item.tags]
    : parseCommaText(item.tags);

  fTags.value = selectedTags.join(", ");
  fBaseRating.value = item.baseRating !== undefined && item.baseRating !== null
  ? String(item.baseRating)
  : "";
  fMenuType.value = item.menuType ?? "";
  fMainMenus.value = Array.isArray(item.mainMenus) ? item.mainMenus.join(", ") : "";
  fAddress.value = item.address ?? "";
  fAddressShort.value = item.addressShort ?? "";
  fMapQuery.value = item.mapQuery ?? "";
  fDescription.value = item.description ?? "";

  ensureOption(categoryOptions, fCategory.value);
  ensureSubCategory(fCategory.value, selectedSubCategories);
  selectedTags.forEach((tag) => ensureOption(tagOptions, tag));

  renderCategoryOptions();
  renderSubCategoryOptions();
  renderTagOptions();
  renderSelectedTagsPreview();
  renderRatingOptions();

  saveMsg.textContent = `선택된 식당: ${item.name}`;
}

function renderList() {
  const keyword = String(adminSearch.value || "").trim().toLowerCase();

  const filtered = restaurants.filter((r) => {
    const text = `${r.name || ""} ${r.category || ""} ${r.subCategory || ""}`.toLowerCase();
    return !keyword || text.includes(keyword);
  });

  restaurantList.innerHTML = filtered.map((r) => {
    const active = Number(r.id) === Number(currentId) ? "active" : "";
    return `
      <button type="button" class="admin-list-item ${active}" data-id="${r.id}">
        <div class="admin-list-name">${r.name || ""}</div>
        <div class="admin-list-meta">${r.category || ""} / ${r.subCategory || ""}</div>
      </button>
    `;
  }).join("");

  restaurantList.querySelectorAll(".admin-list-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const item = restaurants.find((r) => Number(r.id) === id);
      if (!item) return;
      fillForm(item);
      renderList();
    });
  });
}

function getFormData() {
  const id = Number(fId.value) || nextId();
  return {
    id,
    name: fName.value.trim(),
    category: fCategory.value.trim(),
    subCategory: selectedSubCategories.join(", "),
    tags: [...selectedTags],
    baseRating: Number(fBaseRating.value) || 0,
    userRatingAvg: 0,
    userRatingCount: 0,
    mainMenus: parseCommaText(fMainMenus.value),
    menuType: fMenuType.value.trim(),
    address: fAddress.value.trim(),
    addressShort: fAddressShort.value.trim(),
    mapQuery: fMapQuery.value.trim(),
    description: fDescription.value.trim(),
    photoUrls: [],
    reviews: []
  };
}

async function saveRestaurant() {
  const item = getFormData();

  if (!item.name) {
    saveMsg.textContent = "식당명을 입력해주세요.";
    return;
  }
  if (!item.category) {
    saveMsg.textContent = "대분류를 선택하거나 입력해주세요.";
    return;
  }
  if (!item.subCategory) {
    saveMsg.textContent = "중분류를 선택하거나 입력해주세요.";
    return;
  }

  try {
    const oldItem = restaurants.find((r) => Number(r.id) === Number(item.id));
    if (oldItem) {
      item.userRatingAvg = oldItem.userRatingAvg ?? 0;
      item.userRatingCount = oldItem.userRatingCount ?? 0;
      item.photoUrls = Array.isArray(oldItem.photoUrls) ? oldItem.photoUrls : [];
      item.reviews = Array.isArray(oldItem.reviews) ? oldItem.reviews : [];
    }

    ensureOption(categoryOptions, item.category);
    ensureSubCategory(item.category, selectedSubCategories);
    item.tags.forEach((tag) => ensureOption(tagOptions, tag));

    await set(ref(db, `restaurants/${item.id}`), item);
    currentId = item.id;
    saveMsg.textContent = `저장 완료: ${item.name}`;
  } catch (error) {
    console.error(error);
    saveMsg.textContent = "저장 중 오류가 발생했습니다.";
  }
}

async function deleteRestaurant() {
  const id = Number(fId.value);
  if (!id) {
    saveMsg.textContent = "삭제할 식당이 선택되지 않았습니다.";
    return;
  }

  const target = restaurants.find((r) => Number(r.id) === id);
  if (!target) {
    saveMsg.textContent = "삭제 대상이 없습니다.";
    return;
  }

  const ok = confirm(`'${target.name}' 식당을 삭제하시겠습니까?`);
  if (!ok) return;

  try {
    await remove(ref(db, `restaurants/${id}`));
    saveMsg.textContent = `삭제 완료: ${target.name}`;
    resetForm();
  } catch (error) {
    console.error(error);
    saveMsg.textContent = "삭제 중 오류가 발생했습니다.";
  }
}

function bindEvents() {
  loginBtn.addEventListener("click", () => {
    const pw = adminPassword.value;
    if (pw === ADMIN_PASSWORD) {
      setLoginState(true);
      showAdmin();
      adminPassword.value = "";
      loginMsg.textContent = "";
    } else {
      loginMsg.textContent = "비밀번호가 올바르지 않습니다.";
    }
  });

  adminPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });

  logoutBtn.addEventListener("click", () => {
    setLoginState(false);
    showLogin();
  });

  newBtn.addEventListener("click", () => {
    resetForm();
    renderList();
  });

  adminSearch.addEventListener("input", renderList);
  saveBtn.addEventListener("click", saveRestaurant);
  deleteBtn.addEventListener("click", deleteRestaurant);

  addCategoryBtn.addEventListener("click", () => {
    const value = fCategoryCustom.value.trim();
    if (!value) return;

    ensureOption(categoryOptions, value);
    if (!subCategoryMap[value]) subCategoryMap[value] = [];

    fCategory.value = value;
    selectedSubCategories = [];
    fSubCategory.value = "";
    fCategoryCustom.value = "";

    renderCategoryOptions();
    renderSubCategoryOptions();
  });

  addSubCategoryBtn.addEventListener("click", () => {
    const value = fSubCategoryCustom.value.trim();
    const category = fCategory.value.trim();

    if (!category) {
      saveMsg.textContent = "먼저 대분류를 선택해주세요.";
      return;
    }
    if (!value) return;

    ensureSubCategory(category, value);

    if (!selectedSubCategories.includes(value)) {
      selectedSubCategories.push(value);
    }

    fSubCategory.value = selectedSubCategories.join(", ");
    fSubCategoryCustom.value = "";
    renderSubCategoryOptions();
  });

  addTagBtn.addEventListener("click", () => {
    const value = fTagCustom.value.trim();
    if (!value) return;
    ensureOption(tagOptions, value);
    if (!selectedTags.includes(value)) selectedTags.push(value);
    fTagCustom.value = "";
    fTags.value = selectedTags.join(", ");
    renderTagOptions();
    renderSelectedTagsPreview();
  });
}

function initData() {
  onValue(ref(db, "restaurants"), (snapshot) => {
    const data = snapshot.val();
    restaurants = data ? Object.values(data) : [];
    restaurants.sort((a, b) => Number(a.id) - Number(b.id));

    // 기존 음식점 전체 기준으로 카테고리 / 중분류 / 태그 옵션 동기화
    restaurants.forEach((r) => {
      ensureOption(categoryOptions, r.category);
      ensureSubCategory(r.category, r.subCategory);

      if (Array.isArray(r.tags)) {
        r.tags.forEach((tag) => ensureOption(tagOptions, tag));
      } else {
        parseCommaText(r.tags).forEach((tag) => ensureOption(tagOptions, tag));
      }
    });

    renderList();

    const selected = restaurants.find((r) => Number(r.id) === Number(currentId));
    if (selected) {
      fillForm(selected);
    } else if (!currentId) {
      resetForm();
    } else {
      renderCategoryOptions();
      renderSubCategoryOptions();
      renderTagOptions();
      renderSelectedTagsPreview();
      renderRatingOptions();
    }
  });
}

function formatDateTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function renderEditRequests(data) {
  if (!editRequestList) return;

  const entries = Object.entries(data || {}).sort((a, b) => {
    const aTime = a[1]?.createdAt || 0;
    const bTime = b[1]?.createdAt || 0;
    return bTime - aTime;
  });

  if (!entries.length) {
    editRequestList.innerHTML = `<div class="empty">등록된 수정 요청이 없습니다.</div>`;
    return;
  }

  editRequestList.innerHTML = entries.map(([id, item]) => `
    <div class="request-item">
      <div class="request-head">
        <div>
          <strong>${escapeHtml(item.restaurantName || "-")}</strong>
          <span class="request-type">${escapeHtml(item.type || "기타")}</span>
        </div>
        <div class="request-meta">${formatDateTime(item.createdAt)}</div>
      </div>

      <div class="request-meta">
        작성자: ${escapeHtml(item.writer || "익명")} / 상태: ${escapeHtml(item.status || "대기")}
      </div>

      <div class="request-content">${escapeHtml(item.content || "")}</div>

      ${
        item.adminReply
          ? `<div class="request-answer"><strong>관리자 답변</strong><br>${escapeHtml(item.adminReply)}</div>`
          : ""
      }

      <div class="request-actions">
        <button type="button" class="answer-btn" data-id="${id}">답변</button>
        <button type="button" class="edit-btn" data-id="${id}">수정</button>
        <button type="button" class="delete-btn" data-id="${id}">삭제</button>
      </div>
    </div>
  `).join("");
}

onValue(ref(db, "editRequests"), (snapshot) => {
  renderEditRequests(snapshot.val() || {});
});

editRequestList?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const id = btn.dataset.id;
  if (!id) return;

  if (btn.classList.contains("answer-btn")) {
  try {
    const pathRef = ref(db, `editRequests/${id}`);
    const snap = await get(pathRef);
    const item = snap.val() || {};

    const reply = prompt("관리자 답변을 입력하세요.", item.adminReply || "");
    if (reply === null) return;

    await update(pathRef, {
      adminReply: reply.trim(),
      status: reply.trim() ? "답변완료" : "대기"
    });

    alert("답변이 저장되었습니다.");
  } catch (err) {
    console.error(err);
    alert("답변 저장 중 오류가 발생했습니다.");
  }
}

  if (btn.classList.contains("edit-btn")) {
  try {
    const pathRef = ref(db, `editRequests/${id}`);
    const snap = await get(pathRef);
    const item = snap.val() || {};

    const newContent = prompt("수정 요청 내용을 수정하세요.", item.content || "");
    if (newContent === null) return;

    const trimmed = newContent.trim();
if (!trimmed) {
  alert("수정 요청 내용은 비워둘 수 없습니다.");
  return;
}

await update(pathRef, {
  content: trimmed
});

    alert("수정되었습니다.");
  } catch (err) {
    console.error(err);
    alert("수정 중 오류가 발생했습니다.");
  }
}

  if (btn.classList.contains("delete-btn")) {
    const ok = confirm("이 요청을 삭제하시겠습니까?");
    if (!ok) return;

    try {
      await remove(ref(db, `editRequests/${id}`));
      alert("삭제되었습니다.");
    } catch (err) {
      console.error(err);
      alert("삭제 중 오류가 발생했습니다.");
    }
  }
});

function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function init() {
  bindEvents();

  if (checkLoginState()) {
    showAdmin();
  } else {
    showLogin();
  }

  renderCategoryOptions();
  renderSubCategoryOptions();
  renderTagOptions();
  renderSelectedTagsPreview();
  renderRatingOptions();

  initData();
}

init();