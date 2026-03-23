import { db, ref, onValue, set, remove, get, update, push } from "./firebase.js";
let restaurants = [];
let ratingsByRestaurant = {};
let reviewsByRestaurant = {};
let selectedCategory = "전체";
let selectedTags = [];
let currentModalRestaurantId = null;
let onlyMyRated = false;
let onlyFavorites = false;
let sortMode = "default"; // default | rating | popular

const categoryRow = document.getElementById("categoryRow");
const tagRow = document.getElementById("tagRow");
const cardGrid = document.getElementById("cardGrid");
const searchInput = document.getElementById("searchInput");
const myRatedBtn = document.getElementById("myRatedBtn");
const favoriteFilterBtn = document.getElementById("favoriteFilterBtn");
const sortDefaultBtn = document.getElementById("sortDefaultBtn");
const sortRatingBtn = document.getElementById("sortRatingBtn");
const sortPopularBtn = document.getElementById("sortPopularBtn");

const modal = document.getElementById("modal");
const closeModalBtn = document.getElementById("closeModal");
const modalName = document.getElementById("modalName");
const modalRating = document.getElementById("modalRating");
const modalCategory = document.getElementById("modalCategory");
const modalAddress = document.getElementById("modalAddress");
const modalMenus = document.getElementById("modalMenus");
const modalTags = document.getElementById("modalTags");
const modalDesc = document.getElementById("modalDesc");
const modalMapBtn = document.getElementById("modalMapBtn");

