function formatWon(value) {
      const num = Number(value || 0);
      const sign = num > 0 ? "+" : "";
      return sign + num.toLocaleString() + "원";
    }

    function formatPlainWon(value) {
      const num = Number(value || 0);
      return num.toLocaleString() + "원";
    }

    function formatRate(value) {
      const num = Number(value || 0);
      const sign = num > 0 ? "+" : "";
      return sign + num.toFixed(2) + "%";
    }

    function strategyLabel(group) {
  const normalized = normalizeStrategyGroup(group);

  if (normalized === "OPEN") return "🚀 Open";
  if (normalized === "CORE") return "🛡️ Core";
  if (normalized === "VOLUME") return "📊 Volume";
  return "❔ 미분류";
}

function strategyOrder(group) {
  const normalized = normalizeStrategyGroup(group);

  if (normalized === "OPEN") return 1;
  if (normalized === "CORE") return 2;
  if (normalized === "VOLUME") return 3;
  return 4;
}

function normalizeStrategyGroup(group) {
  const value = String(group || "").trim().toUpperCase();

  if (value === "OPEN") return "OPEN";
  if (value === "CORE") return "CORE";
  if (value === "VOLUME") return "VOLUME";
  return "UNKNOWN";
}

function formatShortTime(value) {
  if (!value) return "-";

  const text = String(value);
  const match = text.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})/);

  if (!match) return text.slice(0, 16);

  let hour = Number(match[2]);
  const minute = match[3];

  if (match[1] === "오후" && hour < 12) hour += 12;
  if (match[1] === "오전" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${minute}`;
}


function formatKstBuyTime(value, textValue = null) {
  const candidates = [textValue, value];

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;

    let date = null;
    if (typeof candidate === "number" || /^\d{12,13}$/.test(String(candidate).trim())) {
      const ms = Number(candidate);
      if (Number.isFinite(ms) && ms > 0) date = new Date(ms);
    } else {
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) date = parsed;
    }

    if (date && !Number.isNaN(date.getTime())) {
      const parts = new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(date);

      const get = type => parts.find(part => part.type === type)?.value || "";
      return `${Number(get("month"))}/${Number(get("day"))} ${get("hour")}:${get("minute")}:${get("second")}`;
    }
  }

  return "-";
}

function scoreInt(value, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(number);
}

function scoreText(value) {
  const number = scoreInt(value, null);
  return number === null ? "-" : String(number);
}

function signedScoreText(value) {
  const number = scoreInt(value, 0);
  return `${number >= 0 ? "+" : ""}${number}`;
}


function setMarketTemperature(mt = {}) {
  const el = document.getElementById("marketTemperature");
  if (!el) return;
  const level = String(mt.level || "").toUpperCase();
  const label = mt.label || "-";
  const advanceValue = Number(mt.advanceRatio || 0);
  const declineValue = Number(mt.declineRatio || 0);
  const flatValue = Number(
    mt.flatRatio ??
    mt.unchangedRatio ??
    Math.max(0, 100 - advanceValue - declineValue)
  );
  const score = Number(
    mt.score ??
    mt.marketScore ??
    mt.temperatureScore ??
    0
  );

  const icon =
    level === "HOT" || level === "STRONG"
      ? "🔥"
      : level === "NORMAL"
        ? "🟡"
        : level === "CAUTION" || level === "WEAK"
          ? "🟠"
          : level === "COLD" ||
            level === "DANGER" ||
            level === "VERY_WEAK"
            ? "🔵"
            : "⚪";

  const className =
    level === "HOT" || level === "STRONG"
      ? "market-hot"
      : level === "NORMAL"
        ? "market-normal"
        : level === "CAUTION" || level === "WEAK"
          ? "market-caution"
          : level === "COLD" ||
            level === "DANGER" ||
            level === "VERY_WEAK"
            ? "market-cold"
            : "";

  el.classList.remove(
    "market-hot",
    "market-normal",
    "market-caution",
    "market-cold"
  );

  if (className) {
    el.classList.add(className);
  }

  el.textContent = mt.label
    ? `${icon} ${label}${score > 0 ? ` (${score.toFixed(0)}점)` : ""}`
    : "-";
  setValue("marketAdvanceRatio", `${advanceValue.toFixed(1)}%`);
  setValue("marketDeclineRatio", `${declineValue.toFixed(1)}%`);
  setValue("marketFlatRatio", `${flatValue.toFixed(1)}%`);
  setValue("marketScoreValue", score > 0 ? `${score.toFixed(0)}점` : "-");

  setValue(
  "marketAverageChangeRate",
  `${Number(mt.averageChangeRate || 0).toFixed(2)}%`,
  "rate"
);

setValue(
  "marketVolumePassRatio",
  `${Number(mt.volumePassRatio || 0).toFixed(1)}%`
);

}

function setStatus(id, text, state = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "warn", "bad");
  if (state) el.classList.add(state);
}


function renderOperationalBlockedTop(list = []) {
  const box =
    document.getElementById(
      "operationalBlockedTopBox"
    );

  if (!box) return;

  const rows = Array.isArray(list)
    ? [...list]
        .sort(
          (a, b) =>
            Number(
              b.highestAfterBlockRate || 0
            ) -
            Number(
              a.highestAfterBlockRate || 0
            )
        )
        .slice(0, 5)
    : [];

  if (!rows.length) {
    box.className = "empty";
    box.innerHTML =
      "현재까지 기본 매수조건을 통과한 운영상 차단 후보가 없습니다.";
    return;
  }

  box.className = "mobile-card-list";

  box.innerHTML = rows.map((item, index) => {
    const firstPrice =
      Number(item.firstBlockedPrice || 0);

    const currentPrice =
      Number(item.currentPrice || 0);

    const highestPrice =
      Number(
        item.highestPrice ||
        currentPrice ||
        0
      );

    const currentRate =
      Number(
        item.currentAfterBlockRate ??
        (
          firstPrice > 0
            ? (
                (
                  currentPrice -
                  firstPrice
                ) /
                firstPrice
              ) * 100
            : 0
        )
      );

    const highestRate =
      Number(
        item.highestAfterBlockRate ??
        (
          firstPrice > 0
            ? (
                (
                  highestPrice -
                  firstPrice
                ) /
                firstPrice
              ) * 100
            : 0
        )
      );

    const discoverScore =
      Number(item.discoverScore || 0);

    const volumeRatio =
      Number(item.volumeRatio || 0);

    const dayPosition =
      Number(item.dayPosition || 0);

    const changeRate =
      Number(item.changeRate || 0);

    return `
      <div class="stock-card">
        <div class="stock-card-header">
          <div>
            <div class="stock-name">
              ${index + 1}위
              ${item.name || "-"}
            </div>

            <div class="stock-sub">
              ${item.code || ""} /
              ${strategyLabel(
                item.strategyGroup
              )}
            </div>

            <div class="stock-sub">
              최초 차단
              ${formatShortTime(
                item.firstBlockedAtText ||
                item.firstBlockedAt
              )}
              /
              마지막 확인
              ${formatShortTime(
                item.lastCheckedAtText ||
                item.lastCheckedAt
              )}
            </div>
          </div>

          <div class="stock-rate ${
            currentRate >= 0
              ? "plus"
              : "minus"
          }">
            ${formatRate(currentRate)}
          </div>
        </div>

        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">
              차단 사유
            </div>
            <div class="info-value">
              ${item.blockCategory || "-"}
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              차단 당시 가격
            </div>
            <div class="info-value">
              ${
                firstPrice
                  ? firstPrice.toLocaleString() +
                    "원"
                  : "-"
              }
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              현재가
            </div>
            <div class="info-value">
              ${
                currentPrice
                  ? currentPrice.toLocaleString() +
                    "원"
                  : "-"
              }
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              차단 후 현재
            </div>
            <div class="info-value ${
              currentRate >= 0
                ? "plus"
                : "minus"
            }">
              ${formatRate(currentRate)}
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              차단 후 최고
            </div>
            <div class="info-value ${
              highestRate >= 0
                ? "plus"
                : "minus"
            }">
              ${formatRate(highestRate)}
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              최고가
            </div>
            <div class="info-value">
              ${
                highestPrice
                  ? highestPrice.toLocaleString() +
                    "원"
                  : "-"
              }
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              발견점수
            </div>
            <div class="info-value">
              ${
                discoverScore
                  ? discoverScore.toFixed(1)
                  : "-"
              }
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              거래량비율
            </div>
            <div class="info-value">
              ${
                volumeRatio
                  ? volumeRatio.toFixed(1) +
                    "%"
                  : "-"
              }
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              당일위치
            </div>
            <div class="info-value">
              ${
                dayPosition
                  ? dayPosition.toFixed(1) +
                    "%"
                  : "-"
              }
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">
              당시 상승률
            </div>
            <div class="info-value ${
              changeRate >= 0
                ? "plus"
                : "minus"
            }">
              ${formatRate(changeRate)}
            </div>
          </div>
        </div>

        <div class="status-pill status-wait">
          🚫 ${item.blockReason || item.blockCategory || "운영상 차단"}
        </div>
      </div>
    `;
  }).join("");
}

function renderCandidateAnalysis(source = {}) {
  const data = source.candidateAnalysis || {};

  const makeDefaultStats = () => ({
    checked: 0,
    passed: 0,
    bought: 0,
    conditionRejected: {},
    operationalBlocked: {},
    rejected: {}
  });

  const core = data.CORE || makeDefaultStats();
  const volume = data.VOLUME || makeDefaultStats();

  const totalChecked =
    Number(core.checked || 0) +
    Number(volume.checked || 0);

  const totalBought =
    Number(core.bought || 0) +
    Number(volume.bought || 0);

  const corePassed = Number(core.passed || 0);
  const volumePassed = Number(volume.passed || 0);

  setValue("candidateTotal", `${totalChecked}건`);
  setValue("candidateBought", `${totalBought}건`);
  setValue("candidateCorePass", `${corePassed}건`);
  setValue("candidateVolumePass", `${volumePassed}건`);

  const conditionBox =
    document.getElementById("conditionRejectBox");

  const operationalBox =
    document.getElementById("operationalBlockBox");

  const conditionRows = [];
  const operationalRows = [];

  function pushRows(target, strategyGroup, rows = {}) {
    Object.entries(rows || {}).forEach(([reason, count]) => {
      target.push({
        strategyGroup,
        reason,
        count: Number(count || 0)
      });
    });
  }

  /*
   * 신규 구조 우선 사용
   * 기존 rejected만 존재하면 조건 미충족으로 호환 표시
   */
  pushRows(
    conditionRows,
    "CORE",
    core.conditionRejected ||
      core.rejected ||
      {}
  );

  pushRows(
    conditionRows,
    "VOLUME",
    volume.conditionRejected ||
      volume.rejected ||
      {}
  );

  pushRows(
    operationalRows,
    "CORE",
    core.operationalBlocked ||
      {}
  );

  pushRows(
    operationalRows,
    "VOLUME",
    volume.operationalBlocked ||
      {}
  );

  function renderReasonRows(
    box,
    rows,
    emptyText,
    noDataText
  ) {
    if (!box) return;

    if (!rows.length) {
      box.className = "empty";
      box.innerHTML =
        totalChecked > 0
          ? emptyText
          : noDataText;
      return;
    }

    box.className = "stock-card";
    box.innerHTML = rows
      .sort((a, b) => b.count - a.count)
      .map(row => `
        <div class="reason-row"
             style="display:flex; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid #374151;">
          <span>${strategyLabel(row.strategyGroup)} · ${row.reason}</span>
          <b>${row.count}건</b>
        </div>
      `)
      .join("");
  }

  renderReasonRows(
    conditionBox,
    conditionRows,
    "현재까지 집계된 조건 탈락 사유가 없습니다.",
    "오늘 후보 판단 데이터가 아직 없습니다."
  );

  renderReasonRows(
    operationalBox,
    operationalRows,
    "현재까지 운영상 매수 차단이 없습니다.",
    "오늘 운영상 차단 데이터가 아직 없습니다."
  );

  renderOperationalBlockedTop(
    data.operationalBlockedCandidates || []
  );

  const coreTop = Array.isArray(data.coreTopCandidates)
    ? data.coreTopCandidates.map(item => ({
        ...item,
        strategyGroup: item.strategyGroup || "CORE"
      }))
    : [];

  const volumeTop = Array.isArray(data.volumeTopCandidates)
    ? data.volumeTopCandidates.map(item => ({
        ...item,
        strategyGroup: item.strategyGroup || "VOLUME"
      }))
    : [];

  const top = [...coreTop, ...volumeTop]
    .sort((a, b) => {
      const scoreA = Number(
        a.watchScore ??
        a.finalScore ??
        a.finalBuyScore ??
        a.hotScore ??
        a.discoverScore ??
        0
      );

      const scoreB = Number(
        b.watchScore ??
        b.finalScore ??
        b.finalBuyScore ??
        b.hotScore ??
        b.discoverScore ??
        0
      );

      return scoreB - scoreA;
    })
    .slice(0, 10);

  const topBox = document.getElementById("candidateTopBox");

  if (!topBox) return;

  if (!top.length) {
    topBox.className = "empty";
    topBox.innerHTML =
      "현재 후보 강화목록에 저장된 종목이 없습니다.";
    return;
  }

  topBox.className = "mobile-card-list";

  topBox.innerHTML = top.map((item, index) => {
    const snapshot = item.itemSnapshot || {};
    const detail = item.watchScoreDetail || {};

    const score = Number(
  item.watchScore ??
  item.finalScore ??
  item.finalBuyScore ??
  item.hotScore ??
  item.discoverScore ??
  0
);

    const discoverScore = Number(
      item.discoverScore ??
      snapshot.discoverScore ??
      detail.discoverScore ??
      0
    );

    const rate = Number(
      item.changeRate ??
      snapshot.changeRate ??
      detail.changeRate ??
      0
    );

    const volumeRatio = Number(
      item.volumeRatio ??
      snapshot.tradeVolumeRatio ??
      detail.volumeRatio ??
      0
    );

    const dayPosition = Number(
      item.dayPosition ??
      snapshot.dayPosition ??
      detail.dayPosition ??
      0
    );

    const currentPrice = Number(
      item.currentPrice ??
      snapshot.currentPrice ??
      snapshot.price ??
      0
    );

    const firstPrice = Number(item.firstPrice || 0);
    const highestPrice = Number(
      item.highestPrice ??
      item.highPrice ??
      snapshot.highestPrice ??
      snapshot.highPrice ??
      currentPrice ??
      0
    );

    const priceChangeRate = firstPrice > 0
      ? ((currentPrice - firstPrice) / firstPrice) * 100
      : 0;

    const highestChangeRate = firstPrice > 0 && highestPrice > 0
      ? ((highestPrice - firstPrice) / firstPrice) * 100
      : 0;

    return `
      <div class="stock-card">
        <div class="stock-card-header">
          <div>
            <div class="stock-name">
              <span class="candidate-rank">${index + 1}위</span>
              ${item.name || snapshot.name || "-"}
            </div>
            <div class="stock-sub">
              ${item.code || snapshot.code || ""} /
              ${strategyLabel(item.strategyGroup)}
            </div>
            <div class="stock-sub">
              최초발견 ${formatShortTime(item.firstSeenAtText || item.firstSeenAt)} /
              마지막확인 ${formatShortTime(item.lastSeenAtText || item.lastSeenAt || data.updatedAt)}
            </div>
          </div>

          <div class="stock-rate ${priceChangeRate >= 0 ? "plus" : "minus"}">
            ${formatRate(priceChangeRate)}
          </div>
        </div>

        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">후보강화 점수</div>
            <div class="info-value">${score ? score.toFixed(1) : "-"}</div>
          </div>

          <div class="info-box">
            <div class="info-label">발견점수</div>
            <div class="info-value">${discoverScore ? discoverScore.toFixed(1) : "-"}</div>
          </div>

          <div class="info-box">
            <div class="info-label">거래량비율</div>
            <div class="info-value">${volumeRatio ? volumeRatio.toFixed(1) + "%" : "-"}</div>
          </div>

          <div class="info-box">
            <div class="info-label">당일위치</div>
            <div class="info-value">${dayPosition ? dayPosition.toFixed(1) + "%" : "-"}</div>
          </div>

          <div class="info-box">
            <div class="info-label">현재 상승률</div>
            <div class="info-value ${rate >= 0 ? "plus" : "minus"}">${formatRate(rate)}</div>
          </div>

          <div class="info-box">
            <div class="info-label">발견가</div>
            <div class="info-value">${firstPrice ? firstPrice.toLocaleString() + "원" : "-"}</div>
          </div>

          <div class="info-box">
            <div class="info-label">현재가</div>
            <div class="info-value">${currentPrice ? currentPrice.toLocaleString() + "원" : "-"}</div>
          </div>

          <div class="info-box">
            <div class="info-label">후보 이후 최고가</div>
            <div class="info-value">${highestPrice ? highestPrice.toLocaleString() + "원" : "-"}</div>
          </div>

          <div class="info-box">
            <div class="info-label">후보 이후 최고수익률</div>
            <div class="info-value ${highestChangeRate >= 0 ? "plus" : "minus"}">
              ${firstPrice > 0 && highestPrice > 0 ? formatRate(highestChangeRate) : "-"}
            </div>
          </div>
        </div>

        <div style="margin-top:9px; padding:10px; background:#111827; border-radius:10px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <div style="font-size:12px; color:#9ca3af; margin-bottom:3px;">후보 이후</div>
            <div style="font-size:12px; color:#9ca3af;">최초 발견가 기준</div>
          </div>
          <div class="${priceChangeRate >= 0 ? "plus" : "minus"}" style="font-size:20px; font-weight:bold;">
            ${firstPrice > 0 ? `${priceChangeRate >= 0 ? "▲" : "▼"} ${formatRate(priceChangeRate)}` : "-"}
          </div>
        </div>

        <div class="status-pill status-wait">
          👀 후보 강화 관찰 중
        </div>
      </div>
    `;
  }).join("");
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getMissedWinnerRecommendation(summary = {}) {
  const counts = summary.categoryCounts || {};
  const entries = Object.entries(counts)
    .filter(([category]) => category !== "매수 완료")
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));

  if (!entries.length) {
    return "오늘은 조건별 미매수 원인이 아직 충분히 집계되지 않았습니다. 최소 3~5거래일 데이터를 모은 뒤 매수조건을 조정하는 것이 안전합니다.";
  }

  const [category, count] = entries[0];
  return `오늘 가장 많이 확인된 원인은 ‘${category}’ ${Number(count || 0)}건입니다. 지금 바로 기준을 완화하지 말고, 해당 종목들의 최종 상승률과 반복 빈도를 3~5거래일 누적한 뒤 1개 조건만 조정하세요.`;
}

function renderMissedWinners(data = {}) {
  const box = document.getElementById("missedWinnersBox");
  if (!box) return;

  if (data.ok === false) {
    box.className = "empty";
    box.innerHTML = escapeHtml(data.message || "놓친 상승종목 분석을 불러오지 못했습니다.");
    return;
  }

  if (data.ready === false) {
    box.className = "empty";
    box.innerHTML = `
      <div style="font-weight:bold; margin-bottom:6px;">아직 오늘 상승 종목 목록이 저장되지 않았습니다.</div>
      <div style="font-size:12px; line-height:1.6;">${escapeHtml(data.message || "장 종료 후 분석 데이터가 생성되면 이곳에 표시됩니다.")}</div>
    `;
    return;
  }

  const summary = data.summary || {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const categoryCounts = summary.categoryCounts || {};

  const categoryHtml = Object.entries(categoryCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([category, count]) => `
      <div class="missed-category-row">
        <span>${escapeHtml(category)}</span>
        <b>${Number(count || 0)}건</b>
      </div>
    `).join("");

  const cards = rows
    .filter(item => !item.bought)
    .slice(0, 20)
    .map((item, index) => {
      const strategyRows = Array.isArray(item.strategies) ? item.strategies : [];
      const strategyText = strategyRows.length
        ? strategyRows.map(row => strategyLabel(row.strategyGroup)).join(" / ")
        : "미발견";

      const firstChangeRates = strategyRows
        .map(row => Number(row.first?.changeRate))
        .filter(Number.isFinite);

      const firstChangeRate = firstChangeRates.length
        ? firstChangeRates[0]
        : null;

      const afterRate = firstChangeRate !== null
        ? Number(item.changeRate || 0) - firstChangeRate
        : null;

      return `
        <div class="stock-card">
          <div class="stock-card-header">
            <div>
              <div class="stock-name">${index + 1}위 ${escapeHtml(item.name || "-")}</div>
              <div class="stock-sub">${escapeHtml(item.code || "")} / ${strategyText}</div>
              <div class="stock-sub">최초발견 ${formatShortTime(item.firstSeenAt)} / 마지막확인 ${formatShortTime(item.latestCheckedAt)}</div>
            </div>
            <div class="stock-rate plus">${formatRate(item.changeRate || 0)}</div>
          </div>

          <div class="info-grid">
            <div class="info-box">
              <div class="info-label">발견 여부</div>
              <div class="info-value">${item.discovered ? "발견" : "미발견"}</div>
            </div>
            <div class="info-box">
              <div class="info-label">최종 분류</div>
              <div class="info-value">${escapeHtml(item.resultCategory || "-")}</div>
            </div>
            <div class="info-box">
              <div class="info-label">최고 후보점수</div>
              <div class="info-value">${Number(item.bestWatchScore || 0).toFixed(1)}</div>
            </div>
            <div class="info-box">
              <div class="info-label">종가</div>
              <div class="info-value">${Number(item.closePrice || 0) ? Number(item.closePrice).toLocaleString() + "원" : "-"}</div>
            </div>
            <div class="info-box">
              <div class="info-label">고가</div>
              <div class="info-value">${Number(item.highPrice || 0) ? Number(item.highPrice).toLocaleString() + "원" : "-"}</div>
            </div>
            <div class="info-box">
              <div class="info-label">발견 이후 추가상승</div>
              <div class="info-value ${afterRate === null || afterRate >= 0 ? "plus" : "minus"}">${afterRate === null ? "-" : formatRate(afterRate)}</div>
            </div>
          </div>

          <div style="margin-top:9px; padding:10px; background:#111827; border-radius:10px; font-size:13px; line-height:1.55;">
            <div style="color:#9ca3af; margin-bottom:4px;">미매수 원인</div>
            <b>${escapeHtml(item.resultReason || item.resultCategory || "원인 기록 없음")}</b>
          </div>
        </div>
      `;
    }).join("");

  box.className = "";
  box.innerHTML = `
    <div class="missed-summary-grid">
      <div class="missed-summary-item"><div class="missed-summary-label">상승종목</div><div class="missed-summary-value">${Number(summary.risingCount || 0)}개</div></div>
      <div class="missed-summary-item"><div class="missed-summary-label">발견</div><div class="missed-summary-value">${Number(summary.discoveredCount || 0)}개</div></div>
      <div class="missed-summary-item"><div class="missed-summary-label">미발견</div><div class="missed-summary-value">${Number(summary.notDiscoveredCount || 0)}개</div></div>
      <div class="missed-summary-item"><div class="missed-summary-label">매수완료</div><div class="missed-summary-value">${Number(summary.boughtCount || 0)}개</div></div>
      <div class="missed-summary-item"><div class="missed-summary-label">놓친종목</div><div class="missed-summary-value plus">${Number(summary.missedCount || 0)}개</div></div>
      <div class="missed-summary-item"><div class="missed-summary-label">분석기준</div><div class="missed-summary-value">+${Number(data.minChangeRate || 3).toFixed(1)}%</div></div>
    </div>

    <div class="missed-recommendation">
      <b>오늘 수정 검토</b><br>
      ${escapeHtml(getMissedWinnerRecommendation(summary))}
    </div>

    ${categoryHtml ? `<div class="stock-card" style="margin-bottom:10px;"><div style="font-weight:bold; margin-bottom:4px;">원인별 집계</div>${categoryHtml}</div>` : ""}
    <div class="mobile-card-list">${cards || `<div class="empty">미매수 상승종목이 없습니다.</div>`}</div>
  `;
}

async function loadMissedWinnersAnalysis() {
  const box = document.getElementById("missedWinnersBox");
  try {
    const res = await fetch("https://sytrader.duckdns.org/api/missed-winners-analysis", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `API 오류 ${res.status}`);
    renderMissedWinners(data);
  } catch (err) {
    console.error("놓친 상승종목 조회 오류", err);
    if (box) {
      box.className = "empty";
      box.innerHTML = `놓친 상승종목 분석을 불러오지 못했습니다.<br><span style="font-size:12px;">${escapeHtml(err.message)}</span>`;
    }
  }
}

async function refreshMissedWinners() {
  const box = document.getElementById("missedWinnersBox");
  if (box) {
    box.className = "empty";
    box.textContent = "놓친 상승종목 분석을 다시 불러오는 중...";
  }
  await loadMissedWinnersAnalysis();
}


    function showTab(name) {
      const tabMap = { holdings:"holdingsTab", candidates:"candidatesTab", stats:"statsTab", sells:"sellsTab" };
      document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("onclick")?.includes(`'${name}'`));
      });
      document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
      document.getElementById(tabMap[name])?.classList.add("active");
    }

    function setValue(id, value, type) {
      const el = document.getElementById(id);
      if (!el) return;

      el.textContent = value;

      const num = Number(String(value).replace(/[^0-9.-]/g, ""));
      el.classList.remove("plus", "minus");

      if (type === "money" || type === "rate") {
        if (num > 0) el.classList.add("plus");
        if (num < 0) el.classList.add("minus");
      }
    }

    let manualSellInProgressCode = "";

    async function manualSellHolding(code, name, qty) {
      const normalizedCode = String(code || "").trim();
      const stockName = String(name || normalizedCode || "보유종목");
      const sellQty = Number(qty || 0);

      if (!normalizedCode || sellQty <= 0) {
        alert("매도할 종목이나 보유수량을 확인할 수 없습니다.");
        return;
      }

      if (manualSellInProgressCode) {
        alert("다른 수동 매도 요청을 처리 중입니다.");
        return;
      }

      const confirmed = confirm(
        `${stockName} (${normalizedCode}) ${sellQty.toLocaleString()}주를\n` +
        `조회 시점의 현재가로 전량 매도하시겠습니까?\n\n` +
        `※ 화면 가격과 실제 처리 가격은 조회 시점 차이로 달라질 수 있습니다.`
      );

      if (!confirmed) return;

      manualSellInProgressCode = normalizedCode;
      const button = document.querySelector(
        `.manual-sell-btn[data-code="${CSS.escape(normalizedCode)}"]`
      );

      if (button) {
        button.disabled = true;
        button.textContent = "매도 처리 중...";
      }

      try {
        const response = await fetch("/api/manual-paper-sell", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            code: normalizedCode
          })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || data.ok === false) {
          if (data.pending) {
            throw new Error(
              data.message ||
              "수동 매도 요청 처리 결과가 지연되고 있습니다. 보유현황을 새로고침해 주세요."
            );
          }
          throw new Error(data.message || `수동 매도 실패 (${response.status})`);
        }

        alert(
          `${stockName} 전량 매도가 완료되었습니다.\n` +
          `매도가 ${Number(data.sellPrice || 0).toLocaleString()}원 / ` +
          `${Number(data.qty || 0).toLocaleString()}주\n` +
          `실현손익 ${formatWon(data.profit || 0)} (` +
          `${formatRate(data.profitRate || 0)})`
        );

        await loadPerformanceSummary();
      } catch (error) {
        console.error("수동 매도 오류", error);
        alert(error.message || "수동 매도 중 오류가 발생했습니다.");
      } finally {
        manualSellInProgressCode = "";

        if (button) {
          button.disabled = false;
          button.textContent = "현재가 전량매도";
        }
      }
    }


    function getHoldingTrendStatus({
      profitRate = 0,
      highestProfitRate = 0,
      drawdownFromHigh = 0,
      holdingScoreDiff = 0,
      currentDayPositionRate = 0
    } = {}) {
      const profit = Number(profitRate || 0);
      const highest = Number(highestProfitRate || 0);
      const drawdown = Number(drawdownFromHigh || 0);
      const scoreDiff = Number(holdingScoreDiff || 0);
      const dayPosition = Number(currentDayPositionRate || 0);

      if (
        profit >= 1.0 &&
        drawdown > -0.7 &&
        scoreDiff >= -5 &&
        dayPosition >= 55
      ) {
        return {
          tone: "strong",
          icon: "🟢",
          title: "강한 상승 유지",
          detail: "현재가가 고점 부근을 유지하고 보유점수도 안정적입니다."
        };
      }

      if (
        highest >= 1.0 &&
        drawdown <= -1.5
      ) {
        return {
          tone: "warning",
          icon: "🟠",
          title: "고점 이탈 주의",
          detail: `최고가 대비 ${Math.abs(drawdown).toFixed(2)}% 내려온 상태입니다.`
        };
      }

      if (
        scoreDiff <= -15 ||
        dayPosition < 30 ||
        profit <= -1.0
      ) {
        return {
          tone: "danger",
          icon: "🔴",
          title: "추세 약화",
          detail: "보유점수 또는 당일 위치가 크게 약해졌습니다."
        };
      }

      if (
        highest > profit + 0.4 ||
        scoreDiff < 0
      ) {
        return {
          tone: "caution",
          icon: "🟡",
          title: "상승 둔화",
          detail: "상승세는 남아 있지만 최고점 이후 힘이 다소 약해졌습니다."
        };
      }

      return {
        tone: "normal",
        icon: "🔵",
        title: "보유 추세 관찰",
        detail: "뚜렷한 이탈 신호 없이 현재 흐름을 유지하고 있습니다."
      };
    }

    function buildHoldingPriceChart(history = [], buyPrice = 0, currentPrice = 0) {
      const rows = (Array.isArray(history) ? history : [])
        .map(row => ({
          time: Number(row.checkedAt || row.checkedAtMs || row.time || 0),
          price: Number(row.price || row.currentPrice || 0)
        }))
        .filter(row => row.price > 0)
        .slice(-120);

      if (rows.length < 2) {
        return `<div class="holding-chart-empty">가격 흐름 데이터가 아직 충분하지 않습니다.</div>`;
      }

      const width = 640;
      const height = 190;
      const padX = 28;
      const padTop = 24;
      const padBottom = 24;
      const prices = rows.map(row => row.price);
      if (buyPrice > 0) prices.push(Number(buyPrice));
      if (currentPrice > 0) prices.push(Number(currentPrice));
      let minPrice = Math.min(...prices);
      let maxPrice = Math.max(...prices);
      const rangePadding = Math.max(1, (maxPrice - minPrice) * 0.10);
      minPrice -= rangePadding;
      maxPrice += rangePadding;
      if (maxPrice <= minPrice) {
        maxPrice += 1;
        minPrice -= 1;
      }

      const x = index => padX + (index / Math.max(1, rows.length - 1)) * (width - padX * 2);
      const y = price => padTop + ((maxPrice - price) / (maxPrice - minPrice)) * (height - padTop - padBottom);
      const points = rows.map((row, index) => `${x(index).toFixed(1)},${y(row.price).toFixed(1)}`).join(' ');

      const highestIndex = rows.reduce((best, row, index) =>
        row.price > rows[best].price ? index : best, 0);
      const highestRow = rows[highestIndex];
      const currentRow = rows[rows.length - 1];
      const buyX = x(0);
      const buyY = y(Number(buyPrice || rows[0].price));
      const highX = x(highestIndex);
      const highY = y(highestRow.price);
      const currentX = x(rows.length - 1);
      const currentY = y(Number(currentPrice || currentRow.price));
      const firstTime = formatKstBuyTime(rows[0].time, '');
      const lastTime = formatKstBuyTime(currentRow.time, '');

      return `
        <div class="holding-chart-wrap">
          <div class="holding-chart-head">
            <span>보유 후 가격 흐름</span>
            <b>${Number(currentPrice || currentRow.price).toLocaleString()}원</b>
          </div>
          <svg class="holding-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="매수 이후 가격 흐름. 삼각형은 매수, 별은 최고가, 원은 현재가를 표시합니다.">
            <line x1="${padX}" y1="${height/2}" x2="${width-padX}" y2="${height/2}" class="holding-chart-grid" />
            <line x1="${padX}" y1="${buyY.toFixed(1)}" x2="${width-padX}" y2="${buyY.toFixed(1)}" class="holding-chart-buy-line" />
            <polyline points="${points}" class="holding-chart-line" />

            <polygon points="${buyX.toFixed(1)},${(buyY-8).toFixed(1)} ${(buyX-7).toFixed(1)},${(buyY+6).toFixed(1)} ${(buyX+7).toFixed(1)},${(buyY+6).toFixed(1)}" class="holding-marker-buy" />
            <text x="${(buyX+10).toFixed(1)}" y="${(buyY-8).toFixed(1)}" class="holding-marker-label">매수</text>

            <text x="${highX.toFixed(1)}" y="${(highY-7).toFixed(1)}" text-anchor="middle" class="holding-marker-high">★</text>
            <text x="${highX.toFixed(1)}" y="${(highY-20).toFixed(1)}" text-anchor="middle" class="holding-marker-label">최고</text>

            <circle cx="${currentX.toFixed(1)}" cy="${currentY.toFixed(1)}" r="6" class="holding-marker-current" />
            <text x="${(currentX-10).toFixed(1)}" y="${(currentY-10).toFixed(1)}" text-anchor="end" class="holding-marker-label">현재</text>
          </svg>
          <div class="holding-chart-axis">
            <span>${firstTime}</span>
            <span>${lastTime}</span>
          </div>
          <div class="holding-chart-legend">
            <span>▲ 매수 ${Number(buyPrice || 0).toLocaleString()}원</span>
            <span>★ 최고 ${Number(highestRow.price || 0).toLocaleString()}원</span>
            <span>● 현재 ${Number(currentPrice || currentRow.price).toLocaleString()}원</span>
          </div>
        </div>
      `;
    }

    function toggleHoldingDetail(code) {
      const normalizedCode = String(code || '').trim();
      if (!normalizedCode) return;
      const panel = document.getElementById(`holding-detail-${normalizedCode}`);
      const button = document.querySelector(`.holding-name-toggle[data-code="${CSS.escape(normalizedCode)}"]`);
      if (!panel) return;
      const opened = panel.classList.toggle('active');
      if (button) button.setAttribute('aria-expanded', opened ? 'true' : 'false');
    }

    function renderHoldings(list) {
      const box = document.getElementById("holdingBox");

      if (!box) return;

     

      if (!Array.isArray(list) || list.length === 0) {
        box.className = "empty";
        box.innerHTML = "현재 보유 종목이 없습니다.";
        return;
      }

      box.className = "mobile-card-list";

      const sortedList = [...list].sort((a, b) => {
        const groupDiff = strategyOrder(normalizeStrategyGroup(a.strategyGroup)) - strategyOrder(normalizeStrategyGroup(b.strategyGroup));
        if (groupDiff !== 0) return groupDiff;
        return Number(b.profitRate || 0) - Number(a.profitRate || 0);
      });

      let lastGroup = "";

      box.innerHTML = sortedList.map((item, index) => {
        const group = normalizeStrategyGroup(item.strategyGroup);
        const showGroupTitle = group !== lastGroup;
        lastGroup = group;

        const profitRate = Number(item.profitRate || 0);
        const profit = Number(item.profit || 0);
        const drawdownFromHigh = Number(item.drawdownFromHigh || 0);
        const highestProfitRate = Number(item.highestProfitRate || 0);
        const buyAmount = Number(item.buyAmount || 0);
        const evalAmount = Number(item.evalAmount || 0);
        const holdingDays = Number(item.holdingDays || 0);

        const scoreDetails =
  item.discoverScoreDetails ||
  item.scoreDetails ||
  item.finalBuyScoreDetail?.discoverScoreDetails ||
  item.finalBuyScoreDetail?.scoreDetails ||
  item.candidateWatchScoreDetail?.discoverScoreDetails ||
  {};

const finalDetail =
  item.finalBuyScoreDetail ||
  item.candidateWatchScoreDetail ||
  {};

/*
 * CORE/VOLUME 후보점수의 실제 구성값을 우선 표시한다.
 * 예전 보유자료는 discoverScoreDetails가 없을 수 있으므로
 * changeRatePart / volumePart / dayPositionPart를 예비값으로 사용한다.
 */
const rateScore = Number(
  scoreDetails.rate ??
  scoreDetails.riseRate ??
  scoreDetails.changeRate ??
  finalDetail.changeRatePart ??
  item.rateScore ??
  0
);

const volumeScore = Number(
  scoreDetails.volume ??
  scoreDetails.volumeScore ??
  finalDetail.volumePart ??
  item.volumeScore ??
  0
);

const openScore = Number(
  scoreDetails.openStrength ??
  scoreDetails.openScore ??
  finalDetail.openStrengthPart ??
  item.openStrengthScore ??
  0
);

const positionScore = Number(
  scoreDetails.dayPosition ??
  scoreDetails.positionScore ??
  finalDetail.dayPositionPart ??
  item.dayPositionScore ??
  0
);

const discoverPartScore = Number(
  finalDetail.discoverPart ??
  item.discoverScore ??
  0
);

const baseScore = Number(
  item.candidateBaseScore ??
  finalDetail.baseTotal ??
  0
);

const trendPenalty = Number(
  item.candidateTrendPenalty ??
  finalDetail.trendPenalty ??
  0
);

const finalBuyScore = Number(
  item.finalBuyScore ??
  item.candidateWatchScore ??
  finalDetail.total ??
  finalDetail.score ??
  0
);

const marketScore = Number(
  item.marketScore?.score ??
  item.marketScore ??
  item.marketTemperature?.score ??
  finalDetail.marketScore?.score ??
  finalDetail.marketScore ??
  0
);

const leaderStrengthScore = Number(
  item.leaderStrengthScore ??
  item.candidateStrengthScore ??
  finalDetail.leaderStrengthScore ??
  finalDetail.candidateStrengthScore ??
  0
);

const sectorPowerScore = Number(
  item.sectorPowerScore ??
  item.sectorScore ??
  finalDetail.sectorPowerScore ??
  finalDetail.sectorScore ??
  0
);

const buyTimeDisplay = formatKstBuyTime(
  item.buyTime ?? item.buyAt ?? item.buyTimeMs,
  item.buyTimeText
);

const currentChangeRate = Number(
  item.currentChangeRate ??
  item.changeRate ??
  item.holdingScoreHistory?.[item.holdingScoreHistory.length - 1]?.changeRate ??
  0
);
const currentOpenPositionRate = Number(
  item.currentOpenPositionRate ?? item.buyOpenPositionRate ?? 0
);
const currentTradeVolumeRatio = Number(
  item.currentTradeVolumeRatio ??
  item.holdingScoreHistory?.[item.holdingScoreHistory.length - 1]?.tradeVolumeRatio ??
  item.buyTradeVolumeRatio ??
  0
);
const currentDayPositionRate = Number(
  item.currentDayPositionRate ??
  item.holdingScoreHistory?.[item.holdingScoreHistory.length - 1]?.dayPositionRate ??
  item.buyDayPositionRate ??
  0
);
const holdingScore = Number(
  item.holdingScore ??
  item.holdingScoreHistory?.[item.holdingScoreHistory.length - 1]?.holdingScore ??
  finalBuyScore ??
  0
);
const holdingScoreDiff = Number(item.holdingScoreDiff ?? holdingScore - finalBuyScore ?? 0);
const holdingScoreHistory = Array.isArray(item.holdingScoreHistory) ? item.holdingScoreHistory : [];
const holdingTrendStatus = getHoldingTrendStatus({
  profitRate,
  highestProfitRate,
  drawdownFromHigh,
  holdingScoreDiff,
  currentDayPositionRate
});

const openDiagnostic = item.openBuyDiagnostic || item.selectionInputs || {};
const openMomentumScore = Number(item.momentumScore || openDiagnostic.momentumScore || 0);
const openHotMomentumScore = Number(item.hotMomentumScore || openDiagnostic.hotMomentumScore || 0);
const openPricePersistence = Number(item.hotPricePersistence || openDiagnostic.hotPricePersistence || 0);
const openVolumePersistence = Number(item.hotVolumePersistence || openDiagnostic.hotVolumePersistence || 0);
const openHotDurationSeconds = Number(item.hotDurationSeconds || openDiagnostic.hotDurationSeconds || 0);

        const trailingClass = item.trailingActive ? "status-on" : "status-wait";
        const trailingTitle = item.trailingActive ? "🟢 익절보호 ON" : "⏳ 트레일링 대기";
        const trailingDetail = item.trailingActive
          ? `고점대비 ${formatRate(drawdownFromHigh)}`
          : `최고수익 ${formatRate(highestProfitRate)}`;

        return `
          ${showGroupTitle ? `<div class="strategy-group-title">${strategyLabel(group)} 보유 ${sortedList.filter(row => normalizeStrategyGroup(row.strategyGroup) === group).length}개</div>` : ""}

          <div class="stock-card">
            <div class="stock-card-header">
              <div>
                <button
                  type="button"
                  class="stock-name holding-name-toggle"
                  data-code="${escapeHtml(item.code || "")}"
                  onclick="toggleHoldingDetail(this.dataset.code)"
                  aria-expanded="false"
                  title="클릭하여 차트와 현재 상태 보기"
                >#${index + 1} ${escapeHtml(item.name || "-")} <span class="holding-toggle-mark">▾</span></button>
                <div class="stock-sub">${item.code || ""}</div>
                <div class="stock-sub">
                  ${strategyLabel(group)} /
                  ${item.strategyName || item.strategyPreset || "-"} /
                  발견점수 ${scoreText(item.discoverScore)} /
                  매수 ${buyTimeDisplay}
                </div>

                <div class="score-chip-row">
                  <span class="score-chip">최종 ${scoreText(finalBuyScore)}</span>
                  ${group === "OPEN"
                    ? `
                      <span class="score-chip">지속 ${scoreText(openMomentumScore)}</span>
                      <span class="score-chip">HOT ${scoreText(openHotMomentumScore)}</span>
                      <span class="score-chip">가격지속 ${openPricePersistence ? (openPricePersistence * 100).toFixed(0) + "%" : "-"}</span>
                      <span class="score-chip">거래량지속 ${openVolumePersistence ? (openVolumePersistence * 100).toFixed(0) + "%" : "-"}</span>
                      <span class="score-chip">HOT유지 ${openHotDurationSeconds ? Math.round(openHotDurationSeconds) + "초" : "-"}</span>
                    `
                    : `
                      <span class="score-chip">시장 ${scoreText(marketScore)}</span>
                      <span class="score-chip">섹터 ${scoreText(sectorPowerScore)}</span>
                      <span class="score-chip">수급 ${scoreText(leaderStrengthScore)}</span>
                    `
                  }
                </div>
              </div>

              <div class="stock-rate ${profitRate >= 0 ? "plus" : "minus"}">
                ${formatRate(profitRate)}
              </div>
            </div>

            <div class="info-grid">
              <div class="info-box">
                <div class="info-label">매수가</div>
                <div class="info-value">${Number(item.buyPrice || 0).toLocaleString()}원</div>
              </div>

              <div class="info-box">
                <div class="info-label">현재가</div>
                <div class="info-value">${Number(item.currentPrice || 0).toLocaleString()}원</div>
              </div>

              <div class="info-box">
                <div class="info-label">평가손익</div>
                <div class="info-value ${profit >= 0 ? "plus" : "minus"}">${formatWon(profit)}</div>
              </div>

              <div class="info-box">
                <div class="info-label">최고수익률</div>
                <div class="info-value ${highestProfitRate >= 0 ? "plus" : "minus"}">${formatRate(highestProfitRate)}</div>
              </div>

              <div class="info-box">
                <div class="info-label">고점대비</div>
                <div class="info-value ${drawdownFromHigh >= 0 ? "plus" : "minus"}">${formatRate(drawdownFromHigh)}</div>
              </div>

              <div class="info-box">
                <div class="info-label">보유수량</div>
                <div class="info-value">${Number(item.qty || 0).toLocaleString()}주</div>
              </div>

              <div class="info-box">
                <div class="info-label">보유기간</div>
                <div class="info-value">${holdingDays}일</div>
              </div>

              <div class="info-box">
                <div class="info-label">매수금액</div>
                <div class="info-value">${formatPlainWon(buyAmount)}</div>
              </div>

              <div class="info-box">
                <div class="info-label">평가금액</div>
                <div class="info-value">${formatPlainWon(evalAmount)}</div>
              </div>

              <div class="info-box">
                <div class="info-label">트레일링 기준</div>
                <div class="info-value">${item.trailingStopRate || 0}%</div>
              </div>

              <div class="info-box">
                <div class="info-label">매수시각</div>
                <div class="info-value">${buyTimeDisplay}</div>
              </div>
            </div>

            <div class="status-pill ${trailingClass}">
              ${trailingTitle} · ${trailingDetail}
            </div>

            <div style="margin-top:8px; padding:8px; background:#111827; border-radius:10px;">
              <div style="font-size:12px; color:#9ca3af; margin-bottom:5px;">점수상세</div>
              <div style="font-size:13px; line-height:1.6;">
                발견 ${signedScoreText(discoverPartScore)}<br>
                상승률 ${signedScoreText(rateScore)}<br>
                거래량 ${signedScoreText(volumeScore)}<br>
                시가강세 ${signedScoreText(openScore)}<br>
                당일위치 ${signedScoreText(positionScore)}<br>
                기본점수 ${scoreText(baseScore)} / 추세감점 ${signedScoreText(trendPenalty)}<br>
                최종점수 ${scoreText(finalBuyScore)} / 시장점수 ${scoreText(marketScore)} / 섹터점수 ${scoreText(sectorPowerScore)} / 수급강도 ${scoreText(leaderStrengthScore)}
              </div>
            </div>

            ${Array.isArray(item.discoverReasons) && item.discoverReasons.length > 0
              ? `
                <div style="margin-top:8px; padding:8px; background:#111827; border-radius:10px;">
                  <div style="font-size:12px; color:#9ca3af; margin-bottom:5px;">매수사유</div>
                  <div style="font-size:13px; line-height:1.5;">
                    ${item.discoverReasons.map(reason => `• ${reason}`).join("<br>")}
                  </div>
                </div>
              `
              : ""
            }

            <div id="holding-detail-${escapeHtml(item.code || "")}" class="holding-detail-panel">
              ${buildHoldingPriceChart(holdingScoreHistory, Number(item.buyPrice || 0), Number(item.currentPrice || 0))}
              <div class="holding-trend-status ${holdingTrendStatus.tone}">
                <div class="holding-trend-title">${holdingTrendStatus.icon} ${holdingTrendStatus.title}</div>
                <div class="holding-trend-detail">${holdingTrendStatus.detail}</div>
              </div>
              <div class="holding-live-grid">
                <div class="holding-live-item"><span>현재 등락률</span><b class="${currentChangeRate >= 0 ? "plus" : "minus"}">${formatRate(currentChangeRate)}</b></div>
                <div class="holding-live-item"><span>시가대비</span><b class="${currentOpenPositionRate >= 0 ? "plus" : "minus"}">${formatRate(currentOpenPositionRate)}</b></div>
                <div class="holding-live-item"><span>거래량비율</span><b>${currentTradeVolumeRatio.toFixed(1)}%</b></div>
                <div class="holding-live-item"><span>당일위치</span><b>${currentDayPositionRate.toFixed(1)}%</b></div>
                <div class="holding-live-item"><span>현재 보유점수</span><b>${scoreText(holdingScore)}</b></div>
                <div class="holding-live-item"><span>매수점수 대비</span><b class="${holdingScoreDiff >= 0 ? "plus" : "minus"}">${signedScoreText(holdingScoreDiff)}</b></div>
              </div>
              <div class="holding-detail-note">종목명 클릭은 상세정보만 열고 닫습니다. 매도는 아래 빨간 버튼으로만 실행됩니다.</div>
            </div>

            <div class="manual-sell-row">
              <button
                type="button"
                class="manual-sell-btn"
                data-code="${escapeHtml(item.code || "")}"
                data-name="${escapeHtml(item.name || item.code || "")}"
                data-qty="${Number(item.qty || 0)}"
                onclick="manualSellHolding(this.dataset.code, this.dataset.name, this.dataset.qty)"
              >현재가 전량매도</button>
            </div>
          </div>
        `;
      }).join("");
    }

    function renderRecent7Days(list) {
  const box = document.getElementById("recent7DaysBox");
  if (!box) return;

  if (!Array.isArray(list) || list.length === 0) {
    box.innerHTML = "<div class='empty'>최근 7일 데이터가 없습니다.</div>";
    return;
  }

 box.innerHTML = `
  <div class="stock-card">
    ${list.map(item => {
      const profit = Number(item.realizedProfit || 0);
      const rate = Number(item.profitRate || 0);

      return `
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #374151;">
          <div>
            <b>${item.date}</b>
            <span style="color:#9ca3af; font-size:12px;"> / 청산 ${item.trades || 0}종목 · 체결 ${item.sellFills ?? item.trades ?? 0}건</span>
          </div>
          <div class="${profit >= 0 ? "plus" : "minus"}" style="font-weight:bold;">
            ${formatWon(profit)} / ${formatRate(rate)}
          </div>
        </div>
      `;
    }).join("")}
  </div>
