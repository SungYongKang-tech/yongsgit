import { db } from './firebase.js';
import { ref, onValue, set } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const scheduleRef = ref(db, 'schedule');
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

window.importSchedule = async function () {
  const confirmUpload = confirm("정말 Firebase에 시간표를 업로드하시겠습니까?");
  if (!confirmUpload) return;

  const schedule = {};
  const names = [
    ["김승일", "정승목", "김승일", "정승목"],
    ["이상준", "박나령", "이상준", "박나령"],
    ["이낭주", "양충현", "이낭주", "양충현"],
    ["조보미", "송은아", "조보미", "송은아"],
    ["고은선", "임춘근", "고은선", "임춘근"]
  ];
  const days = ["mon", "tue", "wed", "thu"];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      schedule[`${days[j]}_${i}`] = { name: names[i][j] };
    }
  }

  try {
    await set(ref(db, 'schedule'), schedule);
    alert("✅ 시간표 업로드 성공!");
  } catch (e) {
    alert("❌ 오류 발생: " + e.message);
  }
};

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
      const value = data[key]?.name ?? "";
      if (value) {
        cell.textContent = value;
        if (value === userName) {
          cell.style.fontWeight = "bold";
        }
        cell.innerHTML += `<br><button class="btn" onclick="markAbsent('${key}')">불참</button>`;
      } else {
        cell.classList.add("empty");
        cell.innerHTML = `<button class="btn" onclick="joinLesson('${key}')">참가하기</button>`;
      }
      row.appendChild(cell);
    });
    table.appendChild(row);
  });

  container.appendChild(table);
}

window.markAbsent = function (key) {
  set(ref(db, `schedule/${key}`), { name: "" });
};

window.joinLesson = function (key) {
  set(ref(db, `schedule/${key}`), { name: userName });
};

onValue(scheduleRef, (snapshot) => {
  const data = snapshot.val() || {};
  console.log("🔥 불러온 시간표 데이터:", data);
  renderSchedule(data);
});