const editRestaurantBtn = document.getElementById("editRestaurantBtn");
const viewMode = document.getElementById("viewMode");
const editMode = document.getElementById("editMode");
const editName = document.getElementById("editName");
const editCategory = document.getElementById("editCategory");
const editAddress = document.getElementById("editAddress");
const editMenus = document.getElementById("editMenus");
const editTags = document.getElementById("editTags");
const editTagPicker = document.getElementById("editTagPicker");
const editDesc = document.getElementById("editDesc");
const saveRestaurantBtn = document.getElementById("saveRestaurantBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const editTagCustom = document.getElementById("editTagCustom");
const addEditTagBtn = document.getElementById("addEditTagBtn");

const openRequestBtn = document.getElementById("openRequestBtn");
const requestModal = document.getElementById("requestModal");
const closeRequestModalBtn = document.getElementById("closeRequestModalBtn");
const submitRequestBtn = document.getElementById("submitRequestBtn");

const requestRestaurant = document.getElementById("requestRestaurant");
const requestType = document.getElementById("requestType");
const requestWriter = document.getElementById("requestWriter");
const requestContent = document.getElementById("requestContent");

const openMyRequestBtn = document.getElementById("openMyRequestBtn");
const myRequestModal = document.getElementById("myRequestModal");
const closeMyRequestModalBtn = document.getElementById("closeMyRequestModalBtn");
const myRequestList = document.getElementById("myRequestList");

const BASE_TAGS = [
  "전체",
  "점심",
  "저녁",
  "회식",
  "혼밥",
  "해장",
  "술모임",
  "가성비",
  "빨리나옴",
  "단체가능",
  "룸있음",
  "주차가능"
];

const RATING_STORAGE_KEY = "koen_food_user_key";
const FAVORITES_STORAGE_KEY = "koen_food_favorites";
const REVIEW_MAX_LENGTH = 50;
const ADMIN_PASSWORD_PATH = "config/adminPassword";

function getUserKey() {
  let key = localStorage.getItem(RATING_STORAGE_KEY);
  if (!key) {
    key = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(RATING_STORAGE_KEY, key);
  }
  return key;
}

const userKey = getUserKey();
let editRequestsById = {};

/* =========================
   찜(localStorage)
========================= */
function getFavoriteIds() {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map((v) => Number(v)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveFavoriteIds(ids) {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
}

function isFavorite(restaurantId) {
  return getFavoriteIds().includes(Number(restaurantId));
}

function toggleFavorite(restaurantId) {
  const id = Number(restaurantId);
  const ids = getFavoriteIds();
  const exists = ids.includes(id);
  const next = exists ? ids.filter((v) => v !== id) : [...ids, id];

  saveFavoriteIds(next);

  renderFavoriteFilterButton();
  renderCards();

  if (currentModalRestaurantId && Number(currentModalRestaurantId) === id) {
    renderModalFavoriteButton(id);
  }
}

/* =========================
   후기
========================= */
function getRestaurantReviewsObject(restaurantId) {
  return reviewsByRestaurant[String(restaurantId)] || {};
}

function normalizeReviewItem(value, key) {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    return {
      userKey: key,
      text,
      updatedAt: 0
    };
  }

  const text = String(value.text || "").trim();
  if (!text) return null;

  return {
    userKey: key,
    text,
    updatedAt: Number(value.updatedAt || value.createdAt || 0)
  };
}

function getRestaurantReviewsList(restaurantId) {
  const obj = getRestaurantReviewsObject(restaurantId);

  return Object.entries(obj)
    .map(([key, value]) => normalizeReviewItem(value, key))
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function getMyReview(restaurantId) {
  const obj = getRestaurantReviewsObject(restaurantId);
  return normalizeReviewItem(obj[userKey], userKey);
}

function getLatestReview(restaurantId) {
  const list = getRestaurantReviewsList(restaurantId);
  return list.length ? list[0] : null;
}

async function saveMyReview(restaurantId, text) {
  const id = String(restaurantId);
  const clean = String(text || "").trim().slice(0, REVIEW_MAX_LENGTH);

  if (!id) return;

  if (!clean) {
    alert("후기를 입력해주세요.");
    return;
  }

  try {
    await set(ref(db, `restaurantReviews/${id}/${userKey}`), {
      text: clean,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error(error);
    alert("후기 저장 중 오류가 발생했습니다.");
  }
}

async function deleteMyReview(restaurantId) {
  const id = String(restaurantId);
  if (!id) return;

  try {
    await remove(ref(db, `restaurantReviews/${id}/${userKey}`));
  } catch (error) {
    console.error(error);
    alert("후기 삭제 중 오류가 발생했습니다.");
  }
}

/* =========================
   모달 UI 동적 생성
========================= */
let modalUserRatingSection = null;
let modalUserRatingStars = null;
let modalUserRatingText = null;
let modalUserRatingDeleteBtn = null;
let modalFavoriteBtn = null;

let modalReviewSection = null;
let modalReviewInput = null;
let modalReviewCount = null;
let modalReviewSaveBtn = null;
let modalReviewDeleteBtn = null;
let modalReviewList = null;

function getModalInsertBase() {
  return viewMode || modalMapBtn?.parentNode || modal.querySelector(".modal-content");
}

function getModalInsertTarget() {
  return modalMapBtn?.parentNode || getModalInsertBase();
}

function ensureModalRatingUi() {
  if (document.getElementById("modalUserRatingSection")) {
    modalUserRatingSection = document.getElementById("modalUserRatingSection");
    modalUserRatingStars = document.getElementById("modalUserRatingStars");
    modalUserRatingText = document.getElementById("modalUserRatingText");
    modalUserRatingDeleteBtn = document.getElementById("modalUserRatingDeleteBtn");
  } else {
    const section = document.createElement("div");
    section.id = "modalUserRatingSection";
    section.className = "modal-user-rating-section";

    section.innerHTML = `
      <h4>내 별점(실제 이용자만 등록 가능)</h4>
      <div id="modalUserRatingStars" class="rating-stars"></div>
      <div id="modalUserRatingText" class="rating-help-text">아직 선택한 별점이 없습니다.</div>
      <button type="button" id="modalUserRatingDeleteBtn" class="rating-delete-btn">내 별점 삭제</button>
    `;

    getModalInsertTarget().insertBefore(section, modalMapBtn);

    modalUserRatingSection = document.getElementById("modalUserRatingSection");
    modalUserRatingStars = document.getElementById("modalUserRatingStars");
    modalUserRatingText = document.getElementById("modalUserRatingText");
    modalUserRatingDeleteBtn = document.getElementById("modalUserRatingDeleteBtn");

    modalUserRatingDeleteBtn.addEventListener("click", async () => {
      if (!currentModalRestaurantId) return;
      await deleteMyRating(currentModalRestaurantId);
    });
  }

  ensureModalFavoriteButton();
  ensureModalReviewUi();
}

function ensureModalFavoriteButton() {
  if (document.getElementById("modalFavoriteBtn")) {
    modalFavoriteBtn = document.getElementById("modalFavoriteBtn");
    return;
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "modalFavoriteBtn";
  btn.className = "modal-favorite-btn";

  getModalInsertTarget().insertBefore(btn, modalMapBtn);

  modalFavoriteBtn = btn;
}

function ensureModalReviewUi() {
  if (document.getElementById("modalReviewSection")) {
    modalReviewSection = document.getElementById("modalReviewSection");
    modalReviewInput = document.getElementById("modalReviewInput");
    modalReviewCount = document.getElementById("modalReviewCount");
    modalReviewSaveBtn = document.getElementById("modalReviewSaveBtn");
    modalReviewDeleteBtn = document.getElementById("modalReviewDeleteBtn");
    modalReviewList = document.getElementById("modalReviewList");
    return;
  }

  const section = document.createElement("div");
  section.id = "modalReviewSection";
  section.className = "modal-review-section";

  section.innerHTML = `
    <h4>한줄 후기</h4>
    <textarea id="modalReviewInput" class="review-textarea" rows="3" placeholder="예: 점심 빨리 나와서 좋음"></textarea>
    <div id="modalReviewCount" class="review-count">0 / ${REVIEW_MAX_LENGTH}</div>
    <div class="review-action-row">
      <button type="button" id="modalReviewSaveBtn" class="review-save-btn">후기 저장</button>
      <button type="button" id="modalReviewDeleteBtn" class="review-delete-btn">내 후기 삭제</button>
    </div>
    <div id="modalReviewList" class="review-list"></div>
  `;

  getModalInsertTarget().insertBefore(section, modalMapBtn.nextSibling);

  modalReviewSection = document.getElementById("modalReviewSection");
  modalReviewInput = document.getElementById("modalReviewInput");
  modalReviewCount = document.getElementById("modalReviewCount");
  modalReviewSaveBtn = document.getElementById("modalReviewSaveBtn");
  modalReviewDeleteBtn = document.getElementById("modalReviewDeleteBtn");
  modalReviewList = document.getElementById("modalReviewList");

  modalReviewInput.addEventListener("input", () => {
    const clean = modalReviewInput.value.slice(0, REVIEW_MAX_LENGTH);
    if (modalReviewInput.value !== clean) {
      modalReviewInput.value = clean;
    }
    updateReviewCounter();
  });

  modalReviewSaveBtn.addEventListener("click", async () => {
    if (!currentModalRestaurantId) return;
    await saveMyReview(currentModalRestaurantId, modalReviewInput.value);
  });

  modalReviewDeleteBtn.addEventListener("click", async () => {
    if (!currentModalRestaurantId) return;
    await deleteMyReview(currentModalRestaurantId);
  });
}

function updateReviewCounter() {
  if (!modalReviewInput || !modalReviewCount) return;
  modalReviewCount.textContent = `${modalReviewInput.value.length} / ${REVIEW_MAX_LENGTH}`;
}

function renderModalFavoriteButton(restaurantId) {
  ensureModalFavoriteButton();

  const active = isFavorite(restaurantId);
  modalFavoriteBtn.textContent = active ? "❤️ 찜 해제" : "🤍 찜하기";
  modalFavoriteBtn.classList.toggle("active", active);

  modalFavoriteBtn.onclick = () => {
    toggleFavorite(restaurantId);
  };
}

function renderModalReviewUi(restaurantId) {
  ensureModalReviewUi();

  const myReview = getMyReview(restaurantId);
  const reviews = getRestaurantReviewsList(restaurantId);

  modalReviewInput.value = myReview ? myReview.text : "";
  updateReviewCounter();

  modalReviewDeleteBtn.style.display = myReview ? "inline-block" : "none";

  if (!reviews.length) {
    modalReviewList.innerHTML = `
      <div class="review-empty">아직 등록된 후기가 없습니다.</div>
    `;
    return;
  }

  modalReviewList.innerHTML = reviews
    .map((review) => {
      const mine = review.userKey === userKey;
      return `
        <div class="review-item ${mine ? "mine" : ""}">
          <div class="review-text">${escapeHtml(review.text)}</div>
          <div class="review-meta">${mine ? "내 후기" : "익명 후기"}</div>
        </div>
      `;
    })
    .join("");
}

/* =========================
   평점 계산
========================= */
function getRestaurantRatingsObject(restaurantId) {
  return ratingsByRestaurant[String(restaurantId)] || {};
}

function getRestaurantRatingStats(restaurantId) {
  const obj = getRestaurantRatingsObject(restaurantId);
  const values = Object.values(obj)
    .map((v) => {
      if (typeof v === "number") return v;
      if (v && typeof v.score === "number") return v.score;
      return null;
    })
    .filter((v) => typeof v === "number" && v >= 1 && v <= 5);

  const count = values.length;
  const avg = count ? values.reduce((sum, v) => sum + v, 0) / count : 0;

  return { avg, count };
}

function getMyRating(restaurantId) {
  const obj = getRestaurantRatingsObject(restaurantId);
  const mine = obj[userKey];

  if (typeof mine === "number") return mine;
  if (mine && typeof mine.score === "number") return mine.score;
  return 0;
}

function hasMyRating(restaurantId) {
  return getMyRating(restaurantId) > 0;
}

function getEffectiveRating(restaurant) {
  const { avg, count } = getRestaurantRatingStats(restaurant.id);
  if (count > 0) return avg;
  return typeof restaurant.baseRating === "number" ? restaurant.baseRating : 0;
}

function getRatingCount(restaurant) {
  return getRestaurantRatingStats(restaurant.id).count;
}

function getDisplayRating(restaurant) {
  const { avg, count } = getRestaurantRatingStats(restaurant.id);

  if (count > 0) {
    return {
      score: avg,
      count,
      label: `⭐ ${avg.toFixed(1)} (${count}명)`
    };
  }

  const base =
    typeof restaurant.baseRating === "number" ? restaurant.baseRating : 0;

  return {
    score: base,
    count: 0,
    label: `⭐ ${base ? base.toFixed(1) : "-"}`
  };
}

function normalizeTagName(tag) {
  const t = String(tag || "").trim();

  const map = {
    "술한잔": "술모임",
    "주차편함": "주차가능",
    "주차 가능": "주차가능",
    "단체 가능": "단체가능"
  };

  return map[t] || t;
}

function getAllTags() {
  const restaurantTags = restaurants
    .flatMap((r) => Array.isArray(r.tags) ? r.tags : [])
    .map((tag) => normalizeTagName(tag))
    .filter(Boolean);

  return [...new Set(restaurantTags)];
}

/* =========================
   수정용 태그 선택 UI
========================= */
function getSelectableTags() {
  return getAllTags().filter((tag) => tag !== "전체");
}

function getSelectedEditTags() {
  if (!editTagPicker) return [];

  return [...editTagPicker.querySelectorAll(".tag-chip.active")]
    .map((btn) => normalizeTagName(btn.dataset.tag))
    .filter(Boolean);
}

function syncHiddenEditTags() {
  if (!editTags) return;
  editTags.value = getSelectedEditTags().join(", ");
}

function renderEditTagPicker(selectedTags = []) {
  if (!editTagPicker) return;

  const normalizedSelected = [
    ...new Set(
      (selectedTags || [])
        .map((tag) => normalizeTagName(tag))
        .filter(Boolean)
    )
  ];

  const allTags = getSelectableTags();

  editTagPicker.innerHTML = allTags
    .map((tag) => {
      const active = normalizedSelected.includes(tag);
      return `
        <button
          type="button"
          class="tag-chip ${active ? "active" : ""}"
          data-tag="${tag}"
        >
          ${tag}
        </button>
      `;
    })
    .join("");

  const buttons = editTagPicker.querySelectorAll(".tag-chip");

  buttons.forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.toggle("active");
      syncHiddenEditTags();
    };
  });

  syncHiddenEditTags();
}

function addCustomEditTag() {
  const value = normalizeTagName(String(editTagCustom?.value || "").trim());
  if (!value) return;

  const allTags = getAllTags();
  const currentSelected = getSelectedEditTags();

  if (!allTags.includes(value) && !BASE_TAGS.includes(value)) {
    BASE_TAGS.push(value);
  }

  if (!currentSelected.includes(value)) {
    currentSelected.push(value);
  }

  renderEditTagPicker(currentSelected);

  if (editTagCustom) {
    editTagCustom.value = "";
    editTagCustom.focus();
  }
}

/* =========================
   Firebase 저장
========================= */
async function saveMyRating(restaurantId, score) {
  const id = String(restaurantId);
  const num = Number(score);

  if (!id || !num || num < 1 || num > 5) return;

  try {
    await set(ref(db, `restaurantRatings/${id}/${userKey}`), {
      score: num,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error(error);
    alert("별점 저장 중 오류가 발생했습니다.");
  }
}

async function deleteMyRating(restaurantId) {
  const id = String(restaurantId);
  if (!id) return;

  try {
    await remove(ref(db, `restaurantRatings/${id}/${userKey}`));
  } catch (error) {
    console.error(error);
    alert("별점 삭제 중 오류가 발생했습니다.");
  }
}

async function verifyEditPassword() {
  const inputPw = prompt("비밀번호를 입력하세요.");
  if (inputPw === null) return false;

  try {
    const snap = await get(ref(db, ADMIN_PASSWORD_PATH));

    if (!snap.exists()) {
      alert("config/adminPassword 값이 없습니다. Firebase에 먼저 추가해주세요.");
      return false;
    }

    const savedPw = String(snap.val() || "").trim();

    if (!savedPw) {
      alert("관리자 비밀번호가 비어 있습니다.");
      return false;
    }

    if (String(inputPw).trim() !== savedPw) {
      alert("비밀번호가 틀렸습니다.");
      return false;
    }

    return true;
  } catch (error) {
    console.error(error);
    alert("비밀번호 확인 중 오류가 발생했습니다.");
    return false;
  }
}

function fillEditForm(restaurant) {
  if (!restaurant) return;

  editName.value = restaurant.name || "";
  editCategory.value = restaurant.category || "";
  editAddress.value = restaurant.address || "";
  editMenus.value = Array.isArray(restaurant.mainMenus)
    ? restaurant.mainMenus.join(", ")
    : "";

  renderEditTagPicker(Array.isArray(restaurant.tags) ? restaurant.tags : []);

  if (editTagCustom) {
    editTagCustom.value = "";
  }

  editDesc.value = restaurant.description || "";
}

function setModalMode(mode) {
  const isEdit = mode === "edit";

  if (viewMode) viewMode.classList.toggle("hidden", isEdit);
  if (editMode) editMode.classList.toggle("hidden", !isEdit);

  if (modalUserRatingSection) modalUserRatingSection.style.display = isEdit ? "none" : "";
  if (modalFavoriteBtn) modalFavoriteBtn.style.display = isEdit ? "none" : "";
  if (modalReviewSection) modalReviewSection.style.display = isEdit ? "none" : "";
}

async function saveRestaurantInfo() {
  if (!currentModalRestaurantId) return;

  const id = String(currentModalRestaurantId);
  const name = String(editName.value || "").trim();
  const category = String(editCategory.value || "").trim();
  const address = String(editAddress.value || "").trim();
  const mainMenus = String(editMenus.value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const tags = [...new Set(getSelectedEditTags())];
  const description = String(editDesc.value || "").trim();

  if (!name) {
    alert("식당명을 입력해주세요.");
    editName.focus();
    return;
  }

  try {
    await update(ref(db, `restaurants/${id}`), {
      name,
      category,
      address,
      addressShort: address,
      mainMenus,
      tags,
      description
    });

    const target = restaurants.find(
      (item) => Number(item.id) === Number(currentModalRestaurantId)
    );

    if (target) {
      target.name = name;
      target.category = category;
      target.address = address;
      target.addressShort = address;
      target.mainMenus = mainMenus;
      target.tags = tags;
      target.description = description;
    }

    modalName.textContent = name || "";
    modalCategory.textContent = `${category || ""} / ${target?.subCategory || ""}`;
    modalAddress.textContent = address || "";

    modalMenus.innerHTML = Array.isArray(mainMenus)
      ? mainMenus.map((m) => `<span class="menu-tag">${m}</span>`).join(" ")
      : "";

    modalTags.innerHTML = Array.isArray(tags)
      ? tags.map((t) => `<span class="hash-tag">#${t}</span>`).join(" ")
      : "";

    modalDesc.textContent = description || target?.menuType || "설명이 아직 없습니다.";

    renderAll();

    alert("식당 정보가 수정되었습니다.");
    setModalMode("view");
  } catch (error) {
    console.error(error);
    alert("식당 정보 저장 중 오류가 발생했습니다.");
  }
}

/* =========================
   정렬
========================= */
function sortRestaurants(list) {
  const copied = [...list];

  if (sortMode === "rating") {
    copied.sort((a, b) => {
      const diff = getEffectiveRating(b) - getEffectiveRating(a);
      if (diff !== 0) return diff;

      const countDiff = getRatingCount(b) - getRatingCount(a);
      if (countDiff !== 0) return countDiff;

      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    return copied;
  }

  if (sortMode === "popular") {
    copied.sort((a, b) => {
      const countDiff = getRatingCount(b) - getRatingCount(a);
      if (countDiff !== 0) return countDiff;

      const ratingDiff = getEffectiveRating(b) - getEffectiveRating(a);
      if (ratingDiff !== 0) return ratingDiff;

      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    return copied;
  }

  copied.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  return copied;
}

function renderSortButtons() {
  if (sortDefaultBtn) sortDefaultBtn.classList.toggle("active", sortMode === "default");
  if (sortRatingBtn) sortRatingBtn.classList.toggle("active", sortMode === "rating");
  if (sortPopularBtn) sortPopularBtn.classList.toggle("active", sortMode === "popular");
}

/* =========================
   렌더
========================= */
function renderCategories() {
  const categories = [
    "전체",
    ...new Set(restaurants.map((v) => v.category).filter(Boolean))
  ];

  categoryRow.innerHTML = categories
    .map(
      (c) =>
        `<button class="${c === selectedCategory ? "active" : ""}" data="${c}">${c}</button>`
    )
    .join("");

  categoryRow.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      selectedCategory = btn.getAttribute("data");
      renderAll();
    };
  });
}

function renderTags() {
  const tags = getAllTags();

  // 현재 선택된 태그 중, 이제 존재하지 않는 태그는 제거
  selectedTags = selectedTags.filter((tag) => tags.includes(tag));

  if (!tags.length) {
    selectedTags = [];
    tagRow.innerHTML = "";
    tagRow.style.display = "none";
    return;
  }

  tagRow.style.display = "";

  const displayTags = ["전체", ...tags];

  tagRow.innerHTML = displayTags
    .map((t) => {
      const isActive =
        t === "전체" ? selectedTags.length === 0 : selectedTags.includes(t);

      return `<button class="${isActive ? "active" : ""}" data="${t}">${t}</button>`;
    })
    .join("");

  tagRow.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      const tag = btn.getAttribute("data");

      if (tag === "전체") {
        selectedTags = [];
      } else {
        if (selectedTags.includes(tag)) {
          selectedTags = selectedTags.filter((t) => t !== tag);
        } else {
          selectedTags = [...selectedTags, tag];
        }
      }

      renderAll();
    };
  });
}

function renderMyRatedButton() {
  if (!myRatedBtn) return;
  myRatedBtn.classList.toggle("active", onlyMyRated);
  myRatedBtn.textContent = onlyMyRated ? "전체 맛집 보기" : "내가 평가한 맛집";
}

function renderFavoriteFilterButton() {
  if (!favoriteFilterBtn) return;
  favoriteFilterBtn.classList.toggle("active", onlyFavorites);
  favoriteFilterBtn.textContent = onlyFavorites ? "전체 맛집 보기" : "찜한 맛집";
}

function renderCards() {
  const keyword = (searchInput.value || "").trim().toLowerCase();

  let filtered = restaurants.filter((r) => {
    const matchCategory =
      selectedCategory === "전체" || r.category === selectedCategory;

    const restaurantTags = Array.isArray(r.tags)
  ? r.tags.map((tag) => normalizeTagName(tag)).filter(Boolean)
  : [];

const matchTag =
  selectedTags.length === 0 ||
  selectedTags.every((tag) => restaurantTags.includes(tag));

    const nameText = (r.name || "").toLowerCase();
    const menuText = Array.isArray(r.mainMenus)
      ? r.mainMenus.join(" ").toLowerCase()
      : "";
    const addressText = (r.address || "").toLowerCase();
    const addressShortText = (r.addressShort || "").toLowerCase();
    const descText = (r.description || "").toLowerCase();
    const menuTypeText = (r.menuType || "").toLowerCase();
    const tagText = restaurantTags.join(" ").toLowerCase();

    const matchSearch =
      !keyword ||
      nameText.includes(keyword) ||
      menuText.includes(keyword) ||
      addressText.includes(keyword) ||
      addressShortText.includes(keyword) ||
      descText.includes(keyword) ||
      menuTypeText.includes(keyword) ||
      tagText.includes(keyword);

    const matchMyRated = !onlyMyRated || hasMyRating(r.id);
    const matchFavorite = !onlyFavorites || isFavorite(r.id);

    return matchCategory && matchTag && matchSearch && matchMyRated && matchFavorite;
  });

  filtered = sortRestaurants(filtered);

  if (filtered.length === 0) {
    cardGrid.innerHTML = `
      <div class="card">
        <h3>표시할 맛집이 없습니다</h3>
        <div>검색어, 필터, 내가 평가한 맛집, 찜한 맛집 조건을 다시 확인해보세요.</div>
      </div>
    `;
    return;
  }

  cardGrid.innerHTML = filtered
    .map((r) => {
      const ratingInfo = getDisplayRating(r);
      const myRating = getMyRating(r.id);
      const favoriteMark = isFavorite(r.id) ? `<div>❤️ 찜함</div>` : "";
      const ratingCount = getRatingCount(r);
      const latestReview = getLatestReview(r.id);
      const reviewPreview = latestReview
        ? `<div class="card-review-preview">💬 ${escapeHtml(latestReview.text)}</div>`
        : "";

      return `
        <div class="card" data-id="${r.id}">
          <h3>${r.name || ""}</h3>
          <div>${ratingInfo.label}</div>
          ${myRating > 0 ? `<div>내 별점: ${myRating}점</div>` : ""}
          ${favoriteMark}
          ${sortMode === "popular" ? `<div>평가 참여: ${ratingCount}명</div>` : ""}
          <div>${r.category || ""} / ${r.subCategory || ""}</div>
          <div>${Array.isArray(r.mainMenus) ? r.mainMenus.join(", ") : ""}</div>
          <div>${r.addressShort || r.address || ""}</div>
          ${Array.isArray(r.tags) && r.tags.length
  ? `<div>${r.tags.map((t) => "#" + t).join(" ")}</div>`
  : ""}
          ${reviewPreview}
        </div>
      `;
    })
    .join("");

  cardGrid.querySelectorAll(".card").forEach((card) => {
    card.onclick = () => {
      const id = Number(card.getAttribute("data-id"));
      openModal(id);
    };
  });
}

function renderModalRatingUi(restaurantId) {
  ensureModalRatingUi();

  const { avg, count } = getRestaurantRatingStats(restaurantId);
  const myRating = getMyRating(restaurantId);

  modalUserRatingStars.innerHTML = [1, 2, 3, 4, 5]
    .map(
      (score) => `
        <button
          type="button"
          class="star-btn ${score <= myRating ? "active" : ""}"
          data-score="${score}"
          aria-label="${score}점 주기"
        >
          ★
        </button>
      `
    )
    .join("");

  modalUserRatingStars.querySelectorAll(".star-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const score = Number(btn.getAttribute("data-score"));
      await saveMyRating(restaurantId, score);
    });
  });

  if (myRating > 0) {
  modalUserRatingText.textContent = `선택한 별점: ${myRating}점`;
  modalUserRatingDeleteBtn.style.display = "inline-block";
} else {
  modalUserRatingText.textContent = "아직 선택한 별점이 없습니다.";
  modalUserRatingDeleteBtn.style.display = "none";
}

  if (count > 0) {
    modalRating.textContent = `사용자 평점 ${avg.toFixed(1)} / 5 (${count}명 참여)`;
  } else {
    const item = restaurants.find((v) => Number(v.id) === Number(restaurantId));
    const base =
      item && typeof item.baseRating === "number" ? item.baseRating : 0;
    modalRating.textContent = base
      ? `기본 평점 ${base.toFixed(1)} / 5`
      : "아직 등록된 평점이 없습니다.";
  }
}

function openModal(id) {
  const r = restaurants.find((item) => Number(item.id) === Number(id));
  if (!r) return;

  currentModalRestaurantId = Number(id);

  modalName.textContent = r.name || "";
  modalCategory.textContent = `${r.category || ""} / ${r.subCategory || ""}`;
  modalAddress.textContent = r.address || "";

  modalMenus.innerHTML = Array.isArray(r.mainMenus)
    ? r.mainMenus.map((m) => `<span class="menu-tag">${m}</span>`).join(" ")
    : "";

  modalTags.innerHTML = Array.isArray(r.tags)
    ? r.tags.map((t) => `<span class="hash-tag">#${t}</span>`).join(" ")
    : "";

  modalDesc.textContent =
    r.description || r.menuType || "설명이 아직 없습니다.";

  modalMapBtn.onclick = () => openMap(r);

  fillEditForm(r);
  renderModalFavoriteButton(id);
  renderModalRatingUi(id);
  renderModalReviewUi(id);
  setModalMode("view");

  modal.classList.remove("hidden");
}

function buildMapQuery(item) {
  return String(item?.name || "").trim();
}

function openMap(item) {
  const query = buildMapQuery(item);

  if (!query) {
    alert("지도 검색어가 없습니다.");
    return;
  }

  const encoded = encodeURIComponent(query);
  const url = `https://map.naver.com/v5/search/${encoded}`;
  window.open(url, "_blank");
}

function closeModal() {
  modal.classList.add("hidden");
  currentModalRestaurantId = null;
  setModalMode("view");
}

function renderAll() {
  renderCategories();
  renderTags();
  renderMyRatedButton();
  renderFavoriteFilterButton();
  renderSortButtons();
  renderCards();

  if (currentModalRestaurantId) {
    const current = restaurants.find(
      (item) => Number(item.id) === Number(currentModalRestaurantId)
    );
    if (current && !modal.classList.contains("hidden")) {
      openModal(currentModalRestaurantId);
    }
  }
}

/* =========================
   유틸
========================= */
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* =========================
   이벤트
========================= */
searchInput.addEventListener("input", renderCards);

if (myRatedBtn) {
  myRatedBtn.addEventListener("click", () => {
    onlyMyRated = !onlyMyRated;
    renderMyRatedButton();
    renderCards();
  });
}

if (favoriteFilterBtn) {
  favoriteFilterBtn.addEventListener("click", () => {
    onlyFavorites = !onlyFavorites;
    renderFavoriteFilterButton();
    renderCards();
  });
}

if (sortDefaultBtn) {
  sortDefaultBtn.addEventListener("click", () => {
    sortMode = "default";
    renderSortButtons();
    renderCards();
  });
}

if (sortRatingBtn) {
  sortRatingBtn.addEventListener("click", () => {
    sortMode = "rating";
    renderSortButtons();
    renderCards();
  });
}

if (sortPopularBtn) {
  sortPopularBtn.addEventListener("click", () => {
    sortMode = "popular";
    renderSortButtons();
    renderCards();
  });
}

if (editRestaurantBtn) {
  editRestaurantBtn.addEventListener("click", async () => {
    if (!currentModalRestaurantId) return;

    const ok = await verifyEditPassword();
    if (!ok) return;

    const restaurant = restaurants.find(
      (item) => Number(item.id) === Number(currentModalRestaurantId)
    );
    if (!restaurant) return;

    fillEditForm(restaurant);
    setModalMode("edit");
  });
}

if (saveRestaurantBtn) {
  saveRestaurantBtn.addEventListener("click", saveRestaurantInfo);
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    const restaurant = restaurants.find(
      (item) => Number(item.id) === Number(currentModalRestaurantId)
    );
    if (restaurant) fillEditForm(restaurant);
    setModalMode("view");
  });
}

