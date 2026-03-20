import { db, ref, onValue, set, remove } from "./firebase.js";

let restaurants = [];
let ratingsByRestaurant = {};
let reviewsByRestaurant = {};
let selectedCategory = "전체";
let selectedTag = "전체";
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

const TAGS = [
  "전체",
  "점심",
  "저녁",
  "회식",
  "가족식사",
  "데이트",
  "혼밥",
  "해장",
  "술한잔",
  "가성비",
  "고급",
  "유명맛집",
  "진주대표",
  "부모님추천",
  "룸있음",
  "단체가능",
  "주차편함"
];

const RATING_STORAGE_KEY = "koen_food_user_key";
const FAVORITES_STORAGE_KEY = "koen_food_favorites";
const REVIEW_MAX_LENGTH = 50;

function getUserKey() {
  let key = localStorage.getItem(RATING_STORAGE_KEY);
  if (!key) {
    key = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(RATING_STORAGE_KEY, key);
  }
  return key;
}

const userKey = getUserKey();

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

    modalMapBtn.parentNode.insertBefore(section, modalMapBtn);

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
  modalMapBtn.parentNode.insertBefore(btn, modalMapBtn);

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

  modalMapBtn.parentNode.insertBefore(section, modalMapBtn.nextSibling);

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

  modalReviewDeleteBtn.style.display = myReview ? "inline-block" : "inline-block";

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
  tagRow.innerHTML = TAGS.map(
    (t) => `<button class="${t === selectedTag ? "active" : ""}" data="${t}">${t}</button>`
  ).join("");

  tagRow.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      selectedTag = btn.getAttribute("data");
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

    const matchTag =
      selectedTag === "전체" ||
      (Array.isArray(r.tags) && r.tags.includes(selectedTag));

    const nameText = (r.name || "").toLowerCase();
    const menuText = Array.isArray(r.mainMenus)
      ? r.mainMenus.join(" ").toLowerCase()
      : "";
    const addressText = (r.address || "").toLowerCase();
    const addressShortText = (r.addressShort || "").toLowerCase();
    const descText = (r.description || "").toLowerCase();
    const menuTypeText = (r.menuType || "").toLowerCase();
    const tagText = Array.isArray(r.tags) ? r.tags.join(" ").toLowerCase() : "";

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
          <div>${Array.isArray(r.tags) ? r.tags.map((t) => "#" + t).join(" ") : ""}</div>
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
    modalUserRatingDeleteBtn.style.display = "inline-block";
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

  renderModalFavoriteButton(id);
  renderModalRatingUi(id);
  renderModalReviewUi(id);

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
  restaurants = data ? Object.values(data) : [];
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

/* =========================
   초기
========================= */
ensureModalRatingUi();
renderMyRatedButton();
renderFavoriteFilterButton();
renderSortButtons();