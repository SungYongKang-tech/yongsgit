import { db, auth } from "../firebase.js";
import {
  ref,
  onValue,
  get,
  set,
  update,
  remove,
  push
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

import {
  signInAnonymously,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

const $ = (id) => document.getElementById(id);

/* =======================
   Firebase paths
======================= */
const PATH = {
  config: "config",
  adminPassPlain: "config/adminPasswordPlain", // ✅ 평문 4자리
  deletePass: "config/deletePassword",         // ✅ 평문 4자리
  members: "members"
};

let loggedIn = false;
let memberCache = {};
let adminPasswordPlain = null;
let deletePassword = null;

/* 등급 가중치 */
const GRADE_WEIGHT = { A: 4, B: 3, C: 2, D: 1 };

/* =======================
   공통 함수
======================= */
function only4Digits(v) {
  return (v || "").replace(/\D/g, "").slice(0, 4);
}

function showLogin() {
  if ($("adminSection")) $("adminSection").style.display = "none";
  if ($("loginSection")) $("loginSection").style.display = "block";
}

function showAdmin() {
  if ($("loginSection")) $("loginSection").style.display = "none";
  if ($("adminSection")) $("adminSection").style.display = "block";
}

function setLoginError(msg) {
  if ($("loginError")) $("loginError").textContent = msg || "";
}

/* =======================
   Init
======================= */
(async function init() {
  try {
    await signInAnonymously(auth);

    if ($("statusText")) $("statusText").textContent = "연결됨";
    if ($("uidText")) $("uidText").textContent = auth?.currentUser?.uid || "-";

    showLogin();

    // 관리자 비밀번호(평문) 로드
    onValue(ref(db, PATH.adminPassPlain), (snap) => {
      adminPasswordPlain = snap.exists() ? String(snap.val()) : null;
    });

    // 삭제 비밀번호(평문) 로드
    onValue(ref(db, PATH.deletePass), (snap) => {
      deletePassword = snap.exists() ? String(snap.val()) : null;
      if ($("deletePwInput")) {
        $("deletePwInput").value = deletePassword ?? "";
      }
    });

    bindAdminPasswordUI();
    bindLoginPasswordUI();
    bindDeletePasswordUI();
    bindHeaderButtons();
    bindMembers();

    if ($("loginPassword")) $("loginPassword").value = "";
    if ($("newPass1")) $("newPass1").value = "";

  } catch (e) {
    console.error(e);
    if ($("statusText")) $("statusText").textContent = "연결 실패";
    alert("Firebase 연결/로그인 실패. 콘솔을 확인하세요.");
  }
})();

/* =======================
   Header buttons
======================= */
function bindHeaderButtons() {
  if ($("refreshBtn")) {
    $("refreshBtn").onclick = () => location.reload();
  }
}

/* =======================
   로그인
======================= */
$("loginBtn").onclick = async () => {
  const pw = only4Digits($("loginPassword")?.value || "");
  if ($("loginPassword")) $("loginPassword").value = pw;
  setLoginError("");

  if (pw.length !== 4) {
    setLoginError("비밀번호는 숫자 4자리여야 합니다.");
    return;
  }

  try {
    // 최초 1회: 아직 관리자 비밀번호 없으면 지금 입력값으로 저장
    if (!adminPasswordPlain) {
      alert("관리자 비밀번호가 아직 설정되지 않았습니다.\n입력한 비밀번호로 초기 설정합니다.");
      await update(ref(db, PATH.config), {
        adminPasswordPlain: pw,
        deletePassword: deletePassword ?? "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: auth?.currentUser?.uid || ""
      });
      adminPasswordPlain = pw;
    }

    if (String(pw) === String(adminPasswordPlain)) {
      loggedIn = true;
      showAdmin();
      if ($("loginPassword")) $("loginPassword").value = "";
      setLoginError("");
    } else {
      setLoginError("비밀번호가 올바르지 않습니다.");
    }
  } catch (e) {
    console.error(e);
    setLoginError("로그인 처리 중 오류가 발생했습니다.");
  }
};

if ($("loginPassword")) {
  $("loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      $("loginBtn")?.click();
    }
  });
}

/* =======================
   로그아웃
======================= */
$("logoutBtn").onclick = async () => {
  loggedIn = false;
  showLogin();
  if ($("loginPassword")) $("loginPassword").value = "";
  setLoginError("");

  try {
    await signOut(auth);
    await signInAnonymously(auth);
  } catch (e) {
    console.warn("로그아웃 후 재로그인 실패", e);
  }
};

/* =======================
   관리자 비밀번호 변경
   - 평문 4자리 저장
======================= */
$("changePassBtn").onclick = async () => {
  if (!loggedIn) return alert("로그인 후 변경 가능합니다.");

  const p1 = only4Digits($("newPass1")?.value || "");
  if ($("newPass1")) $("newPass1").value = p1;

  if (p1.length !== 4) {
    return alert("관리자 비밀번호는 숫자 4자리로 입력하세요.");
  }

  try {
    await update(ref(db, PATH.config), {
      adminPasswordPlain: p1,
      updatedAt: Date.now(),
      updatedBy: auth?.currentUser?.uid || ""
    });

    adminPasswordPlain = p1;
    if ($("newPass1")) $("newPass1").value = "";
    alert("관리자 비밀번호 저장 완료");
  } catch (e) {
    console.error(e);
    alert("관리자 비밀번호 저장 실패");
  }
};

