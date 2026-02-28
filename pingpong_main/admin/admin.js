// admin.js (Realtime Database 버전)
// - firebase.js(export: app, db(getDatabase), auth)를 재사용
// - 자동 로그인/연결 시도 X
// - 비번 입력 후 [로그인] 클릭 시에만 익명로그인 + 비번검증
// - 최초 1회: security가 없으면 입력 비번을 관리자 비번으로 초기 설정
// - 비번은 SHA-256 해시로 저장(평문 저장 X)

import { auth, db } from "../firebase.js";

import {
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  ref,
  get,
  set,
  update
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

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

// (선수관리까지 연결하려면 여기에 memberList, addMemberBtn 등도 이어붙이면 됩니다)
const mName = document.getElementById("mName");
const mBu = document.getElementById("mBu");
const addMemberBtn = document.getElementById("addMemberBtn");
const memberList = document.getElementById("memberList");

// ====== RTDB 경로 ======
const SECURITY_PATH = "admin/config"; // ✅ 기존 admin/config 사용
const MEMBERS_PATH  = "members";      // ✅ 루트 members 사용

// ====== 세션(비번 저장 X, 로그인 성공 여부만) ======
const SESSION_KEY = "koen_pingpong_admin_ok";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

function only4Digits(v) {
  return (v || "").replace(/\D/g, "").slice(0, 4);
}
function setError(msg) {
  loginError.textContent = msg || "";
}
function setStatus(msg) {
  statusText.textContent = msg || "";
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

// SHA-256 해시
async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ====== 초기 UI ======
setStatus("대기중");
uidText.textContent = "-";
showLogin();

loginPassword.value = "";
newPass1.value = "";
deletePwInput.value = "";

if (hasValidSession()) {
  // 보안상 “자동 진입”은 안 하고 안내만
  setError("비밀번호를 입력해주세요.");
}

// Auth 상태 표시만 해줌(자동 로그인 시도 X)
onAuthStateChanged(auth, (user) => {
  uidText.textContent = user ? user.uid : "-";
});

// ====== 보안정보 읽기 ======
async function readSecurity() {
  const snap = await get(ref(db, SECURITY_PATH));
  return snap.exists() ? snap.val() : null;
}

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
  setStatus("Firebase 로그인 중…");

  try {
    // ✅ 버튼 클릭 시에만 익명 로그인
    const cred = await signInAnonymously(auth);
    const user = cred.user;

    setStatus("비밀번호 확인 중…");
    const inputHash = await sha256(pw);
    const sec = await readSecurity();

    if (!sec || !sec.adminHash) {
      // ✅ 최초 1회: 입력 비번으로 초기 설정
      await set(ref(db, SECURITY_PATH), {
        adminHash: inputHash,
        deleteHash: sec?.deleteHash ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: user.uid
      });
      saveSessionOK();
      setStatus("초기 설정 완료");
      showAdmin();
      loginPassword.value = "";
      await loadMembers(); // 선수목록 로딩(선택)
      return;
    }

    if (sec.adminHash !== inputHash) {
      clearSessionOK();
      setStatus("로그인 실패");
      setError("비밀번호가 올바르지 않습니다.");
      await signOut(auth);
      return;
    }

    // 성공
    saveSessionOK();
    setStatus("로그인 성공");
    showAdmin();
    loginPassword.value = "";
    await loadMembers(); // 선수목록 로딩(선택)
  } catch (e) {
    clearSessionOK();
    setStatus("연결 실패");
    setError("Firebase 연결/로그인에 실패했습니다. (네트워크/권한/설정 확인)");
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
    alert("로그인이 필요합니다. 다시 로그인해 주세요.");
    showLogin();
    return;
  }

  changePassBtn.disabled = true;
  try {
    const h = await sha256(pw);
    await update(ref(db, SECURITY_PATH), {
      adminHash: h,
      updatedAt: Date.now(),
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
    alert("로그인이 필요합니다. 다시 로그인해 주세요.");
    showLogin();
    return;
  }

  saveDeletePwBtn.disabled = true;
  try {
    const h = await sha256(pw);
    await update(ref(db, SECURITY_PATH), {
      deleteHash: h,
      updatedAt: Date.now(),
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

// =========================
// 선수(부수) 관리 - RTDB 예시
// =========================
function normalizeName(s) {
  return (s || "").trim();
}
function keyFromName(name) {
  // RTDB key에 안전하게: 공백 제거 + 일부 문자 치환
  return name.replace(/\s+/g, "").replace(/[.#$/\[\]]/g, "_");
}

async function loadMembers() {
  if (!memberList) return;
  memberList.innerHTML = "";

  try {
    const snap = await get(ref(db, MEMBERS_PATH));
    const data = snap.exists() ? snap.val() : {};
    const arr = Object.entries(data).map(([k, v]) => ({
      key: k,
      name: v?.name || k,
      bu: Number(v?.bu || 8)
    }));

    // 낮을수록 강함(1부 최강) → 오름차순
    arr.sort((a, b) => (a.bu - b.bu) || a.name.localeCompare(b.name));

    arr.forEach(item => {
      const wrap = document.createElement("span");
      wrap.className = "chipWrap";

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = `${item.name} · ${item.bu}부`;

      // 간단 삭제(원하면 수정 메뉴로 확장 가능)
      chip.addEventListener("click", async () => {
        const ok = confirm(`${item.name} (${item.bu}부) 삭제할까요?`);
        if (!ok) return;
        await update(ref(db), { [`${MEMBERS_PATH}/${item.key}`]: null });
        await loadMembers();
      });

      wrap.appendChild(chip);
      memberList.appendChild(wrap);
    });

  } catch (e) {
    // 선수목록 로딩 실패는 로그인과 분리
    console.warn("loadMembers failed", e);
  }
}

addMemberBtn?.addEventListener("click", async () => {
  const name = normalizeName(mName?.value);
  const bu = Number(mBu?.value || 8);

  if (!auth.currentUser) {
    alert("로그인이 필요합니다.");
    showLogin();
    return;
  }
  if (!name) {
    alert("이름을 입력해 주세요.");
    return;
  }
  if (!Number.isFinite(bu)) {
    alert("부수를 선택해 주세요.");
    return;
  }

  const key = keyFromName(name);

  try {
    await set(ref(db, `${MEMBERS_PATH}/${key}`), {
      name,
      bu,
      updatedAt: Date.now(),
      updatedBy: auth.currentUser.uid
    });
    mName.value = "";
    await loadMembers();
  } catch (e) {
    alert("저장 실패: 권한/연결을 확인해 주세요.");
  }
});