`;
}

    function renderRecentSells(list) {
      const box = document.getElementById("recentSellsBox");

      if (!Array.isArray(list) || list.length === 0) {
        box.className = "empty";
        box.innerHTML = "아직 매도 거래 내역이 없습니다.";
        return;
      }

      box.className = "mobile-card-list";

      box.innerHTML = list.map(item => {
        const profitRate = Number(item.profitRate || 0);
        const profit = Number(item.profit || 0);

        return `
          <div class="stock-card">
            <div class="stock-card-header">
              <div>
                <div class="stock-name">${item.name || "-"}</div>
                <div class="stock-sub">${item.code || ""}</div>
                <div class="stock-sub">
  ${item.date || "-"} /
  ${strategyLabel(item.strategyGroup)} /
  ${item.strategyName || item.strategyPreset || "-"}
</div>
              </div>

              <div class="stock-rate ${profitRate >= 0 ? "plus" : "minus"}">
                ${formatRate(profitRate)}
              </div>
            </div>

            <div class="recent-sell-grid">
              <div class="info-box">
                <div class="info-label">실현손익</div>
                <div class="info-value ${profit >= 0 ? "plus" : "minus"}">${formatWon(profit)}</div>
              </div>

              <div class="info-box">
                <div class="info-label">매도사유</div>
                <div class="info-value recent-sell-reason">${item.reason || item.type || "-"}</div>
              </div>
            </div>
          </div>
        `;
      }).join("");
    }

    function renderStrategyStats(list) {
  const box = document.getElementById("strategyStatsBox");
  if (!box) return;

  if (!Array.isArray(list) || list.length === 0) {
    box.innerHTML = "<div class='empty'>전략별 매도 데이터가 없습니다.</div>";
    return;
  }

  box.innerHTML = list.map(item => {
    const profit = Number(item.totalProfit || 0);
    const avgRate = Number(item.avgProfitRate || 0);
    const avgProfit = Number(item.avgProfit || 0);
    const maxProfitRate = Number(item.maxProfitRate || 0);
    const maxLossRate = Number(item.maxLossRate || 0);

    return `
      <div class="stock-card">
        <div class="stock-card-header">
          <div>
            <div class="stock-name">
  ${strategyLabel(item.strategyGroup)}
  / ${item.strategyName || "-"}
            </div>
            <div class="stock-sub">
              청산 ${item.trades || 0}종목 / 매도체결 ${item.sellFills ?? item.trades ?? 0}건 / 승 ${item.wins || 0} / 패 ${item.losses || 0}
            </div>
          </div>

          <div class="stock-rate ${profit >= 0 ? "plus" : "minus"}">
            ${formatRate(avgRate)}
          </div>
        </div>

        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">실현손익</div>
            <div class="info-value ${profit >= 0 ? "plus" : "minus"}">
              ${formatWon(profit)}
            </div>
          </div>

          <div class="info-box">
            <div class="info-label">종목 승률</div>
            <div class="info-value">${formatRate(item.winRate || 0)}</div>
          </div>

           <div class="info-box">
  <div class="info-label">평균손익</div>
  <div class="info-value ${avgProfit >= 0 ? "plus" : "minus"}">
    ${formatWon(avgProfit)}
  </div>
