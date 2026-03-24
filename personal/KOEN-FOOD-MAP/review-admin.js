import { db } from "./firebase.js";
import {
  ref,
  get,
  update,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const reviewContainer = document.getElementById("reviewContainer");
const refreshBtn = document.getElementById("refreshBtn");

let restaurantsMap = {};
let activeReviewRoot = "restaurantReviews";

// 식당명 매핑
async function loadRestaurantsMap() {
  const snap = await get(ref(db, "restaurants"));
  const data = snap.val() || {};
  restaurantsMap = {};

  Object.keys(data).forEach((key) => {
    const item = data[key] || {};
    const rid = String(item.id ?? key);
    const name = item.name || `식당 ${rid}`;

    restaurantsMap[rid] = name;
    restaurantsMap[String(key)] = name;
  });
}

// HTML 이스케이프
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// 후기 값 표준화
function normalizeReviewObj(value, userKey) {
  if (typeof value === "string") {
    return {
      writerId: userKey,
      writerName: "-",
      text: value,
      updatedAt: 0,
      rawType: "string"
    };
  }

  if (value && typeof value === "object") {
    return {
      writerId: value.id || value.userId || value.writerId || userKey,
      writerName:
        value.name ||
        value.nickname ||
        value.writer ||
        value.writerName ||
        value.displayName ||
        "-",
      text:
        value.text ||
        value.review ||
        value.comment ||
        value.content ||
        "",
      updatedAt:
        value.updatedAt ||
        value.createdAt ||
        value.timestamp ||
        0,
      rawType: "object"
    };
  }

  return null;
}

// 후기 저장 경로 자동 탐색
async function detectReviewRoot() {
  const candidates = ["restaurantReviews", "reviews", "oneLineReviews"];

  for (const path of candidates) {
    const snap = await get(ref(db, path));
    const val = snap.val();

    if (val && typeof val === "object" && Object.keys(val).length > 0) {
      activeReviewRoot = path;
      return val;
    }
  }

  activeReviewRoot = "restaurantReviews";
  return {};
}

// 테이블 렌더링
function renderRows(rows) {
  reviewContainer.innerHTML = `
    <div class="review-table-wrap">
      <div class="review-table-scroll">
        <table class="review-table">
          <thead>
            <tr>
              <th style="width:140px;">작성자 ID</th>
              <th style="width:140px;">이름/별명</th>
              <th style="width:180px;">음식점</th>
              <th>한줄후기</th>
              <th style="width:130px;">관리</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr
                data-restaurant-id="${escapeHtml(row.restaurantId)}"
                data-user-key="${escapeHtml(row.userKey)}"
                data-raw-type="${escapeHtml(row.rawType)}"
                data-writer-name="${escapeHtml(row.writerName)}"
              >
                <td class="review-id">${escapeHtml(row.writerId)}</td>
                <td class="review-name">${escapeHtml(row.writerName)}</td>
                <td class="restaurant-name">${escapeHtml(row.restaurantName)}</td>
                <td>
                  <textarea class="review-edit-input">${escapeHtml(row.text)}</textarea>
                </td>
                <td>
                  <div class="review-row-actions">
                    <button class="row-btn btn-edit review-save-btn" type="button">수정</button>
                    <button class="row-btn btn-delete review-delete-btn" type="button">삭제</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  bindRowEvents();
}

// 수정/삭제 이벤트 연결
function bindRowEvents() {
  document.querySelectorAll(".review-save-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr");
      const restaurantId = tr.dataset.restaurantId;
      const userKey = tr.dataset.userKey;
      const rawType = tr.dataset.rawType;
      const writerName = tr.dataset.writerName || "-";
      const textarea = tr.querySelector(".review-edit-input");
      const newText = textarea.value.trim();

      if (!newText) {
        alert("한줄후기 내용은 비워둘 수 없습니다.");
        textarea.focus();
        return;
      }

      try {
        if (rawType === "string") {
          await update(ref(db, `${activeReviewRoot}/${restaurantId}`), {
            [userKey]: newText
          });
        } else {
          await update(ref(db, `${activeReviewRoot}/${restaurantId}/${userKey}`), {
            text: newText,
            writerName,
            updatedAt: Date.now()
          });
        }

        alert("후기를 수정했습니다.");
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

      if (!confirm("이 후기를 삭제하시겠습니까?")) return;

      try {
        await remove(ref(db, `${activeReviewRoot}/${restaurantId}/${userKey}`));
        tr.remove();

        const tbody = document.querySelector(".review-table tbody");
        if (!tbody || !tbody.children.length) {
          reviewContainer.innerHTML = `
            <div class="empty-box">
              등록된 한줄후기가 없습니다.<br>
              <span class="path-badge">읽은 경로: ${escapeHtml(activeReviewRoot)}</span>
            </div>
          `;
        }

        alert("삭제했습니다.");
      } catch (err) {
        console.error(err);
        alert("삭제 중 오류가 발생했습니다.");
      }
    });
  });
}

// 후기 불러오기
async function loadReviews() {
  reviewContainer.innerHTML = `<div class="loading-box">불러오는 중...</div>`;

  try {
    await loadRestaurantsMap();

    const reviewData = await detectReviewRoot();
    const rows = [];

    Object.entries(reviewData).forEach(([restaurantId, reviewUsers]) => {
      if (!reviewUsers) return;

      if (typeof reviewUsers === "object" && !Array.isArray(reviewUsers)) {
        Object.entries(reviewUsers).forEach(([userKey, value]) => {
          const normalized = normalizeReviewObj(value, userKey);
          if (!normalized || !normalized.text) return;

          rows.push({
            restaurantId,
            userKey,
            writerId: normalized.writerId,
            writerName: normalized.writerName,
            restaurantName: restaurantsMap[String(restaurantId)] || `식당 ${restaurantId}`,
            text: normalized.text,
            updatedAt: normalized.updatedAt,
            rawType: normalized.rawType
          });
        });
      }
    });

    rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!rows.length) {
      reviewContainer.innerHTML = `
        <div class="empty-box">
          등록된 한줄후기가 없습니다.<br>
          <span class="path-badge">확인한 경로: ${escapeHtml(activeReviewRoot)}</span>
        </div>
      `;
      return;
    }

    renderRows(rows);
  } catch (err) {
    console.error(err);
    reviewContainer.innerHTML = `
      <div class="empty-box">
        댓글 데이터를 불러오는 중 오류가 발생했습니다.
      </div>
    `;
  }
}

refreshBtn.addEventListener("click", loadReviews);
loadReviews();