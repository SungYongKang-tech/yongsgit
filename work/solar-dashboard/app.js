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

// 강당 용량은 업로드된 기존 엑셀의 102.4 kWp를 기준으로 작성했습니다.
// 실제 용량이 10.24 kW라면 아래 capacityKw만 10.24로 변경하세요.
const EQUIPMENT = [
  { id: "gym-roof-b", name: "체육관 옥상 B", alias: "45kW", capacityKw: 46.08, position: "상부 좌측" },
  { id: "gym-roof-a", name: "체육관 옥상 A", alias: "50kW", capacityKw: 50.22, position: "상부 우측" },
  { id: "auditorium-roof", name: "강당 옥상", alias: "103kW", capacityKw: 102.4, position: "하부 전체" }
];

const ADMIN_PASSWORD = "1111"; // 간편 잠금용. 강한 보안이 필요한 경우 Firebase Authentication 권장.
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

const $ = (id) => document.getElementById(id);
let unlocked = false;
let currentPrevious = {};
let currentExisting = null;

function todayISO(){
  const d = new Date();
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function monthISO(){ return todayISO().slice(0,7); }
function num(v){ const n=Number(String(v??"").replace(/,/g,"")); return Number.isFinite(n)?n:null; }
function fmt(v, digits=1){ return Number.isFinite(Number(v)) ? Number(v).toLocaleString("ko-KR",{maximumFractionDigits:digits}) : "-"; }
function setMsg(el, text, type=""){ el.textContent=text; el.className=`message ${type}`; }

function renderEquipmentInputs(){
  $("equipmentInputs").innerHTML = EQUIPMENT.map(e => `
    <div class="equipment-row" data-id="${e.id}">
      <div class="equipment-name"><b>${e.name} ${e.capacityKw} kW</b><small>${e.alias} · ${e.position}</small></div>
      <label class="field">전일 누적발전량
        <div class="readonly-box" id="prev-${e.id}">- <small>kWh</small></div>
      </label>
      <label class="field">금일 누적발전량
        <input id="input-${e.id}" type="number" step="0.1" min="0" inputmode="decimal" placeholder="누적 kWh" disabled />
      </label>
      <label class="field">오늘 발전량
        <div class="readonly-box" id="daily-${e.id}">- <small>kWh</small></div>
      </label>
    </div>`).join("");
  EQUIPMENT.forEach(e => $("input-"+e.id).addEventListener("input", recalc));
}

function setUnlocked(value){
  unlocked=value;
  $("saveBtn").disabled=!value;
  $("memo").disabled=!value;
  $("writer").disabled=!value;
  EQUIPMENT.forEach(e=>$("input-"+e.id).disabled=!value);
  document.querySelectorAll(".photo-card input[type=file], .photo-card button").forEach(el=>el.disabled=!value);
  $("unlockBtn").textContent=value?"🔓 입력 가능":"🔒 입력 잠금";
  $("lockNotice").style.display=value?"none":"block";
}

async function findPreviousReading(date, equipmentId){
  const target = new Date(date+"T00:00:00");
  for(let i=1;i<=370;i++){
    const d=new Date(target); d.setDate(d.getDate()-i);
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const snap=await get(ref(db,`solar/daily/${ds}/${equipmentId}`));
    if(snap.exists()){
      const v=snap.val();
      if(Number.isFinite(Number(v.cumulative))) return {date:ds,value:Number(v.cumulative)};
      if(Number.isFinite(Number(v.inputValue)) && v.inputMode==="cumulative") return {date:ds,value:Number(v.inputValue)};
    }
  }
  return null;
}

async function loadDate(){
  const date=$("readingDate").value;
  setMsg($("formMessage"),"불러오는 중…");
  currentExisting=null; currentPrevious={};
  const existingSnap=await get(ref(db,`solar/daily/${date}`));
  currentExisting=existingSnap.exists()?existingSnap.val():null;
  for(const e of EQUIPMENT){
    const prev=await findPreviousReading(date,e.id);
    currentPrevious[e.id]=prev;
    $("prev-"+e.id).innerHTML=prev?`${fmt(prev.value)} <small>kWh · ${prev.date}</small>`:`없음 <small>최초 입력</small>`;
    const existing=currentExisting?.[e.id];
    $("input-"+e.id).value=existing?.cumulative ?? existing?.inputValue ?? "";
  }
  $("memo").value=currentExisting?._meta?.memo||"";
  $("writer").value=currentExisting?._meta?.writer||"";
  recalc();
  setMsg($("formMessage"), currentExisting?"기존 입력값을 불러왔습니다. 잠금 해제 후 수정할 수 있습니다.":"새 날짜입니다.", currentExisting?"":"ok");
}

function recalc(){
  let total=0, validCount=0;
  for(const e of EQUIPMENT){
    const cur=num($("input-"+e.id).value);
    const prev=currentPrevious[e.id]?.value;
    let daily=null;
    if(cur!==null && prev!==undefined){ daily=cur-prev; }
    if(cur!==null && prev===undefined){ daily=null; }
    const box=$("daily-"+e.id);
    if(daily===null){ box.innerHTML=`- <small>${cur!==null?"기준값 없음":"kWh"}</small>`; }
    else if(daily<0){ box.innerHTML=`<span style="color:#b42318">${fmt(daily)} kWh</span> <small>확인 필요</small>`; }
    else { box.innerHTML=`${fmt(daily)} <small>kWh</small>`; total+=daily; validCount++; }
  }
  $("calcTotal").innerHTML=`금일 계산 발전량 합계 <b>${validCount?fmt(total):"-"} kWh</b>`;
}

async function saveReading(ev){
  ev.preventDefault();
  if(!unlocked) return;
  const date=$("readingDate").value;
  const payload={}; let total=0;
  for(const e of EQUIPMENT){
    const cumulative=num($("input-"+e.id).value);
    if(cumulative===null){ setMsg($("formMessage"),`${e.name} 누적발전량을 입력하세요.`,"error"); return; }
    const prev=currentPrevious[e.id]?.value;
    const daily=prev===undefined?null:cumulative-prev;
    if(daily!==null && daily<0){ setMsg($("formMessage"),`${e.name}의 금일 누적값이 전일보다 작습니다. 입력값을 확인하세요.`,"error"); return; }
    payload[e.id]={
      inputMode:"cumulative", cumulative, inputValue:cumulative,
      previousCumulative:prev ?? null,
      previousDate:currentPrevious[e.id]?.date ?? null,
      dailyGeneration:daily,
      capacityKw:e.capacityKw,
      updatedAt:Date.now()
    };
    if(daily!==null) total+=daily;
  }
  payload._meta={date,memo:$("memo").value.trim(),writer:$("writer").value.trim(),dailyTotal:total,updatedAt:Date.now()};
  try{
    await set(ref(db,`solar/daily/${date}`),payload);
    setMsg($("formMessage"),"저장했습니다.","ok");
    await Promise.all([loadDate(),loadHistory(),loadSummary()]);
  }catch(err){ setMsg($("formMessage"),`저장 실패: ${err.message}`,"error"); }
}

async function loadHistory(){
  const snap=await get(ref(db,"solar/daily"));
  const data=snap.exists()?snap.val():{};
  const rows=Object.entries(data).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,14);
  $("historyBody").innerHTML=rows.length?rows.map(([date,v])=>{
    const vals=EQUIPMENT.map(e=>v[e.id]?.dailyGeneration);
    const total=v._meta?.dailyTotal ?? vals.reduce((s,x)=>s+(Number.isFinite(Number(x))?Number(x):0),0);
    return `<tr><td>${date}</td>${vals.map(x=>`<td>${fmt(x)}</td>`).join("")}<td><b>${fmt(total)}</b></td><td>${v._meta?.memo||""}</td></tr>`;
  }).join(""):`<tr><td colspan="6" class="muted">저장된 일일 데이터가 없습니다.</td></tr>`;
}

