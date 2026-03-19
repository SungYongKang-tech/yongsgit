// admin.js (RTDB 평문 비밀번호 버전)

import { auth, db } from "../firebase.js";

import { signInAnonymously, signOut } from
  "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import { ref, get, set, update } from
  "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

// ====== DOM ======
const loginSection = document.getElementById("loginSection");
const adminSection = document.getElementById("adminSection");

const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const logoutBtn = document.getElementById("logoutBtn");

const newPass1 = document.getElementById("newPass1");
const changePassBtn = document.getElementById("changePassBtn");

const deletePwInput = document.getElementById("deletePwInput");
const saveDeletePwBtn = document.getElementById("saveDeletePwBtn");

// ✅ 현재 비밀번호 표시용 DOM
const currentAdminPw = document.getElementById("currentAdminPw");
const toggleAdminPw = document.getElementById("toggleAdminPw");

const currentDeletePw = document.getElementById("currentDeletePw");
const toggleDeletePw = document.getElementById("toggleDeletePw");

// 선수 관리
const mName = document.getElementById("mName");
const mBu = document.getElementById("mBu");
const addMemberBtn = document.getElementById("addMemberBtn");
const memberList = document.getElementById("memberList");

// ====== RTDB 경로 ======
const CONFIG_PATH = "config";
const MEMBERS_PATH = "members";

// ====== 세션(비번 저장 X, 로그인 성공 여부만) ======
const SESSION_KEY = "koen_pingpong_admin_ok";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6시간

// ====== 현재 비밀번호 표시 상태 ======
let adminPwVisible = false;
let deletePwVisible = false;
let currentAdminPwValue = "";
let currentDeletePwValue = "";

function only4Digits(v) {
  return (v || "").replace(/\D/g, "").slice(0, 4);
}

function setError(msg) {
  if (!loginError) return;
  loginError.textContent = msg || "";
}

function showAdmin() {
  if (loginSection) loginSection.style.display = "none";
  if (adminSection) adminSection.style.display = "block";
}

function showLogin() {
  if (adminSection) adminSection.style.display = "none";
  if (loginSection) loginSection.style.display = "block";
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

// ====== 초기 UI ======
showLogin();

if (loginPassword) loginPassword.value = "";
if (newPass1) newPass1.value = "";
if (deletePwInput) deletePwInput.value = "";

if (hasValidSession()) {
  setError("비밀번호를 입력해주세요.");
}

// ====== config 읽기 ======
async function readConfig() {
  const snap = await get(ref(db, CONFIG_PATH));
  return snap.exists() ? snap.val() : null;
}

// ====== 현재 비밀번호 표시 갱신 ======
async function refreshPasswordDisplay() {
  try {
    const cfg = await readConfig();

    currentAdminPwValue = String(cfg?.adminPasswordPlain || "");
    currentDeletePwValue = String(cfg?.deletePassword || "");

    if (currentAdminPw) {
      currentAdminPw.textContent = adminPwVisible
        ? (currentAdminPwValue || "-")
        : (currentAdminPwValue ? "●●●●" : "-");
    }

    if (currentDeletePw) {
      currentDeletePw.textContent = deletePwVisible
        ? (currentDeletePwValue || "-")
        : (currentDeletePwValue ? "●●●●" : "-");
    }

    if (toggleAdminPw) {
      toggleAdminPw.textContent = adminPwVisible ? "숨기기" : "보기";
    }

    if (toggleDeletePw) {
      toggleDeletePw.textContent = deletePwVisible ? "숨기기" : "보기";
    }
  } catch (e) {
    console.warn("refreshPasswordDisplay failed", e);
  }
}

// ====== 로그인 처리 ======
async function handleLogin() {
  setError("");

  const pw = only4Digits(loginPassword?.value);
  if (loginPassword) loginPassword.value = pw;

  if (pw.length !== 4) {
    setError("비밀번호는 4자리 숫자여야 합니다.");
    return;
  }

  if (loginBtn) loginBtn.disabled = true;

  try {
    // 버튼 클릭 시에만 익명 로그인
    const cred = await signInAnonymously(auth);
    const user = cred.user;

    const cfg = await readConfig();

    // 최초 1회: config에 adminPasswordPlain 없으면 입력값으로 세팅
    if (!cfg || !cfg.adminPasswordPlain) {
      await set(ref(db, CONFIG_PATH), {
        adminPasswordPlain: pw,
        deletePassword: cfg?.deletePassword ?? "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: user.uid
      });

      saveSessionOK();
      showAdmin();
      if (loginPassword) loginPassword.value = "";
      await refreshPasswordDisplay();
      await loadMembers();
      return;
    }

    // 평문 비교
    if (String(cfg.adminPasswordPlain) !== String(pw)) {
      clearSessionOK();
      setError("비밀번호가 올바르지 않습니다.");
      await signOut(auth);
      return;
    }

    // 성공
    saveSessionOK();
    showAdmin();
    if (loginPassword) loginPassword.value = "";
    await refreshPasswordDisplay();
    await loadMembers();
  } catch (e) {
    clearSessionOK();
    setError("Firebase 연결/로그인에 실패했습니다. (네트워크/권한/설정 확인)");
    try { await signOut(auth); } catch {}
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

loginBtn?.addEventListener("click", handleLogin);

loginPassword?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleLogin();
});

// ====== 보기/숨기기 버튼 ======
toggleAdminPw?.addEventListener("click", async () => {
  adminPwVisible = !adminPwVisible;
  await refreshPasswordDisplay();
});

toggleDeletePw?.addEventListener("click", async () => {
  deletePwVisible = !deletePwVisible;
  await refreshPasswordDisplay();
});

// ====== 로그아웃 ======
logoutBtn?.addEventListener("click", async () => {
  clearSessionOK();
  setError("");
  adminPwVisible = false;
  deletePwVisible = false;
  showLogin();
  if (loginPassword) loginPassword.value = "";
  try { await signOut(auth); } catch {}
});

// ====== 관리자 비번 변경 (평문 저장) ======
changePassBtn?.addEventListener("click", async () => {
  const pw = only4Digits(newPass1?.value);
  if (newPass1) newPass1.value = pw;

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
    await update(ref(db, CONFIG_PATH), {
      adminPasswordPlain: pw,
      updatedAt: Date.now(),
      updatedBy: auth.currentUser.uid
    });

    alert("관리자 비밀번호가 저장되었습니다.");
    if (newPass1) newPass1.value = "";
    adminPwVisible = false;
    await refreshPasswordDisplay();
  } catch (e) {
    alert("저장 실패: Firebase 권한/연결을 확인해 주세요.");
  } finally {
    changePassBtn.disabled = false;
  }
});

