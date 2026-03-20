import { db, ref, onValue, set, remove } from "./firebase.js";

let restaurants = [];
let ratingsByRestaurant = {};
let selectedCategory = "전체";
let selectedTag = "전체";
let currentModalRestaurantId = null;
let onlyMyRated = false;

const categoryRow = document.getElementById("categoryRow");
const tagRow = document.getElementById("tagRow");
const cardGrid = document.getElementById("cardGrid");
const searchInput = document.getElementById("searchInput");
const myRatedBtn = document.getElementById("myRatedBtn");

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
   모달 별점 UI 동적 생성
========================= */
let modalUserRatingSection = null;
let modalUserRatingStars = null;
let modalUserRatingText = null;
let modalUserRatingDeleteBtn = null;

function ensureModalRatingUi() {
  if (document.getElementById("modalUserRatingSection")) {
    modalUserRatingSection = document.getElementById("modalUserRatingSection");
    modalUserRatingStars = document.getElementById("modalUserRatingStars");
    modalUserRatingText = document.getElementById("modalUserRatingText");
    modalUserRatingDeleteBtn = document.getElementById("modalUserRatingDeleteBtn");
    return;
  }

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

function renderCards() {
  const keyword = (searchInput.value || "").trim().toLowerCase();

  const filtered = restaurants.filter((r) => {
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

    return matchCategory && matchTag && matchSearch && matchMyRated;
  });

  if (filtered.length === 0) {
    cardGrid.innerHTML = `
      <div class="card">
        <h3>표시할 맛집이 없습니다</h3>
        <div>검색어, 필터, 또는 '내가 평가한 맛집' 조건을 다시 확인해보세요.</div>
      </div>
    `;
    return;
  }

  cardGrid.innerHTML = filtered
    .map((r) => {
      const ratingInfo = getDisplayRating(r);
      const myRating = getMyRating(r.id);

      return `
        <div class="card" data-id="${r.id}">
          <h3>${r.name || ""}</h3>
          <div>${ratingInfo.label}</div>
          ${myRating > 0 ? `<div>내 별점: ${myRating}점</div>` : ""}
          <div>${r.category || ""} / ${r.subCategory || ""}</div>
          <div>${Array.isArray(r.mainMenus) ? r.mainMenus.join(", ") : ""}</div>
          <div>${r.addressShort || r.address || ""}</div>
          <div>${Array.isArray(r.tags) ? r.tags.map((t) => "#" + t).join(" ") : ""}</div>
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

  renderModalRatingUi(id);

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

/* =========================
   초기
========================= */
ensureModalRatingUi();
renderMyRatedButton();