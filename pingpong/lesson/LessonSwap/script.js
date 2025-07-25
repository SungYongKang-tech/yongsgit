import { db } from './firebase.js';
import {
  ref,
  onValue,
  set,
  get,
  update
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const scheduleRef = ref(db, 'schedule');
const swapRef = ref(db, 'swapRequest');
const userNameKey = "lessonSwapUserName";
let selectedKey = null;
let selectedName = null;

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
  const names = [
    ["김승일", "정승목", "김승일", "정승목"],
    ["이상준", "박나령", "이상준", "박나령"],
    ["이낭주", "양충현", "이낭주", "양충현"],
    ["조보미", "송은아", "조보미", "송은아"],
    ["고은선", "임춘근", "고은선", "임춘근"]
  ];
  const days = ["mon", "tue", "wed", "thu"];
  const schedule = {};
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      schedule[`${days[j]}_${i}`] = { name: names[i][j] };
    }
  }
  await set(scheduleRef, schedule);
  alert("✅ 시간표 업로드 완료");
};

// 셀 클릭 → 선택 토글
function selectCell(key, name, element) {
  document.querySelectorAll("td").forEach(td => td.classList.remove("selected"));
  element.classList.add("selected");
  selectedKey = key;
  selectedName = name;
}

// 시간표 렌더링
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
      const name = data[key]?.name ?? "";

      if (name) {
        cell.innerHTML = `<div>${name}</div>`;
        if (name === userName) {
          cell.style.fontWeight = "bold";
        }
      } else {
        cell.classList.add("empty");
        cell.innerHTML = `<div style="color:gray">비어 있음</div>`;
      }

      // 클릭 시 선택
      cell.onclick = () => selectCell(key, name, cell);
      row.appendChild(cell);
    });
    table.appendChild(row);
  });

  container.appendChild(table);
}

window.handleAbsent = function () {
  if (!selectedKey) return alert("셀을 먼저 선택하세요.");
  set(ref(db, `schedule/${selectedKey}`), { name: "" });
  selectedKey = null;
};

window.requestSwap = function () {
  if (!selectedKey || !selectedName) return alert("다른 사람의 셀을 선택하세요.");
  if (selectedName === userName) return alert("자기 자신에게는 요청할 수 없습니다.");
  const request = {
    from: { key: null, name: userName },
    to: { key: selectedKey, name: selectedName },
    status: "pending"
  };
  // 내 이름이 있는 셀 찾아서 저장
  get(scheduleRef).then(snap => {
    const schedule = snap.val();
    for (let key in schedule) {
      if (schedule[key].name === userName) {
        request.from.key = key;
        break;
      }
    }
    if (!request.from.key) return alert("현재 본인의 시간표를 찾을 수 없습니다.");
    set(swapRef, request).then(() => alert("🔁 변경 요청이 등록되었습니다."));
  });
};

window.approveSwap = function () {
  if (!selectedKey || selectedName !== userName) {
    return alert("자신의 셀을 선택하고 승인하세요.");
  }
  get(swapRef).then(snap => {
    if (!snap.exists()) return alert("요청이 없습니다.");
    const request = snap.val();
    if (request.status !== "pending") return alert("이미 처리된 요청입니다.");
    // 교체
    const updates = {};
    updates[`schedule/${request.from.key}`] = { name: request.to.name };
    updates[`schedule/${request.to.key}`] = { name: request.from.name };
    updates[`swapRequest/status`] = "approved";

    update(ref(db), updates).then(() => {
      alert("✅ 교체가 완료되었습니다!");
      selectedKey = null;
    });
  });
};

onValue(scheduleRef, (snapshot) => {
  const data = snapshot.val() || {};
  renderSchedule(data);
});
