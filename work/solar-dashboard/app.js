import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
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
const storage = getStorage(app);
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

function renderEquipmentInputs(){
  $("equipmentInputs").innerHTML = EQUIPMENT.map(e => `
    <div class="equipment-row" data-id="${e.id}">
      <div class="equipment-name"><b>${e.name} ${e.capacityKw} kW</b><small>${e.alias} · ${e.position}</small></div>
      <label class="field prev-field">전월 1일 누적값
        <div class="readonly-box" id="prev-${e.id}">- <small>kWh</small></div>
      </label>
      <label class="field input-field">이번 1일 누적값
        <input id="input-${e.id}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="누적 kWh" disabled />
      </label>
      <label class="field result-field"><span id="resultLabel-${e.id}">월 발전량</span>
        <div class="readonly-box" id="monthly-${e.id}">- <small>kWh</small></div>
      </label>
    </div>`).join("");
  EQUIPMENT.forEach(e => $("input-"+e.id).addEventListener("input",recalc));
}

function setUnlocked(value){
  unlocked = value;

  const saveBtn = $("saveBtn");
  const memo = $("memo");
  const writer = $("writer");
  const migrationBtn = $("migrationBtn");
  const unlockBtn = $("unlockBtn");
  const lockNotice = $("lockNotice");

  if (saveBtn) saveBtn.disabled = !value;
  if (memo) memo.disabled = !value;
  if (writer) writer.disabled = !value;

  EQUIPMENT.forEach(e => {
    const input = $("input-" + e.id);
    if (input) input.disabled = !value;
  });

  document
    .querySelectorAll(".photo-card input[type=file], .photo-card button")
    .forEach(el => { el.disabled = !value; });

  if (migrationBtn) {
    migrationBtn.disabled = !value || migrationBtn.dataset.done === "1";
  }

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
  const inspectionMonth=$("readingMonth").value;
  const generationMonth=previousMonthISO(inspectionMonth);
  $("generationMonthLabel").textContent=generationMonth;
  setMsg($("formMessage"),"불러오는 중…");

  currentInspection=await getInspection(inspectionMonth);
  previousInspection=await getInspection(generationMonth);

  for(const e of EQUIPMENT){
    const prev=previousInspection?.[e.id]?.cumulative;
    $("prev-"+e.id).innerHTML=Number.isFinite(Number(prev))?`${fmt(prev)} <small>kWh · ${generationMonth} 1일</small>`:`없음 <small>${generationMonth} 자료 필요</small>`;
    const current=currentInspection?.[e.id]?.cumulative;
    $("input-"+e.id).value=Number.isFinite(Number(current))?current:"";
    $("resultLabel-"+e.id).textContent=`${generationMonth} 발전량`;
  }
  $("memo").value=currentInspection?._meta?.memo||"";
  $("writer").value=currentInspection?._meta?.writer||"";
  recalc();
  setMsg($("formMessage"), currentInspection?"기존 검침자료를 불러왔습니다. 잠금 해제 후 수정할 수 있습니다.":"새 검침월입니다.", currentInspection?"":"ok");
  updateStatusForSelectedMonth();
}

function recalc(){
  let total=0, valid=0, missingPrev=false;
  for(const e of EQUIPMENT){
    const cur=num($("input-"+e.id).value);
    const prev=previousInspection?.[e.id]?.cumulative;
    let generation=null;
    if(cur!==null && Number.isFinite(Number(prev))) generation=cur-Number(prev);
    else if(cur!==null) missingPrev=true;
    const box=$("monthly-"+e.id);
    if(generation===null){
      box.innerHTML=`- <small>${cur!==null?"전월 누적값 없음":"kWh"}</small>`;
    }else if(generation<0){
      box.innerHTML=`<span class="negative">${fmt(generation)} kWh</span> <small>확인 필요</small>`;
    }else{
      box.innerHTML=`${fmt(generation)} <small>kWh</small>`;
      total+=generation; valid++;
    }
  }
  $("calcTotal").innerHTML=`계산 발전량 합계 <b>${valid?fmt(total):"-"} kWh</b>${missingPrev?" <small>· 전월 검침값 필요</small>":""}`;
}

