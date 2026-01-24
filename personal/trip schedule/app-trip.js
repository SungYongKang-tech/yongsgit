import { auth, db } from "./firebase.js";
import { uploadToCloudinary } from "./cloudinary.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, addDoc, onSnapshot, query, orderBy,
  updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const tripId = new URLSearchParams(location.search).get("trip");
if (!tripId) {
  alert("trip 파라미터가 없습니다. (trip.html?trip=XXXX)");
  location.href = "index.html";
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${d.getFullYear()}-${m}-${day}`;
}
$("date").value = todayISO();

const authReady = new Promise((resolve) => onAuthStateChanged(auth, (u) => u && resolve(u)));
signInAnonymously(auth).catch(e => alert("익명 로그인 실패: " + e.message));

let me = { uid:null, name:"익명" };
let members = {};

async function ensureJoined() {
  const user = await authReady;
  me.uid = user.uid;

  const myMemberDoc = await getDoc(doc(db, "trips", tripId, "members", me.uid));
  if (myMemberDoc.exists()) {
    me.name = myMemberDoc.data()?.name || "익명";
    $("joinCard").style.display = "none";
    return true;
  }

  $("joinCard").style.display = "block";
  return false;
}

$("joinBtn").addEventListener("click", async () => {
  const user = await authReady;
  const nick = $("nick").value.trim() || "익명";
  await setDoc(doc(db, "trips", tripId, "members", user.uid), {
    name: nick,
    joinedAt: serverTimestamp()
  });
  $("joinCard").style.display = "none";
});

$("shareBtn").addEventListener("click", async () => {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    alert("공유 링크를 복사했습니다. 카톡에 붙여넣기 하시면 됩니다.");
  } catch {
    prompt("복사가 안 되면 아래 링크를 복사하세요:", url);
  }
});

// 여행 메타 로드
(async () => {
  const t = await getDoc(doc(db, "trips", tripId));
  if (!t.exists()) {
    alert("해당 여행방이 없습니다.");
    location.href = "index.html";
    return;
  }
  const meta = t.data()?.meta || {};
  $("tripTitle").textContent = `📌 ${meta.title || "여행"}`;
  $("tripPeriod").textContent = (meta.startDate && meta.endDate) ? `${meta.startDate} ~ ${meta.endDate}` : "";
  await ensureJoined();
})();

// 멤버 구독(이름 표시용)
onSnapshot(collection(db, "trips", tripId, "members"), (snap) => {
  members = {};
  snap.forEach(d => members[d.id] = d.data());
});

// 일정 추가
$("addBtn").addEventListener("click", async () => {
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

  if (!date || !title) return (statusEl.textContent = "날짜와 제목은 필수입니다.");

  let images = [];
  try {
    if (files && files.length > 0) {
      statusEl.textContent = `사진 업로드 중… (${files.length}장)`;
      for (const f of files) {
        const up = await uploadToCloudinary(f);
        images.push({ url: up.secure_url, public_id: up.public_id, name: up.original_filename });
      }
    }
    statusEl.textContent = "저장 중…";

    await addDoc(collection(db, "trips", tripId, "items"), {
      date, time, title, place, mapUrl, note,
      images,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: me.uid
    });

    $("time").value = "";
    $("title").value = "";
    $("place").value = "";
    $("mapUrl").value = "";
    $("note").value = "";
    $("photos").value = "";
    statusEl.textContent = "추가 완료";
    setTimeout(() => statusEl.textContent = "", 1200);
  } catch (e) {
    statusEl.textContent = e.message || String(e);
  }
});

// 일정 리스트 실시간 구독
const q = query(collection(db, "trips", tripId, "items"), orderBy("date"), orderBy("time"));
onSnapshot(q, (snap) => {
  const list = $("list");
  list.innerHTML = "";

  if (snap.empty) {
    list.innerHTML = `<div class="card"><p class="small">아직 일정이 없습니다. 위에서 추가해 주세요.</p></div>`;
    return;
  }

  snap.forEach((d) => {
    const it = d.data();
    const who = members?.[it.updatedBy]?.name || "누군가";
    const map = it.mapUrl ? `<a href="${it.mapUrl}" target="_blank">지도</a>` : "";
    const imgs = (it.images || []).map(img => `<img src="${img.url}" alt="photo">`).join("");

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-title">${it.title}</div>
      <div class="meta">
        <span>📅 ${it.date} ${it.time || ""}</span>
        ${it.place ? `<span>📍 ${it.place}</span>` : ""}
        ${map ? `<span>${map}</span>` : ""}
      </div>
      ${it.note ? `<div class="small" style="margin-top:8px">${it.note}</div>` : ""}
      ${imgs ? `<div class="grid-img">${imgs}</div>` : ""}
      <div class="actions">
        <div class="chip" data-act="edit">수정</div>
        <div class="chip" data-act="del">삭제</div>
        <span class="small">마지막 수정: ${who}</span>
      </div>
    `;

    el.querySelector('[data-act="edit"]').addEventListener("click", async () => openEdit(d.id, it));
    el.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm("이 일정을 삭제할까요?")) return;
      await deleteDoc(doc(db, "trips", tripId, "items", d.id));
    });

    list.appendChild(el);
  });
});

// ---- 수정 모달 ----
let editingId = null;
let editingItem = null;

function openModal(open) {
  $("modalBack").style.display = open ? "flex" : "none";
  if (!open) {
    $("mPhotos").value = "";
    $("mStatus").textContent = "";
  }
}

$("closeModal").addEventListener("click", () => openModal(false));
$("modalBack").addEventListener("click", (e) => {
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

$("saveModal").addEventListener("click", async () => {
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

  if (!date || !title) return (st.textContent = "날짜와 제목은 필수입니다.");

  try {
    let addImages = [];
    if (files && files.length > 0) {
      st.textContent = `사진 업로드 중… (${files.length}장)`;
      for (const f of files) {
        const up = await uploadToCloudinary(f);
        addImages.push({ url: up.secure_url, public_id: up.public_id, name: up.original_filename });
      }
    }

    const nextImages = [...(editingItem.images || []), ...addImages];

    st.textContent = "저장 중…";
    await updateDoc(doc(db, "trips", tripId, "items", editingId), {
      date, time, title, place, mapUrl, note,
      images: nextImages,
      updatedAt: serverTimestamp(),
      updatedBy: me.uid
    });

    st.textContent = "저장 완료";
    setTimeout(() => openModal(false), 600);
  } catch (e) {
    st.textContent = e.message || String(e);
  }
});
