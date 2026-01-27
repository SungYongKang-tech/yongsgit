// app-index.js (공용 여행 목록 + ID 표시 + 삭제 버튼)
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
  deleteDoc, // ✅ 추가
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
// ✅ 공용 여행 목록 + ID 표시 + 삭제 버튼
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

        const tripId = d.id;

        const card = document.createElement("div");
        card.className = "item";
        card.innerHTML = `
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="meta">
            ${period ? `<span>📅 ${escapeHtml(period)}</span>` : ""}
            <span class="small" style="display:block; margin-top:4px; opacity:.75;">
              ID: ${escapeHtml(tripId)}
            </span>
          </div>
          <div class="actions">
            <a class="chip" href="trip.html?trip=${encodeURIComponent(tripId)}">열기</a>
            <div class="chip" data-copy="${escapeHtml(tripId)}">링크 복사</div>
            <div class="chip" data-del="${escapeHtml(tripId)}">삭제</div>
          </div>
        `;

        // 링크 복사
        card.querySelector("[data-copy]")?.addEventListener("click", async () => {
          const base = location.origin + location.pathname.replace(/index\.html?$/i, "");
          const url = `${base}trip.html?trip=${encodeURIComponent(tripId)}`;
          try {
            await navigator.clipboard.writeText(url);
            alert("여행 링크를 복사했습니다. 카톡에 붙여넣기 하시면 됩니다.");
          } catch {
            prompt("복사가 안 되면 아래 링크를 복사하세요:", url);
          }
        });

        // ✅ 삭제(트립 문서만 삭제)
        card.querySelector("[data-del]")?.addEventListener("click", async () => {
          const ok = confirm(
            `이 여행을 삭제할까요?\n\n- trips/${tripId} 문서만 삭제됩니다.\n- items, members는 콘솔에서 별도로 지우셔야 완전 삭제됩니다.`
          );
          if (!ok) return;

          try {
            await deleteDoc(doc(db, "trips", tripId));
            alert("삭제했습니다. (하위 items/members는 콘솔에서 추가 삭제 필요)");
          } catch (e) {
            console.error(e);
            alert(`삭제 실패: ${e.code || ""}\n${e.message || e}`);
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

    location.href = `trip.html?trip=${encodeURIComponent(tripId)}`;
  } catch (e) {
    console.error(e);
    statusEl.textContent = `저장 실패: ${e.message || e}`;
  }
});
