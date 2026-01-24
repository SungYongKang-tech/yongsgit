import { auth, db } from "./firebase.js";
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${d.getFullYear()}-${m}-${day}`;
}
$("startDate").value = todayISO();
$("endDate").value = todayISO();

const statusEl = $("status");
const authReady = new Promise((resolve) => onAuthStateChanged(auth, (u) => u && resolve(u)));
signInAnonymously(auth).catch(e => statusEl.textContent = "익명 로그인 실패: " + e.message);

function randomId(len=12){
  const chars="abcdefghijklmnopqrstuvwxyz0123456789";
  let s="";
  for(let i=0;i<len;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

$("createBtn").addEventListener("click", async () => {
  const user = await authReady;
  const title = $("title").value.trim();
  const startDate = $("startDate").value;
  const endDate = $("endDate").value;
  const myName = $("myName").value.trim() || "익명";

  if (!title) return (statusEl.textContent = "여행 이름을 입력해 주세요.");
  if (!startDate || !endDate) return (statusEl.textContent = "기간을 입력해 주세요.");

  const tripId = randomId(16);
  await setDoc(doc(db, "trips", tripId), {
    meta: { title, startDate, endDate, createdAt: serverTimestamp(), ownerUid: user.uid }
  });

  await setDoc(doc(db, "trips", tripId, "members", user.uid), {
    name: myName,
    joinedAt: serverTimestamp()
  });

  location.href = `trip.html?trip=${encodeURIComponent(tripId)}`;
});
