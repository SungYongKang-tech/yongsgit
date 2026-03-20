import { db, ref, onValue } from "./firebase.js";

let restaurants = [];
let selectedCategory = "전체";
let selectedTag = "전체";

const categoryRow = document.getElementById("categoryRow");
const tagRow = document.getElementById("tagRow");
const cardGrid = document.getElementById("cardGrid");
const searchInput = document.getElementById("searchInput");

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

    return matchCategory && matchTag && matchSearch;
  });

  if (filtered.length === 0) {
    cardGrid.innerHTML = `
      <div class="card">
        <h3>검색 결과가 없습니다</h3>
        <div>검색어 또는 필터를 바꿔서 다시 확인해보세요.</div>
      </div>
    `;
    return;
  }

  cardGrid.innerHTML = filtered
    .map(
      (r) => `
      <div class="card" data-id="${r.id}">
        <h3>${r.name || ""}</h3>
        <div>⭐ ${
          typeof r.baseRating === "number" ? r.baseRating.toFixed(1) : "-"
        }</div>
        <div>${r.category || ""} / ${r.subCategory || ""}</div>
        <div>${Array.isArray(r.mainMenus) ? r.mainMenus.join(", ") : ""}</div>
        <div>${r.addressShort || r.address || ""}</div>
        <div>${Array.isArray(r.tags) ? r.tags.map((t) => "#" + t).join(" ") : ""}</div>
      </div>
    `
    )
    .join("");

  cardGrid.querySelectorAll(".card").forEach((card) => {
    card.onclick = () => {
      const id = Number(card.getAttribute("data-id"));
      openModal(id);
    };
  });
}

function openModal(id) {
  const r = restaurants.find((item) => Number(item.id) === Number(id));
  if (!r) return;

  modalName.textContent = r.name || "";
  modalRating.textContent =
    typeof r.baseRating === "number" ? r.baseRating.toFixed(1) : "-";
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
}

function renderAll() {
  renderCategories();
  renderTags();
  renderCards();
}

searchInput.addEventListener("input", renderCards);

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

onValue(ref(db, "restaurants"), (snapshot) => {
  const data = snapshot.val();
  restaurants = data ? Object.values(data) : [];
  restaurants.sort((a, b) => Number(a.id) - Number(b.id));
  renderAll();
});