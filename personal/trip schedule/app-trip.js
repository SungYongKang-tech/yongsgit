// app-trip.js
import { auth, db } from "./firebase.js";
import { uploadToCloudinary } from "./cloudinary.js";

import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";


const $ = (id) => document.getElementById(id);

window.addEventListener("error", (e) => {
  alert("에러: " + (e.message || e.error?.message || e.error || "unknown"));
});
window.addEventListener("unhandledrejection", (e) => {
  alert("Promise 에러: " + (e.reason?.message || e.reason || "unknown"));
});


// -------------------- tripId --------------------
const tripId = new URLSearchParams(location.search).get("trip");
if (!tripId) {
  alert("trip 파라미터가 없습니다. (예: trip.html?trip=XXXX)");
  location.href = "index.html";
}

// -------------------- util --------------------
function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function iso(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function addDays(baseDate, n) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + n);
  return d;
}
function safeText(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// -------------------- 기본값 --------------------
if ($("date")) $("date").value = todayISO();

// -------------------- Auth --------------------
const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (u) => u && resolve(u));
});

signInAnonymously(auth).catch((e) => {
  console.error("익명 로그인 실패:", e);
  alert(`익명 로그인 실패\ncode: ${e.code}\nmessage: ${e.message}`);
});

// -------------------- me / members --------------------
let me = { uid: null, name: "익명" };
let members = {};

// ✅ 최신 items를 id로 바로 찾기 위해 저장
let latestItemsById = {};

// ✅ 현재 미리보기로 열려있는 이미지 정보
let viewing = { itemId: null, public_id: null, url: null, name: "" };


// -------------------- view mode + cache --------------------
let viewMode = "all"; // all | today | tomorrow
let cachedItems = []; // ✅ 마지막 스냅샷 items 저장

function setViewMode(mode) {
  viewMode = mode;

  const hint = $("viewHint");
  if (hint) {
    if (mode === "today") hint.textContent = "오늘 일정만 보여줍니다.";
    else if (mode === "tomorrow") hint.textContent = "내일 일정만 보여줍니다.";
    else hint.textContent = "전체 일정을 날짜별로 묶어서 보여줍니다.";
  }

  // ✅ 버튼을 누르면 캐시로 즉시 다시 그림
  renderItems();
}

// 버튼 연결
$("viewAll")?.addEventListener("click", () => setViewMode("all"));
$("viewToday")?.addEventListener("click", () => setViewMode("today"));
$("viewTomorrow")?.addEventListener("click", () => setViewMode("tomorrow"));

// -------------------- Join --------------------
async function ensureJoined() {
  const user = await authReady;
  me.uid = user.uid;

  const myRef = doc(db, "trips", tripId, "members", me.uid);
  const mySnap = await getDoc(myRef);

  // 이미 가입돼 있으면 OK
  if (mySnap.exists()) {
    me.name = mySnap.data()?.name || "익명";
    $("joinCard").style.display = "none";
    return true;
  }

  // ✅ 자동 가입(닉네임 없으면 "익명")
  const nickInput = $("nick")?.value?.trim();
  const nickFromLS = localStorage.getItem("tripNick")?.trim();
  const nick = nickInput || nickFromLS || "익명";

  await setDoc(myRef, {
    name: nick,
    joinedAt: serverTimestamp(),
  });

  localStorage.setItem("tripNick", nick);
  me.name = nick;

  // joinCard는 굳이 안 띄워도 됨
  $("joinCard").style.display = "none";
  return true;
}


$("joinBtn")?.addEventListener("click", async () => {
  const user = await authReady;
  const nick = $("nick")?.value.trim() || "익명";

  await setDoc(doc(db, "trips", tripId, "members", user.uid), {
    name: nick,
    joinedAt: serverTimestamp(),
  });

  $("joinCard").style.display = "none";
});

// -------------------- Share --------------------
$("shareBtn")?.addEventListener("click", async () => {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    alert("공유 링크를 복사했습니다. 카톡에 붙여넣기 하시면 됩니다.");
  } catch {
    prompt("복사가 안 되면 아래 링크를 복사하세요:", url);
  }
});

// -------------------- Load trip meta --------------------
(async () => {
  const t = await getDoc(doc(db, "trips", tripId));
  if (!t.exists()) {
    alert("해당 여행방이 없습니다.");
    location.href = "index.html";
    return;
  }
  const meta = t.data()?.meta || {};
  $("tripTitle").textContent = `📌 ${meta.title || "여행"}`;
  $("tripPeriod").textContent =
    meta.startDate && meta.endDate ? `${meta.startDate} ~ ${meta.endDate}` : "";

  await ensureJoined();

  // ✅ 처음 진입 시 전체 보기로 시작(원하시면 today로 바꾸셔도 됩니다)
  setViewMode("all");
})();

// -------------------- Members subscription --------------------
onSnapshot(collection(db, "trips", tripId, "members"), (snap) => {
  members = {};
  snap.forEach((d) => (members[d.id] = d.data()));

  // 멤버명이 늦게 들어와도 화면 갱신
  renderItems();
});

