import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { HISTORICAL_DATA } from "./historical-data.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnIJEWMU9G5GvZuBvUqFvGTlM5goy2fyw",
  authDomain: "work-schedule-b3c4e.firebaseapp.com",
  databaseURL: "https://work-schedule-b3c4e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "work-schedule-b3c4e",
  storageBucket: "work-schedule-b3c4e.firebasestorage.app",
  messagingSenderId: "823965422017",
  appId: "1:823965422017:web:5967c96d54d66b74919f40"
};

const BASE = "solarHQ";

const CLOUDINARY_CLOUD_NAME = "dqpcvlakz";
const CLOUDINARY_UPLOAD_PRESET = "koen_solar";
const CLOUDINARY_UPLOAD_URL =
  `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
const ADMIN_PASSWORD = "1111";
const EQUIPMENT = [
  { id: "gym-roof-b", name: "체육관 옥상 B", alias: "45kW", capacityKw: 46.08, position: "상부 좌측", status: "active" },
  { id: "gym-roof-a", name: "체육관 옥상 A", alias: "50kW", capacityKw: 50.22, position: "상부 우측", status: "active" },
  { id: "auditorium-roof", name: "강당 옥상", alias: "103kW", capacityKw: 102.4, position: "하부 전체", status: "active" }
];
const ALL_EQUIPMENT = [
  { id: "parking-100", label: "옥외주차장 100.44", capacityKw: 100.44, status: "removed" },
  { id: "gym-roof-a", label: "체육관 50.22", capacityKw: 50.22, status: "active" },
  { id: "parking-256", label: "옥외주차장 256", capacityKw: 256, status: "removed" },
  { id: "auditorium-roof", label: "강당 102.4", capacityKw: 102.4, status: "active" },
  { id: "gym-roof-b", label: "체육관 46.08", capacityKw: 46.08, status: "active" }
];

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const $ = (id) => document.getElementById(id);
let unlocked = false;
let currentInspection = null;
let previousInspection = null;

function monthISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function previousMonthISO(month){
  const [y,m] = month.split("-").map(Number);
  const d = new Date(y,m-2,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function num(v){ const n=Number(String(v??"").replace(/,/g,"")); return Number.isFinite(n)?n:null; }
function fmt(v,digits=1){ return Number.isFinite(Number(v)) ? Number(v).toLocaleString("ko-KR",{maximumFractionDigits:digits}) : "-"; }
function setMsg(el,text,type=""){ el.textContent=text; el.className=`message ${type}`; }

function shortDateLabel(month){
  const [y,m] = month.split("-").map(Number);
  return `${String(y).slice(-2)}년 ${m}월 1일 누적값`;
}

function renderEquipmentInputs(){
  $("equipmentInputs").innerHTML = `
    <div class="equipment-header-row">
      <div>설비</div>
      <div id="prevHeader">전월 1일 누적값</div>
      <div id="currentHeader">이번 1일 누적값</div>
    </div>
    ${EQUIPMENT.map(e => `
      <div class="equipment-row" data-id="${e.id}">
        <div class="equipment-name"><b>${e.name}</b><small>${e.capacityKw} kW</small></div>
        <div class="readonly-box" id="prev-${e.id}">-</div>
        <input id="input-${e.id}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="누적 kWh" disabled />
      </div>`).join("")}
  `;
}

function setUnlocked(value){
  unlocked = value;

  const saveBtn = $("saveBtn");
  const unlockBtn = $("unlockBtn");
  const lockNotice = $("lockNotice");

  if (saveBtn) saveBtn.disabled = !value;

  EQUIPMENT.forEach(e => {
    const input = $("input-" + e.id);
    if (input) input.disabled = !value;
  });

  document
    .querySelectorAll(".photo-card input[type=file], .photo-card button")
    .forEach(el => { el.disabled = !value; });

  if (unlockBtn) {
    unlockBtn.textContent = value ? "🔓 입력 가능" : "🔒 입력 잠금";
  }

  if (lockNotice) {
    lockNotice.style.display = value ? "none" : "block";
  }
}

async function getInspection(month){
  const snap=await get(ref(db,`${BASE}/inspections/${month}`));
  return snap.exists()?snap.val():null;
}

async function loadMonth(){
  const inspectionMonth = $("readingMonth").value;
  const previousInspectionMonth = previousMonthISO(inspectionMonth);
  setMsg($("formMessage"), "불러오는 중…");

  currentInspection = await getInspection(inspectionMonth);
  previousInspection = await getInspection(previousInspectionMonth);

  $("prevHeader").textContent = shortDateLabel(previousInspectionMonth);
  $("currentHeader").textContent = shortDateLabel(inspectionMonth);

  for(const e of EQUIPMENT){
    const prev = previousInspection?.[e.id]?.cumulative;
    $("prev-"+e.id).textContent = Number.isFinite(Number(prev)) ? fmt(prev) : "-";

    const current = currentInspection?.[e.id]?.cumulative;
    $("input-"+e.id).value = Number.isFinite(Number(current)) ? current : "";
  }

  setMsg(
    $("formMessage"),
    currentInspection
      ? "저장된 누적값을 불러왔습니다. 잠금 해제 후 수정할 수 있습니다."
      : "새 검침월입니다.",
    currentInspection ? "" : "ok"
  );
}

async function saveReading(ev){
  ev.preventDefault();
  if(!unlocked) return;

  const inspectionMonth = $("readingMonth").value;
  const generationMonth = previousMonthISO(inspectionMonth);

  if(currentInspection){
    const ok = confirm(`${shortDateLabel(inspectionMonth)} 자료가 이미 있습니다.\n수정한 값으로 덮어쓸까요?`);
    if(!ok) return;
  }

  if(!previousInspection){
    setMsg($("formMessage"), `${shortDateLabel(generationMonth)} 자료가 없어 월 발전량을 계산할 수 없습니다.`, "error");
    return;
  }

  const inspectionPayload = {};
  const monthlyPayload = {};
  let total = 0;

  for(const e of EQUIPMENT){
    const cumulative = num($("input-"+e.id).value);
    const prev = Number(previousInspection?.[e.id]?.cumulative);

    if(cumulative === null){
      setMsg($("formMessage"), `${e.name} 누적 발전량을 입력하세요.`, "error");
      return;
    }
    if(!Number.isFinite(prev)){
      setMsg($("formMessage"), `${e.name}의 전월 누적값이 없습니다.`, "error");
      return;
    }

    const generation = cumulative - prev;
    if(generation < 0){
      setMsg($("formMessage"), `${e.name} 누적값이 전월보다 작습니다. 입력값을 확인하세요.`, "error");
      return;
    }

    inspectionPayload[e.id] = {
      cumulative,
      capacityKw: e.capacityKw,
      updatedAt: Date.now(),
      source: "manual"
    };

    monthlyPayload[e.id] = {
      monthlyGeneration: generation,
      capacityKw: e.capacityKw,
      inputMode: "cumulative",
      inspectionMonth,
      source: "manual"
    };

    total += generation;
  }

  inspectionPayload._meta = {
    inspectionMonth,
    updatedAt: Date.now(),
    source: "manual"
  };

  monthlyPayload._meta = {
    generationMonth,
    inspectionMonth,
    inputMode: "cumulative",
    monthlyTotal: total,
    updatedAt: Date.now(),
    source: "manual"
  };

  try{
    const updates = {};
    updates[`inspections/${inspectionMonth}`] = inspectionPayload;
    updates[`monthly/${generationMonth}`] = monthlyPayload;
    await update(ref(db, BASE), updates);

    setMsg($("formMessage"), `${shortDateLabel(inspectionMonth)} 자료를 저장했습니다.`, "ok");
    await Promise.all([loadMonth(), loadHistory(), loadSummary()]);
  }catch(err){
    setMsg($("formMessage"), `저장 실패: ${err.message}`, "error");
  }
}

function setupYearFilter(){
  const select=$("historyYear");
  const nowYear=new Date().getFullYear();
  for(let y=2016;y<=Math.max(2026,nowYear);y++){
    const opt=document.createElement("option"); opt.value=String(y); opt.textContent=`${y}년`; select.appendChild(opt);
  }
  select.value="2026";
  select.addEventListener("change",loadHistory);
}

async function loadHistory(){
  const year = $("historyYear").value;
  const snap = await get(ref(db, `${BASE}/monthly`));
  const data = snap.exists() ? snap.val() : {};

  const rows = Object.entries(data)
    .filter(([m]) => m.startsWith(year + "-"))
    .sort((a,b) => a[0].localeCompare(b[0]));

  // 선택 연도에 실제 발전량이 존재하는 설비만 표시합니다.
  // 따라서 철거된 설비가 해당 연도에 발전하지 않았다면 표에서 자동으로 사라집니다.
  const visibleEquipment = ALL_EQUIPMENT.filter(e =>
    rows.some(([,v]) => {
      const n = Number(v?.[e.id]?.monthlyGeneration);
      return Number.isFinite(n) && Math.abs(n) > 0;
    })
  );

  // 월별 표는 태양광 번호 대신 실제 설치위치와 용량으로 표시합니다.
  const labelFor = (e) => {
    const labels = {
      "parking-100": { place: "옥외주차장", capacity: "100.44 kW" },
      "gym-roof-a": { place: "체육관옥상A", capacity: "50.22 kW" },
      "parking-256": { place: "옥외주차장", capacity: "256 kW" },
      "auditorium-roof": { place: "강당옥상", capacity: "102.4 kW" },
      "gym-roof-b": { place: "체육관옥상B", capacity: "46.08 kW" }
    };
    const info = labels[e.id] || {
      place: e.label || "태양광",
      capacity: `${e.capacityKw || ""} kW`
    };
    return `<span class="history-place">${info.place}</span><small>${info.capacity}</small>`;
  };

  const head = $("historyHead");
  const body = $("historyBody");
  const foot = $("historyFoot");

  if (!rows.length) {
    head.innerHTML = `<tr><th>발전월</th><th>합계</th></tr>`;
    body.innerHTML = `<tr><td colspan="2" class="muted">${year}년 저장자료가 없습니다.</td></tr>`;
    foot.innerHTML = "";
    return;
  }

  if (!visibleEquipment.length) {
    head.innerHTML = `<tr><th>발전월</th><th>합계</th></tr>`;
    body.innerHTML = rows.map(([month]) =>
      `<tr><td><b>${Number(month.slice(5,7))}월</b></td><td>0</td></tr>`
    ).join("");
    foot.innerHTML = `<tr class="total-row"><th>합계</th><th>0</th></tr>`;
    return;
  }

  head.innerHTML = `<tr>
    <th>발전월</th>
    ${visibleEquipment.map(e => `<th>${labelFor(e)}</th>`).join("")}
    <th>합계</th>
  </tr>`;

  const equipmentTotals = Object.fromEntries(visibleEquipment.map(e => [e.id, 0]));
  let grandTotal = 0;

  body.innerHTML = rows.map(([month,v]) => {
    const vals = visibleEquipment.map(e => {
      const n = Number(v?.[e.id]?.monthlyGeneration);
      const value = Number.isFinite(n) ? n : 0;
      equipmentTotals[e.id] += value;
      return value;
    });
    const total = vals.reduce((s,n) => s + n, 0);
    grandTotal += total;

    return `<tr>
      <td><b>${Number(month.slice(5,7))}월</b></td>
      ${vals.map(x => `<td>${fmt(x)}</td>`).join("")}
      <td><b>${fmt(total)}</b></td>
    </tr>`;
  }).join("");

  foot.innerHTML = `<tr class="total-row">
    <th>합계</th>
    ${visibleEquipment.map(e => `<th>${fmt(equipmentTotals[e.id])}</th>`).join("")}
    <th>${fmt(grandTotal)}</th>
  </tr>`;
}

function monthlyTotalOf(v){
  const metaTotal = Number(v?._meta?.monthlyTotal);
  if(Number.isFinite(metaTotal)) return metaTotal;

  return ALL_EQUIPMENT.reduce((sum,e) => {
    const n = Number(v?.[e.id]?.monthlyGeneration);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function getNextInspectionDate(){
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getMonth()+1}월 ${next.getDate()}일`;
}

