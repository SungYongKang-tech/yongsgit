(() => {
  "use strict";

  const API_BASE =
    window.location.protocol === "http:" || window.location.protocol === "https:"
      ? window.location.origin
      : "https://sytrader.duckdns.org";

  const STRATEGIES = ["OPEN", "CORE", "VOLUME", "WAVE", "FAST"];
  const ICON = {
    OPEN: "🚀",
    CORE: "🛡️",
    VOLUME: "📊",
    WAVE: "🌊",
    FAST: "⚡"
  };

  let latest = {
    portfolio: null,
    server: null,
    paper: null,
    dashboard: null
  };
  let loading = false;

  const $ = id => document.getElementById(id);

  function n(value, fallback = 0) {
    const x = Number(value);
    return Number.isFinite(x) ? x : fallback;
  }

  function won(value) {
    return `${Math.round(n(value)).toLocaleString("ko-KR")}원`;
  }

  function text(id, value) {
    const el = $(id);
    if (el) el.textContent = value ?? "-";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok || data.ok === false) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    return data;
  }

  function runtimeStrategyMap() {
    const rows = Array.isArray(latest.dashboard?.strategies)
      ? latest.dashboard.strategies
      : [];
    return new Map(
      rows.map(row => [
        String(row.id || row.strategyGroup || row.label || "").toUpperCase(),
        row
      ])
    );
  }

  function renderPortfolio() {
    const p = latest.portfolio || {};
    text("masterAsset", won(p.totalAsset));
    text("masterCash", won(p.totalCash));
    text("masterExposure", won(p.totalExposure));
    text("masterAvailable", won(p.availableCash));
    text("reserveCash", won(p.reserveCash));
    text("holdingCount", `${n(p.holdingCount)}개`);
    text("allocationMode", p.allocationMode || "-");

    const limitRate = n(p.totalAsset) > 0
      ? (n(p.exposureLimit) / n(p.totalAsset)) * 100
      : 0;
    const reserveRate = n(p.totalAsset) > 0
      ? (n(p.reserveCash) / n(p.totalAsset)) * 100
      : 0;
    text("exposureLimitText", `최대 ${limitRate.toFixed(0)}% · ${won(p.exposureLimit)}`);
    text("reserveText", `최소현금 ${reserveRate.toFixed(0)}% · ${won(p.reserveCash)}`);

    const runtime = runtimeStrategyMap();
    const strategyGrid = $("strategyGrid");
    if (!strategyGrid) return;

    strategyGrid.innerHTML = STRATEGIES.map(strategy => {
      const cfg = p.strategies?.[strategy] || {};
      const rt = runtime.get(strategy) || {};
      const status = String(cfg.status || "ACTIVE").toUpperCase();
      const badgeClass =
        status === "PAUSED" ? "paused" :
        status === "REDUCED" ? "reduced" : "active";
      const exposure = won(cfg.exposure);
      const holdingCount = n(cfg.holdingCount);
      const runtimeText =
        rt.statusDetail ||
        rt.status ||
        (holdingCount > 0 ? `${holdingCount}종목 보유` : "후보/보유 상태는 대시보드에서 확인");

      return `
        <div class="card strategy-card">
          <div class="strategy-head">
            <div class="strategy-name">${ICON[strategy]} ${strategy}</div>
            <span class="badge ${badgeClass}">${escapeHtml(status)}</span>
          </div>
          <div class="strategy-main">${exposure}</div>
          <div class="strategy-sub">보유 ${holdingCount}개 · ${escapeHtml(runtimeText)}</div>
          <div class="strategy-actions">
            <button class="safe strategy-status-btn"
                    data-strategy="${strategy}" data-status="ACTIVE">ACTIVE</button>
            <button class="danger strategy-status-btn"
                    data-strategy="${strategy}" data-status="PAUSED">PAUSED</button>
          </div>
        </div>
      `;
    }).join("");

    document.querySelectorAll(".strategy-status-btn").forEach(button => {
      button.addEventListener("click", async () => {
        const strategy = button.dataset.strategy;
        const status = button.dataset.status;

        const message =
          status === "PAUSED"
            ? `${strategy} 신규매수만 중지할까요?\n\n기존 보유종목의 매도 위험관리는 계속됩니다.`
            : `${strategy} 신규매수를 다시 ACTIVE로 바꿀까요?`;

        if (!confirm(message)) return;

        await setStrategyStatus(strategy, status);
      });
    });
  }

  function renderServerStatus() {
    const s = latest.server || {};
    const paper = latest.paper || {};

    text("lastRunAt", s.lastRunAt || paper.lastRunAt || "-");
    text("lastSellCheckAt", s.lastSellCheckAt || paper.lastSellCheckAt || "-");
    text("dailyLossLimit", won(paper.dailyLossLimit));
    text("dailyBuyStopped", paper.dailyBuyStopped === true ? "중지됨" : "정상");

    const openStatus = s.openCompleted
      ? `완료${s.openCompletedAt ? ` · ${s.openCompletedAt}` : ""}`
      : s.openSkipped
        ? `SKIP · ${s.openSkipReason || "-"}`
        : "대기/진행";
    text("openStatus", openStatus);

    const enabled = s.serverAutoEnabled === true;
    const btn = $("engineToggleBtn");
    if (btn) {
      btn.dataset.enabled = String(enabled);
      btn.className = enabled ? "danger" : "safe";
      btn.textContent = enabled
        ? "■ OPEN·CORE·VOLUME 엔진 OFF"
        : "▶ OPEN·CORE·VOLUME 엔진 ON";
    }
    text(
      "engineChangedAt",
      `최근 변경: ${s.serverAutoChangedAt || "-"} · WAVE/FAST는 이 스위치와 별도`
    );
  }

  function setApiState(message, error = false) {
    const el = $("apiState");
    if (!el) return;
    el.textContent = message;
    el.className = error ? "bad" : "ok";
  }

  async function loadAll() {
    if (loading) return;
    loading = true;

    const refreshBtn = $("refreshBtn");
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "조회 중...";
    }

    setApiState("MASTER 서버 조회 중...");
    try {
      const stamp = Date.now();

      const [portfolio, server, paper, dashboard] = await Promise.all([
        api(`/api/portfolio-summary?t=${stamp}`),
        api(`/api/server-auto-status?t=${stamp}`),
        api(`/api/paper-state?t=${stamp}`),
        api(`/api/strategy-dashboard-summary?t=${stamp}`).catch(error => ({
          ok: false,
          strategies: [],
          optionalError: error.message
        }))
      ]);

      latest = { portfolio, server, paper, dashboard };
      renderPortfolio();
      renderServerStatus();

      setApiState(
        dashboard?.optionalError
          ? `MASTER 정상 · 전략 상세 일부 미조회 (${dashboard.optionalError})`
          : "MASTER 서버 정상"
      );
      text(
        "updatedAt",
        new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
      );
    } catch (error) {
      console.error("MASTER 서버관리 조회 오류", error);
      setApiState(`조회 실패 · ${error.message}`, true);
    } finally {
      loading = false;
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "🔄 서버 조회";
      }
    }
  }

  async function setStrategyStatus(strategy, status) {
    setApiState(`${strategy} ${status} 변경 중...`);
    try {
      const data = await api("/api/portfolio-strategy-status", {
        method: "POST",
        body: JSON.stringify({ strategy, status })
      });
      setApiState(data.message || `${strategy} ${status} 완료`);
      await loadAll();
    } catch (error) {
      alert(`${strategy} 상태 변경 실패\n\n${error.message}`);
      setApiState(`상태 변경 실패 · ${error.message}`, true);
    }
  }

  async function setAllStrategies(status) {
    const pause = status === "PAUSED";
    const ok = confirm(
      pause
        ? "OPEN·CORE·VOLUME·WAVE·FAST 신규매수를 모두 중지할까요?\n\n기존 보유종목의 매도 위험관리는 계속됩니다."
        : "5개 전략의 신규매수를 모두 ACTIVE로 다시 허용할까요?"
    );
    if (!ok) return;

    const button = pause ? $("pauseAllBtn") : $("resumeAllBtn");
    if (button) button.disabled = true;

    setApiState(`5전략 ${status} 변경 중...`);
    try {
      const data = await api("/api/portfolio-all-strategies-status", {
        method: "POST",
        body: JSON.stringify({ status })
      });
      setApiState(data.message || `5전략 ${status} 완료`);
      await loadAll();
    } catch (error) {
      alert(`5전략 상태 변경 실패\n\n${error.message}`);
      setApiState(`전체 상태 변경 실패 · ${error.message}`, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function toggleLegacyEngine() {
    const enabled = latest.server?.serverAutoEnabled === true;

    const warning = enabled
      ? "OPEN·CORE·VOLUME 엔진을 완전히 OFF할까요?\n\n주의: 신규매수뿐 아니라 이 엔진의 기존 보유 매도 점검도 멈출 수 있습니다.\n\n단순 신규매수 중지는 MASTER 신규매수 전체중지를 사용하세요."
      : "OPEN·CORE·VOLUME 엔진을 다시 ON할까요?";

    if (!confirm(warning)) return;

    const btn = $("engineToggleBtn");
    if (btn) btn.disabled = true;
    try {
      await api(`/api/server-auto-toggle?enabled=${!enabled}`);
      await loadAll();
    } catch (error) {
      alert(`엔진 상태 변경 실패\n\n${error.message}`);
      setApiState(`엔진 변경 실패 · ${error.message}`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function reissueToken() {
    if (!confirm(
      "키움 토큰을 신규발급하고 kiwwm-server를 재시작할까요?\n\n실제 토큰 오류가 있을 때만 사용하세요."
    )) return;

    const btn = $("reissueTokenBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "토큰 발급 중...";
    }

    try {
      const data = await api("/api/token/reissue", {
        method: "POST",
        body: JSON.stringify({})
      });
      alert(data.message || "토큰 신규발급 완료");
      setApiState("토큰 발급 완료 · 서버 재시작 대기");
      setTimeout(loadAll, 5000);
    } catch (error) {
      alert(`토큰 신규발급 실패\n\n${error.message}`);
      setApiState(`토큰 발급 실패 · ${error.message}`, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "🔑 토큰 신규발급 + 서버재시작";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("refreshBtn")?.addEventListener("click", loadAll);
    $("pauseAllBtn")?.addEventListener("click", () => setAllStrategies("PAUSED"));
    $("resumeAllBtn")?.addEventListener("click", () => setAllStrategies("ACTIVE"));
    $("engineToggleBtn")?.addEventListener("click", toggleLegacyEngine);
    $("reissueTokenBtn")?.addEventListener("click", reissueToken);

    loadAll();
    setInterval(loadAll, 30000);
  });
})();