if (addEditTagBtn) {
  addEditTagBtn.addEventListener("click", addCustomEditTag);
}

if (editTagCustom) {
  editTagCustom.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomEditTag();
    }
  });
}

closeModalBtn.addEventListener("click", closeModal);

modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    closeModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) {
    closeModal();
  }
});

/* =========================
   Firebase 구독
========================= */
onValue(ref(db, "restaurants"), (snapshot) => {
  const data = snapshot.val();
  restaurants = data
    ? Object.values(data).map((item) => ({
        ...item,
        tags: Array.isArray(item.tags)
          ? [...new Set(item.tags.map((tag) => normalizeTagName(tag)).filter(Boolean))]
          : []
      }))
    : [];

  restaurants.sort((a, b) => Number(a.id) - Number(b.id));
  renderAll();
});

onValue(ref(db, "restaurantRatings"), (snapshot) => {
  ratingsByRestaurant = snapshot.val() || {};
  renderAll();
});

onValue(ref(db, "restaurantReviews"), (snapshot) => {
  reviewsByRestaurant = snapshot.val() || {};
  renderAll();
});

onValue(ref(db, "editRequests"), (snapshot) => {
  editRequestsById = snapshot.val() || {};
  renderMyRequests();
});

function openRequestModal() {
  requestModal.classList.remove("hidden");
}

