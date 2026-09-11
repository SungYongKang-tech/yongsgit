const API_BASE = "https://sytrader.duckdns.org";
const STRATEGY_ORDER = ["OPEN", "CORE", "VOLUME", "WAVE", "FAST"];
const STRATEGY_META = {
  OPEN: { icon: "🚀", label: "OPEN", desc: "장초 단기 급등 포착" },
  CORE: { icon: "🛡️", label: "CORE", desc: "강한 주도주 추세" },
  VOLUME: { icon: "📊", label: "VOLUME", desc: "거래량 급증 종목" },
  WAVE: { icon: "🌊", label: "WAVE", desc: "눌림 후 반등" },
  FAST: { icon: "⚡", label: "FAST", desc: "초기 급등 빠른 진입" }
};

let loadedSettings = null;
let serverReady = false;

function byId(id){ return document.getElementById(id); }
function deepClone(value){ return JSON.parse(JSON.stringify(value)); }
function clampNumber(value, min, max, fallback){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeSettings(raw = {}){
  const source = raw.settings && typeof raw.settings === "object" ? raw.settings : raw;
  const strategies = source.strategies && typeof source.strategies === "object" ? source.strategies : {};
  const normalized = {
    globalBuyEnabled: source.globalBuyEnabled !== false,
    maxTotalExposureRate: clampNumber(source.maxTotalExposureRate ?? 100, 0, 100, 100),
    reserveCashRate: clampNumber(source.reserveCashRate ?? 0, 0, 100, 0),
    strategies: {}
  };

  const defaults = {
    OPEN: { positionRatio:20, maxHoldingCount:5, maxDailyBuyCount:5, maxExposureRate:100 },
    CORE: { positionRatio:10, maxHoldingCount:5, maxDailyBuyCount:5, maxExposureRate:100 },
    VOLUME:{ positionRatio:10, maxHoldingCount:5, maxDailyBuyCount:5, maxExposureRate:100 },
    WAVE:  { positionRatio:10, maxHoldingCount:5, maxDailyBuyCount:2, maxExposureRate:100 },
    FAST:  { positionRatio:10, maxHoldingCount:5, maxDailyBuyCount:5, maxExposureRate:100 }
  };

  for (const id of STRATEGY_ORDER){
    const row = strategies[id] || {};
    normalized.strategies[id] = {
      buyEnabled: row.buyEnabled !== false,
      positionRatio: clampNumber(row.positionRatio ?? defaults[id].positionRatio, 0, 100, defaults[id].positionRatio),
      maxHoldingCount: Math.round(clampNumber(row.maxHoldingCount ?? defaults[id].maxHoldingCount, 0, 20, defaults[id].maxHoldingCount)),
      maxDailyBuyCount: Math.round(clampNumber(row.maxDailyBuyCount ?? defaults[id].maxDailyBuyCount, 0, 20, defaults[id].maxDailyBuyCount)),
      maxExposureRate: clampNumber(row.maxExposureRate ?? defaults[id].maxExposureRate, 0, 100, defaults[id].maxExposureRate)
    };
  }
  return normalized;
}

function setStatus(text, tone="warn"){
  const el = byId("connectionStatus");
  if (!el) return;
  el.textContent = text;
  el.className = `status ${tone}`;
}

function strategyCardHtml(id, row){
  const meta = STRATEGY_META[id];
  return `
    <section class="strategy-card ${id}" data-strategy="${id}">
      <div class="strategy-head">
        <div>
          <div class="strategy-name">${meta.icon} ${meta.label}</div>
          <div class="sub">${meta.desc}</div>
        </div>
        <div style="display:flex;align-items:center;gap:7px;">
          <span class="state-text ${row.buyEnabled ? "on" : ""}" data-state-text="${id}">${row.buyEnabled ? "매수 허용" : "매수 금지"}</span>
          <label class="switch" title="신규매수 허용/금지">
            <input type="checkbox" data-field="buyEnabled" data-strategy="${id}" ${row.buyEnabled ? "checked" : ""}/>
            <span class="switch-ui"></span>
          </label>
        </div>
      </div>

      <div class="field-grid">
        <div class="field">
          <label>1종목 매수비율</label>
          <div class="input-row"><input type="number" min="0" max="100" step="1" data-field="positionRatio" data-strategy="${id}" value="${row.positionRatio}"/><span class="unit">%</span></div>
        </div>
        <div class="field">
          <label>전략 최대 투자비율</label>
          <div class="input-row"><input type="number" min="0" max="100" step="1" data-field="maxExposureRate" data-strategy="${id}" value="${row.maxExposureRate}"/><span class="unit">%</span></div>
        </div>
        <div class="field">
          <label>최대 보유종목</label>
          <div class="input-row"><input type="number" min="0" max="20" step="1" data-field="maxHoldingCount" data-strategy="${id}" value="${row.maxHoldingCount}"/><span class="unit">종목</span></div>
        </div>
        <div class="field">
          <label>하루 최대 신규매수</label>
          <div class="input-row"><input type="number" min="0" max="20" step="1" data-field="maxDailyBuyCount" data-strategy="${id}" value="${row.maxDailyBuyCount}"/><span class="unit">회</span></div>
        </div>
      </div>
      <div class="summary" data-summary="${id}"></div>
    </section>`;
}

function renderSettings(settings){
  byId("globalBuyEnabled").checked = settings.globalBuyEnabled;
  byId("maxTotalExposureRate").value = settings.maxTotalExposureRate;
  byId("reserveCashRate").value = settings.reserveCashRate;
  byId("strategyGrid").innerHTML = STRATEGY_ORDER.map(id => strategyCardHtml(id, settings.strategies[id])).join("");
  bindFieldListeners();
  updateAllSummaries();
  updateDirtyState();
}

function bindFieldListeners(){
  document.querySelectorAll('input[data-strategy]').forEach(input => {
    input.addEventListener("input", () => {
      if (input.dataset.field === "buyEnabled") updateStateText(input.dataset.strategy, input.checked);
      updateStrategySummary(input.dataset.strategy);
      updateDirtyState();
    });
    input.addEventListener("change", () => {
      if (input.dataset.field === "buyEnabled") updateStateText(input.dataset.strategy, input.checked);
      updateStrategySummary(input.dataset.strategy);
      updateDirtyState();
    });
  });
}

function updateStateText(id, enabled){
  const el = document.querySelector(`[data-state-text="${id}"]`);
  if (!el) return;
  el.textContent = enabled ? "매수 허용" : "매수 금지";
  el.classList.toggle("on", enabled);
}

function readSettingsFromForm(){
  const result = {
    globalBuyEnabled: byId("globalBuyEnabled").checked,
    maxTotalExposureRate: clampNumber(byId("maxTotalExposureRate").value, 0, 100, 100),
    reserveCashRate: clampNumber(byId("reserveCashRate").value, 0, 100, 0),
    strategies: {}
  };

  for (const id of STRATEGY_ORDER){
    const get = field => document.querySelector(`[data-strategy="${id}"][data-field="${field}"]`);
    result.strategies[id] = {
      buyEnabled: !!get("buyEnabled")?.checked,
      positionRatio: clampNumber(get("positionRatio")?.value, 0, 100, 0),
      maxHoldingCount: Math.round(clampNumber(get("maxHoldingCount")?.value, 0, 20, 0)),
      maxDailyBuyCount: Math.round(clampNumber(get("maxDailyBuyCount")?.value, 0, 20, 0)),
      maxExposureRate: clampNumber(get("maxExposureRate")?.value, 0, 100, 0)
    };
  }
  return result;
}

function updateStrategySummary(id){
  const row = readSettingsFromForm().strategies[id];
  const el = document.querySelector(`[data-summary="${id}"]`);
  if (!el) return;
  const theoretical = Math.min(row.maxExposureRate, row.positionRatio * row.maxHoldingCount);
  el.innerHTML = row.buyEnabled
    ? `신규매수 <b style="color:#86efac">허용</b> · 1종목 ${row.positionRatio}% · 이론상 최대 보유노출 약 <b>${theoretical}%</b>`
    : `신규매수 <b style="color:#fca5a5">금지</b> · 기존 보유종목 매도관리는 계속`;
}

function updateAllSummaries(){ STRATEGY_ORDER.forEach(updateStrategySummary); }

function stableStringify(value){ return JSON.stringify(value); }
function isDirty(){
  if (!loadedSettings) return false;
  return stableStringify(readSettingsFromForm()) !== stableStringify(loadedSettings);
}
function updateDirtyState(){
  const dirty = isDirty();
  const save = byId("saveBtn");
  if (save) save.disabled = !serverReady || !dirty;
  if (serverReady) setStatus(dirty ? "서버 설정을 불러왔습니다. 변경사항이 아직 저장되지 않았습니다." : "서버 설정과 화면이 일치합니다.", dirty ? "warn" : "ok");
}

function validateSettings(settings){
  if (settings.reserveCashRate + settings.maxTotalExposureRate > 100){
    return "MASTER 최대 투자비율 + 최소 현금비율의 합은 100%를 넘을 수 없습니다.";
  }
  for (const id of STRATEGY_ORDER){
    const row = settings.strategies[id];
    if (row.positionRatio > row.maxExposureRate && row.maxExposureRate > 0){
      return `${id}: 1종목 매수비율(${row.positionRatio}%)이 전략 최대 투자비율(${row.maxExposureRate}%)보다 큽니다.`;
    }
    if (row.buyEnabled && row.maxHoldingCount === 0){
      return `${id}: 신규매수 허용 상태인데 최대 보유종목이 0입니다.`;
    }
    if (row.buyEnabled && row.maxDailyBuyCount === 0){
      return `${id}: 신규매수 허용 상태인데 하루 최대 신규매수가 0회입니다.`;
    }
  }
  return "";
}

function describeChanges(before, after){
  const lines = [];
  if (before.globalBuyEnabled !== after.globalBuyEnabled) lines.push(`MASTER 신규매수: ${before.globalBuyEnabled ? "허용" : "금지"} → ${after.globalBuyEnabled ? "허용" : "금지"}`);
  if (before.maxTotalExposureRate !== after.maxTotalExposureRate) lines.push(`MASTER 최대 투자비율: ${before.maxTotalExposureRate}% → ${after.maxTotalExposureRate}%`);
  if (before.reserveCashRate !== after.reserveCashRate) lines.push(`최소 현금비율: ${before.reserveCashRate}% → ${after.reserveCashRate}%`);

  const fieldLabels = {
    buyEnabled:"신규매수", positionRatio:"1종목 비율", maxHoldingCount:"최대보유", maxDailyBuyCount:"하루매수", maxExposureRate:"전략 투자한도"
  };
  for (const id of STRATEGY_ORDER){
    for (const field of Object.keys(fieldLabels)){
      if (before.strategies[id][field] === after.strategies[id][field]) continue;
      const oldVal = field === "buyEnabled" ? (before.strategies[id][field] ? "허용" : "금지") : before.strategies[id][field];
      const newVal = field === "buyEnabled" ? (after.strategies[id][field] ? "허용" : "금지") : after.strategies[id][field];
      const unit = ["positionRatio","maxExposureRate"].includes(field) ? "%" : ["maxHoldingCount"].includes(field) ? "종목" : field === "maxDailyBuyCount" ? "회" : "";
      lines.push(`${id} ${fieldLabels[field]}: ${oldVal}${unit} → ${newVal}${unit}`);
    }
  }
  return lines;
}

async function loadSettings(){
  serverReady = false;
  byId("saveBtn").disabled = true;
  setStatus("서버 설정을 불러오는 중입니다.", "warn");
  try{
    const res = await fetch(`${API_BASE}/api/trading-settings`, { cache:"no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
    loadedSettings = normalizeSettings(data);
    serverReady = true;
    renderSettings(deepClone(loadedSettings));
    setStatus("서버의 현재 전략 설정을 불러왔습니다.", "ok");
  }catch(error){
    console.error("전략 설정 조회 오류", error);
    loadedSettings = normalizeSettings({});
    renderSettings(deepClone(loadedSettings));
    serverReady = false;
    byId("saveBtn").disabled = true;
    setStatus(`전략 설정 API 연결 필요 · ${error.message} · 화면은 예시값이며 저장할 수 없습니다.`, "bad");
  }
}

async function saveSettings(){
  if (!serverReady || !loadedSettings) return;
  const next = readSettingsFromForm();
  const validationError = validateSettings(next);
  if (validationError){ alert(validationError); return; }

  const changes = describeChanges(loadedSettings, next);
  if (!changes.length){ alert("변경된 설정이 없습니다."); return; }
  const preview = changes.slice(0, 12).join("\n") + (changes.length > 12 ? `\n외 ${changes.length - 12}건` : "");
  const ok = confirm(`다음 설정을 지금 적용하시겠습니까?\n\n${preview}\n\n※ 신규매수 차단과 기존 보유종목 매도관리는 분리되어야 합니다.`);
  if (!ok) return;

  const saveBtn = byId("saveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "적용 중...";
  try{
    const res = await fetch(`${API_BASE}/api/trading-settings`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(next)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
    loadedSettings = normalizeSettings(data.settings || next);
    renderSettings(deepClone(loadedSettings));
    alert("전략 운전설정이 적용되었습니다.");
  }catch(error){
    console.error("전략 설정 저장 오류", error);
    alert(`설정 적용 실패: ${error.message}`);
  }finally{
    saveBtn.textContent = "설정 적용";
    updateDirtyState();
  }
}

byId("reloadBtn").addEventListener("click", loadSettings);
byId("discardBtn").addEventListener("click", () => {
  if (!loadedSettings) return;
  if (isDirty() && !confirm("저장하지 않은 변경사항을 취소하시겠습니까?")) return;
  renderSettings(deepClone(loadedSettings));
});
byId("saveBtn").addEventListener("click", saveSettings);
byId("globalBuyEnabled").addEventListener("change", updateDirtyState);
byId("maxTotalExposureRate").addEventListener("input", updateDirtyState);
byId("reserveCashRate").addEventListener("input", updateDirtyState);

loadSettings();
