import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getDatabase, ref, get, set, update } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnIJEWMU9G5GvZuBvUqFvGTlM5goy2fyw",
  authDomain: "work-schedule-b3c4e.firebaseapp.com",
  databaseURL: "https://work-schedule-b3c4e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "work-schedule-b3c4e",
  storageBucket: "work-schedule-b3c4e.firebasestorage.app",
  messagingSenderId: "823965422017",
  appId: "1:823965422017:web:5967c96d54d66b74919f40"
};

const EQUIPMENT = [
  { id: "gym-roof-b", name: "체육관 옥상 B", alias: "45kW", capacityKw: 46.08, position: "상부 좌측" },
  { id: "gym-roof-a", name: "체육관 옥상 A", alias: "50kW", capacityKw: 50.22, position: "상부 우측" },
  { id: "auditorium-roof", name: "강당 옥상", alias: "103kW", capacityKw: 102.4, position: "하부 전체" }
];

const ADMIN_PASSWORD = "1111";
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

const $ = (id) => document.getElementById(id);
let unlocked = false;
let currentPrevious = {};
let currentExisting = null;

function monthISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function previousMonthISO(month){
  const [y,m] = month.split("-").map(Number);
  const d = new Date(y,m-2,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function generationMonthFromInspection(month){ return previousMonthISO(month); }
function num(v){ const n=Number(String(v??"").replace(/,/g,"")); return Number.isFinite(n)?n:null; }
function fmt(v, digits=1){ return Number.isFinite(Number(v)) ? Number(v).toLocaleString("ko-KR",{maximumFractionDigits:digits}) : "-"; }
function setMsg(el, text, type=""){ el.textContent=text; el.className=`message ${type}`; }

function renderEquipmentInputs(){
  $("equipmentInputs").innerHTML = EQUIPMENT.map(e => `
    <div class="equipment-row" data-id="${e.id}">
      <div class="equipment-name"><b>${e.name} ${e.capacityKw} kW</b><small>${e.alias} · ${e.position}</small></div>
      <label class="field prev-field">이전 검침 누적값
        <div class="readonly-box" id="prev-${e.id}">- <small>kWh</small></div>
      </label>
      <label class="field input-field"><span id="label-${e.id}">이번 검침 누적값</span>
        <input id="input-${e.id}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="누적 kWh" disabled />
      </label>
      <label class="field result-field"><span id="resultLabel-${e.id}">전월 발전량</span>
        <div class="readonly-box" id="monthly-${e.id}">- <small>kWh</small></div>
      </label>
    </div>`).join("");
  EQUIPMENT.forEach(e => $("input-"+e.id).addEventListener("input", recalc));
}

function setUnlocked(value){
  unlocked=value;
  $("saveBtn").disabled=!value;
  $("memo").disabled=!value;
  $("writer").disabled=!value;
  $("inputMode").disabled=!value;
  EQUIPMENT.forEach(e=>$("input-"+e.id).disabled=!value);
  document.querySelectorAll(".photo-card input[type=file], .photo-card button").forEach(el=>el.disabled=!value);
  $("unlockBtn").textContent=value?"🔓 입력 가능":"🔒 입력 잠금";
  $("lockNotice").style.display=value?"none":"block";
}

async function findPreviousCumulative(month, equipmentId){
  const [y,m] = month.split("-").map(Number);
  for(let i=1;i<=180;i++){
    const d = new Date(y,m-1-i,1);
    const ms = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const snap = await get(ref(db,`solar/monthly/${ms}/${equipmentId}`));
    if(snap.exists()){
      const v=snap.val();
      if(Number.isFinite(Number(v.cumulative))) return {month:ms,value:Number(v.cumulative)};
      if(v.inputMode==="cumulative" && Number.isFinite(Number(v.inputValue))) return {month:ms,value:Number(v.inputValue)};
    }
  }
  return null;
}

function updateModeUI(){
  const mode=$("inputMode").value;
  const inspection=$("readingMonth").value;
  const genMonth=generationMonthFromInspection(inspection);
  if(mode==="cumulative"){
    $("modeHelp").textContent=`${inspection} 1일 누적값을 입력하면 ${genMonth} 발전량을 자동 계산합니다.`;
    document.querySelectorAll(".prev-field").forEach(el=>el.style.display="flex");
    EQUIPMENT.forEach(e=>{
      $("label-"+e.id).textContent="이번 검침 누적값";
      $("resultLabel-"+e.id).textContent=`${genMonth} 발전량`;
      $("input-"+e.id).placeholder="누적 kWh";
    });
  }else{
    $("modeHelp").textContent="과거자료처럼 월 발전량 자체가 정리되어 있을 때 사용합니다.";
    document.querySelectorAll(".prev-field").forEach(el=>el.style.display="none");
    EQUIPMENT.forEach(e=>{
      $("label-"+e.id).textContent="월 발전량";
      $("resultLabel-"+e.id).textContent="저장 발전량";
      $("input-"+e.id).placeholder="월 발전량 kWh";
    });
  }
  recalc();
}

async function loadMonth(){
  const month=$("readingMonth").value;
  setMsg($("formMessage"),"불러오는 중…");
  currentExisting=null; currentPrevious={};
  const existingSnap=await get(ref(db,`solar/monthly/${month}`));
  currentExisting=existingSnap.exists()?existingSnap.val():null;
  const existingMode=currentExisting?._meta?.inputMode || "cumulative";
  $("inputMode").value=existingMode;

  for(const e of EQUIPMENT){
    const prev=await findPreviousCumulative(month,e.id);
    currentPrevious[e.id]=prev;
    $("prev-"+e.id).innerHTML=prev?`${fmt(prev.value)} <small>kWh · ${prev.month}</small>`:`없음 <small>최초 기준값</small>`;
    const existing=currentExisting?.[e.id];
    if(existingMode==="generation") $("input-"+e.id).value=existing?.monthlyGeneration ?? existing?.inputValue ?? "";
    else $("input-"+e.id).value=existing?.cumulative ?? existing?.inputValue ?? "";
  }
  $("memo").value=currentExisting?._meta?.memo||"";
  $("writer").value=currentExisting?._meta?.writer||"";
  updateModeUI();
  setMsg($("formMessage"), currentExisting?"기존 월 자료를 불러왔습니다. 잠금 해제 후 수정할 수 있습니다.":"새 검침월입니다.", currentExisting?"":"ok");
  updateStatusForSelectedMonth();
}

function recalc(){
  const mode=$("inputMode").value;
  let total=0, validCount=0;
  for(const e of EQUIPMENT){
    const cur=num($("input-"+e.id).value);
    let generation=null;
    if(mode==="generation") generation=cur;
    else {
      const prev=currentPrevious[e.id]?.value;
      if(cur!==null && prev!==undefined) generation=cur-prev;
    }
    const box=$("monthly-"+e.id);
    if(generation===null){
      box.innerHTML=`- <small>${cur!==null && mode==="cumulative"?"이전 누적값 없음":"kWh"}</small>`;
    } else if(generation<0){
      box.innerHTML=`<span class="negative">${fmt(generation)} kWh</span> <small>확인 필요</small>`;
    } else {
      box.innerHTML=`${fmt(generation)} <small>kWh</small>`;
      total+=generation; validCount++;
    }
  }
  $("calcTotal").innerHTML=`계산 발전량 합계 <b>${validCount?fmt(total):"-"} kWh</b>`;
}

async function saveReading(ev){
  ev.preventDefault();
  if(!unlocked) return;
  const month=$("readingMonth").value;
  const mode=$("inputMode").value;
  const payload={}; let total=0;
  for(const e of EQUIPMENT){
    const inputValue=num($("input-"+e.id).value);
    if(inputValue===null){ setMsg($("formMessage"),`${e.name} 값을 입력하세요.`,"error"); return; }
    let monthlyGeneration=null;
    let cumulative=null;
    let prev=null;
    if(mode==="cumulative"){
      cumulative=inputValue;
      prev=currentPrevious[e.id]?.value;
      monthlyGeneration=prev===undefined?null:cumulative-prev;
      if(monthlyGeneration!==null && monthlyGeneration<0){
        setMsg($("formMessage"),`${e.name}의 누적값이 이전 검침값보다 작습니다. 입력값을 확인하세요.`,"error"); return;
      }
    }else{
      monthlyGeneration=inputValue;
      if(monthlyGeneration<0){ setMsg($("formMessage"),`${e.name} 월 발전량을 확인하세요.`,"error"); return; }
    }
    payload[e.id]={
      inputMode:mode,
      inputValue,
      cumulative,
      previousCumulative:prev ?? null,
      previousMonth:currentPrevious[e.id]?.month ?? null,
      monthlyGeneration,
      capacityKw:e.capacityKw,
      updatedAt:Date.now()
    };
    if(monthlyGeneration!==null) total+=monthlyGeneration;
  }
  payload._meta={
    inspectionMonth:month,
    generationMonth: mode==="cumulative" ? generationMonthFromInspection(month) : month,
    inputMode:mode,
    memo:$("memo").value.trim(),
    writer:$("writer").value.trim(),
    monthlyTotal:total,
    updatedAt:Date.now()
  };
  try{
    await set(ref(db,`solar/monthly/${month}`),payload);
    setMsg($("formMessage"),"월간자료를 저장했습니다.","ok");
    await Promise.all([loadMonth(),loadHistory(),loadSummary()]);
  }catch(err){ setMsg($("formMessage"),`저장 실패: ${err.message}`,"error"); }
}

async function loadHistory(){
  const snap=await get(ref(db,"solar/monthly"));
  const data=snap.exists()?snap.val():{};
  const rows=Object.entries(data).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,18);
  $("historyBody").innerHTML=rows.length?rows.map(([inspectionMonth,v])=>{
    const vals=EQUIPMENT.map(e=>v[e.id]?.monthlyGeneration);
    const total=v._meta?.monthlyTotal ?? vals.reduce((s,x)=>s+(Number.isFinite(Number(x))?Number(x):0),0);
    const generationMonth=v._meta?.generationMonth || inspectionMonth;
    const mode=v._meta?.inputMode==="generation"?"직접입력":"누적차감";
    return `<tr><td>${generationMonth}</td>${vals.map(x=>`<td>${fmt(x)}</td>`).join("")}<td><b>${fmt(total)}</b></td><td>${mode}</td><td>${v._meta?.memo||""}</td></tr>`;
  }).join(""):`<tr><td colspan="7" class="muted">저장된 월간 데이터가 없습니다.</td></tr>`;
}

async function loadSummary(){
  const snap=await get(ref(db,"solar/monthly"));
  const data=snap.exists()?snap.val():{};
  const entries=Object.entries(data).sort((a,b)=>b[0].localeCompare(a[0]));
  if(!entries.length){
    $("latestTotal").textContent="-"; $("yearTotal").textContent="-"; $("latestMonth").textContent="-"; $("latestMonthSub").textContent="저장된 자료 없음"; return;
  }
  const [latestInspection,latest]=entries[0];
  const latestGenMonth=latest._meta?.generationMonth || latestInspection;
  $("latestTotal").textContent=fmt(latest._meta?.monthlyTotal);
  $("latestMonth").textContent=latestGenMonth;
  $("latestMonthSub").textContent=`검침 ${latestInspection}`;
  const year=latestGenMonth.slice(0,4);
  let yTotal=0, count=0;
  for(const [,v] of entries){
    const gm=v._meta?.generationMonth;
    const t=Number(v._meta?.monthlyTotal);
    if(gm?.startsWith(year) && Number.isFinite(t)){yTotal+=t;count++;}
  }
  $("yearTotal").textContent=count?fmt(yTotal):"-";
}

async function updateStatusForSelectedMonth(){
  const month=$("readingMonth").value;
  const snap=await get(ref(db,`solar/monthly/${month}`));
  const exists=snap.exists();
  $("monthStatus").textContent=exists?"입력완료":"미입력";
  $("monthStatusSub").textContent=exists?`${month} 검침자료 저장됨`:`${month} 검침자료 없음`;
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
  const snap=await get(ref(db,`solar/monthlyPhotos/${month}`));
  const data=snap.exists()?snap.val():{};
  for(const e of EQUIPMENT){
    const box=$("preview-"+e.id); const url=data[e.id]?.photoUrl;
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
    const storagePath=`solar/inverterPhotos/${month}/${e.id}.${ext}`;
    const storageRef=sRef(storage,storagePath);
    await uploadBytes(storageRef,file,{contentType:file.type||"image/jpeg"});
    const photoUrl=await getDownloadURL(storageRef);
    await update(ref(db,`solar/monthlyPhotos/${month}/${e.id}`),{photoUrl,storagePath,uploadedAt:Date.now()});
    setMsg($("photoMessage"),`${e.name} 사진을 저장했습니다.`,"ok");
    await loadPhotos();
  }catch(err){ setMsg($("photoMessage"),`사진 저장 실패: ${err.message}`,"error"); }
}

function initPassword(){
  $("unlockBtn").addEventListener("click",()=>{
    if(unlocked){ setUnlocked(false); return; }
    $("passwordInput").value=""; $("passwordError").textContent=""; $("passwordDialog").showModal(); setTimeout(()=>$("passwordInput").focus(),50);
  });
  $("passwordForm").addEventListener("submit",e=>{
    e.preventDefault();
    if($("passwordInput").value===ADMIN_PASSWORD){ setUnlocked(true); $("passwordDialog").close(); }
    else { $("passwordError").textContent="비밀번호가 맞지 않습니다."; }
  });
  $("cancelPassword").addEventListener("click",()=>$("passwordDialog").close());
}

async function init(){
  renderEquipmentInputs(); renderPhotoCards(); initPassword(); setUnlocked(false);
  $("readingMonth").value=monthISO(); $("photoMonth").value=monthISO();
  $("readingMonth").addEventListener("change",async()=>{ await loadMonth(); $("photoMonth").value=$("readingMonth").value; await loadPhotos(); });
  $("photoMonth").addEventListener("change",loadPhotos);
  $("inputMode").addEventListener("change",updateModeUI);
  $("readingForm").addEventListener("submit",saveReading);
  try{
    await get(ref(db,"solar"));
    $("firebaseState").textContent="Firebase 정상"; $("firebaseState").classList.add("ok");
    await Promise.all([loadMonth(),loadHistory(),loadSummary(),loadPhotos()]);
  }catch(err){
    $("firebaseState").textContent="Firebase 연결 오류"; $("firebaseState").classList.add("bad");
    setMsg($("formMessage"),`Firebase 연결 오류: ${err.message}`,"error");
  }
}

init();