</div>

<div class="info-box">
  <div class="info-label">최대수익률</div>
  <div class="info-value ${maxProfitRate >= 0 ? "plus" : "minus"}">
    ${formatRate(maxProfitRate)}
  </div>
</div>

<div class="info-box">
  <div class="info-label">최대손실률</div>
  <div class="info-value ${maxLossRate >= 0 ? "plus" : "minus"}">
    ${formatRate(maxLossRate)}
  </div>
</div>

        </div>
      </div>
    `;
  }).join("");
}

    function renderOpenPerformance(data = {}) {
      const holdings = Array.isArray(data.holdings) ? data.holdings : [];
      const strategyStats = Array.isArray(data.strategyStats) ? data.strategyStats : [];

      const openHoldingCount = holdings.filter(
        item => normalizeStrategyGroup(item.strategyGroup) === "OPEN"
      ).length;

      const openRows = strategyStats.filter(
        item => normalizeStrategyGroup(item.strategyGroup) === "OPEN"
      );

      const openSellCount = openRows.reduce(
        (sum, item) => sum + Number(item.trades || 0),
        0
      );
      const openWins = openRows.reduce(
        (sum, item) => sum + Number(item.wins || 0),
        0
      );
      const openLosses = openRows.reduce(
        (sum, item) => sum + Number(item.losses || 0),
        0
      );
      const openRealizedProfit = openRows.reduce(
        (sum, item) => sum + Number(item.totalProfit || 0),
        0
      );

      const weightedRateTotal = openRows.reduce(
        (sum, item) =>
          sum +
          Number(item.avgProfitRate || 0) * Number(item.trades || 0),
        0
      );

      const openAvgProfitRate =
        openSellCount > 0 ? weightedRateTotal / openSellCount : 0;

      const openWinRate =
        openSellCount > 0 ? (openWins / openSellCount) * 100 : 0;

      // OPEN은 당일 최대 1회 매수이므로 누적 매수건수는
      // 완료된 매도건수 + 현재 OPEN건수로 계산합니다.
      const openBuyCount = openSellCount + openHoldingCount;

      setValue("openBuyCount", `${openBuyCount}건`);
      setValue("openSellCount", `${openSellCount}건`);
      setValue("openWinLoss", `${openWins}승 / ${openLosses}패`);
      setValue("openWinRate", formatRate(openWinRate), "rate");
      setValue("openRealizedProfit", formatWon(openRealizedProfit), "money");
      setValue("openAvgProfitRate", formatRate(openAvgProfitRate), "rate");
    }


function setOpenText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
}

function classifyOpenSelectionMode(day = {}) {
  const reason = String(
    day.selectedTrade?.selectionReason ||
    day.realTrade?.selectionReason ||
    day.result?.sellReason ||
    day.openSkipReason ||
    day.tracking?.decision ||
    ""
  );

  if (/상승 지속|지속강도|모멘텀|momentum/i.test(reason)) {
    return "30초 상승지속 확인";
  }
  if (/보완|안전 최소조건|fallback/i.test(reason)) {
    return "지속강도 보완선정";
  }
  if (/엄격|정상 통과|rank|최종점수/i.test(reason)) {
    return "지속강도 1위";
  }
  if (day.selectedTrade || day.realTrade?.buyPrice || day.openBuyCode) return "실제선정";
  return day.tracking?.stageLabel || "30초 다중관찰 중";
}

function firstFiniteOpenNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function normalizeOpenLivePayload(payload = {}) {
  // 신규 OPEN 실시간 API(/api/open-live-tracking) 우선
  if (payload.tracking || payload.scan || payload.daily || payload.hot) {
    const tracking = payload.tracking || {};
    const scan = payload.scan || {};
    const daily = payload.daily || {};
    const top = tracking.topCandidate || null;
    const hotItems = Array.isArray(payload.hot?.items) ? payload.hot.items : [];
    const topCode = String(top?.code || "").replace(/\D/g, "").slice(-6);
    const hotMatch = hotItems.find(item =>
      String(item?.code || "").replace(/\D/g, "").slice(-6) === topCode
    ) || null;

    let status = "SCANNING";
    if (payload.openSkipped) status = "SKIPPED";
    else if (payload.openCompleted) status = payload.openBuyCode ? "COMPLETED" : "SKIPPED";
    else if (payload.openBuyCode) status = "HOLDING";
    else if (/WAIT|대기/i.test(String(tracking.stage || ""))) status = "WAITING";

    return {
      source: "LIVE",
      status,
      top,
      selected: payload.openBuyCode
        ? {
            code: payload.openBuyCode,
            name: payload.openBuyName || payload.openBuyCode,
            selectedAt: payload.openBuyAt || null
          }
        : null,
      tracking,
      scan,
      daily,
      hot: payload.hot || {},
      hotMatch,
      updatedAt: tracking.updatedAt || scan.checkedAt || payload.serverTime || null,
      skipReason: payload.openSkipReason || null
    };
  }

  // 예전 학습 API 형식도 호환
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const day = rows.find(row => String(row.date || "") === today) || rows[0] || {};
  const candidates = Array.isArray(day.latestCandidates) ? day.latestCandidates : [];
  return {
    source: "LEARNING",
    status: String(day.status || ((day.selectedTrade || day.realTrade) ? "HOLDING" : "WAITING")).toUpperCase(),
    top: candidates[0] || day.openTopCandidate || null,
    selected: day.selectedTrade || day.realTrade || null,
    tracking: day.tracking || {},
    scan: {},
    daily: {},
    hot: {},
    hotMatch: null,
    updatedAt: payload.updatedAt || day.lastCandidateScanAt || day.updatedAt || null,
    skipReason: day.openSkipReason || null,
    day,
    candidates
  };
}

function renderOpenLiveStatus(payload = {}) {
  const live = normalizeOpenLivePayload(payload);
  const top = live.top;
  const selected = live.selected;
  const tracking = live.tracking || {};
  const scan = live.scan || {};
  const daily = live.daily || {};
  const hotMatch = live.hotMatch;
  const day = live.day || {};
  const status = String(live.status || "WAITING").toUpperCase();

  const badge = document.getElementById("openLiveMode");
  if (badge) {
    badge.className = "open-mode-badge";
    if (selected) {
      badge.classList.add("open-mode-buy");
      badge.textContent = "실제 매수";
    } else if (status === "SKIPPED" || status === "COMPLETED") {
      badge.classList.add("open-mode-skip");
      badge.textContent = status === "SKIPPED" ? "미매수 종료" : "거래 완료";
    } else {
      badge.classList.add("open-mode-wait");
      badge.textContent = tracking.stageLabel || "상승지속 관찰";
    }
  }

  const statusMap = {
    WAITING: "시작 대기",
    SCANNING: tracking.stageLabel || "OPEN 후보 관찰 중",
    HOLDING: "OPEN 보유 중",
    COMPLETED: "OPEN 거래 완료",
    SKIPPED: "오늘 미매수"
  };

  const metricSource = selected?.selectionInputs || selected || top || {};
  const diagnostic = selected?.openBuyDiagnostic || selected?.selectionInputs || top || {};

  const momentumScore = firstFiniteOpenNumber(
    diagnostic.momentumScore,
    metricSource.momentumScore,
    top?.momentumScore
  );
  const hotMomentumScore = firstFiniteOpenNumber(
    diagnostic.hotMomentumScore,
    metricSource.hotMomentumScore,
    top?.hotMomentumScore,
    hotMatch?.openMomentumScore
  );
  const pricePersistence = firstFiniteOpenNumber(
    diagnostic.hotPricePersistence,
    diagnostic.pricePersistence,
    metricSource.hotPricePersistence,
    metricSource.pricePersistence,
    top?.hotPricePersistence,
    top?.pricePersistence
  );
  const volumePersistence = firstFiniteOpenNumber(
    diagnostic.hotVolumePersistence,
    diagnostic.volumePersistence,
    metricSource.hotVolumePersistence,
    metricSource.volumePersistence,
    top?.hotVolumePersistence,
    top?.volumePersistence
  );
  const priceRise30s = firstFiniteOpenNumber(
    diagnostic.hotPriceRise30s,
    diagnostic.priceRise30s,
    diagnostic.priceRiseRate,
    metricSource.hotPriceRise30s,
    metricSource.priceRise30s,
    metricSource.priceRiseRate,
    top?.hotPriceRise30s,
    top?.priceRise30s,
    top?.priceRiseRate
  );
  const volumeGrowth30s = firstFiniteOpenNumber(
    diagnostic.hotVolumeGrowth30s,
    diagnostic.volumeGrowth30s,
    diagnostic.volumeGrowthRate,
    metricSource.hotVolumeGrowth30s,
    metricSource.volumeGrowth30s,
    metricSource.volumeGrowthRate,
    top?.hotVolumeGrowth30s,
    top?.volumeGrowth30s,
    top?.volumeGrowthRate
  );
  const hotDurationSeconds = firstFiniteOpenNumber(
    diagnostic.hotDurationSeconds,
    metricSource.hotDurationSeconds,
    top?.hotDurationSeconds
  );
  const highRefreshCount = firstFiniteOpenNumber(
    diagnostic.hotHighRefreshCount,
    diagnostic.highRefreshCount,
    metricSource.hotHighRefreshCount,
    metricSource.highRefreshCount,
    top?.hotHighRefreshCount,
    top?.highRefreshCount
  );
  const observationCount = firstFiniteOpenNumber(
    diagnostic.observationCount,
    metricSource.observationCount,
    top?.observationCount,
    day.candidateObservations?.[top?.code]?.observationCount
  );

  setOpenText("openLiveStatus", statusMap[status] || status);
  setOpenText(
    "openSelectionMode",
    live.source === "LIVE"
      ? (tracking.stageLabel || classifyOpenSelectionMode({ ...day, tracking, openBuyCode: selected?.code }))
      : classifyOpenSelectionMode(day)
  );
  setOpenText(
    "openTopCandidate",
    top ? `${top.name || top.code || "-"}${top.code ? ` (${top.code})` : ""}` : "-"
  );
  setOpenText(
    "openTopScore",
    top
      ? `${Number(top.rankScore ?? top.discoverScore ?? top.score ?? 0).toFixed(1)}점`
      : "-"
  );

  const candidateDecisionEl = document.getElementById("openCandidateDecision");
  const rejectReasonEl = document.getElementById("openRejectReason");
  const candidatePassed = top?.passed === true;
  const rejectReason = String(top?.rejectReason || top?.reason || tracking.decision || "").trim();
  const rejectCategory = String(top?.rejectCategory || "").trim();

  if (candidateDecisionEl) {
    candidateDecisionEl.classList.remove("open-candidate-pass", "open-candidate-reject", "open-candidate-wait");
    if (!top) {
      candidateDecisionEl.textContent = "후보 없음";
      candidateDecisionEl.classList.add("open-candidate-wait");
    } else if (candidatePassed) {
      candidateDecisionEl.textContent = top?.fallbackBuy ? "보완 매수후보" : "매수조건 통과";
      candidateDecisionEl.classList.add("open-candidate-pass");
    } else if (rejectReason) {
      candidateDecisionEl.textContent = rejectCategory ? `탈락 · ${rejectCategory}` : "현재 조건 탈락";
      candidateDecisionEl.classList.add("open-candidate-reject");
    } else {
      candidateDecisionEl.textContent = "추가 관찰 중";
      candidateDecisionEl.classList.add("open-candidate-wait");
    }
  }

  if (rejectReasonEl) {
    rejectReasonEl.classList.remove("open-candidate-pass", "open-candidate-reject", "open-candidate-wait");
    if (!top) {
      rejectReasonEl.textContent = "후보 검색 중";
      rejectReasonEl.classList.add("open-candidate-wait");
    } else if (candidatePassed) {
      rejectReasonEl.textContent = "매수 대상 순위 비교 중";
      rejectReasonEl.classList.add("open-candidate-pass");
    } else {
      rejectReasonEl.textContent = rejectReason || "관찰 데이터 추가 확인 중";
      rejectReasonEl.classList.add(rejectReason ? "open-candidate-reject" : "open-candidate-wait");
    }
  }

  const rejectCounts = scan.rejectCounts && typeof scan.rejectCounts === "object" ? scan.rejectCounts : {};
  const rejectTop = Object.entries(rejectCounts)
    .map(([name, count]) => [name, Number(count || 0)])
    .sort((a, b) => b[1] - a[1])[0];
  setOpenText(
    "openRejectTop",
    rejectTop && rejectTop[1] > 0 ? `${rejectTop[0]} ${rejectTop[1]}건` : (top ? "집계 중" : "-")
  );

  setOpenText(
    "openMomentumScore",
    momentumScore || hotMomentumScore
      ? `${momentumScore.toFixed(1)}점${hotMomentumScore ? ` / HOT ${hotMomentumScore.toFixed(1)}` : ""}`
      : (top ? "관찰 데이터 축적 중" : "-")
  );
  setOpenText(
    "openPersistence",
    pricePersistence || volumePersistence
      ? `가격 ${(pricePersistence * 100).toFixed(0)}% / 거래량 ${(volumePersistence * 100).toFixed(0)}%`
      : (top ? "측정 중" : "-")
  );
  setOpenText(
    "openRecentMomentum",
    priceRise30s || volumeGrowth30s
      ? `가격 ${formatRate(priceRise30s)} / 거래량 ${formatRate(volumeGrowth30s)}`
      : (top ? "측정 중" : "-")
  );

  let hotStatusText = "-";
  if (hotDurationSeconds || highRefreshCount) {
    hotStatusText = `${Math.round(hotDurationSeconds)}초 / ${Math.round(highRefreshCount)}회`;
  } else if (hotMatch) {
    hotStatusText = `현재 HOT / 지속 ${Number(hotMatch.openMomentumScore || 0).toFixed(1)}`;
  } else if (top) {
    const hotMatched = top.hotMatched === true || top.isDirectHotCandidate === true || top.originalSource === "HOT";
    hotStatusText = hotMatched ? "HOT 유입 / 현재순위 밖" : "일반 후보";
  }
  setOpenText("openHotDuration", hotStatusText);

  setOpenText(
    "openObservationCount",
    observationCount
      ? `${Math.round(observationCount)}회`
      : (top ? "1회 이상 관찰" : "-")
  );

  if (selected) {
    const buyPrice = Number(selected.buyPrice || selected.entryPrice || 0);
    const qty = Number(selected.qty || 0);
    setOpenText(
      "openActualBuy",
      `${selected.name || selected.code || "-"}${buyPrice ? ` / ${buyPrice.toLocaleString()}원` : ""}${qty ? ` / ${qty.toLocaleString()}주` : ""}`
    );
  } else {
    setOpenText("openActualBuy", "아직 없음");
  }

  let reason =
    tracking.decision ||
    selected?.selectionReason ||
    top?.rejectReason ||
    top?.reason ||
    day.result?.sellReason ||
    live.skipReason ||
    "";

  if (live.source === "LIVE") {
    const scanText =
      `현재 스캔 후보 ${Number(scan.candidateCount || 0)} / ` +
      `평가 ${Number(scan.evaluatedCount || 0)} / ` +
      `엄격통과 ${Number(scan.strictPassedCount || 0)} / ` +
      `잠재 ${Number(scan.potentialCount || 0)}`;
    const dailyText =
      `오늘 누적 후보 ${Number(daily.candidateCount || 0)} / ` +
      `평가 ${Number(daily.evaluatedCount || 0)} / ` +
      `HOT유입 ${Number(daily.hotInputCount || 0)}`;
    reason = reason ? `${reason} · ${scanText} · ${dailyText}` : `${scanText} · ${dailyText}`;
  } else if (!reason) {
    const candidates = live.candidates || [];
    reason = candidates.length
      ? `후보 ${candidates.length}개를 반복 관찰 중입니다.`
      : "아직 OPEN 후보가 저장되지 않았습니다.";
  }

  setOpenText("openLiveReason", reason);
  setOpenText(
    "openLiveUpdatedAt",
    `갱신 ${formatShortTime(live.updatedAt || new Date().toLocaleTimeString("ko-KR"))}`
  );
}

async function loadOpenLiveStatus() {
  try {
    // 실시간 운영상태 전용 API를 사용한다. 학습 API는 당일 후보 필드를 축약해서
    // 대시보드에 '-'가 계속 표시될 수 있으므로 실시간 카드에는 사용하지 않는다.
    const res = await fetch(
      "https://sytrader.duckdns.org/api/open-live-tracking",
      { cache: "no-store" }
    );
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.message || `API 오류 ${res.status}`);
    }
    renderOpenLiveStatus(data);
  } catch (err) {
    console.error("OPEN 실시간 상태 조회 오류", err);
    setOpenText("openLiveStatus", "조회 오류");
    setOpenText("openSelectionMode", "-");
    setOpenText("openTopCandidate", "-");
    setOpenText("openTopScore", "-");
    setOpenText("openCandidateDecision", "-");
    setOpenText("openRejectReason", "-");
    setOpenText("openRejectTop", "-");
    setOpenText("openMomentumScore", "-");
    setOpenText("openPersistence", "-");
    setOpenText("openRecentMomentum", "-");
    setOpenText("openHotDuration", "-");
    setOpenText("openObservationCount", "-");
    setOpenText("openActualBuy", "-");
    setOpenText("openLiveReason", `OPEN 실시간 API 확인 필요 / ${err.message}`);
    const badge = document.getElementById("openLiveMode");
    if (badge) {
      badge.className = "open-mode-badge open-mode-skip";
      badge.textContent = "API 오류";
    }
  }
}


    async function loadPerformanceSummary() {
      try {
        const res = await fetch("https://sytrader.duckdns.org/api/performance-summary");
        const data = await res.json();

        if (!data.ok) {
          throw new Error(data.message || "성과 데이터를 불러오지 못했습니다.");
        }

        const s = data.summary || {};

        setValue("currentAsset", formatPlainWon(s.currentAsset));
        setValue("todayProfit", formatWon(s.todayProfit), "money");
        setValue("totalAssetProfit", formatWon(s.totalAssetProfit), "money");
        setValue("totalAssetProfitRate", formatRate(s.totalAssetProfitRate), "rate");
        setValue("holdingCount", `${s.holdingCount || 0}개`);
        setValue("holdingProfit", formatWon(s.holdingProfit), "money");

const mt =
  data.marketTemperature ||
  data.summary?.marketTemperature ||
  s.marketTemperature ||
  {};

setMarketTemperature(mt);

        

        setValue("todayProfitRate", formatRate(s.todayProfitRate), "rate");
        setValue(
          "totalTrades",
          `${s.totalTrades || 0}종목 / ${s.sellFillCount ?? s.totalTrades ?? 0}체결`
        );
        setValue("winRate", formatRate(s.winRate), "rate");
        setValue("avgProfitRate", formatRate(s.avgProfitRate), "rate");
        setValue("avgWinRate", formatRate(s.avgWinRate), "rate");
        setValue("avgLossRate", formatRate(s.avgLossRate), "rate");
        setValue("totalRealizedProfit", formatWon(s.totalRealizedProfit), "money");
        setValue("totalUnrealizedProfit", formatWon(s.totalUnrealizedProfit), "money");

       

        const holdings = data.holdings || [];


       const openCount = holdings.filter(h => normalizeStrategyGroup(h.strategyGroup) === "OPEN").length;
       const coreCount = holdings.filter(h => normalizeStrategyGroup(h.strategyGroup) === "CORE").length;
       const volumeCount = holdings.filter(h => normalizeStrategyGroup(h.strategyGroup) === "VOLUME").length;

       setValue("openHoldingCount", `${openCount}개`);
       setValue("coreHoldingCount", `${coreCount}개`);
       setValue("volumeHoldingCount", `${volumeCount}개`);
       
       setStatus("serverStatus", "서버 정상", "ok");
       setStatus("apiStatus", "API 정상", "ok");
       setStatus("lastUpdatedAt", `갱신 ${new Date().toLocaleTimeString("ko-KR", {hour:"2-digit", minute:"2-digit", hour12:false})}`, "ok");
       
       renderCandidateAnalysis(data);

        renderOpenPerformance(data);
        renderHoldings(data.holdings || []);
        renderRecent7Days(data.recent7Days || []);
        renderStrategyStats(data.strategyStats || []);
        renderRecentSells(data.recentSells || []);
      } catch (err) {
        console.error(err);
        setStatus("serverStatus", "서버 확인 필요", "bad");
        setStatus("apiStatus", "API 오류", "bad");
        setStatus("lastUpdatedAt", "갱신 실패", "bad");

        const holdingBox = document.getElementById("holdingBox");
        const sellsBox = document.getElementById("recentSellsBox");

        if (holdingBox) {
          holdingBox.className = "empty";
          holdingBox.innerHTML = "성과분석 데이터를 불러오지 못했습니다.";
        }

        if (sellsBox) {
          sellsBox.className = "empty";
          sellsBox.innerHTML = "성과분석 데이터를 불러오지 못했습니다.";
        }
      }
    }

    loadPerformanceSummary();
    loadOpenLiveStatus();
    loadMissedWinnersAnalysis();
    setInterval(loadPerformanceSummary, 30000);
    setInterval(loadOpenLiveStatus, 10000);
