// /pingpong_main/auto-month-close.js
import { db } from "./firebase.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const pad2 = (n) => String(n).padStart(2, "0");

function kstNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}
function yyyymm(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function ymd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function lastDayOfMonthKST(d) {
  // KST 기준 말일
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

async function loadMembersByName() {
  const snap = await get(ref(db, "members"));
  const byName = {};
  if (!snap.exists()) return byName;

  const data = snap.val() || {};
  Object.entries(data).forEach(([uid, p]) => {
    if (!p?.name) return;
    const name = String(p.name).trim();
    byName[name] = { uid, name, bu: Number(p.bu ?? 99) };
  });
  return byName;
}

/**
 * ✅ 월마감 자동 저장
 * - 월말(말일) 또는 다음달 1일에만 실행
 * - monthlyReports/YYYY-MM/meta/closed 잠금으로 중복 방지
 * - matches는 읽기만, monthlyReports만 갱신
 */
export async function autoMonthCloseIfNeeded() {
  const now = kstNow();
  const month = yyyymm(now);
  const today = now.getDate();
  const lastDay = lastDayOfMonthKST(now);

  // ✅ 월말 또는 1일에만 자동 수행
  const shouldRun = today === lastDay || today === 1;
  if (!shouldRun) return { ran: false, reason: "not-scheduled-day", month };

  // ✅ 이미 월마감 저장되었으면 종료
  const lockSnap = await get(ref(db, `monthlyReports/${month}/meta/closed`));
  if (lockSnap.exists() && lockSnap.val() === true) {
    return { ran: false, reason: "already-closed", month };
  }

  // ✅ matches가 비어있으면 종료
  const mSnap = await get(ref(db, "matches"));
  if (!mSnap.exists()) return { ran: false, reason: "matches-empty", month };

  const matches = Object.values(mSnap.val() || {});
  if (!matches.length) return { ran: false, reason: "matches-empty", month };

  const membersByName = await loadMembersByName();

  // 선수별 집계
  const agg = {}; // uid -> {uid,name,bu,total,win,lose}

  for (const m of matches) {
    if (!["A", "B"].includes(m?.winnerSide)) continue;

    const sideA = (m.namesA || []).map((s) => String(s).trim());
    const sideB = (m.namesB || []).map((s) => String(s).trim());
    const winA = m.winnerSide === "A";

    // A팀
    for (const name of sideA) {
      const info = membersByName[name];
      if (!info) continue;
      if (!agg[info.uid]) agg[info.uid] = { ...info, total: 0, win: 0, lose: 0 };
      agg[info.uid].total++;
      if (winA) agg[info.uid].win++;
      else agg[info.uid].lose++;
    }

    // B팀
    for (const name of sideB) {
      const info = membersByName[name];
      if (!info) continue;
      if (!agg[info.uid]) agg[info.uid] = { ...info, total: 0, win: 0, lose: 0 };
      agg[info.uid].total++;
      if (!winA) agg[info.uid].win++;
      else agg[info.uid].lose++;
    }
  }

  const nowMs = Date.now();
  const updates = {};

  Object.values(agg).forEach((p) => {
    const rate = p.total ? Math.round((p.win / p.total) * 1000) / 10 : 0; // 소수1자리
    updates[`monthlyReports/${month}/players/${p.uid}`] = {
      uid: p.uid,
      name: p.name,
      bu: p.bu,
      total: p.total,
      win: p.win,
      lose: p.lose,
      rate,
      updatedAt: nowMs,
    };
  });

  // ✅ 잠금(중복 저장 방지)
  updates[`monthlyReports/${month}/meta`] = {
    month,
    closed: true,
    closedAt: nowMs,
    closedDate: ymd(now),
    source: "matches-auto",
  };

  await update(ref(db), updates);
  return { ran: true, month, players: Object.keys(agg).length, matches: matches.length };
}