/* =======================
   관리자 비번 입력칸(newPass1)
======================= */
function bindAdminPasswordUI() {
  const input = $("newPass1");
  if (!input) return;

  input.setAttribute("inputmode", "numeric");
  input.setAttribute("pattern", "[0-9]*");
  input.setAttribute("maxlength", "4");

  input.addEventListener("input", () => {
    input.value = only4Digits(input.value);
  });
}

/* =======================
   로그인 입력칸(loginPassword)
======================= */
function bindLoginPasswordUI() {
  const input = $("loginPassword");
  if (!input) return;

  input.setAttribute("inputmode", "numeric");
  input.setAttribute("pattern", "[0-9]*");
  input.setAttribute("maxlength", "4");

  input.addEventListener("input", () => {
    input.value = only4Digits(input.value);
  });
}

/* =======================
   삭제 비밀번호 설정
======================= */
function bindDeletePasswordUI() {
  const input = $("deletePwInput");
  const btn = $("saveDeletePwBtn");
  if (!input || !btn) return;

  input.setAttribute("inputmode", "numeric");
  input.setAttribute("pattern", "[0-9]*");
  input.setAttribute("maxlength", "4");

  input.addEventListener("input", () => {
    input.value = only4Digits(input.value);
  });

  btn.addEventListener("click", async () => {
    if (!loggedIn) return alert("로그인 후 변경 가능합니다.");

    const v = only4Digits(input.value || "");
    input.value = v;

    if (v.length !== 4) {
      return alert("삭제 비밀번호는 숫자 4자리로 입력하세요.");
    }

    try {
      await update(ref(db, PATH.config), {
        deletePassword: v,
        updatedAt: Date.now(),
        updatedBy: auth?.currentUser?.uid || ""
      });

      deletePassword = v;
      alert("경기 삭제 비밀번호 저장 완료");
    } catch (e) {
      console.error(e);
      alert("경기 삭제 비밀번호 저장 실패");
    }
  });
}

/* =======================
   멤버 관리
======================= */
function bindMembers() {
  onValue(ref(db, PATH.members), (snap) => {
    memberCache = snap.exists() ? snap.val() : {};
    renderMembers();
  });
}

let openActionKey = null;

function closeMemberActions() {
  openActionKey = null;
  document.querySelectorAll(".chipActions").forEach((x) => x.remove());
}

function renderMembers() {
  const el = $("memberList");
  if (!el) return;
  el.innerHTML = "";

  el.onclick = (e) => {
    if (e.target.closest(".chipWrap")) return;
    closeMemberActions();
  };

  Object.entries(memberCache).forEach(([key, val]) => {
    const wrap = document.createElement("span");
    wrap.className = "chipWrap";

    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = `${val.name}(${val.grade})`;

    chip.onclick = (e) => {
      e.stopPropagation();
      if (!loggedIn) return;

      if (openActionKey === key) {
        closeMemberActions();
        return;
      }

      closeMemberActions();
      openActionKey = key;

      const panel = document.createElement("div");
      panel.className = "chipActions";
      panel.onclick = (ev) => ev.stopPropagation();

      const editBtn = document.createElement("button");
      editBtn.className = "btnMini primary";
      editBtn.type = "button";
      editBtn.textContent = "수정";
      editBtn.onclick = async () => {
        const newName = prompt("이름 수정", val.name);
        if (newName === null) return;
        const name = newName.trim();
        if (!name) return alert("이름은 비워둘 수 없습니다.");

        const newGradeRaw = prompt("등급 수정 (A/B/C/D)", val.grade);
        if (newGradeRaw === null) return;
        const grade = newGradeRaw.trim().toUpperCase();
        if (!GRADE_WEIGHT[grade]) return alert("등급은 A/B/C/D 중 하나여야 합니다.");

        await update(ref(db, `${PATH.members}/${key}`), {
          name,
          grade,
          weight: GRADE_WEIGHT[grade]
        });

        closeMemberActions();
      };

      const delBtn = document.createElement("button");
      delBtn.className = "btnMini danger";
      delBtn.type = "button";
      delBtn.textContent = "삭제";
      delBtn.onclick = async () => {
        if (!confirm(`${val.name} 선수를 삭제하시겠습니까?`)) return;
        await remove(ref(db, `${PATH.members}/${key}`));
        closeMemberActions();
      };

      panel.appendChild(editBtn);
      panel.appendChild(delBtn);
      wrap.appendChild(chip);
      wrap.appendChild(panel);
    };

    wrap.appendChild(chip);
    el.appendChild(wrap);
  });
}

/* =======================
   멤버 추가
======================= */
$("addMemberBtn").onclick = async () => {
  if (!loggedIn) return;

  const name = ($("mName")?.value || "").trim();
  const grade = ($("mGrade")?.value || "D").toUpperCase();

  if (!name) return alert("이름을 입력하세요.");
  if (!GRADE_WEIGHT[grade]) return alert("등급이 올바르지 않습니다.");

  await push(ref(db, PATH.members), {
    name,
    grade,
    weight: GRADE_WEIGHT[grade]
  });

  $("mName").value = "";
};