async function loadSummary(){
  const snap=await get(ref(db,"solar/daily"));
  const data=snap.exists()?snap.val():{};
  const today=todayISO(); const month=today.slice(0,7); const year=today.slice(0,4);
  let todayTotal=null, monthTotal=0, yearTotal=0, monthCount=0, yearCount=0;
  for(const [date,v] of Object.entries(data)){
    const t=Number(v._meta?.dailyTotal);
    if(!Number.isFinite(t)) continue;
    if(date===today) todayTotal=t;
    if(date.startsWith(month)){monthTotal+=t;monthCount++;}
    if(date.startsWith(year)){yearTotal+=t;yearCount++;}
  }
  $("todayTotal").textContent=fmt(todayTotal);
  $("monthTotal").textContent=monthCount?fmt(monthTotal):"-";
  $("yearTotal").textContent=yearCount?fmt(yearTotal):"-";
  $("todayStatus").textContent=todayTotal===null?"미입력":"입력완료";
  $("todayStatusSub").textContent=todayTotal===null?"오늘 누적값을 입력하세요":"오늘 데이터 저장됨";
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
  $("readingDate").value=todayISO(); $("photoMonth").value=monthISO();
  $("readingDate").addEventListener("change",loadDate);
  $("photoMonth").addEventListener("change",loadPhotos);
  $("readingForm").addEventListener("submit",saveReading);
  try{
    await get(ref(db,"solar"));
    $("firebaseState").textContent="Firebase 정상"; $("firebaseState").classList.add("ok");
    await Promise.all([loadDate(),loadHistory(),loadSummary(),loadPhotos()]);
  }catch(err){
    $("firebaseState").textContent="Firebase 연결 오류"; $("firebaseState").classList.add("bad");
    setMsg($("formMessage"),`Firebase 연결 오류: ${err.message}`,"error");
  }
}

init();