function closeRequestModal() {
  requestModal.classList.add("hidden");
  requestRestaurant.value = "";
  requestType.value = "정보수정";
  requestWriter.value = "";
  requestContent.value = "";
}

openRequestBtn?.addEventListener("click", openRequestModal);
closeRequestModalBtn?.addEventListener("click", closeRequestModal);

requestModal?.addEventListener("click", (e) => {
  if (e.target === requestModal) {
    closeRequestModal();
  }
});

async function submitEditRequest() {
  const restaurant = requestRestaurant.value.trim();
  const type = requestType.value;
  const writer = requestWriter.value.trim();
  const content = requestContent.value.trim();

  if (!restaurant) {
    alert("식당명을 입력해주세요.");
    requestRestaurant.focus();
    return;
  }

  if (!content) {
    alert("요청 내용을 입력해주세요.");
    requestContent.focus();
    return;
  }

  try {
    const newRef = push(ref(db, "editRequests"));

    await set(newRef, {
  restaurantName: restaurant,
  type,
  writer: writer || "익명",
  userKey: userKey,
  content,
  status: "대기",
  adminReply: "",
  createdAt: Date.now()
});

    alert("수정 요청이 등록되었습니다.");
    closeRequestModal();
  } catch (err) {
    console.error(err);
    alert("수정 요청 등록 중 오류가 발생했습니다.");
  }
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

function getMyEditRequests() {
  return Object.entries(editRequestsById || {})
    .map(([id, item]) => ({ id, ...item }))
    .filter((item) => item.userKey === userKey)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderMyRequests() {
  if (!myRequestList) return;

  const myItems = getMyEditRequests();

  if (!myItems.length) {
    myRequestList.innerHTML = `
      <div class="my-request-empty">
        아직 등록한 수정 요청이 없습니다.
      </div>
    `;
    return;
  }

  myRequestList.innerHTML = myItems.map((item) => `
    <div class="my-request-item">
      <div class="my-request-head">
        <div>
          <strong>${escapeHtml(item.restaurantName || "-")}</strong>
          <span class="my-request-type">${escapeHtml(item.type || "기타")}</span>
        </div>
        <div class="my-request-meta">${formatDateTime(item.createdAt)}</div>
      </div>

      <div class="my-request-meta">
        작성자: ${escapeHtml(item.writer || "익명")} / 상태: ${escapeHtml(item.status || "대기")}
      </div>

      <div class="my-request-content">${escapeHtml(item.content || "")}</div>

      ${
        item.adminReply
          ? `<div class="my-request-reply"><strong>관리자 답변</strong><br>${escapeHtml(item.adminReply)}</div>`
          : `<div class="my-request-reply"><strong>관리자 답변</strong><br>아직 답변이 등록되지 않았습니다.</div>`
      }
    </div>
  `).join("");
}

function openMyRequestModal() {
  renderMyRequests();
  myRequestModal?.classList.remove("hidden");
}

function closeMyRequestModal() {
  myRequestModal?.classList.add("hidden");
}

openMyRequestBtn?.addEventListener("click", openMyRequestModal);
closeMyRequestModalBtn?.addEventListener("click", closeMyRequestModal);

myRequestModal?.addEventListener("click", (e) => {
  if (e.target === myRequestModal) {
    closeMyRequestModal();
  }
});

submitRequestBtn?.addEventListener("click", submitEditRequest);

function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonthKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function initVisitorStats() {
  const visitorEl = document.getElementById("visitorCount");
  if (!visitorEl) return;

  const todayKey = getTodayKey();
  const monthKey = getMonthKey();

  let visitorId = localStorage.getItem("koen_food_visitor_id");
  if (!visitorId) {
    visitorId = "v_" + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem("koen_food_visitor_id", visitorId);
  }

  const todayMarkKey = `koen_food_visited_today_${todayKey}`;
  const monthMarkKey = `koen_food_visited_month_${monthKey}`;

  const alreadyCountedToday = localStorage.getItem(todayMarkKey) === "Y";
  const alreadyCountedMonth = localStorage.getItem(monthMarkKey) === "Y";

  const totalRef = ref(db, "analytics/totalVisits");
  const totalSnap = await get(totalRef);
  const currentTotal = totalSnap.exists() ? totalSnap.val() : 0;
  await set(totalRef, currentTotal + 1);

  if (!alreadyCountedToday) {
    const todayRef = ref(db, `analytics/dailyVisits/${todayKey}`);
    const todaySnap = await get(todayRef);
    const currentToday = todaySnap.exists() ? todaySnap.val() : 0;
    await set(todayRef, currentToday + 1);
    localStorage.setItem(todayMarkKey, "Y");
  }

  if (!alreadyCountedMonth) {
    const monthRef = ref(db, `analytics/monthlyVisits/${monthKey}`);
    const monthSnap = await get(monthRef);
    const currentMonth = monthSnap.exists() ? monthSnap.val() : 0;
    await set(monthRef, currentMonth + 1);
    localStorage.setItem(monthMarkKey, "Y");
  }

  let totalValue = 0;
  let monthValue = 0;
  let todayValue = 0;

  function renderVisitorCount() {
    visitorEl.textContent =
      `${Number(totalValue).toLocaleString()} / ${Number(monthValue).toLocaleString()} / ${Number(todayValue).toLocaleString()}`;
  }

  onValue(ref(db, "analytics/totalVisits"), (snap) => {
    totalValue = snap.exists() ? snap.val() : 0;
    renderVisitorCount();
  });

  onValue(ref(db, `analytics/monthlyVisits/${monthKey}`), (snap) => {
    monthValue = snap.exists() ? snap.val() : 0;
    renderVisitorCount();
  });

  onValue(ref(db, `analytics/dailyVisits/${todayKey}`), (snap) => {
    todayValue = snap.exists() ? snap.val() : 0;
    renderVisitorCount();
  });
}

initVisitorStats();



/* =========================
   초기
========================= */
ensureModalRatingUi();
setModalMode("view");
renderMyRatedButton();
renderFavoriteFilterButton();
renderSortButtons();