// app-index.js (공용 여행 목록 버전 - 중복 제거)
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
  return (s ?? "")
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
// ✅ 공용 여행 목록: Firestore trips에서 읽어오기
// index.html에 <div id="tripList"></div> 필요
// ============================================================
const listEl = $("tripList");
const listStatus = $("tripListStatus");

if (listEl) {
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
          </div>
          <div class="actions">
            <a class="chip" href="trip.html?trip=${encodeURIComponent(d.id)}">열기</a>
            <div class="chip" data-copy="${escapeHtml(d.id)}">링크 복사</div>
          </div>
        `;

        // 링크 복사
        card.querySelector("[data-copy]")?.addEventListener("click", async () => {
          const url = `${location.origin}${location.pathname.replace(/index\.html?$/,"")}trip.html?trip=${encodeURIComponent(d.id)}`;
          try {
            await navigator.clipboard.writeText(url);
            alert("여행 링크를 복사했습니다. 카톡에 붙여넣기 하시면 됩니다.");
          } catch {
            prompt("복사가 안 되면 아래 링크를 복사하세요:", url);
          }
        });

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

    // ✅ 공용 목록 정렬을 위해 createdAt 최상단 저장
    await setDoc(doc(db, "trips", tripId), {
      createdAt: serverTimestamp(),
      meta: {
        title,
        startDate,
        endDate,
        createdAt: serverTimestamp(),
        ownerUid: user.uid,
      },
    });

    // 멤버 등록(작성자)
    await setDoc(doc(db, "trips", tripId, "members", user.uid), {
      name: myName,
      joinedAt: serverTimestamp(),
    });

    // 이동
    location.href = `trip.html?trip=${encodeURIComponent(tripId)}`;
  } catch (e) {
    console.error(e);
    statusEl.textContent = `저장 실패: ${e.message || e}`;
  }
});