async function saveReading(ev){
  ev.preventDefault();
  if(!unlocked) return;
  const inspectionMonth=$("readingMonth").value;
  const generationMonth=previousMonthISO(inspectionMonth);

  // 같은 검침월 자료가 이미 있으면 실수로 덮어쓰지 않도록 한 번 더 확인합니다.
  if(currentInspection){
    const ok = confirm(`${inspectionMonth} 1일 검침자료가 이미 있습니다.\n수정한 값으로 덮어쓸까요?`);
    if(!ok) return;
  }

  if(!previousInspection){
    setMsg($("formMessage"),`${generationMonth} 1일 누적검침값이 없어 자동 계산할 수 없습니다. 기존자료 등록 여부를 확인하세요.`,"error");
    return;
  }

  const inspectionPayload={};
  const monthlyPayload={};
  let total=0;
  for(const e of EQUIPMENT){
    const cumulative=num($("input-"+e.id).value);
    const prev=Number(previousInspection?.[e.id]?.cumulative);
    if(cumulative===null){ setMsg($("formMessage"),`${e.name} 누적발전량을 입력하세요.`,"error"); return; }
    if(!Number.isFinite(prev)){ setMsg($("formMessage"),`${e.name}의 전월 누적검침값이 없습니다.`,"error"); return; }
    const generation=cumulative-prev;
    if(generation<0){ setMsg($("formMessage"),`${e.name} 누적값이 전월보다 작습니다. 입력값을 확인하세요.`,"error"); return; }
    inspectionPayload[e.id]={cumulative,capacityKw:e.capacityKw,updatedAt:Date.now(),source:"manual"};
    monthlyPayload[e.id]={monthlyGeneration:generation,capacityKw:e.capacityKw,inputMode:"cumulative",inspectionMonth,source:"manual"};
    total+=generation;
  }
  inspectionPayload._meta={inspectionMonth,memo:$("memo").value.trim(),writer:$("writer").value.trim(),updatedAt:Date.now(),source:"manual"};
  monthlyPayload._meta={generationMonth,inspectionMonth,inputMode:"cumulative",monthlyTotal:total,memo:$("memo").value.trim(),writer:$("writer").value.trim(),updatedAt:Date.now(),source:"manual"};

  try{
    const updates={};
    updates[`inspections/${inspectionMonth}`]=inspectionPayload;
    updates[`monthly/${generationMonth}`]=monthlyPayload;
    await update(ref(db,BASE),updates);
    setMsg($("formMessage"),`${inspectionMonth} 검침값과 ${generationMonth} 발전량을 저장했습니다.`,"ok");
    await Promise.all([loadMonth(),loadHistory(),loadSummary()]);
  }catch(err){ setMsg($("formMessage"),`저장 실패: ${err.message}`,"error"); }
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
  const year=$("historyYear").value;
  const snap=await get(ref(db,`${BASE}/monthly`));
  const data=snap.exists()?snap.val():{};
  const rows=Object.entries(data).filter(([m])=>m.startsWith(year+"-")).sort((a,b)=>b[0].localeCompare(a[0]));
  $("historyBody").innerHTML=rows.length?rows.map(([month,v])=>{
    const vals=ALL_EQUIPMENT.map(e=>v[e.id]?.monthlyGeneration);
    const total=v._meta?.monthlyTotal ?? vals.reduce((s,x)=>s+(Number.isFinite(Number(x))?Number(x):0),0);
    return `<tr><td><b>${month}</b></td>${vals.map(x=>`<td>${fmt(x)}</td>`).join("")}<td><b>${fmt(total)}</b></td><td>${v._meta?.source==="xlsx-history"?"기존자료":"월검침"}</td></tr>`;
  }).join(""):`<tr><td colspan="8" class="muted">${year}년 저장자료가 없습니다.</td></tr>`;
}

async function loadSummary(){
  const snap=await get(ref(db,`${BASE}/monthly`));
  const data=snap.exists()?snap.val():{};
  const entries=Object.entries(data).filter(([,v])=>Number.isFinite(Number(v?._meta?.monthlyTotal))).sort((a,b)=>b[0].localeCompare(a[0]));
  if(!entries.length){
    $("latestTotal").textContent="-"; $("yearTotal").textContent="-"; $("latestMonth").textContent="-"; $("latestMonthSub").textContent="기존자료 미등록"; return;
  }
  const [latestMonth,latest]=entries[0];
  $("latestTotal").textContent=fmt(latest._meta.monthlyTotal);
  $("latestMonth").textContent=latestMonth;
  $("latestMonthSub").textContent=latest._meta?.source==="xlsx-history"?"기존자료":"월검침 계산";
  const year=latestMonth.slice(0,4);
  let yTotal=0,count=0;
  for(const [m,v] of entries){
    const t=Number(v._meta?.monthlyTotal);
    if(m.startsWith(year+"-")&&Number.isFinite(t)){ yTotal+=t; count++; }
  }
  $("yearTotal").textContent=count?fmt(yTotal):"-";
  $("yearLabel").textContent=`${year}년`;
}

async function updateStatusForSelectedMonth(){
  const month=$("readingMonth").value;
  const snap=await get(ref(db,`${BASE}/inspections/${month}`));
  const exists=snap.exists();
  $("monthStatus").textContent=exists?"입력완료":"미입력";
  $("monthStatusSub").textContent=exists?`${month} 1일 검침자료 있음`:`${month} 1일 검침자료 없음`;
}

