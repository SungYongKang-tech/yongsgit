// script.js
import { db } from './firebase.js';
import { ref, onValue, set, get, update, remove } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// 🔽 스크립트 하단에 추가
window.importSchedule = function () {
  if (!confirm("기존 시간표를 덮어씁니다. 계속하시겠습니까?")) return;

  const initialData = {
  mon_0: { name: "김승일" }, tue_0: { name: "정승묵" }, wed_0: { name: "김승일" }, thu_0: { name: "정승묵" },
  mon_1: { name: "이상준" }, tue_1: { name: "박나령" }, wed_1: { name: "이상준" }, thu_1: { name: "박나령" },
  mon_2: { name: "이양주" }, tue_2: { name: "양충현" }, wed_2: { name: "이양주" }, thu_2: { name: "양충현" },
  mon_3: { name: "조보미" }, tue_3: { name: "송은아" }, wed_3: { name: "조보미" }, thu_3: { name: "송은아" },
  mon_4: { name: "고은선" }, tue_4: { name: "임춘근" }, wed_4: { name: "고은선" }, thu_4: { name: "임춘근" }
};


  set(scheduleRef, initialData)
    .then(() => {
      alert("시간표가 업로드되었습니다.");
    })
    .catch((error) => {
      alert("업로드 중 오류 발생: " + error.message);
    });
};


const scheduleRef = ref(db, 'schedule');
const requestRef = ref(db, 'swapRequest');
const userNameKey = "lessonSwapUserName";
let userName = localStorage.getItem(userNameKey);
if (!userName) {
  userName = prompt("이름을 입력하세요:");
  localStorage.setItem(userNameKey, userName);
}
document.getElementById("userNameDisplay").textContent = `안녕하세요, ${userName}님`;

// ✅ 이 아래에 추가
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
  if (!selectedKey) return alert("먼저 본인의 셀을 선택하세요.");
  
  get(ref(db, `schedule/${selectedKey}`)).then(snap => {
    const currentName = snap.val()?.name;
    if (currentName !== userName) {
      return alert("본인의 셀만 선택할 수 있습니다.");
    }

    set(requestRef, {
      from: { key: selectedKey, name: userName },
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

    if (fromName === userName) return alert("자기 자신과는 교체할 수 없습니다.");

    get(ref(db, `schedule/${selectedKey}`)).then(toSnap => {
      const toName = toSnap.val()?.name;
      if (toName !== userName) {
        return alert("본인의 셀만 선택할 수 있습니다.");
      }

      // 실제 교체 진행
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
