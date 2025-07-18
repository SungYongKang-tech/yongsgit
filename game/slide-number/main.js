import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getDatabase, ref, set, get, child
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyCoHcYm0_fdpCcJbyh6PO60fjOZZKoR8xg",
  authDomain: "number-baseball-aee52.firebaseapp.com",
  databaseURL: "https://number-baseball-aee52-default-rtdb.firebaseio.com",
  projectId: "number-baseball-aee52",
  storageBucket: "number-baseball-aee52.appspot.com",
  messagingSenderId: "998537150772",
  appId: "1:998537150772:web:905808137b15084d91a561"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// 변수 정의
let tiles = [...Array(15).keys()].map(i => i + 1).concat('');
let startTime, timerInterval, completed = false;

const board = document.getElementById('board');
const timerEl = document.getElementById('timer');
const statusEl = document.getElementById('status');

// 시간 포맷
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 셔플
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 타이머 시작
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = `⏱️ ${formatTime(elapsed)}`;
  }, 1000);
}

// 보드 렌더링
function render() {
  board.innerHTML = '';
  tiles.forEach((val, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    if (val === '') tile.classList.add('empty');
    tile.textContent = val;
    tile.onclick = () => moveTile(i);
    board.appendChild(tile);
  });
}

// 타일 이동
function moveTile(index) {
  if (completed) return;
  const emptyIndex = tiles.indexOf('');
  const diff = Math.abs(index - emptyIndex);
  const sameRow = Math.floor(index / 4) === Math.floor(emptyIndex / 4);
  if ((diff === 1 && sameRow) || diff === 4) {
    [tiles[index], tiles[emptyIndex]] = [tiles[emptyIndex], tiles[index]];
    render();
    checkWin();
  }
}

// 승리 확인
function checkWin() {
  const solved = [...Array(15).keys()].map(i => i + 1).concat('');
  if (JSON.stringify(tiles) === JSON.stringify(solved)) {
    completed = true;
    clearInterval(timerInterval);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    statusEl.textContent = `🎉 퍼즐 완료! 시간: ${formatTime(elapsed)}`;
    checkAndSaveRanking(elapsed);
  }
}

// 순위 저장
function saveRanking(name, timeSec) {
  return set(ref(db, 'puzzleRankings/' + name), timeSec);
}

// 순위 출력
function loadTopRankings() {
  const dbRef = ref(db);
  get(child(dbRef, 'puzzleRankings')).then(snapshot => {
    const list = document.getElementById('rankingList');
    list.innerHTML = '';
    if (snapshot.exists()) {
      const data = snapshot.val();
      const sorted = Object.entries(data)
        .map(([name, time]) => ({ name, time }))
        .sort((a, b) => a.time - b.time)
        .slice(0, 10);
      sorted.forEach(entry => {
        const li = document.createElement('li');
        li.textContent = `${entry.name} - ${formatTime(entry.time)}`;
        list.appendChild(li);
      });
    }
  });
}

// 상위 10위 안인지 판별
function checkAndSaveRanking(newTime) {
  const dbRef = ref(db);
  get(child(dbRef, 'puzzleRankings')).then(snapshot => {
    const data = snapshot.val() || {};
    const sorted = Object.entries(data)
      .map(([name, time]) => ({ name, time }))
      .sort((a, b) => a.time - b.time);

    if (sorted.length < 10 || newTime < sorted[9].time) {
      const name = prompt("🎉 10등 안에 들었습니다! 이름을 입력하세요:");
      if (name) {
        saveRanking(name, newTime).then(loadTopRankings);
      }
    } else {
      alert("좋은 기록이지만 10위 안에는 들지 못했습니다.");
      loadTopRankings();
    }
  });
}

// 실행
shuffle(tiles);
render();
startTimer();
loadTopRankings();
