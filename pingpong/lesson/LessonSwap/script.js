// script.js
import { db } from './firebase.js';
import { ref, onValue, set, get, update, remove } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// 🔽 사용자 이름 입력 (인사말 없음, 이름변경 버튼 없음)
const userNameKey = "lessonSwapUserName";
let userName = localStorage.getItem(userNameKey);
if (!userName) {
  userName = prompt("이름을 입력하세요:");
  localStorage.setItem(userNameKey, userName);
}
// 🔽 스크립트 하단에 추가
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
    .then(() => {
      alert("시간표가 초기화되었습니다.");
    })
    .catch((error) => {
      alert("초기화 중 오류 발생: " + error.message);
    });
};


const scheduleRef = ref(db, 'schedule');
const requestRef = ref(db, 'swapRequest');

onValue(scheduleRef, (snapshot) => {
  const data = snapshot.val() || {};
  renderSchedule(data);
});


window.changeName = function () {
  localStorage.removeItem(userNameKey);
  location.reload();
};

let selectedKey = null;

function renderSchedule(data) {
  const container = document.getElementById("scheduleContainer");
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.style.overflowX = "auto"; // 모바일 반응형
  wrapper.style.maxWidth = "100%";

  const table = document.createElement("table");
   table.style.width = "100%";
   table.style.borderCollapse = "collapse";
   table.style.fontSize = "3.8vw"; // 화면 크기에 맞게 반응형 폰트
   table.style.tableLayout = "fixed"; // 셀 고정 너비로

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

     cell.style.border = "1px solid #ccc";
     cell.style.padding = "6px";
     cell.style.fontSize = "3.5vw";
     cell.style.wordBreak = "break-word"; // 이름 줄바꿈
     cell.style.textAlign = "center";

      if (value) {
        cell.textContent = value;
        if (value === userName) {
          cell.style.fontWeight = "bold";
        }
      } else {
        cell.classList.add("empty");
        cell.style.backgroundColor = "#f5f5f5";
      }

      cell.onclick = () => {
        //selectedKey = key;
        //highlightSelected(key);
        handleCellClick(key, value);
      };

      row.appendChild(cell);
    });

    table.appendChild(row);
  });

  wrapper.appendChild(table);
  container.appendChild(wrapper);
}


function highlightSelected(key) {
  document.querySelectorAll("td").forEach(td => {
    td.style.backgroundColor = "";
  });

  const index = keyToCellIndex(key);
  if (index) {
    const { rowIdx, colIdx } = index;
    const table = document.querySelector("#scheduleContainer table");
    const cell = table.rows[rowIdx + 1].cells[colIdx + 1];
    cell.style.backgroundColor = "#b3e5fc";
  }
}

// key 문자열을 row/col index로 변환하는 유틸 함수
function keyToCellIndex(key) {
  const [day, pIdx] = key.split("_");
  const colIdx = { mon: 0, tue: 1, wed: 2, thu: 3 }[day];
  const rowIdx = parseInt(pIdx);
  return colIdx != null && !isNaN(rowIdx) ? { rowIdx, colIdx } : null;
}


window.markAbsent = function () {
  if (!selectedKey) return alert("셀을 선택하세요.");
  if (!confirm("이 자리를 비우시겠습니까?")) return;

  // 이름 확인 없이 누구든지 해당 셀을 공란으로 처리
  set(ref(db, `schedule/${selectedKey}`), { name: "" })
    .then(() => {
      alert("불참 처리되었습니다.");
      selectedKey = null;
    });
};



window.requestSwap = function () {
  if (!selectedKey) return alert("먼저 본인의 셀을 선택하세요.");
  
  get(ref(db, `schedule/${selectedKey}`)).then(snap => {
    const currentName = snap.val()?.name;
    if (userName !== "강성용" && currentName !== userName) {
      return alert("본인의 셀만 선택할 수 있습니다.");
    }

    set(requestRef, {
      from: { key: selectedKey, name: currentName },
      status: "pending"
    });

    alert("교체 요청이 등록되었습니다.\n상대방이 셀을 클릭 후 '변경 승인' 버튼을 눌러야 완료됩니다.");
    selectedKey = null;
  });
};


window.approveSwap = function () {
  if (!selectedKey) return alert("먼저 자신의 셀을 선택하세요.");

  get(requestRef).then(snap => {
    if (!snap.exists()) return alert("진행 중인 요청이 없습니다.");

    const request = snap.val();
    if (request.status !== "pending") return alert("요청 상태가 올바르지 않습니다.");

    const fromKey = request.from.key;
    const fromName = request.from.name;

    get(ref(db, `schedule/${selectedKey}`)).then(toSnap => {
      const toName = toSnap.val()?.name;

      if (userName !== "강성용" && toName !== userName) {
        return alert("본인의 셀만 선택할 수 있습니다.");
      }

      const updates = {};
      updates[`schedule/${fromKey}`] = { name: toName };
      updates[`schedule/${selectedKey}`] = { name: fromName };

      update(ref(db), updates).then(() => {
        remove(requestRef);
        alert("교체가 완료되었습니다.");
        selectedKey = null;
      });
    });
  });
};

let selectedEmptyKey = null;
let selectedNameKey = null;

function handleCellClick(key, value) {
  selectedKey = key; // ✅ 이 줄 추가

  if (!value) {
    // 빈 자리 클릭
    if (selectedNameKey) {
      assignNameToEmptyCell(selectedNameKey, key);
      selectedNameKey = null;
    } else {
      selectedEmptyKey = key;
      highlightSelected(key);
    }
  } else {
    // 이름 있는 자리 클릭
    if (selectedEmptyKey) {
      assignNameToEmptyCell(key, selectedEmptyKey);
      selectedEmptyKey = null;
    } else {
      selectedNameKey = key;
      highlightSelected(key);
    }
  }
}

function assignNameToEmptyCell(fromKey, toKey) {
  get(ref(db, `schedule/${fromKey}`)).then(snap => {
    const name = snap.val()?.name;
    if (!name) return alert("배정할 이름이 없습니다.");

    set(ref(db, `schedule/${toKey}`), { name })
      .then(() => {
        alert(`${name}님이 빈자리에 배정되었습니다.`);
        selectedEmptyKey = null;
        selectedNameKey = null;
        selectedKey = null;
      });
  });
}
