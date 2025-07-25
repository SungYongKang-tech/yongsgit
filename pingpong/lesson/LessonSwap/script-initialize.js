// schedule 초기값을 Firebase에 등록하는 스크립트
import { db } from './firebase.js';
import { ref, set } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// 초기 시간표 데이터
const initialSchedule = {};

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
    const key = `${days[j]}_${i}`;
    initialSchedule[key] = { name: names[i][j] };
  }
}

set(ref(db, 'schedule'), initialSchedule)
  .then(() => {
    alert('✅ Firebase에 시간표가 성공적으로 업로드되었습니다!');
  })
  .catch((error) => {
    alert('❌ 업로드 중 오류 발생: ' + error.message);
  });
