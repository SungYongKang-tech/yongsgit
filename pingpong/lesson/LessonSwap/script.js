// script.js
import { db } from './firebase.js';
import { ref, onValue, set, get, update } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";


const scheduleRef = ref(db, 'schedule');

onValue(scheduleRef, (snapshot) => {
  const data = snapshot.val() || {};
  renderSchedule(data);
});

  const initialData = {
    mon_0: { name: "김승일" }, tue_0: { name: "정승목" }, wed_0: { name: "김승일" }, thu_0: { name: "정승목" },
    mon_1: { name: "이상준" }, tue_1: { name: "박나령" }, wed_1: { name: "이상준" }, thu_1: { name: "박나령" },
    mon_2: { name: "이낭주" }, tue_2: { name: "양충현" }, wed_2: { name: "이낭주" }, thu_2: { name: "양충현" },
    mon_3: { name: "조보미" }, tue_3: { name: "송은아" }, wed_3: { name: "조보미" }, thu_3: { name: "송은아" },
    mon_4: { name: "고은선" }, tue_4: { name: "임춘근" }, wed_4: { name: "고은선" }, thu_4: { name: "임춘근" }
  };

window.importSchedule = function () {
 // if (!confirm("기존 시간표를 덮어씁니다. 계속하시겠습니까?")) return;



  set(scheduleRef, initialData)
//    .then(() => alert("시간표가 초기화되었습니다."))
//    .catch((error) => alert("초기화 중 오류 발생: " + error.message));
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

  // 1개 선택 후 빈 셀 클릭 → 복사
  if (selectedCells.length === 1 && isEmpty) {
    const from = selectedCells[0];
    const copiedName = from.cell.textContent.trim();

    cell.textContent = copiedName;
    cell.classList.remove("empty");
    cell.style.backgroundColor = "";
    set(ref(db, `schedule/${key}`), { name: copiedName });

    from.cell.classList.remove("selected");
    selectedCells = [];
    document.getElementById("swapBtn").disabled = true;
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


window.handleSwap = function () {
  if (selectedCells.length !== 2) return;

  const [{ cell: cellA, key: keyA }, { cell: cellB, key: keyB }] = selectedCells;
  const nameA = cellA.textContent;
  const nameB = cellB.textContent;

  // Swap UI
  cellA.textContent = nameB;
  cellB.textContent = nameA;

  // Firebase 반영
  set(ref(db, `schedule/${keyA}`), { name: nameB });
  set(ref(db, `schedule/${keyB}`), { name: nameA });

  // 스타일 초기화
  selectedCells.forEach(({ cell }) => cell.classList.remove("selected"));
  selectedCells = [];
  document.getElementById("swapBtn").disabled = true;
};

window.markAbsent = function () {
  if (selectedCells.length !== 1) return alert("하나의 셀만 선택해야 합니다.");
  
  const { cell, key } = selectedCells[0];

  set(ref(db, `schedule/${key}`), { name: "" })
    .then(() => {
     // alert("불참 처리되었습니다.");
      cell.textContent = "";
      cell.classList.add("empty");
      cell.style.backgroundColor = "#f5f5f5";

      // 🔽 추가: 선택 해제 처리
      cell.classList.remove("selected");
      selectedCells = [];

      document.getElementById("swapBtn").disabled = true;
    });
};


function shouldResetSchedule() {
  const now = new Date();
  const day = now.getDay(); // 일: 0, 월: 1, ..., 금: 5
  const hour = now.getHours();

  // 금요일 17시(5시) 이후인지 체크
  return (day === 5 && hour >= 17);
}

function resetOncePerWeek() {
  const resetKey = 'scheduleResetWeek';
  const currentWeek = getWeekKey();

  if (shouldResetSchedule() && localStorage.getItem(resetKey) !== currentWeek) {
    importSchedule();  // 초기화 함수 실행
    localStorage.setItem(resetKey, currentWeek);
  }
}

// 해당 주차를 구분하기 위한 키 생성
function getWeekKey() {
  const now = new Date();
  const year = now.getFullYear();
  const week = Math.ceil(((now - new Date(year, 0, 1)) / 86400000 + new Date(year, 0, 1).getDay() + 1) / 7);
  return `${year}-W${week}`;
}

// 초기화 실행
resetOncePerWeek();
