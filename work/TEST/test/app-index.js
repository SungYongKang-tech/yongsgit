// app-index.js
import { auth, db } from "./firebase.js";
import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

// -------------------- util --------------------
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function randomId(len = 16) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function escapeHtml(s) {
  return (s || "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// -------------------- UI 초기값 --------------------
if ($("startDate")) $("startDate").value = todayISO();
if ($("endDate")) $("endDate").value = todayISO();
const statusEl = $("status");

// -------------------- Auth --------------------
const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (u) => u && resolve(u));
});

signInAnonymously(auth).catch((e) => {
  console.error("익명 로그인 실패:", e);
  if (statusEl) statusEl.textContent = `익명 로그인 실패: ${e.code || ""} ${e.message || ""}`;
  alert(`익명 로그인 실패\ncode: ${e.code}\nmessage: ${e.message}`);
});

// ============================================================
// ✅ (A) 공용 여행 목록: Firestore trips에서 읽어오기
//  - index.html에 <div id="tripList"></div> 가 있어야 합니다.
//  - (선택) <p class="small" id="tripListStatus"></p> 있으면 상태 표시
// ============================================================
function renderPublicTrips() {
  const listEl = $("tripList");
  const listStatus = $("tripListStatus");
  if (!listEl) return;

  // ✅ createdAt 최상단 기준 정렬
  const q = query(collection(db, "trips"), orderBy("createdAt", "desc"), limit(50));

  onSnapshot(
    q,
    (snap) => {
      listEl.innerHTML = "";

      if (snap.empty) {
        listEl.innerHTML = `<div class="small">아직 생성된 여행이 없습니다. 위에서 새 여행을 만들어 주세요.</div>`;
        if (listStatus) listStatus.textContent = "";
        return;
      }

      snap.forEach((d) => {
        const data = d.data() || {};
        const meta = data.meta || {};

        const title = meta.title || "여행";
        const period =
          meta.startDate && meta.endDate ? `${meta.startDate} ~ ${meta.endDate}` : "";

        const card = document.createElement("div");
        card.className = "item";
        card.innerHTML = `
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="meta">
            <span>📅 ${escapeHtml(period)}</span>
            <span class="small">ID: ${escapeHtml(d.id)}</span>
          </div>
          <div class="actions">
            <a class="chip" href="trip.html?trip=${encodeURIComponent(d.id)}">열기</a>
          </div>
        `;

        listEl.appendChild(card);
      });

      if (listStatus) listStatus.textContent = `표시 중: ${snap.size}개`;
    },
    (err) => {
      console.error(err);
      listEl.innerHTML = `<div class="small">목록 불러오기 실패: ${escapeHtml(err.message)}</div>`;
      if (listStatus) listStatus.textContent = "";
    }
  );
}

renderPublicTrips();

// ============================================================
// (선택) 기존 로컬 목록 유지: 같은 기기에서 "최근 여행" 편의용
//  - 다른 폰에서는 안 보이는 게 정상
// ============================================================
const LS_KEY = "myTrips";

function saveTripToLocal({ tripId, title, startDate, endDate }) {
  const prev = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  const next = [
    { tripId, title, startDate, endDate, savedAt: Date.now() },
    ...prev.filter((x) => x.tripId !== tripId),
  ].slice(0, 30);
  localStorage.setItem(LS_KEY, JSON.stringify(next));
}

function renderMyTrips() {
  const box = $("myTrips");
  const hint = $("myTripsHint");
  if (!box) return;

  const list = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  if (!list.length) {
    box.innerHTML = `<div class="small">이 기기에서 최근에 열었던 여행이 없습니다.</div>`;
    if (hint) hint.textContent = "";
    return;
  }

  box.innerHTML = list
    .map(
      (t) => `
      <div class="item">
        <div class="item-title">${escapeHtml(t.title || "여행")}</div>
        <div class="meta">
          <span>📅 ${
            t.startDate && t.endDate ? `${t.startDate} ~ ${t.endDate}` : ""
          }</span>
          <span class="small">${new Date(t.savedAt).toLocaleString()}</span>
        </div>
        <div class="actions">
          <a class="chip" href="trip.html?trip=${encodeURIComponent(t.tripId)}">열기</a>
          <div class="chip" data-del="${t.tripId}">목록에서 제거</div>
        </div>
      </div>
    `
    )
    .join("");

  box.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      const cur = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
      const next = cur.filter((x) => x.tripId !== id);
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      renderMyTrips();
    });
  });

  if (hint)
    hint.textContent =
      "※ 이 목록(최근 여행)은 이 기기(브라우저)에만 저장됩니다. 공용 여행 목록은 위에서 확인하세요.";
}

renderMyTrips();

// -------------------- 여행 만들기 --------------------
$("createBtn")?.addEventListener("click", async () => {
  const user = await authReady;

  const title = $("title")?.value.trim();
  const startDate = $("startDate")?.value;
  const endDate = $("endDate")?.value;
  const myName = $("myName")?.value.trim() || "익명";

  if (!title) return (statusEl.textContent = "여행 이름을 입력해 주세요.");
  if (!startDate || !endDate) return (statusEl.textContent = "기간을 입력해 주세요.");

  const tripId = randomId(16);

  try {
    statusEl.textContent = "저장 중…";

    // ✅ trips 문서: createdAt 최상단 추가(공용 목록 정렬용)
    await setDoc(doc(db, "trips", tripId), {
      createdAt: serverTimestamp(), // ✅ 핵심
      meta: {
        title,
        startDate,
        endDate,
        createdAt: serverTimestamp(),
        ownerUid: user.uid,
      },
    });

    // 멤버 등록
    await setDoc(doc(db, "trips", tripId, "members", user.uid), {
      name: myName,
      joinedAt: serverTimestamp(),
    });

    // (선택) 로컬에도 저장(같은 기기 편의)
    saveTripToLocal({ tripId, title, startDate, endDate });
    renderMyTrips();

    // 이동
    location.href = `trip.html?trip=${encodeURIComponent(tripId)}`;
  } catch (e) {
    console.error(e);
    statusEl.textContent = `저장 실패: ${e.message || e}`;
  }
});