// ====== 경기 삭제 비번 저장 (평문 저장) ======
saveDeletePwBtn?.addEventListener("click", async () => {
  const pw = only4Digits(deletePwInput?.value);
  if (deletePwInput) deletePwInput.value = pw;

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
    await update(ref(db, CONFIG_PATH), {
      deletePassword: pw,
      updatedAt: Date.now(),
      updatedBy: auth.currentUser.uid
    });

    alert("경기 삭제 비밀번호가 저장되었습니다.");
    if (deletePwInput) deletePwInput.value = "";
    deletePwVisible = false;
    await refreshPasswordDisplay();
  } catch (e) {
    alert("저장 실패: Firebase 권한/연결을 확인해 주세요.");
  } finally {
    saveDeletePwBtn.disabled = false;
  }
});

// =========================
// 선수(부수) 관리
// =========================
function normalizeName(s) {
  return (s || "").trim();
}

function keyFromName(name) {
  return name.replace(/\s+/g, "").replace(/[.#$/\[\]]/g, "_");
}

async function loadMembers() {
  if (!memberList) return;
  memberList.innerHTML = "";

  try {
    const snap = await get(ref(db, MEMBERS_PATH));
    const data = snap.exists() ? snap.val() : {};

    const arr = Object.entries(data).map(([k, v]) => {
      if (v && typeof v === "object") {
        return {
          key: k,
          name: v.name || v.fullName || k,
          bu: Number(v.bu ?? v.level ?? v.rank ?? 8)
        };
      }
      if (typeof v === "number") {
        return { key: k, name: k, bu: Number(v) };
      }
      return { key: k, name: String(v || k), bu: 8 };
    });

    arr.sort((a, b) => (a.bu - b.bu) || a.name.localeCompare(b.name));

    arr.forEach((item) => {
      const wrap = document.createElement("span");
      wrap.className = "chipWrap";

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = `${item.name} · ${item.bu}부`;

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

    if (mName) mName.value = "";
    await loadMembers();
  } catch (e) {
    alert("저장 실패: 권한/연결을 확인해 주세요.");
  }
});