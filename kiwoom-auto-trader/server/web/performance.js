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
    .sort((a, b) =>
      Number(b.watchScore || b.finalScore || b.discoverScore || 0) -
      Number(a.watchScore || a.finalScore || a.discoverScore || 0)
    )
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
    const priceChangeRate = firstPrice > 0
      ? ((currentPrice - firstPrice) / firstPrice) * 100
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
  {};

const rateScore = Number(
  scoreDetails.rate ??
  scoreDetails.riseRate ??
  scoreDetails.changeRate ??
  item.rateScore ??
  0
);

const volumeScore = Number(
  scoreDetails.volume ??
  scoreDetails.volumeScore ??
  item.volumeScore ??
  0
);

const openScore = Number(
  scoreDetails.openStrength ??
  scoreDetails.openScore ??
  item.openStrengthScore ??
  0
);

const positionScore = Number(
  scoreDetails.dayPosition ??
  scoreDetails.positionScore ??
  item.dayPositionScore ??
  0
);

        const finalBuyScore = Number(
  item.finalBuyScore ||
  item.finalBuyScoreDetail?.score ||
  0
);

const marketScore = Number(
  item.marketScore?.score ||
  item.finalBuyScoreDetail?.marketScore ||
  0
);

const leaderStrengthScore = Number(
  item.leaderStrengthScore ||
  item.finalBuyScoreDetail?.leaderStrengthScore ||
  0
);

const sectorPowerScore = Number(
  item.sectorPowerScore ||
  item.finalBuyScoreDetail?.sectorPowerScore ||
  0
);

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
                <div class="stock-name">#${index + 1} ${item.name || "-"}</div>
                <div class="stock-sub">${item.code || ""}</div>
                <div class="stock-sub">
                  ${strategyLabel(group)} /
                  ${item.strategyName || item.strategyPreset || "-"} /
                  발견점수 ${item.discoverScore || "-"} /
                  매수 ${formatShortTime(item.buyTime || item.buyAt)}
                </div>

                <div class="score-chip-row">
                  <span class="score-chip">최종 ${finalBuyScore || "-"}</span>
                  <span class="score-chip">시장 ${marketScore || "-"}</span>
                  <span class="score-chip">섹터 ${sectorPowerScore || "-"}</span>
                  <span class="score-chip">수급 ${leaderStrengthScore || "-"}</span>
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
                <div class="info-value">${formatShortTime(item.buyTime || item.buyAt)}</div>
              </div>
            </div>

            <div class="status-pill ${trailingClass}">
              ${trailingTitle} · ${trailingDetail}
            </div>

            <div style="margin-top:8px; padding:8px; background:#111827; border-radius:10px;">
              <div style="font-size:12px; color:#9ca3af; margin-bottom:5px;">점수상세</div>
              <div style="font-size:13px; line-height:1.6;">
                상승률 ${rateScore >= 0 ? "+" : ""}${rateScore}<br>
                거래량 ${volumeScore >= 0 ? "+" : ""}${volumeScore}<br>
                시가강세 ${openScore >= 0 ? "+" : ""}${openScore}<br>
                당일위치 ${positionScore >= 0 ? "+" : ""}${positionScore}<br>
                최종점수 ${finalBuyScore || "-"} / 시장점수 ${marketScore || "-"} / 섹터점수 ${sectorPowerScore || "-"} / 수급강도 ${leaderStrengthScore || "-"}
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
            <span style="color:#9ca3af; font-size:12px;"> / 거래 ${item.trades || 0}건</span>
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
              거래 ${item.trades || 0}건 / 승 ${item.wins || 0} / 패 ${item.losses || 0}
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
            <div class="info-label">승률</div>
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
        setValue("totalTrades", `${s.totalTrades || 0}건`);
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
    setInterval(loadPerformanceSummary, 30000);