// -------------------- Add item --------------------
$("addBtn")?.addEventListener("click", async () => {
  const ok = await ensureJoined();
  if (!ok) return;

  const statusEl = $("status");
  statusEl.textContent = "";

  const date = $("date").value;
  const time = $("time").value || "";
  const title = $("title").value.trim();
  const place = $("place").value.trim();
  const mapUrl = $("mapUrl").value.trim();
  const note = $("note").value.trim();
  const files = $("photos").files;

  if (!date || !title) {
    statusEl.textContent = "날짜와 제목은 필수입니다.";
    return;
  }

  let images = [];
  try {
    if (files && files.length > 0) {
      statusEl.textContent = `사진 업로드 중… (${files.length}장)`;
      for (const f of files) {
        const up = await uploadToCloudinary(f);
        images.push({
          url: up.secure_url,
          public_id: up.public_id,
          name: up.original_filename,
        });
      }
    }

    statusEl.textContent = "저장 중…";

    await addDoc(collection(db, "trips", tripId, "items"), {
      date,
      time,
      timeSort,
      title,
      place,
      mapUrl,
      note,
      images,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: me.uid,
    });

    // 입력 초기화
    $("time").value = "";
    $("title").value = "";
    $("place").value = "";
    $("mapUrl").value = "";
    $("note").value = "";
    $("photos").value = "";

    statusEl.textContent = "추가 완료";
    setTimeout(() => (statusEl.textContent = ""), 900);
  } catch (e) {
    console.error(e);
    statusEl.textContent = e.message || String(e);
  }
});

// -------------------- Edit modal --------------------
let editingId = null;
let editingItem = null;

function openModal(open) {
  $("modalBack").style.display = open ? "flex" : "none";
  if (!open) {
    $("mPhotos").value = "";
    $("mStatus").textContent = "";
  }
}

$("closeModal")?.addEventListener("click", () => openModal(false));
$("modalBack")?.addEventListener("click", (e) => {
  if (e.target === $("modalBack")) openModal(false);
});

async function openEdit(id, item) {
  const ok = await ensureJoined();
  if (!ok) return;

  editingId = id;
  editingItem = item;

  $("mDate").value = item.date || todayISO();
  $("mTime").value = item.time || "";
  $("mTitle").value = item.title || "";
  $("mPlace").value = item.place || "";
  $("mMapUrl").value = item.mapUrl || "";
  $("mNote").value = item.note || "";

  openModal(true);
}

$("saveModal")?.addEventListener("click", async () => {
  const ok = await ensureJoined();
  if (!ok) return;

  const st = $("mStatus");
  st.textContent = "";

  if (!editingId) return;

  const date = $("mDate").value;
  const time = $("mTime").value || "";
  const title = $("mTitle").value.trim();
  const place = $("mPlace").value.trim();
  const mapUrl = $("mMapUrl").value.trim();
  const note = $("mNote").value.trim();
  const files = $("mPhotos").files;

  if (!date || !title) {
    st.textContent = "날짜와 제목은 필수입니다.";
    return;
  }

  try {
    let addImages = [];
    if (files && files.length > 0) {
      st.textContent = `사진 업로드 중… (${files.length}장)`;
      for (const f of files) {
        const up = await uploadToCloudinary(f);
        addImages.push({
          url: up.secure_url,
          public_id: up.public_id,
          name: up.original_filename,
        });
      }
    }

    const nextImages = [...(editingItem?.images || []), ...addImages];

    st.textContent = "저장 중…";
    await updateDoc(doc(db, "trips", tripId, "items", editingId), {
      date,
      time,
      timesort,
      title,
      place,
      mapUrl,
      note,
      images: nextImages,
      updatedAt: serverTimestamp(),
      updatedBy: me.uid,
    });

    st.textContent = "저장 완료";
    setTimeout(() => openModal(false), 500);
  } catch (e) {
    console.error(e);
    st.textContent = e.message || String(e);
  }
});

// -------------------- List query --------------------
const q = query(
  collection(db, "trips", tripId, "items"),
  orderBy("date"),  
  orderBy("timesort")
);



