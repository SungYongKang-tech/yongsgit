// script.js
import { db } from './firebase.js';
import {
  ref, onValue, set, get, update, push, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// ---- 익명 로그인(스크립트 내부에서 자체 처리) ----
const auth = getAuth(); // firebase.js에서 만든 기본 앱을 사용
const authReady = new Promise((resolve) => {
  onAuthStateChanged(auth, (user) => { if (user) resolve(user); });
});
signInAnonymously(auth).catch((e) => {
  console.error('익명 로그인 실패:', e);
  alert('익명 로그인 실패: ' + e.message);
});

async function requireAuth() {
  const user = await authReady;
  if (!user) throw new Error('인증되지 않았습니다. (익명 로그인 미완료)');
  return user;
}

// ---- 상태 스냅샷 (UNDO에 사용) ----
let latestData = {};
const scheduleRef = ref(db, 'schedule');
onValue(scheduleRef, (snapshot) => {
  latestData = snapshot.val() || {};
  renderSchedule(latestData);
});

// ---- 초기 템플릿 ----
const initialData = {
  mon_0: { name: "정승목" }, tue_0: { name: "김승일" }, wed_0: { name: "정승목" }, thu_0: { name: "김승일" },
  mon_1: { name: "이상준" }, tue_1: { name: "박나령" }, wed_1: { name: "이상준" }, thu_1: { name: "박나령" },
  mon_2: { name: "이낭주" }, tue_2: { name: "양충현" }, wed_2: { name: "이낭주" }, thu_2: { name: "양충현" },
  mon_3: { name: "조보미" }, tue_3: { name: "송은아" }, wed_3: { name: "조보미" }, thu_3: { name: "송은아" },
  mon_4: { name: "고은선" }, tue_4: { name: "임춘근" }, wed_4: { name: "고은선" }, thu_4: { name: "임춘근" }
};

// ---- 공용 유틸: 멀티경로 원자 업데이트 + 로그 + 1단계 UNDO ----
async function atomicApply(changes, logPayload = {}) {
  // changes: [{ key: 'mon_0', newName: '홍길동' }, ...]
  const user = await requireAuth();
  const uid = user.uid;

  const undoEntries = {};   // 되돌리기용 이전값
  const multi = {};         // 멀티 경로 업데이트 페이로드

  for (const { key, newName } of changes) {
    const prevName = (latestData[key]?.name) ?? "";
    undoEntries[`schedule/${key}`] = { name: prevName };
    multi[`schedule/${key}`] = { name: newName, _by: uid, _ts: serverTimestamp() };
  }

  const logKey = push(ref(db, 'logs')).key;
  multi[`logs/${logKey}`] = {
    ...logPayload,
    items: changes.map(({ key, newName }) => ({
      key,
      from: (latestData[key]?.name) ?? "",
      to: newName
    })),
    by: uid,
    ts: serverTimestamp()
  };

  multi[`undo/last/${uid}`] = {
    entries: undoEntries,
    by: uid,
    ts: serverTimestamp()
  };

  await update(ref(db), multi);
}

// ---- 초기화(임포트) ----
window.importSchedule = async function () {
  await requireAuth();
  const changes = Object.keys(initialData).map(key => ({
    key,
    newName: initialData[key].name
  }));
  await atomicApply(changes, { type: 'import' });
};

// (옵션) 남아있는 외부 함수
window.changeName = function () {
  try { localStorage.removeItem(userNameKey); } catch {}
  location.reload();
};

// ---- 렌더링 ----
let selectedCells = [];

function renderSchedule(data) {
  const container = document.getElementById("scheduleContainer");
  container.innerHTML = "";

  ensureUndoButton();

  const wrapper = document.createElement("div");
  wrapper.style.overflowX = "auto";
  wrapper.style.maxWidth = "100%";

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "4.5vw";
  table.style.tableLayout = "fixed";

  const header = document.createElement("tr");
  const headerTitles = ["교시", "월", "화", "수", "목"];
  headerTitles.forEach(title => {
    const th = document.createElement("th");
    th.textContent = title;
    th.style.backgroundColor = "#ffe8d6";
    th.style.padding = "6px";
    th.style.fontSize = "4.2vw";
    th.style.border = "1px solid #ccc";
    header.appendChild(th);
  });
  table.appendChild(header);

  const periods = [
    { label: "0교시", time: "11:25~" },
    { label: "1교시", time: "11:40~" },
    { label: "2교시", time: "11:55~" },
    { label: "3교시", time: "12:10~" },
    { label: "4교시", time: "12:25~" }
  ];
  const days = ["mon", "tue", "wed", "thu"];

  periods.forEach((periodObj, pIdx) => {
    const row = document.createElement("tr");

    const timeCell = document.createElement("td");
    timeCell.innerHTML = `<div>${periodObj.label}</div><div style="font-size: 12px; color: #888;">${periodObj.time}</div>`;
    timeCell.style.border = "1px solid #ccc";
    timeCell.style.padding = "8px";
    timeCell.style.textAlign = "center";
    row.appendChild(timeCell);

    days.forEach(day => {
      const key = `${day}_${pIdx}`;
      const cell = document.createElement("td");
      const value = data[key]?.name || "";
      cell.dataset.key = key;
      cell.style.border = "1px solid #ccc";
      cell.style.padding = "6px";
      cell.style.fontSize = "4.2vw";
      cell.style.wordBreak = "break-word";
      cell.style.textAlign = "center";

      if (value) {
        cell.textContent = value;
        if (initialData[key]?.name !== value) {
          cell.classList.add("modified");
        }
      } else {
        cell.classList.add("empty");
        cell.style.backgroundColor = "#f5f5f5";
      }

      cell.onclick = () => handleCellClick(cell, key);
      row.appendChild(cell);
    });

    table.appendChild(row);
  });

  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

// ---- 셀 인터랙션 ----
function handleCellClick(cell, key) {
  const name = cell.textContent.trim();
  const isEmpty = !name;

  // 이미 선택된 셀이면 해제
  const alreadyIndex = selectedCells.findIndex(item => item.cell === cell);
  if (alreadyIndex > -1) {
    selectedCells.splice(alreadyIndex, 1);
    cell.classList.remove("selected");
    document.getElementById("swapBtn").disabled = true;
    return;
  }

  // 1개 선택 후 빈 셀 클릭 → 복사(원자 업데이트)
  if (selectedCells.length === 1 && isEmpty) {
    const from = selectedCells[0];
    const copiedName = from.cell.textContent.trim();

    // 낙관적 UI
    const prevClasses = cell.className;
    const prevBg = cell.style.backgroundColor;
    cell.textContent = copiedName;
    cell.classList.remove("empty");
    cell.style.backgroundColor = "";

    atomicApply(
      [{ key, newName: copiedName }],
      { type: 'copy', fromKey: from.key ?? from.cell?.dataset?.key, toKey: key }
    )
      .then(() => {
        from.cell.classList.remove("selected");
        selectedCells = [];
        document.getElementById("swapBtn").disabled = true;
      })
      .catch((e) => {
        // 실패 시 원복
        cell.textContent = "";
        cell.className = prevClasses;
        cell.style.backgroundColor = prevBg;
        alert('저장 실패: ' + e.message);
      });
    return;
  }

  // 이름 있는 셀 1~2개 선택
  if (!isEmpty && selectedCells.length < 2) {
    selectedCells.push({ cell, key });
    cell.classList.add("selected");
  }

  // 서로 변경 버튼 활성화 조건
  document.getElementById("swapBtn").disabled = (selectedCells.length !== 2);
}

// ---- 스왑(원자 처리) ----
window.handleSwap = async function () {
  if (selectedCells.length !== 2) return;

  const [{ cell: cellA, key: keyA }, { cell: cellB, key: keyB }] = selectedCells;
  const nameA = cellA.textContent;
  const nameB = cellB.textContent;

  // 낙관적 UI
  cellA.textContent = nameB;
  cellB.textContent = nameA;

  try {
    await atomicApply(
      [
        { key: keyA, newName: nameB },
        { key: keyB, newName: nameA }
      ],
      { type: 'swap' }
    );
  } catch (e) {
    cellA.textContent = nameA;
    cellB.textContent = nameB;
    alert('서로 변경 실패: ' + e.message);
    return;
  }

  selectedCells.forEach(({ cell }) => cell.classList.remove("selected"));
  selectedCells = [];
  document.getElementById("swapBtn").disabled = true;
};

// ---- 비우기(불참, 원자 처리) ----
window.markAbsent = async function () {
  if (selectedCells.length !== 1) return alert("하나의 셀만 선택해야 합니다.");

  const { cell, key } = selectedCells[0];

  const prevText = cell.textContent;
  const prevClasses = cell.className;
  const prevBg = cell.style.backgroundColor;

  cell.textContent = "";
  cell.classList.add("empty");
  cell.style.backgroundColor = "#f5f5f5";
  cell.classList.remove("selected");

  try {
    await atomicApply([{ key, newName: "" }], { type: 'absent' });
  } catch (e) {
    cell.textContent = prevText;
    cell.className = prevClasses;
    cell.style.backgroundColor = prevBg;
    alert('불참 처리 실패: ' + e.message);
    return;
  }

  selectedCells = [];
  document.getElementById("swapBtn").disabled = true;
};

// ---- 되돌리기(1단계) ----
window.undoLast = async function () {
  const user = await requireAuth();
  const uid = user.uid;

  const snap = await get(ref(db, `undo/last/${uid}`));
  if (!snap.exists()) {
    alert('되돌릴 내역이 없습니다.');
    return;
  }
  const undo = snap.val() || {};
  const entries = undo.entries || {};

  const logKey = push(ref(db, 'logs')).key;
  const multi = {};

  for (const path in entries) {
    multi[path] = { name: entries[path]?.name ?? "", _by: uid, _ts: serverTimestamp() };
  }

  multi[`logs/${logKey}`] = {
    type: 'undo',
    items: Object.keys(entries).map(path => ({
      key: path.split('/')[1],
      to: entries[path]?.name ?? ""
    })),
    by: uid,
    ts: serverTimestamp()
  };

  multi[`undo/last/${uid}`] = null;

  try {
    await update(ref(db), multi);
  } catch (e) {
    alert('되돌리기 실패: ' + e.message);
  }
};

// ---- 주간 자동 초기화(금 17시 이후 1회) ----
function shouldResetSchedule() {
  const now = new Date();
  const day = now.getDay(); // 일:0, 월:1, ..., 금:5
  const hour = now.getHours();
  return (day === 5 && hour >= 17);
}
function resetOncePerWeek() {
  const resetKey = 'scheduleResetWeek';
  const currentWeek = getWeekKey();
  if (shouldResetSchedule() && localStorage.getItem(resetKey) !== currentWeek) {
    authReady.then(() => {
      window.importSchedule();
      localStorage.setItem(resetKey, currentWeek);
    });
  }
}
function getWeekKey() {
  const now = new Date();
  const year = now.getFullYear();
  const week = Math.ceil(((now - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7);
  return `${year}-W${week}`;
}
resetOncePerWeek();

// ---- UI 도우미 ----
function ensureUndoButton() {
  const controls = document.querySelector('.controls');
  if (!controls || controls.querySelector('#undoBtn')) return;

  const btn = document.createElement('button');
  btn.id = 'undoBtn';
  btn.textContent = '↩️ 되돌리기';
  btn.className = 'btn-reset';
  btn.style.fontWeight = '800';
  btn.onclick = () => window.undoLast();

  const swapBtn = document.getElementById('swapBtn');
  if (swapBtn && swapBtn.parentElement === controls) {
    controls.insertBefore(btn, swapBtn.nextSibling);
  } else {
    controls.appendChild(btn);
  }
}
