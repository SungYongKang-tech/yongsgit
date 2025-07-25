// script.js
import { db } from './firebase.js';
import { ref, onValue, set, get, update, remove } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const scheduleRef = ref(db, 'schedule');
const requestRef = ref(db, 'swapRequest');
const userNameKey = "lessonSwapUserName";
let userName = localStorage.getItem(userNameKey);
if (!userName) {
  userName = prompt("이름을 입력하세요:");
  localStorage.setItem(userNameKey, userName);
}
document.getElementById("userNameDisplay").textContent = `안녕하세요, ${userName}님`;

window.changeName = function () {
  localStorage.removeItem(userNameKey);
  location.reload();
};

let selectedKey = null;

function renderSchedule(data) {
  const container = document.getElementById("scheduleContainer");
  container.innerHTML = "";
  const table = document.createElement("table");
  const header = "<tr><th>교시</th><th>월</th><th>화</th><th>수</th><th>목</th></tr>";
  table.innerHTML = header;

  const periods = ["0교시", "1교시", "2교시", "3교시", "4교시"];
  const days = ["mon", "tue", "wed", "thu"];

  periods.forEach((period, pIdx) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${period}</td>`;
    days.forEach(day => {
      const key = `${day}_${pIdx}`;
      const cell = document.createElement("td");
      const value = data[key]?.name || "";

      if (value) {
        cell.textContent = value;
        if (value === userName) {
          cell.style.fontWeight = "bold";
        }
      } else {
        cell.classList.add("empty");
      }

      cell.onclick = () => {
        selectedKey = key;
        highlightSelected(key);
      };

      row.appendChild(cell);
    });
    table.appendChild(row);
  });

  container.appendChild(table);
}

function highlightSelected(key) {
  document.querySelectorAll("td").forEach(td => td.style.backgroundColor = "");
  const cell = [...document.querySelectorAll("td")].find(td => td.textContent.includes(userName));

  if (cell) cell.style.fontWeight = "bold";
  const selected = [...document.querySelectorAll("td")].find(td => td.onclick && td.onclick.toString().includes(key));
  if (selected) selected.style.backgroundColor = "#b3e5fc";
}

window.markAbsent = function () {
  if (!selectedKey) return alert("셀을 선택하세요.");
  set(ref(db, `schedule/${selectedKey}`), { name: "" });
  selectedKey = null;
};

window.requestSwap = function () {
  if (!selectedKey) return alert("본인의 셀을 먼저 선택하세요.");
  get(ref(db, `schedule/${selectedKey}`)).then(snap => {
    if (snap.exists() && snap.val().name === userName) {
      set(requestRef, {
        from: { key: selectedKey, name: userName },
        status: "pending"
      });
      alert("교체 요청이 등록되었습니다. 상대방에게 셀 클릭 후 승인 요청하세요.");
    } else {
      alert("본인의 셀만 선택할 수 있습니다.");
    }
  });
};

window.approveSwap = function () {
  if (!selectedKey) return alert("셀을 선택하세요.");
  get(requestRef).then(snap => {
    if (snap.exists()) {
      const request = snap.val();
      if (request.status === "pending") {
        const fromKey = request.from.key;
        const fromName = request.from.name;
        get(ref(db, `schedule/${selectedKey}`)).then(toSnap => {
          const toName = toSnap.val()?.name;
          set(ref(db, `schedule/${selectedKey}`), { name: fromName });
          set(ref(db, `schedule/${fromKey}`), { name: toName || "" });
          remove(requestRef);
          alert("교체가 완료되었습니다.");
        });
      }
    } else {
      alert("진행 중인 요청이 없습니다.");
    }
  });
};

onValue(scheduleRef, (snapshot) => {
  const data = snapshot.val() || {};
  renderSchedule(data);
});