async function loadSummary(){
  const snap = await get(ref(db, `${BASE}/monthly`));
  const data = snap.exists() ? snap.val() : {};
  const entries = Object.entries(data)
    .filter(([month]) => /^\d{4}-\d{2}$/.test(month))
    .sort((a,b) => a[0].localeCompare(b[0]));

  let allTimeTotal = 0;
  let total2026 = 0;
  let months2026 = 0;

  for(const [month, value] of entries){
    const total = monthlyTotalOf(value);
    if(!Number.isFinite(total)) continue;

    allTimeTotal += total;

    if(month.startsWith("2026-")){
      total2026 += total;
      months2026++;
    }
  }

  const expected2026 = months2026 > 0 ? (total2026 / months2026) * 12 : null;

  $("allTimeTotal").textContent = entries.length ? fmt(allTimeTotal) : "-";
  $("total2026").textContent = months2026 ? fmt(total2026) : "-";
  $("expected2026").textContent = Number.isFinite(expected2026) ? fmt(expected2026) : "-";
  $("nextInspectionDate").textContent = getNextInspectionDate();
}

function renderPhotoCards(){
  $("photoGrid").innerHTML=EQUIPMENT.map(e=>`<article class="photo-card" data-photo-id="${e.id}">
    <h3>${e.name} ${e.capacityKw} kW</h3>
    <div class="photo-preview" id="preview-${e.id}">등록된 사진 없음</div>
    <input id="file-${e.id}" type="file" accept="image/*" disabled />
    <button id="upload-${e.id}" class="btn secondary" type="button" disabled>사진 업로드/교체</button>
  </article>`).join("");
  EQUIPMENT.forEach(e=>$("upload-"+e.id).addEventListener("click",()=>uploadPhoto(e)));
}

