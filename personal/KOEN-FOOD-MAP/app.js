import { db, ref, onValue } from "./firebase.js";

let restaurants = [];
let selectedCategory = "전체";
let selectedTag = "전체";

const categoryRow = document.getElementById("categoryRow");
const tagRow = document.getElementById("tagRow");
const cardGrid = document.getElementById("cardGrid");
const searchInput = document.getElementById("searchInput");

const TAGS = ["전체","점심","회식","가족식사","데이트","혼밥","해장","가성비"];

function renderCategories() {
  const categories = ["전체", ...new Set(restaurants.map(v => v.category))];

  categoryRow.innerHTML = categories.map(c =>
    `<button class="${c===selectedCategory?'active':''}" data="${c}">${c}</button>`
  ).join("");

  categoryRow.querySelectorAll("button").forEach(btn=>{
    btn.onclick = ()=>{
      selectedCategory = btn.getAttribute("data");
      renderAll();
    }
  });
}

function renderTags() {
  tagRow.innerHTML = TAGS.map(t =>
    `<button class="${t===selectedTag?'active':''}" data="${t}">${t}</button>`
  ).join("");

  tagRow.querySelectorAll("button").forEach(btn=>{
    btn.onclick = ()=>{
      selectedTag = btn.getAttribute("data");
      renderAll();
    }
  });
}

function renderCards() {
  const keyword = searchInput.value.toLowerCase();

  const filtered = restaurants.filter(r=>{
    const matchCategory = selectedCategory==="전체" || r.category===selectedCategory;
    const matchTag = selectedTag==="전체" || r.tags.includes(selectedTag);

    const matchSearch = r.name.toLowerCase().includes(keyword);

    return matchCategory && matchTag && matchSearch;
  });

  cardGrid.innerHTML = filtered.map(r=>`
    <div class="card">
      <h3>${r.name}</h3>
      <div>⭐ ${r.baseRating}</div>
      <div>${r.category} / ${r.subCategory}</div>
      <div>${r.mainMenus.join(", ")}</div>
      <div>${r.tags.map(t=>"#"+t).join(" ")}</div>
    </div>
  `).join("");
}

function renderAll(){
  renderCategories();
  renderTags();
  renderCards();
}

searchInput.addEventListener("input", renderCards);

// Firebase 데이터 불러오기
onValue(ref(db, "restaurants"), snapshot=>{
  const data = snapshot.val();
  restaurants = data ? Object.values(data) : [];
  renderAll();
});