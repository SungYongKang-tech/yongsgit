import { auth, db } from "./firebase.js";
import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

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

// -------------------- 최근 여행 저장/표시 --------------------
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
    box.innerHTML = `<div class="small">아직 저장된 여행이 없습니다. 위에서 새 여행을 만들면 여기에 표시됩니다.</div>`;
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

  // 삭제 버튼 처리
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
      "※ 이 목록은 이 기기(브라우저)에 저장됩니다. 다른 폰/PC에서는 보이지 않습니다.";
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderMyTrips();

// -------------------- 여행 만들기 --------------------
$("createBtn")?.addEventListener("click", async () => {
  const user = await authReady;

  const title = $("title").value.trim();
  const startDate = $("startDate").value;
  const endDate = $("endDate").value;
  const myName = $("myName").value.trim() || "익명";

  if (!title) return (statusEl.textContent = "여행 이름을 입력해 주세요.");
  if (!startDate || !endDate) return (statusEl.textContent = "기간을 입력해 주세요.");

  const tripId = randomId(16);

  try {
    statusEl.textContent = "저장 중…";

    // trips 문서
    await setDoc(doc(db, "trips", tripId), {
      meta: { title, startDate, endDate, createdAt: serverTimestamp(), ownerUid: user.uid },
    });

    // 멤버 등록
    await setDoc(doc(db, "trips", tripId, "members", user.uid), {
      name: myName,
      joinedAt: serverTimestamp(),
    });

    // ✅ 로컬에 저장(나중에 index에서 다시 열 수 있게)
    saveTripToLocal({ tripId, title, startDate, endDate });

    // 이동
    location.href = `trip.html?trip=${encodeURIComponent(tripId)}`;
  } catch (e) {
    console.error(e);
    statusEl.textContent = `저장 실패: ${e.message || e}`;
  }
});