async function loadPhotos(){
  const month=$("photoMonth").value;
  const snap=await get(ref(db,`${BASE}/monthlyPhotos/${month}`));
  const data=snap.exists()?snap.val():{};
  for(const e of EQUIPMENT){
    const box=$("preview-"+e.id), url=data[e.id]?.photoUrl;
    box.innerHTML=url?`<img src="${url}" alt="${e.name} ${month} 인버터 화면 사진">`:`등록된 사진 없음`;
  }
}


function uploadCloudinaryImage(file, onProgress){
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    // Unsigned preset은 file + upload_preset 두 값만 사용합니다.
    // 폴더는 Cloudinary의 koen_solar preset에 설정된 Asset folder를 따릅니다.
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("asset_folder", "koen-solar");

    xhr.open("POST", CLOUDINARY_UPLOAD_URL, true);
    xhr.timeout = 45000;

    xhr.upload.addEventListener("progress", (event) => {
      if(event.lengthComputable && typeof onProgress === "function"){
        const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        onProgress(percent);
      }
    });

    xhr.addEventListener("load", () => {
      let result = {};
      try{
        result = JSON.parse(xhr.responseText || "{}");
      }catch(_){}

      if(xhr.status >= 200 && xhr.status < 300 && result.secure_url){
        resolve(result);
        return;
      }

      const reason =
        result?.error?.message ||
        `Cloudinary HTTP ${xhr.status || "응답 없음"}`;
      reject(new Error(reason));
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Cloudinary 서버와 통신하지 못했습니다. 네트워크 또는 브라우저 차단을 확인하세요."));
    });

    xhr.addEventListener("timeout", () => {
      reject(new Error("Cloudinary 업로드가 45초 안에 완료되지 않았습니다."));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Cloudinary 업로드가 취소되었습니다."));
    });

    xhr.send(formData);
  });
}

