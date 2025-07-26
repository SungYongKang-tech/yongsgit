// script.js
import { db } from './firebase.js';
import { ref, onValue, set, get, update } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";


const scheduleRef = ref(db, 'schedule');

onValue(scheduleRef, (snapshot) => {
  const data = snapshot.val() || {};
  renderSchedule(data);
});

window.importSchedule = function () {
  if (!confirm("기존 시간표를 덮어씁니다. 계속하시겠습니까?")) return;

  const initialData = {
    mon_0: { name: "김승일" }, tue_0: { name: "정승묵" }, wed_0: { name: "김승일" }, thu_0: { name: "정승묵" },
    mon_1: { name: "이상준" }, tue_1: { name: "박나령" }, wed_1: { name: "이상준" }, thu_1: { name: "박나령" },
    mon_2: { name: "이낭주" }, tue_2: { name: "양충현" }, wed_2: { name: "이낭주" }, thu_2: { name: "양충현" },
    mon_3: { name: "조보미" }, tue_3: { name: "송은아" }, wed_3: { name: "조보미" }, thu_3: { name: "송은아" },
    mon_4: { name: "고은선" }, tue_4: { name: "임춘근" }, wed_4: { name: "고은선" }, thu_4: { name: "임춘근" }
  };

  set(scheduleRef, initialData)
    .then(() => alert("시간표가 초기화되었습니다."))
    .catch((error) => alert("초기화 중 오류 발생: " + error.message));
};

window.changeName = function () {
  localStorage.removeItem(userNameKey);
  location.reload();
};

let selectedCells = [];

function renderSchedule(data) {
  const container = document.getElementById("scheduleContainer");
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.overflowX = "auto";
  wrapper.style.maxWidth = "100%";

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "3.8vw";
  table.style.tableLayout = "fixed";

  const header = document.createElement("tr");
  const headerTitles = ["교시", "월", "화", "수", "목"];
  headerTitles.forEach(title => {
    const th = document.createElement("th");
    th.textContent = title;
    th.style.backgroundColor = "#ffe8d6";
    th.style.padding = "6px";
    th.style.fontSize = "3.5vw";
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
      cell.style.fontSize = "3.5vw";
      cell.style.wordBreak = "break-word";
      cell.style.textAlign = "center";

      if (value) {
        cell.textContent = value;
     
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

function handleCellClick(cell, key) {
  const name = cell.textContent.trim();

  // 1. 아무것도 선택 안 된 상태 → 첫 셀 선택
  if (selectedCells.length === 0 && name) {
    selectedCells.push({ cell, key });
    cell.classList.add("selected");

  // 2. 첫 셀 선택 이후 빈 셀 클릭 → 복사
  } else if (selectedCells.length === 1 && !name) {
    const from = selectedCells[0];

    const nameToCopy = from.cell.textContent.trim();
    cell.textContent = nameToCopy;
    cell.classList.remove("empty");
    cell.style.backgroundColor = "";
    set(ref(db, `schedule/${key}`), { name: nameToCopy });

    // 선택 초기화
    from.cell.classList.remove("selected");
    selectedCells = [];
  
  } else {
    // 선택 초기화
    selectedCells.forEach(({ cell }) => cell.classList.remove("selected"));
    selectedCells = [];
  }

  // 버튼 비활성화 유지
  document.getElementById("swapBtn").disabled = true;
}


  // 서로변경 버튼 상태 설정
  document.getElementById("swapBtn").disabled = (selectedCells.length !== 2);





window.handleSwap = function () {
  if (selectedCells.length !== 2) return;

  const [cellA, cellB] = selectedCells;
  const keyA = cellA.dataset.key;
  const keyB = cellB.dataset.key;
  const nameA = cellA.textContent;
  const nameB = cellB.textContent;

  // Swap in UI
  cellA.textContent = nameB;
  cellB.textContent = nameA;

  // Firebase 반영
  const refA = ref(db, `schedule/${keyA}`);
  const refB = ref(db, `schedule/${keyB}`);
  set(refA, { name: nameB });
  set(refB, { name: nameA });

  // UI 정리
  selectedCells.forEach(cell => cell.classList.remove("selected"));
  selectedCells = [];
  document.getElementById("swapBtn").disabled = true;
};

window.markAbsent = function () {
  if (selectedCells.length !== 1) return alert("하나의 셀만 선택해야 합니다.");
  
  const { cell, key } = selectedCells[0];

  set(ref(db, `schedule/${key}`), { name: "" })
    .then(() => {
      alert("불참 처리되었습니다.");
      cell.textContent = "";
      cell.classList.add("empty");
      cell.style.backgroundColor = "#f5f5f5";

      document.getElementById("swapBtn").disabled = true;
    });
};