// ✅ 렌더 함수: 캐시(cachedItems) + viewMode 기준으로만 그림
function renderItems() {
  const listEl = $("list");
  if (!listEl) return;

  listEl.innerHTML = "";

  if (!cachedItems.length) {
    listEl.innerHTML = `<div class="card"><p class="small">아직 일정이 없습니다. 위에서 추가해 주세요.</p></div>`;
    return;
  }

  const today = iso(new Date());
  const tomorrow = iso(addDays(new Date(), 1));

  // 보기모드 필터
  let items = [...cachedItems];
  if (viewMode === "today") items = items.filter((it) => it.date === today);
  if (viewMode === "tomorrow") items = items.filter((it) => it.date === tomorrow);

  if (!items.length) {
    listEl.innerHTML = `<div class="card"><p class="small">해당 보기 모드에 일정이 없습니다.</p></div>`;
    return;
  }

  // 날짜별 그룹화
  const groups = {};
  for (const it of items) {
    const key = it.date || "미정";
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  }

  Object.keys(groups)
    .sort()
    .forEach((dateKey) => {
      const wrap = document.createElement("div");
      wrap.className = "card";
      wrap.innerHTML = `<h2>📅 ${safeText(dateKey)}</h2><div class="list"></div>`;
      listEl.appendChild(wrap);

      const g = wrap.querySelector(".list");
      groups[dateKey].sort((a, b) => (a.time || "").localeCompare(b.time || ""));

      for (const it of groups[dateKey]) {
        const who = members?.[it.updatedBy]?.name || "누군가";
        const map = it.mapUrl
          ? `<a href="${safeText(it.mapUrl)}" target="_blank" rel="noopener">지도</a>`
          : "";
        const imgs = (it.images || [])
  .map((img) => `
    <button class="thumb" type="button"
      data-act="viewimg"
      data-itemid="${safeText(it.id)}"
      data-url="${safeText(img.url)}"
      data-pid="${safeText(img.public_id || "")}"
      data-name="${safeText(img.name || "")}">
      <img src="${safeText(img.url)}" alt="photo">
    </button>
  `)
  .join("");


        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `
          <div class="item-title">${it.time ? `⏰ ${safeText(it.time)}  ` : ""}${safeText(it.title)}</div>
          <div class="meta">
            ${it.place ? `<span>📍 ${safeText(it.place)}</span>` : ""}
            ${map ? `<span>${map}</span>` : ""}
          </div>
          ${it.note ? `<div class="small" style="margin-top:8px">${safeText(it.note)}</div>` : ""}
          ${imgs ? `<div class="grid-img">${imgs}</div>` : ""}
          <div class="actions">
            <div class="chip" data-act="edit">수정</div>
            <div class="chip" data-act="del">삭제</div>
            
          </div>
        `;

        el.querySelector('[data-act="edit"]').addEventListener("click", () => openEdit(it.id, it));
        el.querySelector('[data-act="del"]').addEventListener("click", async () => {
          if (!confirm("이 일정을 삭제할까요?")) return;
          await deleteDoc(doc(db, "trips", tripId, "items", it.id));
        });

        g.appendChild(el);
      }
    });
     

}

$("list")?.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-act="viewimg"]');
  if (!btn) return;

  const ok = await ensureJoined(); // 수정/삭제까지 있으니 통일
  if (!ok) return;

  openImgViewer({
    itemId: btn.getAttribute("data-itemid"),
    url: btn.getAttribute("data-url"),
    public_id: btn.getAttribute("data-pid"),
    name: btn.getAttribute("data-name"),
  });
});


// ✅ onSnapshot은 캐시만 갱신하고 renderItems만 호출
onSnapshot(
  q,
  (snap) => {
    cachedItems = [];
    latestItemsById = {};

    snap.forEach((d) => {
      const it = { id: d.id, ...d.data() };
      cachedItems.push(it);
      latestItemsById[it.id] = it;
    });

    renderItems();
  },
  (err) => {
    console.error("items onSnapshot error:", err);
    const listEl = $("list");
    if (listEl) {
      listEl.innerHTML = `
        <div class="card">
          <h2>일정 불러오기 오류</h2>
          <p class="small">${safeText(err.code || "")} ${safeText(err.message || String(err))}</p>
        </div>
      `;
    }
    alert(`일정 불러오기 오류\n${err.code || ""}\n${err.message || err}`);
  }
);


function openImgViewer({ itemId, url, public_id, name }) {
  viewing = { itemId, url, public_id, name };

  $("imgView").src = url;
  $("imgInfo").textContent = name ? `파일명: ${name}` : "";
  $("imgMsg").textContent = "";
  $("imgBack").style.display = "flex";
}

function closeImgViewer() {
  $("imgBack").style.display = "none";
  $("imgView").src = "";
  $("imgMsg").textContent = "";
  viewing = { itemId: null, public_id: null, url: null, name: "" };
}

$("imgClose")?.addEventListener("click", closeImgViewer);
$("imgBack")?.addEventListener("click", (e) => {
  if (e.target === $("imgBack")) closeImgViewer();
});

$("imgDelete")?.addEventListener("click", async () => {
  if (!viewing.itemId || !viewing.url) return;

  const ok = confirm("이 사진을 이 일정에서 삭제할까요?");
  if (!ok) return;

  try {
    const item = latestItemsById[viewing.itemId];
    if (!item) {
      $("imgMsg").textContent = "일정 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.";
      return;
    }

    const nextImages = (item.images || []).filter((img) => img.url !== viewing.url);

    $("imgMsg").textContent = "삭제 중…";

    await updateDoc(doc(db, "trips", tripId, "items", viewing.itemId), {
      images: nextImages,
      updatedAt: serverTimestamp(),
      updatedBy: me.uid,
    });

    $("imgMsg").textContent = "삭제 완료";
    setTimeout(() => closeImgViewer(), 300);
  } catch (e) {
    console.error(e);
    $("imgMsg").textContent = e.message || String(e);
  }
});