async function uploadPhoto(e){
  if(!unlocked) return;

  const fileInput = $("file-" + e.id);
  const uploadBtn = $("upload-" + e.id);
  const file = fileInput?.files?.[0];

  if(!file){
    setMsg($("photoMessage"), `${e.name} 사진을 선택하세요.`, "error");
    return;
  }

  const month = $("photoMonth").value;
  if(month < "2026-07"){
    setMsg($("photoMessage"), "사진 관리는 2026년 7월부터입니다.", "error");
    return;
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if(!allowedTypes.includes(file.type)){
    setMsg($("photoMessage"), "JPG, PNG, WEBP 사진만 업로드할 수 있습니다.", "error");
    return;
  }

  const maxBytes = 5 * 1024 * 1024;
  if(file.size > maxBytes){
    setMsg($("photoMessage"), "사진은 5MB 이하로 선택하세요.", "error");
    return;
  }

  const originalText = uploadBtn?.textContent || "사진 업로드/교체";

  try{
    if(uploadBtn){
      uploadBtn.disabled = true;
      uploadBtn.textContent = "업로드 준비…";
    }

    const result = await uploadCloudinaryImage(file, (percent) => {
      setMsg($("photoMessage"), `${e.name} 업로드 중… ${percent}%`);
      if(uploadBtn) uploadBtn.textContent = `업로드 ${percent}%`;
    });

    if(uploadBtn) uploadBtn.textContent = "Firebase 기록 중…";

    await update(
      ref(db, `${BASE}/monthlyPhotos/${month}/${e.id}`),
      {
        photoUrl: result.secure_url,
        publicId: result.public_id || "",
        assetId: result.asset_id || "",
        format: result.format || "",
        width: Number(result.width || 0),
        height: Number(result.height || 0),
        bytes: Number(result.bytes || file.size || 0),
        cloudinaryFolder: "koen-solar",
        uploadPreset: CLOUDINARY_UPLOAD_PRESET,
        uploadedAt: Date.now()
      }
    );

    fileInput.value = "";
    setMsg($("photoMessage"), `${e.name} 사진을 저장했습니다.`, "ok");
    await loadPhotos();

  }catch(err){
    console.error("[Cloudinary 업로드 실패]", err);
    setMsg($("photoMessage"), `사진 저장 실패: ${err.message}`, "error");
  }finally{
    if(uploadBtn){
      uploadBtn.disabled = !unlocked;
      uploadBtn.textContent = originalText;
    }
  }
}

async function ensureHistoricalData(){
  const marker = await get(ref(db, `${BASE}/_migration/xlsx_2016_2026_v1`));
  if(marker.exists()) return true;

  const updates = {};
  for(const a of HISTORICAL_DATA.assets) updates[`assets/${a.id}`] = a;
  for(const [m,v] of Object.entries(HISTORICAL_DATA.monthly)) updates[`monthly/${m}`] = v;
  for(const [m,v] of Object.entries(HISTORICAL_DATA.inspections)) updates[`inspections/${m}`] = v;

  updates["_migration/xlsx_2016_2026_v1"] = {
    importedAt: Date.now(),
    sourceFile: HISTORICAL_DATA.meta.sourceFile,
    monthlyRange: HISTORICAL_DATA.meta.monthlyRange,
    inspectionRange: HISTORICAL_DATA.meta.inspectionRange,
    monthlyCount: HISTORICAL_DATA.meta.monthlyCount,
    inspectionCount: HISTORICAL_DATA.meta.inspectionCount
  };

  await update(ref(db, BASE), updates);
  return true;
}

function monthRange(startMonth, endMonth){
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  const months = [];
  let y = sy, m = sm;
  while(y < ey || (y === ey && m <= em)){
    months.push(`${y}-${String(m).padStart(2,"0")}`);
    m++;
    if(m > 12){ m = 1; y++; }
  }
  return months;
}

async function exportGenerationExcel(startMonth, endMonth){
  if(!window.XLSX) throw new Error("엑셀 생성 라이브러리를 불러오지 못했습니다.");

  const snap = await get(ref(db, `${BASE}/monthly`));
  const data = snap.exists() ? snap.val() : {};
  const months = monthRange(startMonth, endMonth);

  const rowsInRange = months.map(month => [month, data[month] || null]);
  const visibleEquipment = ALL_EQUIPMENT.filter(e =>
    rowsInRange.some(([,v]) => {
      const n = Number(v?.[e.id]?.monthlyGeneration);
      return Number.isFinite(n) && Math.abs(n) > 0;
    })
  );

  if(!rowsInRange.some(([,v]) => v)){
    throw new Error("선택한 기간에 저장된 발전량 자료가 없습니다.");
  }

  const equipmentName = {
    "parking-100": "옥외주차장 100.44 kW",
    "gym-roof-a": "체육관옥상A 50.22 kW",
    "parking-256": "옥외주차장 256 kW",
    "auditorium-roof": "강당옥상 102.4 kW",
    "gym-roof-b": "체육관옥상B 46.08 kW"
  };

  const aoa = [];
  aoa.push(["본사사옥 태양광 월별 발전량"]);
  aoa.push(["조회기간", `${startMonth} ~ ${endMonth}`]);
  aoa.push([]);
  aoa.push(["발전월", ...visibleEquipment.map(e => equipmentName[e.id] || e.label || e.id), "합계(kWh)"]);

  const equipmentTotals = Object.fromEntries(visibleEquipment.map(e => [e.id, 0]));
  let grandTotal = 0;

  for(const [month, value] of rowsInRange){
    const vals = visibleEquipment.map(e => {
      const n = Number(value?.[e.id]?.monthlyGeneration);
      const v = Number.isFinite(n) ? n : 0;
      equipmentTotals[e.id] += v;
      return v;
    });
    const total = vals.reduce((sum, n) => sum + n, 0);
    grandTotal += total;
    aoa.push([month, ...vals, total]);
  }

  aoa.push([]);
  aoa.push(["합계", ...visibleEquipment.map(e => equipmentTotals[e.id]), grandTotal]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 12 },
    ...visibleEquipment.map(() => ({ wch: 22 })),
    { wch: 15 }
  ];

  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: visibleEquipment.length + 1 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "월별 발전량");

  const fileName = `본사사옥_태양광_발전량_${startMonth}_${endMonth}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

function initExcelExport(){
  const btn = $("exportExcelBtn");
  const dialog = $("excelDialog");
  const form = $("excelForm");
  const start = $("excelStartMonth");
  const end = $("excelEndMonth");
  const error = $("excelError");

  btn.addEventListener("click", () => {
    const now = monthISO();
    start.value = `${new Date().getFullYear()}-01`;
    end.value = now;
    error.textContent = "";
    dialog.showModal();
  });

  $("cancelExcel").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";

    if(!start.value || !end.value){
      error.textContent = "시작월과 종료월을 선택하세요.";
      return;
    }
    if(start.value > end.value){
      error.textContent = "시작월은 종료월보다 늦을 수 없습니다.";
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const oldText = submitBtn.textContent;
    try{
      submitBtn.disabled = true;
      submitBtn.textContent = "생성 중…";
      await exportGenerationExcel(start.value, end.value);
      dialog.close();
    }catch(err){
      error.textContent = `엑셀 생성 실패: ${err.message}`;
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }
  });
}

function initPassword(){
  $("unlockBtn").addEventListener("click",()=>{
    if(unlocked){ setUnlocked(false); return; }
    $("passwordInput").value=""; $("passwordError").textContent=""; $("passwordDialog").showModal(); setTimeout(()=>$("passwordInput").focus(),50);
  });
  $("passwordForm").addEventListener("submit",e=>{
    e.preventDefault();
    if($("passwordInput").value===ADMIN_PASSWORD){ setUnlocked(true); $("passwordDialog").close(); }
    else $("passwordError").textContent="비밀번호가 맞지 않습니다.";
  });
  $("cancelPassword").addEventListener("click",()=>$("passwordDialog").close());
}

async function init(){
  const requiredIds = [
    "equipmentInputs", "photoGrid", "historyYear", "historyHead", "historyBody", "historyFoot", "passwordDialog",
    "passwordForm", "unlockBtn", "readingMonth", "photoMonth", "readingForm",
    "allTimeTotal", "expected2026", "total2026", "nextInspectionDate",
    "exportExcelBtn", "excelDialog", "excelForm", "excelStartMonth", "excelEndMonth", "cancelExcel"
  ];
  const missingIds = requiredIds.filter(id => !$(id));
  if (missingIds.length) {
    console.error("[태양광 대시보드] index.html/app.js 버전 불일치:", missingIds);
    const formMessage = $("formMessage");
    if (formMessage) setMsg(formMessage, "화면 파일 버전 불일치", "error");
    return;
  }

  renderEquipmentInputs();
  renderPhotoCards();
  setupYearFilter();
  initPassword();
  initExcelExport();
  setUnlocked(false);
  $("readingMonth").value=monthISO(); $("photoMonth").value=monthISO();
  $("readingMonth").addEventListener("change",async()=>{ await loadMonth(); $("photoMonth").value=$("readingMonth").value; await loadPhotos(); });
  $("photoMonth").addEventListener("change",loadPhotos);
  $("readingForm").addEventListener("submit",saveReading);
  try{
    await get(ref(db,BASE));
    await ensureHistoricalData();
    await Promise.all([loadMonth(),loadHistory(),loadSummary(),loadPhotos()]);
  }catch(err){
    setMsg($("formMessage"),`Firebase 연결 오류: ${err.message}`,"error");
  }
}

init();
