import { db, ref, onValue, set, remove } from "./firebase.js";

const ADMIN_PASSWORD = "koen1234";
const LOGIN_KEY = "koen_food_admin_login";

let restaurants = [];
let currentId = null;

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

function resetForm() {
  currentId = null;
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
  saveMsg.textContent = "새 식당 입력 상태입니다.";
}

function fillForm(item) {
  currentId = Number(item.id);
  fId.value = item.id ?? "";
  fName.value = item.name ?? "";
  fCategory.value = item.category ?? "";
  fSubCategory.value = item.subCategory ?? "";
  fTags.value = Array.isArray(item.tags) ? item.tags.join(", ") : "";
  fBaseRating.value =
    typeof item.baseRating === "number" ? item.baseRating : "";
  fMenuType.value = item.menuType ?? "";
  fMainMenus.value = Array.isArray(item.mainMenus)
    ? item.mainMenus.join(", ")
    : "";
  fAddress.value = item.address ?? "";
  fAddressShort.value = item.addressShort ?? "";
  fMapQuery.value = item.mapQuery ?? "";
  fDescription.value = item.description ?? "";
  saveMsg.textContent = `선택된 식당: ${item.name}`;
}

function renderList() {
  const keyword = String(adminSearch.value || "").trim().toLowerCase();

  const filtered = restaurants.filter((r) => {
    const text = `${r.name || ""} ${r.category || ""} ${r.subCategory || ""}`.toLowerCase();
    return !keyword || text.includes(keyword);
  });

  restaurantList.innerHTML = filtered
    .map((r) => {
      const active = Number(r.id) === Number(currentId) ? "active" : "";
      return `
        <button type="button" class="admin-list-item ${active}" data-id="${r.id}">
          <div class="admin-list-name">${r.name || ""}</div>
          <div class="admin-list-meta">${r.category || ""} / ${r.subCategory || ""}</div>
        </button>
      `;
    })
    .join("");

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
  const name = fName.value.trim();

  return {
    id,
    name,
    category: fCategory.value.trim(),
    subCategory: fSubCategory.value.trim(),
    tags: parseCommaText(fTags.value),
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
    saveMsg.textContent = "대분류를 입력해주세요.";
    return;
  }

  if (!item.subCategory) {
    saveMsg.textContent = "중분류를 입력해주세요.";
    return;
  }

  try {
    const oldItem = restaurants.find((r) => Number(r.id) === Number(item.id));

    // 기존 사용자 데이터 유지
    if (oldItem) {
      item.userRatingAvg = oldItem.userRatingAvg ?? 0;
      item.userRatingCount = oldItem.userRatingCount ?? 0;
      item.photoUrls = Array.isArray(oldItem.photoUrls) ? oldItem.photoUrls : [];
      item.reviews = Array.isArray(oldItem.reviews) ? oldItem.reviews : [];
    }

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
}

function initData() {
  onValue(ref(db, "restaurants"), (snapshot) => {
    const data = snapshot.val();
    restaurants = data ? Object.values(data) : [];
    restaurants.sort((a, b) => Number(a.id) - Number(b.id));

    renderList();

    const selected = restaurants.find((r) => Number(r.id) === Number(currentId));
    if (selected) {
      fillForm(selected);
    } else if (!currentId) {
      resetForm();
    }
  });
}

function init() {
  bindEvents();

  if (checkLoginState()) {
    showAdmin();
  } else {
    showLogin();
  }

  initData();
}

init();