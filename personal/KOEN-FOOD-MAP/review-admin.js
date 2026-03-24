import { auth, db } from "./firebase.js";
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  ref,
  get,
  update,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const reviewContainer = document.getElementById("reviewContainer");
const refreshBtn = document.getElementById("refreshBtn");

let restaurantsMap = {};

async function ensureAuth() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}

async function loadRestaurantsMap() {
  const snap = await get(ref(db, "restaurants"));
  const data = snap.val() || {};
  restaurantsMap = {};

  Object.keys(data).forEach((key) => {
    const item = data[key] || {};
    const rid = String(item.id ?? key);
    restaurantsMap[rid] = item.name || `식당 ${rid}`;
    restaurantsMap[String(key)] = item.name || `식당 ${rid}`;
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pickWriterName(reviewObj = {}) {
  return (
    reviewObj.name ||
    reviewObj.nickname ||
    reviewObj.writer ||
    reviewObj.writerName ||
    reviewObj.displayName ||
    "-"
  );
}

function pickReviewText(reviewObj = {}) {
  return reviewObj.text || reviewObj.review || reviewObj.comment || "";
}

function pickUpdatedAt(reviewObj = {}) {
  return reviewObj.updatedAt || reviewObj.createdAt || 0;
}

async function loadReviews() {
  reviewContainer.innerHTML = `<div class="empty-box">불러오는 중...</div>`;

  await ensureAuth();
  await loadRestaurantsMap();

  const reviewSnap = await get(ref(db, "restaurantReviews"));
  const reviewData = reviewSnap.val() || {};

  const rows = [];

  Object.entries(reviewData).forEach(([restaurantId, reviewUsers]) => {
    if (!reviewUsers || typeof reviewUsers !== "object") return;

    Object.entries(reviewUsers).forEach(([userKey, reviewObj]) => {
      if (!reviewObj || typeof reviewObj !== "object") return;

      rows.push({
        restaurantId,
        userKey,
        writerId: userKey,
        writerName: pickWriterName(reviewObj),
        restaurantName: restaurantsMap[String(restaurantId)] || `식당 ${restaurantId}`,
        text: pickReviewText(reviewObj),
        updatedAt: pickUpdatedAt(reviewObj)
      });
    });
  });

  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (!rows.length) {
    reviewContainer.innerHTML = `<div class="empty-box">등록된 한줄후기가 없습니다.</div>`;
    return;
  }

  reviewContainer.innerHTML = `
    <div class="review-table-wrap">
      <table class="review-table">
        <thead>
          <tr>
            <th style="width:110px;">작성자 ID</th>
            <th style="width:140px;">이름/별명</th>
            <th style="width:180px;">음식점</th>
            <th>한줄후기</th>
            <th style="width:130px;">관리</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr data-restaurant-id="${escapeHtml(row.restaurantId)}" data-user-key="${escapeHtml(row.userKey)}">
              <td>${escapeHtml(row.writerId)}</td>
              <td>${escapeHtml(row.writerName)}</td>
              <td>${escapeHtml(row.restaurantName)}</td>
              <td>
                <textarea class="review-edit-input">${escapeHtml(row.text)}</textarea>
              </td>
              <td>
                <div class="review-row-actions">
                  <button class="btn-sm btn-edit review-save-btn" type="button">수정</button>
                  <button class="btn-sm btn-delete review-delete-btn" type="button">삭제</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  bindRowEvents();
}

function bindRowEvents() {
  document.querySelectorAll(".review-save-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const restaurantId = tr.dataset.restaurantId;
      const userKey = tr.dataset.userKey;
      const textarea = tr.querySelector(".review-edit-input");
      const newText = textarea.value.trim();

      if (!newText) {
        alert("한줄후기는 비워둘 수 없습니다.");
        textarea.focus();
        return;
      }

      try {
        await update(ref(db, `restaurantReviews/${restaurantId}/${userKey}`), {
          text: newText,
          updatedAt: Date.now()
        });
        alert("한줄후기를 수정했습니다.");
      } catch (err) {
        console.error(err);
        alert("수정 중 오류가 발생했습니다.");
      }
    });
  });

  document.querySelectorAll(".review-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const restaurantId = tr.dataset.restaurantId;
      const userKey = tr.dataset.userKey;

      if (!confirm("이 한줄후기를 삭제하시겠습니까?")) return;

      try {
        await remove(ref(db, `restaurantReviews/${restaurantId}/${userKey}`));
        tr.remove();

        const tbody = document.querySelector(".review-table tbody");
        if (!tbody || !tbody.children.length) {
          reviewContainer.innerHTML = `<div class="empty-box">등록된 한줄후기가 없습니다.</div>`;
        }

        alert("삭제했습니다.");
      } catch (err) {
        console.error(err);
        alert("삭제 중 오류가 발생했습니다.");
      }
    });
  });
}

refreshBtn.addEventListener("click", loadReviews);

loadReviews();