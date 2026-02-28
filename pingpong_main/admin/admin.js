// admin.js (전체 교체)
// ✅ 동작 방식
// - 페이지 로드시 Firebase를 "자동 로그인"하지 않음
// - 비밀번호 입력 후 [로그인] 클릭할 때만 Firebase 로그인 + 비번 검증
// - 최초 1회(서버에 비번이 없으면) 입력한 비번을 관리자 비번으로 저장
// - 비번은 Firestore에 "해시"로 저장(평문 저장 X)
// - 실패는 alert() 대신 화면 에러 텍스트로만 표시

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ✅ 여기에 본인 Firebase 설정 넣기
const firebaseConfig = {
  // apiKey: "...",
  // authDomain: "...",
  // projectId: "...",
  // storageBucket: "...",
  // messagingSenderId: "...",
  // appId: "..."
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ====== DOM ======
const loginSection = document.getElementById("loginSection");
const adminSection = document.getElementById("adminSection");

const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const statusText = document.getElementById("statusText");
const uidText = document.getElementById("uidText");

const logoutBtn = document.getElementById("logoutBtn");

const newPass1 = document.getElementById("newPass1");
const changePassBtn = document.getElementById("changePassBtn");

const deletePwInput = document.getElementById("deletePwInput");
const saveDeletePwBtn = document.getElementById("saveDeletePwBtn");

// ====== 설정 ======
const SECURITY_DOC = doc(db, "pingpong_admin", "security"); // 필요하면 컬렉션/문서명 바꿔도 됨
const SESSION_KEY = "koen_pingpong_admin_ok"; // 비번 저장 X, 로그인 성공 여부만 저장
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6시간 유지(원하면 조절)

// ====== 유틸 ======
function only4Digits(v) {
  return (v || "").replace(/\D/g, "").slice(0, 4);
}
function setError(msg) {
  loginError.textContent = msg || "";
}
function setStatus(msg) {
  statusText.textContent = msg;
}
function showAdmin() {
  loginSection.style.display = "none";
  adminSection.style.display = "block";
}
function showLogin() {
  adminSection.style.display = "none";
  loginSection.style.display = "block";
}
function saveSessionOK() {
  localStorage.setItem(SESSION_KEY, String(Date.now()));
}
function clearSessionOK() {
  localStorage.removeItem(SESSION_KEY);
}
function hasValidSession() {
  const t = Number(localStorage.getItem(SESSION_KEY) || 0);
  if (!t) return false;
  return (Date.now() - t) < SESSION_TTL_MS;
}

// SHA-256 해시 (브라우저 내장 SubtleCrypto)
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ====== 초기 UI ======
setStatus("대기중");
uidText.textContent = "-";
showLogin();

// 입력값이 보이지 않도록 항상 정리(자동완성/남아있는 값 방지)
loginPassword.value = "";
newPass1.value = "";
deletePwInput.value = "";

// 페이지 로드시 “자동 로그인/연결” 시도하지 않음
// 단, 세션이 남아있다면 로그인 버튼 클릭 없이도 바로 들어가게 할 수도 있음.
// 여기서는 "세션이 있어도 Firebase 연결은 필요"하니, 세션이 있으면 안내만 하고 버튼을 누르게 처리.
if (hasValidSession()) {
  setError("이전에 로그인한 기록이 있습니다. 보안을 위해 다시 ‘로그인’을 눌러 연결을 완료해 주세요.");
}

// ====== Firebase Auth 상태 표시 ======
onAuthStateChanged(auth, (user) => {
  if (user) {
    uidText.textContent = user.uid;
  } else {
    uidText.textContent = "-";
  }
});

// ====== 로그인 처리 ======
async function handleLogin() {
  setError("");

  const pw = only4Digits(loginPassword.value);
  loginPassword.value = pw;

  if (pw.length !== 4) {
    setError("비밀번호는 4자리 숫자여야 합니다.");
    return;
  }

  loginBtn.disabled = true;
  setStatus("Firebase 연결 중…");

  try {
    // ✅ 여기서만 Firebase 로그인 시도
    const cred = await signInAnonymously(auth);
    const user = cred.user;

    setStatus("보안정보 확인 중…");

    // 보안 문서 읽기
    const snap = await getDoc(SECURITY_DOC);
    const inputHash = await sha256(pw);

    if (!snap.exists()) {
      // ✅ 최초 1회: 입력 비번을 관리자 비번으로 초기 설정
      await setDoc(SECURITY_DOC, {
        adminHash: inputHash,
        deleteHash: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid
      });
      saveSessionOK();
      setStatus("초기 설정 완료");
      showAdmin();
      loginPassword.value = "";
      return;
    }

    const data = snap.data() || {};
    if (!data.adminHash) {
      // 문서는 있는데 adminHash가 비어있으면 다시 초기 설정
      await updateDoc(SECURITY_DOC, {
        adminHash: inputHash,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
      saveSessionOK();
      setStatus("초기 비밀번호 설정 완료");
      showAdmin();
      loginPassword.value = "";
      return;
    }

    // ✅ 비번 검증
    if (data.adminHash !== inputHash) {
      // 실패: 관리자 화면으로 안 들어가게 막기
      clearSessionOK();
      setStatus("로그인 실패");
      setError("비밀번호가 올바르지 않습니다.");
      // 필요시 로그아웃(원하면)
      await signOut(auth);
      return;
    }

    // 성공
    saveSessionOK();
    setStatus("로그인 성공");
    showAdmin();
    loginPassword.value = "";
  } catch (e) {
    clearSessionOK();
    setStatus("연결 실패");
    // ✅ 절대 alert로 pw 띄우지 말고, 에러만 표시
    setError("Firebase 연결/로그인에 실패했습니다. (네트워크/권한/프로젝트 설정 확인)");
    try { await signOut(auth); } catch {}
  } finally {
    loginBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", handleLogin);
loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});

// ====== 로그아웃 ======
logoutBtn?.addEventListener("click", async () => {
  clearSessionOK();
  setStatus("로그아웃");
  setError("");
  showLogin();
  loginPassword.value = "";
  try { await signOut(auth); } catch {}
});

// ====== 관리자 비번 변경 ======
changePassBtn?.addEventListener("click", async () => {
  const pw = only4Digits(newPass1.value);
  newPass1.value = pw;

  if (pw.length !== 4) {
    alert("관리자 비밀번호는 4자리 숫자여야 합니다.");
    return;
  }
  if (!auth.currentUser) {
    alert("Firebase에 로그인되어 있지 않습니다. 다시 로그인해 주세요.");
    showLogin();
    return;
  }

  changePassBtn.disabled = true;
  try {
    const h = await sha256(pw);
    await updateDoc(SECURITY_DOC, {
      adminHash: h,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    });
    alert("관리자 비밀번호가 저장되었습니다.");
    newPass1.value = "";
  } catch (e) {
    alert("저장 실패: Firebase 권한/연결을 확인해 주세요.");
  } finally {
    changePassBtn.disabled = false;
  }
});

// ====== 경기 삭제 비번 저장 ======
saveDeletePwBtn?.addEventListener("click", async () => {
  const pw = only4Digits(deletePwInput.value);
  deletePwInput.value = pw;

  if (pw.length !== 4) {
    alert("삭제 비밀번호는 4자리 숫자여야 합니다.");
    return;
  }
  if (!auth.currentUser) {
    alert("Firebase에 로그인되어 있지 않습니다. 다시 로그인해 주세요.");
    showLogin();
    return;
  }

  saveDeletePwBtn.disabled = true;
  try {
    const h = await sha256(pw);
    await updateDoc(SECURITY_DOC, {
      deleteHash: h,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid
    });
    alert("경기 삭제 비밀번호가 저장되었습니다.");
    deletePwInput.value = "";
  } catch (e) {
    alert("저장 실패: Firebase 권한/연결을 확인해 주세요.");
  } finally {
    saveDeletePwBtn.disabled = false;
  }
});