function renderPhotoCards(){
  $("photoGrid").innerHTML=EQUIPMENT.map(e=>`<article class="photo-card" data-photo-id="${e.id}">
    <h3>${e.name} ${e.capacityKw} kW</h3>
    <div class="photo-preview" id="preview-${e.id}">등록된 사진 없음</div>
    <input id="file-${e.id}" type="file" accept="image/*" disabled />
    <button id="upload-${e.id}" class="btn secondary" type="button" disabled>인버터 사진 업로드/교체</button>
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

async function uploadPhoto(e){
  if(!unlocked) return;
  const file=$("file-"+e.id).files[0];
  if(!file){ setMsg($("photoMessage"),`${e.name} 사진을 선택하세요.`,"error"); return; }
  const month=$("photoMonth").value;
  if(month<"2026-07"){ setMsg($("photoMessage"),"사진 관리는 2026년 7월부터입니다.","error"); return; }
  try{
    setMsg($("photoMessage"),`${e.name} 업로드 중…`);
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase();
    const storagePath=`${BASE}/inverterPhotos/${month}/${e.id}.${ext}`;
    const storageRef=sRef(storage,storagePath);
    await uploadBytes(storageRef,file,{contentType:file.type||"image/jpeg"});
    const photoUrl=await getDownloadURL(storageRef);
    await update(ref(db,`${BASE}/monthlyPhotos/${month}/${e.id}`),{photoUrl,storagePath,uploadedAt:Date.now()});
    setMsg($("photoMessage"),`${e.name} 사진을 저장했습니다.`,"ok");
    await loadPhotos();
  }catch(err){ setMsg($("photoMessage"),`사진 저장 실패: ${err.message}`,"error"); }
}

async function checkMigration(){
  const marker=await get(ref(db,`${BASE}/_migration/xlsx_2016_2026_v1`));
  if(marker.exists()){
    $("migrationBtn").dataset.done="1";
    $("migrationBtn").disabled=true;
    $("migrationBtn").textContent="기존자료 등록 완료";
    const v=marker.val();
    $("migrationStatus").textContent=`등록 완료 · 월 발전량 ${v.monthlyCount||122}개월 · 누적검침 ${v.inspectionCount||124}개월`;
    return true;
  }
  $("migrationBtn").dataset.done="0";
  $("migrationBtn").disabled=!unlocked;
  $("migrationStatus").textContent="아직 Firebase에 등록되지 않았습니다.";
  return false;
}

async function importHistoricalData(){
  if(!unlocked || $("migrationBtn").dataset.done==="1") return;
  if(!confirm("엑셀 기존자료(2016년 6월~2026년 9월 검침)를 Firebase에 등록할까요?\n새 전용 경로 solarHQ에 저장됩니다.")) return;
  try{
    $("migrationBtn").disabled=true;
    setMsg($("migrationMessage"),"기존자료를 Firebase에 등록하는 중입니다…");
    const updates={};
    for(const a of HISTORICAL_DATA.assets) updates[`assets/${a.id}`]=a;
    for(const [m,v] of Object.entries(HISTORICAL_DATA.monthly)) updates[`monthly/${m}`]=v;
    for(const [m,v] of Object.entries(HISTORICAL_DATA.inspections)) updates[`inspections/${m}`]=v;
    updates["_migration/xlsx_2016_2026_v1"]={
      importedAt:Date.now(),
      sourceFile:HISTORICAL_DATA.meta.sourceFile,
      monthlyRange:HISTORICAL_DATA.meta.monthlyRange,
      inspectionRange:HISTORICAL_DATA.meta.inspectionRange,
      monthlyCount:HISTORICAL_DATA.meta.monthlyCount,
      inspectionCount:HISTORICAL_DATA.meta.inspectionCount
    };
    await update(ref(db,BASE),updates);
    setMsg($("migrationMessage"),"기존자료 등록이 완료되었습니다.","ok");
    await Promise.all([checkMigration(),loadMonth(),loadHistory(),loadSummary()]);
  }catch(err){
    setMsg($("migrationMessage"),`기존자료 등록 실패: ${err.message}`,"error");
    $("migrationBtn").disabled=!unlocked;
  }
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
    "equipmentInputs", "photoGrid", "historyYear", "passwordDialog",
    "passwordForm", "unlockBtn", "readingMonth", "photoMonth",
    "readingForm", "migrationBtn"
  ];
  const missingIds = requiredIds.filter(id => !$(id));
  if (missingIds.length) {
    console.error("[태양광 대시보드] index.html/app.js 버전 불일치:", missingIds);
    const state = $("firebaseState");
    if (state) {
      state.textContent = "화면 파일 버전 불일치";
      state.classList.add("bad");
    }
    return;
  }

  renderEquipmentInputs();
  renderPhotoCards();
  setupYearFilter();
  initPassword();
  setUnlocked(false);
  $("readingMonth").value=monthISO(); $("photoMonth").value=monthISO();
  $("readingMonth").addEventListener("change",async()=>{ await loadMonth(); $("photoMonth").value=$("readingMonth").value; await loadPhotos(); });
  $("photoMonth").addEventListener("change",loadPhotos);
  $("readingForm").addEventListener("submit",saveReading);
  $("migrationBtn").addEventListener("click",importHistoricalData);
  try{
    await get(ref(db,BASE));
    $("firebaseState").textContent="Firebase 정상"; $("firebaseState").classList.add("ok");
    await checkMigration();
    await Promise.all([loadMonth(),loadHistory(),loadSummary(),loadPhotos()]);
  }catch(err){
    $("firebaseState").textContent="Firebase 연결 오류"; $("firebaseState").classList.add("bad");
    setMsg($("formMessage"),`Firebase 연결 오류: ${err.message}`,"error");
  }
}

init();
