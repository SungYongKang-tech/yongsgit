// app-trip.js
import { auth, db } from "./firebase.js";
import { uploadToCloudinary } from "./cloudinary.js";

import {
  signInAnonymously,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
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

// trip meta 캐시(제목/기간 표 상단에 쓰기)
let tripMetaCache = { title: "여행", startDate: "", endDate: "" };

// ✅ 에러 핸들러 (중복 제거 + 너무 자주 alert 뜨는 것 방지)
let _lastAlertAt = 0;
function safeAlert(msg) {
  const now = Date.now();
  if (now - _lastAlertAt < 800) return;
  _lastAlertAt = now;
  alert(msg);
}
window.addEventListener("error", (e) => {
  safeAlert("에러: " + (e.message || e.error?.message || e.error || "unknown"));
});
window.addEventListener("unhandledrejection", (e) => {
  safeAlert("Promise 에러: " + (e.reason?.message || e.reason || "unknown"));
});

// -------------------- tripId --------------------
const tripId = new URLSearchParams(location.search).get("trip");

if (!tripId) {
  alert("여행 정보가 없는 주소입니다.\n카카오톡 공지에 등록된 원래 링크를 다시 확인해 주세요.");
  location.replace("index.html");
  throw new Error("trip 파라미터 없음");
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
function formatDateShort(dateStr) {
  // "2026-01-25" → "26.01.25"
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || "";
  const [y, m, d] = dateStr.split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

function getWeekdayKor(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "";

  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return weekdays[date.getDay()];
}

function formatDateWithWeekday(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr || "";
  }

  return `${dateStr} (${getWeekdayKor(dateStr)})`;
}

function formatDateShortWithWeekday(dateStr) {
  if (!dateStr) return "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return String(dateStr);
  }

  return `${formatDateShort(dateStr)} (${getWeekdayKor(dateStr)})`;
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

// ✅ timeSort 만들기: 시간이 없으면 항상 뒤로 가게 "99:99"
function makeTimeSort(timeStr) {
  const t = (timeStr || "").trim();
  // HH:MM 정상 형식이면 그대로, 아니면 뒤로
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  return "99:99";
}

// -------------------- 기본값 --------------------
if ($("date")) $("date").value = todayISO();

// -------------------- Auth --------------------
const authReady = (async () => {
  try {
    // 브라우저를 닫았다 열어도 가능한 범위에서 익명 로그인 유지
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    // 카카오톡 내부 브라우저에서 local persistence가 제한될 수 있음
    console.warn("로그인 유지 설정 실패, 현재 세션으로 계속 진행:", e);
  }

  // Firebase가 기존 로그인 상태를 확인할 때까지 기다림
  const currentUser = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user || null);
    });
  });

  if (currentUser) {
    return currentUser;
  }

  // 카카오톡 내부 브라우저에서 새 익명 사용자 생성
  const credential = await signInAnonymously(auth);
  return credential.user;
})().catch((e) => {
  console.error("익명 로그인 실패:", e);

  alert(
    `익명 로그인에 실패했습니다.\n\n` +
    `${e.code || ""}\n${e.message || e}\n\n` +
    `카카오톡 오른쪽 위 메뉴에서 '다른 브라우저로 열기'를 눌러 주세요.`
  );

  throw e;
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
let cachedItems = []; // 마지막 스냅샷 items 저장

function setViewMode(mode) {
  viewMode = mode;

  const hint = $("viewHint");
  if (hint) {
    if (mode === "today") hint.textContent = "오늘 일정만 보여줍니다.";
    else if (mode === "tomorrow") hint.textContent = "내일 일정만 보여줍니다.";
    else hint.textContent = "전체 일정을 날짜별로 묶어서 보여줍니다.";
  }
  renderItems();
}

$("viewAll")?.addEventListener("click", () => setViewMode("all"));
$("viewToday")?.addEventListener("click", () => setViewMode("today"));
$("viewTomorrow")?.addEventListener("click", () => setViewMode("tomorrow"));

// -------------------- Join --------------------
async function ensureJoined() {
  const user = await authReady;
  me.uid = user.uid;

  const myRef = doc(db, "trips", tripId, "members", me.uid);
  const mySnap = await getDoc(myRef);

  if (mySnap.exists()) {
    me.name = mySnap.data()?.name || "익명";
    $("joinCard") && ($("joinCard").style.display = "none");
    return true;
  }

  const nickInput = $("nick")?.value?.trim();
  const nickFromLS = localStorage.getItem("tripNick")?.trim();
  const nick = nickInput || nickFromLS || "익명";

  await setDoc(myRef, { name: nick, joinedAt: serverTimestamp() });
  localStorage.setItem("tripNick", nick);
  me.name = nick;

  $("joinCard") && ($("joinCard").style.display = "none");
  return true;
}

$("joinBtn")?.addEventListener("click", async () => {
  const user = await authReady;
  const nick = $("nick")?.value.trim() || "익명";

  await setDoc(doc(db, "trips", tripId, "members", user.uid), {
    name: nick,
    joinedAt: serverTimestamp(),
  });

  me.uid = user.uid;
  me.name = nick;

  localStorage.setItem("tripNick", nick);

  if ($("joinCard")) {
    $("joinCard").style.display = "none";
  }

  if ($("joinStatus")) {
    $("joinStatus").textContent = "참여했습니다.";
  }
});

// -------------------- Share --------------------
$("shareBtn")?.addEventListener("click", async () => {
  const url = location.href;

  try {
    await navigator.clipboard.writeText(url);
    alert("여행 링크를 복사했습니다.\n카카오톡에 붙여넣기 하세요.");
  } catch {
    prompt("아래 링크를 복사하세요.", url);
  }
});

// -------------------- Load trip meta --------------------
async function loadTripMeta() {
  // 반드시 익명 로그인이 완료된 후 Firestore 접근
  await authReady;

  const tripRef = doc(db, "trips", tripId);
  const tripSnap = await getDoc(tripRef);

  if (!tripSnap.exists()) {
    alert("생성된 여행의 열기버튼을 눌러주세요");
    location.replace("index.html");
    return false;
  }

  const meta = tripSnap.data()?.meta || {};

  tripMetaCache = {
    title: meta.title || "여행",
    startDate: meta.startDate || "",
    endDate: meta.endDate || "",
  };

  if ($("tripTitle")) {
    $("tripTitle").textContent = `📌 ${tripMetaCache.title}`;
  }

  if ($("tripPeriod")) {
    $("tripPeriod").textContent =
      tripMetaCache.startDate && tripMetaCache.endDate
        ? `${tripMetaCache.startDate} ~ ${tripMetaCache.endDate}`
        : "";
  }

  await ensureJoined();
  setViewMode("all");

  return true;
}

// -------------------- Members subscription --------------------
let unsubscribeMembers = null;

function startMembersListener() {
  if (unsubscribeMembers) {
    unsubscribeMembers();
  }

  unsubscribeMembers = onSnapshot(
    collection(db, "trips", tripId, "members"),
    (snap) => {
      members = {};
      snap.forEach((d) => {
        members[d.id] = d.data();
      });
      renderItems();
    },
    (err) => {
      console.error("members onSnapshot error:", err);
    }
  );
}

// -------------------- Add item --------------------
$("addBtn")?.addEventListener("click", async () => {
  const ok = await ensureJoined();
  if (!ok) return;

  const statusEl = $("status");
  statusEl.textContent = "";

  const date = $("date").value;

  // ✅ A안: 시작/끝 시간 2개
  const timeStart = $("timeStart")?.value || "";
  const timeEnd   = $("timeEnd")?.value || "";

  // ✅ 정렬용 timeSort: 시작시간이 있으면 시작시간, 없으면 99:99
  const timeSort = (timeStart && /^\d{2}:\d{2}$/.test(timeStart)) ? timeStart : "99:99";

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
      // ✅ 저장 필드
      timeStart,
      timeEnd,
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
    $("timeStart") && ($("timeStart").value = "");
    $("timeEnd") && ($("timeEnd").value = "");
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
  $("modalBack") && ($("modalBack").style.display = open ? "flex" : "none");
  if (!open) {
    $("mPhotos") && ($("mPhotos").value = "");
    $("mStatus") && ($("mStatus").textContent = "");
  }
}
function bindModalKeyboardScroll() {
  const modal = $("modalBack");
  if (!modal) return;

  modal.querySelectorAll("input, textarea, select").forEach((el) => {
    el.addEventListener("focus", () => {
      setTimeout(() => {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 300);
    });
  });
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

  // ✅ A안: 시작/끝 시간
  $("mTimeStart") && ($("mTimeStart").value = item.timeStart || "");
  $("mTimeEnd") && ($("mTimeEnd").value = item.timeEnd || "");

  $("mTitle").value = item.title || "";
  $("mPlace").value = item.place || "";
  $("mMapUrl").value = item.mapUrl || "";
  $("mNote").value = item.note || "";

  openModal(true);
bindModalKeyboardScroll();

setTimeout(() => {
  $("mTitle")?.focus();
}, 200);
}

$("saveModal")?.addEventListener("click", async () => {
  const ok = await ensureJoined();
  if (!ok) return;

  const st = $("mStatus");
  st.textContent = "";

  if (!editingId) return;

  const date = $("mDate").value;

  // ✅ A안: 시작/끝 시간
  const timeStart = $("mTimeStart")?.value || "";
  const timeEnd   = $("mTimeEnd")?.value || "";

  const timeSort = (timeStart && /^\d{2}:\d{2}$/.test(timeStart)) ? timeStart : "99:99";

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
      timeStart,
      timeEnd,
      timeSort,

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


// -------------------- List query + onSnapshot (인덱스 없으면 자동 폴백) --------------------
let unsubscribeItems = null;

function startItemsListener() {
  // 1) ✅ 우선 (date + timeSort) 복합 정렬 시도
  const q1 = query(
    collection(db, "trips", tripId, "items"),
    orderBy("date"),
    orderBy("timeSort")
  );

  // 2) ✅ 폴백: 인덱스 없을 때는 date만 (화면에서 timeSort로 정렬)
  const q2 = query(collection(db, "trips", tripId, "items"), orderBy("date"));

  const attach = (qToUse, usedName) => {
    if (unsubscribeItems) unsubscribeItems();
    unsubscribeItems = onSnapshot(
      qToUse,
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
      // startItemsListener() 안의 onSnapshot 에러 핸들러 부분만 교체

(err) => {
  // ✅ q1에서 인덱스 없을 때는 "정상적인 폴백 경로"라서 error로 찍지 않음
  if (usedName === "q1" && err?.code === "failed-precondition") {
    console.warn("Composite index missing → fallback to q2 (orderBy date only)");
    attach(q2, "q2");
    return;
  }

  // ✅ 그 외 진짜 에러만 error 처리
  console.error(`items onSnapshot error (${usedName}):`, err);

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
  };

  attach(q1, "q1");
}

// -------------------- Page initialize --------------------
async function initializeTripPage() {
  try {
    const loaded = await loadTripMeta();
    if (!loaded) return;

    // 로그인과 여행방 확인이 모두 끝난 뒤 실시간 구독 시작
    startMembersListener();
    startItemsListener();
  } catch (e) {
    console.error("여행 페이지 초기화 실패:", e);

    const message = e?.message || String(e);

    const listEl = $("list");
    if (listEl) {
      listEl.innerHTML = `
        <div class="card">
          <h2>여행 일정을 불러오지 못했습니다.</h2>
          <p class="small">${safeText(message)}</p>
          <p class="small">
            카카오톡 오른쪽 위 메뉴에서 ‘다른 브라우저로 열기’를 눌러 다시 접속해 주세요.
          </p>
        </div>
      `;
    }
  }
}

initializeTripPage();

// -------------------- Render --------------------
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
      wrap.innerHTML = `
  <h2>📅 ${safeText(formatDateWithWeekday(dateKey))}</h2>
  <div class="list"></div>
`;
      listEl.appendChild(wrap);

      const g = wrap.querySelector(".list");

      // ✅ 화면에서 timeSort 기준 정렬 (폴백 쿼리여도 정상)
      groups[dateKey].sort((a, b) => {
        const at = a.timeSort || makeTimeSort(a.timeStart);
        const bt = b.timeSort || makeTimeSort(b.timeStart);
        return String(at).localeCompare(String(bt));
      });

      for (const it of groups[dateKey]) {
        // ✅ A안 시간 표시 문자열 만들기
const timeLabel =
  it.timeStart && it.timeEnd ? `${it.timeStart}~${it.timeEnd}`
  : it.timeStart ? it.timeStart
  : "";

        const map = it.mapUrl
          ? `<a href="${safeText(it.mapUrl)}" target="_blank" rel="noopener">지도</a>`
          : "";

        const imgs = (it.images || [])
          .map(
            (img) => `
              <button class="thumb" type="button"
                data-act="viewimg"
                data-itemid="${safeText(it.id)}"
                data-url="${safeText(img.url)}"
                data-pid="${safeText(img.public_id || "")}"
                data-name="${safeText(img.name || "")}">
                <img src="${safeText(img.url)}" alt="photo">
              </button>
            `
          )
          .join("");

        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `
          <div class="item-title">
  ${timeLabel ? `⏰ ${safeText(timeLabel)}  ` : ""}${safeText(it.title)}
</div>

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

// ======================================================
// ✅ 표로 보기 (여행 제목 + 전체 일정표)
// ======================================================



// Load trip meta 부분에서 meta를 캐시에 저장하도록 2줄만 추가하세요.
// (기존 코드에서 meta 읽는 부분 바로 아래에 추가)
/// tripMetaCache = { title: meta.title || "여행", startDate: meta.startDate || "", endDate: meta.endDate || "" };
function openTableModal() {
  const back = $("tableBack");
  const tableEl = $("tableEl");
  const tableCards = $("tableCards");
  const tableMsg = $("tableMsg");

  if (!back) {
    alert("표 모달 영역을 찾을 수 없습니다.");
    return;
  }

  // ✅ 모달 먼저 열기
  back.style.setProperty("display", "flex", "important");
  document.body.style.overflow = "hidden";

  const title = tripMetaCache.title || "여행";

  const period =
    tripMetaCache.startDate && tripMetaCache.endDate
      ? `${tripMetaCache.startDate} ~ ${tripMetaCache.endDate}`
      : "";

  if ($("tableTitle")) {
    $("tableTitle").textContent = `📌 ${title} - 전체 일정표`;
  }

  if ($("tableSub")) {
    $("tableSub").textContent = period ? `기간: ${period}` : "";
  }

  try {
    const items = buildTableItemsForCurrentView();

    console.log("표로 보기 일정 수:", items.length, items);

    // ✅ 화면 너비로 휴대폰 판단
    const mobile = window.innerWidth <= 768;

    if (mobile) {
      if (tableEl) {
        tableEl.style.setProperty("display", "none", "important");
      }

      if (!tableCards) {
        throw new Error("tableCards 영역이 없습니다.");
      }

      // ✅ CSS보다 우선하도록 important 적용
      tableCards.style.setProperty("display", "block", "important");
      tableCards.style.setProperty("visibility", "visible", "important");
      tableCards.style.setProperty("opacity", "1", "important");
      tableCards.style.setProperty("width", "100%", "important");
      tableCards.style.setProperty("min-height", "100px", "important");

      renderCards(items);
    } else {
      if (tableCards) {
        tableCards.style.setProperty("display", "none", "important");
      }

      if (!tableEl) {
        throw new Error("tableEl 영역이 없습니다.");
      }

      tableEl.style.setProperty("display", "table", "important");
      renderTable(items);
    }

    if (tableMsg) {
      tableMsg.textContent = items.length
        ? `총 ${items.length}개 일정`
        : "표시할 일정이 없습니다.";
    }
  } catch (e) {
    console.error("표 렌더링 오류:", e);

    if (tableMsg) {
      tableMsg.textContent = `표시 오류: ${e.message || e}`;
    }

    alert(`표시 오류\n${e.message || e}`);
  }
}

function closeTableModal() {
  const back = $("tableBack");

  if (!back) return;

  back.style.setProperty("display", "none", "important");
  document.body.style.overflow = "";

  if ($("tableEl")) {
    $("tableEl").innerHTML = "";
  }

  if ($("tableCards")) {
    $("tableCards").innerHTML = "";
  }

  if ($("tableMsg")) {
    $("tableMsg").textContent = "";
  }
}

function formatTimeLabel(it) {
  const s = (it.timeStart || "").trim();
  const e = (it.timeEnd || "").trim();
  if (s && e) return `${s}~${e}`;
  if (s) return s;
  return ""; // 시간 없을 수도 있음
}

function renderTable(items) {
  const table = $("tableEl");
  if (!table) return;

 
  // 헤더
  table.innerHTML = `
    <thead>
      <tr style="background:#fafafa;">
        <th style="text-align:left; padding:10px; border-bottom:1px solid #eee;">날짜</th>
        <th style="text-align:left; padding:10px; border-bottom:1px solid #eee;">시간</th>
        <th style="text-align:left; padding:10px; border-bottom:1px solid #eee;">제목</th>
        <th style="text-align:left; padding:10px; border-bottom:1px solid #eee;">장소</th>
        <th style="text-align:left; padding:10px; border-bottom:1px solid #eee;">지도</th>
        <th style="text-align:left; padding:10px; border-bottom:1px solid #eee;">메모</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="padding:12px; color:#666;">표시할 일정이 없습니다.</td>
      </tr>
    `;
    return;
  }

  // 바디
  for (const it of items) {
    const date = formatDateShortWithWeekday(it.date);

    const time = formatTimeLabel(it);
    const title = it.title || "";
    const place = it.place || "";
    const note = it.note || "";
    const mapUrl = it.mapUrl || "";

    const mapCell = mapUrl
      ? `<a href="${safeText(mapUrl)}" target="_blank" rel="noopener">열기</a>`
      : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:10px; border-bottom:1px solid #f0f0f0; white-space:nowrap;">${safeText(date)}</td>
      <td style="padding:10px; border-bottom:1px solid #f0f0f0; white-space:nowrap;">${safeText(time)}</td>
      <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${safeText(title)}</td>
      <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${safeText(place)}</td>
      <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${mapCell}</td>
      <td style="padding:10px; border-bottom:1px solid #f0f0f0;">${safeText(note)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
}

function renderCards(items) {
  const wrap = $("tableCards");

  if (!wrap) {
    throw new Error("휴대폰 카드 영역(tableCards)을 찾을 수 없습니다.");
  }

  wrap.innerHTML = "";

  wrap.style.setProperty("display", "block", "important");
  wrap.style.setProperty("visibility", "visible", "important");
  wrap.style.setProperty("opacity", "1", "important");
  wrap.style.setProperty("width", "100%", "important");
  wrap.style.setProperty("min-height", "100px", "important");
  wrap.style.setProperty("box-sizing", "border-box", "important");

  if (!Array.isArray(items) || items.length === 0) {
    wrap.innerHTML = `
      <div style="
        display:block;
        padding:20px;
        background:#f8fafc;
        border:1px solid #e5e7eb;
        border-radius:12px;
        color:#666;
      ">
        표시할 일정이 없습니다.
      </div>
    `;
    return;
  }

  for (const it of items) {
    const date = formatDateShortWithWeekday(it.date);
    const time = formatTimeLabel(it);
    const title = it.title || "제목 없음";
    const place = it.place || "";
    const note = it.note || "";
    const mapUrl = it.mapUrl || "";

    const card = document.createElement("div");

    card.style.cssText = `
      display:block;
      width:100%;
      max-width:100%;
      box-sizing:border-box;
      background:#ffffff;
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:14px;
      margin:0 0 10px 0;
      overflow:hidden;
      color:#111827;
    `;

    card.innerHTML = `
      <div style="
        display:block;
        margin-bottom:9px;
        font-size:17px;
        line-height:1.4;
        font-weight:800;
        color:#111827;
        overflow-wrap:anywhere;
      ">
        ${safeText(title)}
      </div>

      <div style="
        display:block;
        font-size:14px;
        line-height:1.7;
        color:#374151;
        overflow-wrap:anywhere;
      ">
        ${
          date
            ? `<div>📅 <strong>${safeText(date)}</strong></div>`
            : ""
        }

        ${
          time
            ? `<div>⏰ ${safeText(time)}</div>`
            : ""
        }

        ${
          place
            ? `<div>📍 ${safeText(place)}</div>`
            : ""
        }

        ${
          mapUrl
            ? `
              <div>
                🗺️
                <a
                  href="${safeText(mapUrl)}"
                  target="_blank"
                  rel="noopener"
                >
                  지도 열기
                </a>
              </div>
            `
            : ""
        }

        ${
          note
            ? `
              <div style="
                margin-top:6px;
                white-space:pre-wrap;
                overflow-wrap:anywhere;
              ">
                📝 ${safeText(note)}
              </div>
            `
            : ""
        }
      </div>
    `;

    wrap.appendChild(card);
  }
}

// ✅ 표 복사(엑셀/구글시트/카톡 메모 등에 붙여넣기 쉬운 TSV)
async function copyTableAsTSV() {
  const items = buildTableItemsForCurrentView();

  const header = ["날짜", "시간", "제목", "장소", "지도", "메모"];
  const rows = items.map((it) => [
  formatDateWithWeekday(it.date),
    formatTimeLabel(it),
    it.title || "",
    it.place || "",
    it.mapUrl || "",
    (it.note || "").replace(/\s+/g, " ").trim(),
  ]);

  const tsv = [header, ...rows].map((r) => r.join("\t")).join("\n");

  try {
    await navigator.clipboard.writeText(tsv);
    $("tableMsg") && ($("tableMsg").textContent = "표를 복사했습니다. (엑셀/시트에 붙여넣기 가능)");
  } catch {
    $("tableMsg") && ($("tableMsg").textContent = "복사에 실패했습니다. 브라우저 권한을 확인해 주세요.");
  }
}


// 버튼 연결
$("openTable")?.addEventListener("click", openTableModal);
$("closeTable")?.addEventListener("click", closeTableModal);
$("copyTable")?.addEventListener("click", copyTableAsTSV);

// 모달 바깥 클릭 닫기
$("tableBack")?.addEventListener("click", (e) => {
  if (e.target === $("tableBack")) closeTableModal();
});


// ✅ 썸네일 클릭(이벤트 위임)
$("list")?.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-act="viewimg"]');
  if (!btn) return;

  const ok = await ensureJoined();
  if (!ok) return;

  openImgViewer({
    itemId: btn.getAttribute("data-itemid"),
    url: btn.getAttribute("data-url"),
    public_id: btn.getAttribute("data-pid"),
    name: btn.getAttribute("data-name"),
  });
});

// -------------------- Image viewer --------------------
function openImgViewer({ itemId, url, public_id, name }) {
  viewing = { itemId, url, public_id, name };

  $("imgView") && ($("imgView").src = url);
  $("imgInfo") && ($("imgInfo").textContent = name ? `파일명: ${name}` : "");
  $("imgMsg") && ($("imgMsg").textContent = "");
  $("imgBack") && ($("imgBack").style.display = "flex");
}

function closeImgViewer() {
  $("imgBack") && ($("imgBack").style.display = "none");
  $("imgView") && ($("imgView").src = "");
  $("imgMsg") && ($("imgMsg").textContent = "");
  viewing = { itemId: null, public_id: null, url: null, name: "" };
}

$("imgClose")?.addEventListener("click", closeImgViewer);
$("imgBack")?.addEventListener("click", (e) => {
  if (e.target === $("imgBack")) closeImgViewer();
});

// ✅ 사진 “일정에서만” 삭제(Cloudinary 완전 삭제는 다음 단계에서)
$("imgDelete")?.addEventListener("click", async () => {
  if (!viewing.itemId || !viewing.url) return;

  if (!confirm("이 사진을 이 일정에서 삭제할까요?")) return;

  try {
    const item = latestItemsById[viewing.itemId];
    if (!item) {
      $("imgMsg") && ($("imgMsg").textContent = "일정 정보를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }

    const nextImages = (item.images || []).filter((img) => img.url !== viewing.url);

    $("imgMsg") && ($("imgMsg").textContent = "삭제 중…");

    await updateDoc(doc(db, "trips", tripId, "items", viewing.itemId), {
      images: nextImages,
      updatedAt: serverTimestamp(),
      updatedBy: me.uid,
    });

    $("imgMsg") && ($("imgMsg").textContent = "삭제 완료");
    setTimeout(() => closeImgViewer(), 300);
  } catch (e) {
    console.error(e);
    $("imgMsg") && ($("imgMsg").textContent = e.message || String(e));
  }
});

function csvEscape(v) {
  const s = (v ?? "").toString();
  // CSV 규칙: 쉼표/따옴표/줄바꿈 있으면 "로 감싸고 내부 "는 ""로
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function downloadTextFile(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildTableItemsForCurrentView() {
  const today = iso(new Date());
  const tomorrow = iso(addDays(new Date(), 1));

  let items = [...cachedItems];
  if (viewMode === "today") items = items.filter((it) => it.date === today);
  if (viewMode === "tomorrow") items = items.filter((it) => it.date === tomorrow);

  items.sort((a, b) => {
    const ad = a.date || "";
    const bd = b.date || "";
    if (ad !== bd) return ad.localeCompare(bd);

    const at = a.timeSort || makeTimeSort(a.timeStart);
    const bt = b.timeSort || makeTimeSort(b.timeStart);
    return String(at).localeCompare(String(bt));
  });

  return items;
}

function downloadTableCSV() {
  // ✅ xlsx 라이브러리 확인
  if (!window.XLSX) {
    alert("엑셀 다운로드 모듈(XLSX)을 불러오지 못했습니다. trip.html에 xlsx 스크립트를 추가했는지 확인하세요.");
    return;
  }

  const items = buildTableItemsForCurrentView();

const fmtDate = (s) => {
  if (!s) return "";

  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(s);

  return `${m[1].slice(2)}.${m[2]}.${m[3]} (${getWeekdayKor(s)})`;
};

  const clean = (v) =>
    (v ?? "")
      .toString()
      .replace(/\r?\n/g, " ")
      .replace(/\t/g, " ")
      .trim();

  const title = (tripMetaCache.title || "여행").replace(/[\\/:*?"<>|]/g, "_");
  const filename = `${title}_일정표.xlsx`;

  // ✅ 첫 줄에 여행 제목(표 맨 위)
  const period =
    tripMetaCache.startDate && tripMetaCache.endDate
      ? `${tripMetaCache.startDate} ~ ${tripMetaCache.endDate}`
      : "";

  const aoa = [];
  aoa.push([`📌 ${tripMetaCache.title || "여행"} - 전체 일정표`]); // 1행
  if (period) aoa.push([`기간: ${period}`]);                      // 2행(옵션)
  aoa.push([]);                                                   // 한 줄 띄우기

  // 헤더
  aoa.push(["날짜", "시간", "제목", "장소", "지도URL", "메모"]);

  // 데이터(✅ 사진 제외)
  for (const it of items) {
    aoa.push([
      fmtDate(it.date || ""),
      clean(formatTimeLabel(it)),
      clean(it.title || ""),
      clean(it.place || ""),
      clean(it.mapUrl || ""),
      clean(it.note || ""),
    ]);
  }

  // ✅ 시트 생성
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);

  // ✅ 보기 좋게: 열 너비 지정(대략)
  ws["!cols"] = [
    { wch: 10 }, // 날짜
    { wch: 12 }, // 시간
    { wch: 28 }, // 제목
    { wch: 22 }, // 장소
    { wch: 35 }, // 지도URL
    { wch: 40 }, // 메모
  ];

  // ✅ 제목행 병합 (A1~F1)
  ws["!merges"] = ws["!merges"] || [];
  ws["!merges"].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } });
  if (period) ws["!merges"].push({ s: { r: 1, c: 0 }, e: { r: 1, c: 5 } });

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "일정표");

  // ✅ 파일 저장
  window.XLSX.writeFile(wb, filename);

  $("tableMsg") && ($("tableMsg").textContent = "엑셀(.xlsx)로 다운로드했습니다. (한글/모바일 OK)");
}

function fmtDateYY(s) {
  if (!s) return "";

  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(s);

  return `${m[1].slice(2)}.${m[2]}.${m[3]} (${getWeekdayKor(s)})`;
}

function buildPrintTableHTML_MultiPage(items) {
  items = [...items].sort((a, b) => {
    const ad = a.date || "";
    const bd = b.date || "";
    if (ad !== bd) return ad.localeCompare(bd);
    const at = a.timeSort || makeTimeSort(a.timeStart);
    const bt = b.timeSort || makeTimeSort(b.timeStart);
    return String(at).localeCompare(String(bt));
  });

  const title = tripMetaCache.title || "여행";
  const period =
    tripMetaCache.startDate && tripMetaCache.endDate
      ? `${tripMetaCache.startDate} ~ ${tripMetaCache.endDate}`
      : "";

  const rows = items.map((it) => {
    const date = fmtDateYY(it.date || "");
    const time = formatTimeLabel(it);
    const t = it.title || "";
    const place = it.place || "";
    const map = it.mapUrl || "";
    const note = (it.note || "").replace(/\r?\n/g, " ");

    return `
      <tr>
        <td class="date">${safeText(date)}</td>
        <td class="time">${safeText(time)}</td>
        <td class="title">${safeText(t)}</td>
        <td class="place">${safeText(place)}</td>
        <td class="map">${safeText(map)}</td>
        <td class="memo">${safeText(note)}</td>
      </tr>
    `;
  }).join("");

  return `
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>${safeText(title)}_일정표</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    html, body { margin:0; padding:0; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }

    h1 { margin: 0 0 6px 0; font-size: 18px; }
    .sub { margin: 0 0 10px 0; color:#555; font-size: 12px; }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #ddd; padding: 6px; font-size: 11px; vertical-align: top; }
    th { background: #f3f3f3; text-align: left; }

    thead { display: table-header-group; } /* ✅ 페이지마다 헤더 반복 */
    tr { page-break-inside: avoid; break-inside: avoid; }

    .date  { width: 78px;  white-space: nowrap; }
    .time  { width: 86px;  white-space: nowrap; }
    .title { width: 260px; }
    .place { width: 160px; }
    .map   { width: 210px; word-break: break-all; }
    .memo  { width: auto; }
  </style>
</head>
<body>
  <h1>📌 ${safeText(title)} - 전체 일정표</h1>
  ${period ? `<div class="sub">기간: ${safeText(period)}</div>` : ``}

  <table>
    <thead>
      <tr>
        <th class="date">날짜</th>
        <th class="time">시간</th>
        <th class="title">제목</th>
        <th class="place">장소</th>
        <th class="map">지도URL</th>
        <th class="memo">메모</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="6">표시할 일정이 없습니다.</td></tr>`}
    </tbody>
  </table>

  <script>
    setTimeout(() => window.print(), 200);
  </script>
</body>
</html>
  `;
}

function downloadPdfMultiPage() {
  const items = buildTableItemsForCurrentView(); // ✅ 이미 만들어두신 함수 재사용
  const w = window.open("", "_blank");
  if (!w) {
    alert("팝업이 차단되어 PDF 창을 열 수 없습니다. 팝업 허용 후 다시 시도해 주세요.");
    return;
  }
  w.document.open();
  w.document.write(buildPrintTableHTML_MultiPage(items));
  w.document.close();
}

// ✅ 버튼 연결 (CSV는 그대로)
$("downloadPdf")?.addEventListener("click", downloadPdfMultiPage);



// 버튼 연결
$("downloadTable")?.addEventListener("click", downloadTableCSV);
