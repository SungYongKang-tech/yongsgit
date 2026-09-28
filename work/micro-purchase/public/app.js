import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, push, set, update, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDnIJEWMU9G5GvZuBvUqFvGTlM5goy2fyw",
  authDomain: "work-schedule-b3c4e.firebaseapp.com",
  databaseURL: "https://work-schedule-b3c4e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "work-schedule-b3c4e",
  storageBucket: "work-schedule-b3c4e.firebasestorage.app",
  messagingSenderId: "823965422017",
  appId: "1:823965422017:web:05b9bb9fcabf93b2919f40"
};

// 규정 그대로 운영: 6회째부터 사유 필수. 부서 내부방침으로 6회째를 완전 차단하려면 true로 변경.
const STRICT_BLOCK_AFTER_5 = false;
const DB_ROOT = "smallContract";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);

const $ = (id) => document.getElementById(id);
const loginView = $("loginView"), appView = $("appView");
let records = [];
let editingId = null;

function todayStr(){
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function digits(v){ return String(v || "").replace(/\D/g, ""); }
function formatBiz(v){
  const d = digits(v).slice(0,10);
  if(d.length <= 3) return d;
  if(d.length <= 5) return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`;
}
function formatMoney(v){ return Number(v || 0).toLocaleString("ko-KR") + "원"; }
function parseAmount(v){ return Number(String(v || "").replace(/[^0-9]/g,"")) || 0; }
function escapeHtml(s){ return String(s ?? "").replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function rulePeriod(dateStr){
  const y = Number(String(dateStr).slice(0,4));
  if(!y) return null;
  if(y < 2026) return { start:`${y}-01-01`, end:`${y}-12-31`, label:`${y}년(제도 시행 전)`, inScope:false };
  if(y === 2026) return { start:"2026-06-30", end:"2026-12-31", label:"2026년 시행기간(6/30~12/31)", inScope: dateStr >= "2026-06-30" };
  return { start:`${y}-01-01`, end:`${y}-12-31`, label:`${y}년(1/1~12/31)`, inScope:true };
}
function inRange(date, start, end){ return (!start || date >= start) && (!end || date <= end); }
function activeRecords(){ return records.filter(r => !r.deleted); }
function countedRecords(){ return activeRecords().filter(r => r.countable !== false); }
function recordSort(a,b){ return (a.date || "").localeCompare(b.date || "") || Number(a.createdAt || 0) - Number(b.createdAt || 0) || String(a.id).localeCompare(String(b.id)); }

function vendorCount(businessNo, dateStr, excludeId=null){
  const b = digits(businessNo); const p = rulePeriod(dateStr);
  if(!b || !p || !p.inScope) return 0;
  return countedRecords().filter(r => r.id !== excludeId && digits(r.businessNo) === b && inRange(r.date, p.start, p.end)).length;
}
function recordPeriodCount(r){
  const p = rulePeriod(r.date);
  if(!p || !p.inScope || r.countable === false) return null;
  const same = countedRecords().filter(x => digits(x.businessNo) === digits(r.businessNo) && inRange(x.date,p.start,p.end)).sort(recordSort);
  const idx = same.findIndex(x => x.id === r.id);
  return idx >= 0 ? idx + 1 : same.length;
}

function refreshPeriodUI(){
  const date = $("purchaseDate").value || todayStr();
  const p = rulePeriod(date);
  $("periodTitle").textContent = p ? `소액계약 관리기간 · ${p.label}` : "소액계약 관리기간";
  if(!editingId){
    $("filterFrom").value = p?.start || "";
    $("filterTo").value = p?.end || "";
  }
  refreshStats();
  refreshVendorStatus();
}

function refreshStats(){
  const date = $("purchaseDate").value || todayStr(); const p = rulePeriod(date);
  if(!p){ return; }
  const list = activeRecords().filter(r => inRange(r.date,p.start,p.end));
  const counted = list.filter(r => r.countable !== false);
  const map = new Map();
  counted.forEach(r => { const k=digits(r.businessNo); if(k) map.set(k,(map.get(k)||0)+1); });
  $("statTotal").textContent = `${list.length}건`;
  $("statTotalAmount").textContent = formatMoney(list.reduce((s,r)=>s+Number(r.amount||0),0));
  $("statVendors").textContent = `${map.size}개`;
  $("statReached").textContent = `${[...map.values()].filter(v=>v===5).length}개`;
  $("statOver").textContent = `${[...map.values()].filter(v=>v>=6).length}개`;
}

function refreshVendorStatus(){
  const date = $("purchaseDate").value; const name=$("vendorName").value.trim(); const biz=digits($("businessNo").value);
  const box=$("vendorStatus"), reasonField=$("reasonField"), exception=$("safetyException").checked;
  if(!date || !biz){ box.className="statusbox neutral"; box.textContent="업체명과 사업자번호를 입력하면 현재 관리기간 발주횟수를 확인합니다."; reasonField.classList.toggle("hidden", !exception); $("reasonLabel").textContent=exception?"안전·보건 예외 근거 *":"반복구매 사유 *"; return; }
  const p = rulePeriod(date);
  if(!p.inScope){ box.className="statusbox neutral"; box.textContent=`${p.label}: 반복제한 산정대상이 아닙니다.`; reasonField.classList.toggle("hidden", !exception); return; }
  const current = vendorCount(biz,date,editingId); const next=current+1;
  let cls="ok", msg=`${name||"해당 업체"}의 ${p.label} 현재 산정횟수는 ${current}회입니다. 이번 등록은 ${next}회째입니다.`;
  if(exception){ cls="warn"; msg += " 이번 건은 안전·보건 예외로 등록되며 산정횟수에는 포함하지 않습니다. 예외 근거를 입력하세요."; }
  else if(next===5){ cls="warn"; msg += " 5회 도달 건입니다. 다음 발주부터 반복구매 사유가 필요합니다."; }
  else if(next>=6){ cls="danger"; msg += STRICT_BLOCK_AFTER_5 ? " 부서 내부 엄격모드가 켜져 있어 저장이 차단됩니다." : " 6회째 이상이므로 반복구매 사유 입력이 필수입니다."; }
  box.className=`statusbox ${cls}`; box.textContent=msg;
  const needReason = exception || (!exception && next>=6);
  reasonField.classList.toggle("hidden", !needReason); $("reasonLabel").textContent=exception?"안전·보건 예외 근거 *":"반복구매 사유 *";
}

function clearForm(){
  editingId=null; $("formTitle").textContent="소액구매 등록"; $("saveBtn").textContent="저장";
  $("purchaseDate").value=todayStr(); $("vendorName").value=""; $("businessNo").value=""; $("itemDetail").value=""; $("amount").value=""; $("safetyException").checked=false; $("repeatReason").value="";
  $("rowNoPreview").textContent="순번 자동부여"; refreshPeriodUI(); renderLedger();
}

function validateForm(){
  const data={
    date:$("purchaseDate").value,
    requester:$("requester").value.trim(),
    vendorName:$("vendorName").value.trim(),
    businessNo:digits($("businessNo").value),
    itemDetail:$("itemDetail").value.trim(),
    amount:parseAmount($("amount").value),
    safetyException:$("safetyException").checked,
    repeatReason:$("repeatReason").value.trim()
  };
  if(!data.date || !data.requester || !data.vendorName || !data.businessNo || !data.itemDetail || !data.amount) return {ok:false,msg:"날짜, 업체명, 사업자번호, 구매내역, 구매금액, 발주자를 모두 입력하세요."};
  if(data.businessNo.length!==10) return {ok:false,msg:"사업자번호는 숫자 10자리로 입력하세요."};
  const p=rulePeriod(data.date); const current=vendorCount(data.businessNo,data.date,editingId); const next=current+1;
  if(data.safetyException && !data.repeatReason) return {ok:false,msg:"안전·보건 예외 근거를 입력하세요."};
  if(!data.safetyException && p.inScope && next>=6 && STRICT_BLOCK_AFTER_5) return {ok:false,msg:"현재 부서 내부 엄격모드에서는 동일업체 6회째 발주 등록이 차단됩니다."};
  if(!data.safetyException && p.inScope && next>=6 && !data.repeatReason) return {ok:false,msg:`이번 등록은 ${next}회째입니다. 반복구매 사유를 입력해야 저장할 수 있습니다.`};
  return {ok:true,data:{...data,businessNo:formatBiz(data.businessNo),countable:!data.safetyException,rulePeriodStart:p.start,rulePeriodEnd:p.end}};
}

async function saveRecord(){
  const v=validateForm(); if(!v.ok){ alert(v.msg); return; }
  const data=v.data; const user=auth.currentUser;
  try{
    if(editingId){
      await update(ref(db,`${DB_ROOT}/records/${editingId}`),{...data,updatedAt:serverTimestamp(),updatedBy:user?.email||""});
    }else{
      const r=push(ref(db,`${DB_ROOT}/records`));
      await set(r,{...data,createdAt:serverTimestamp(),createdBy:user?.email||"",updatedAt:serverTimestamp(),updatedBy:user?.email||"",deleted:false});
    }
    clearForm();
  }catch(e){ console.error(e); alert("저장 중 오류가 발생했습니다: "+(e.message||e)); }
}

function renderLedger(){
  const from=$("filterFrom").value, to=$("filterTo").value, q=$("filterText").value.trim().toLowerCase();
  const list=activeRecords().filter(r=>inRange(r.date,from,to)).filter(r=>{
    if(!q) return true;
    return [r.vendorName,r.businessNo,r.itemDetail,r.requester,r.repeatReason].join(" ").toLowerCase().includes(q);
  }).sort(recordSort);
  const body=$("ledgerBody");
  if(!list.length){ body.innerHTML='<tr><td colspan="10">조건에 맞는 내역이 없습니다.</td></tr>'; return; }
  body.innerHTML=list.map((r,i)=>{
    const cnt=recordPeriodCount(r); let badge='<span class="badge gray">제도 전/예외</span>';
    if(r.countable===false) badge='<span class="badge gray">안전·보건 예외</span>';
    else if(cnt!=null && cnt>=6) badge='<span class="badge danger">사유필수</span>';
    else if(cnt===5) badge='<span class="badge warn">5회 도달</span>';
    else if(cnt!=null) badge='<span class="badge ok">정상</span>';
    const countText = r.countable===false ? "예외" : (cnt==null?"-":`${cnt}회`);
    return `<tr>
      <td>${i+1}</td><td>${escapeHtml(r.date)}</td><td><b>${escapeHtml(r.vendorName)}</b></td><td>${escapeHtml(r.businessNo)}</td><td>${escapeHtml(r.itemDetail)}${r.repeatReason?`<div style="margin-top:4px;color:#7b5415;font-size:.78rem">사유: ${escapeHtml(r.repeatReason)}</div>`:""}</td><td class="amount">${formatMoney(r.amount)}</td><td>${escapeHtml(r.requester)}</td><td>${countText}</td><td>${badge}</td>
      <td><button class="btn small ghost" data-edit="${r.id}">수정</button> <button class="btn small danger" data-del="${r.id}">삭제</button></td>
    </tr>`;
  }).join("");
  body.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editRecord(b.dataset.edit)));
  body.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>deleteRecord(b.dataset.del)));
}

function editRecord(id){
  const r=records.find(x=>x.id===id); if(!r) return;
  editingId=id; $("formTitle").textContent="소액구매 수정"; $("saveBtn").textContent="수정 저장";
  $("purchaseDate").value=r.date||""; $("requester").value=r.requester||""; $("vendorName").value=r.vendorName||""; $("businessNo").value=r.businessNo||""; $("itemDetail").value=r.itemDetail||""; $("amount").value=Number(r.amount||0).toLocaleString("ko-KR"); $("safetyException").checked=r.countable===false || !!r.safetyException; $("repeatReason").value=r.repeatReason||"";
  $("rowNoPreview").textContent="기존 기록 수정"; refreshVendorStatus(); window.scrollTo({top:70,behavior:"smooth"});
}
async function deleteRecord(id){
  const r=records.find(x=>x.id===id); if(!r) return;
  if(!confirm(`${r.vendorName} / ${r.date} 내역을 삭제 표시할까요?\n실제 DB에서는 감사기록을 위해 남아있습니다.`)) return;
  try{ await update(ref(db,`${DB_ROOT}/records/${id}`),{deleted:true,deletedAt:serverTimestamp(),deletedBy:auth.currentUser?.email||""}); }
  catch(e){ alert("삭제 처리 중 오류: "+(e.message||e)); }
}

function renderVendorQuick(){
  const q=$("vendorSearch").value.trim().toLowerCase(); const box=$("vendorQuickResult");
  if(!q){ box.textContent="검색어를 입력하면 업체별 관리횟수와 구매내역을 바로 확인할 수 있습니다."; return; }
  const d=digits(q); const matches=activeRecords().filter(r=>r.vendorName.toLowerCase().includes(q) || (d && digits(r.businessNo).includes(d)));
  if(!matches.length){ box.textContent="일치하는 업체 이력이 없습니다."; return; }
  const byBiz=new Map(); matches.forEach(r=>{const k=digits(r.businessNo); if(!byBiz.has(k)) byBiz.set(k,[]); byBiz.get(k).push(r);});
  const date=$("purchaseDate").value||todayStr(); const p=rulePeriod(date);
  box.innerHTML=[...byBiz.entries()].slice(0,5).map(([biz,list])=>{
    const sample=list.sort(recordSort)[0]; const cnt=list.filter(r=>r.countable!==false && inRange(r.date,p.start,p.end)).length; const total=list.filter(r=>inRange(r.date,p.start,p.end)).reduce((s,r)=>s+Number(r.amount||0),0);
    const latest=list.sort((a,b)=>(b.date||"").localeCompare(a.date||""))[0];
    return `<div style="padding:8px 0;border-bottom:1px solid #edf1f6"><strong>${escapeHtml(sample.vendorName)}</strong><div class="vendor-meta"><span class="badge ${cnt>=6?'danger':cnt===5?'warn':'ok'}">${p.label} 산정 ${cnt}회</span><span class="badge gray">${formatMoney(total)}</span></div><div style="margin-top:6px;font-size:.82rem;color:#637083">${escapeHtml(sample.businessNo)} · 최근 ${escapeHtml(latest.date)} · ${escapeHtml(latest.itemDetail)}</div></div>`;
  }).join("");
}

function exportExcel(){
  const from=$("filterFrom").value, to=$("filterTo").value, q=$("filterText").value.trim().toLowerCase();
  const list=activeRecords().filter(r=>inRange(r.date,from,to)).filter(r=>!q || [r.vendorName,r.businessNo,r.itemDetail,r.requester,r.repeatReason].join(" ").toLowerCase().includes(q)).sort(recordSort);
  if(!list.length){ alert("다운로드할 내역이 없습니다."); return; }
  const rows=list.map((r,i)=>({순번:i+1,날짜:r.date,업체명:r.vendorName,사업자번호:r.businessNo,구매내역:r.itemDetail,구매금액:Number(r.amount||0),발주자:r.requester,기간내횟수:r.countable===false?"예외":(recordPeriodCount(r)??""),반복구매사유:r.repeatReason||"",예외여부:r.countable===false?"예":"아니오",등록자:r.createdBy||""}));
  if(window.XLSX){
    const ws=XLSX.utils.json_to_sheet(rows); ws['!cols']=[{wch:7},{wch:12},{wch:22},{wch:14},{wch:38},{wch:14},{wch:12},{wch:12},{wch:42},{wch:10},{wch:24}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"소액구매대장"); XLSX.writeFile(wb,`업무지원부_소액구매대장_${from||'전체'}_${to||'전체'}.xlsx`);
  }else{
    const cols=Object.keys(rows[0]); const csv='\ufeff'+[cols.join(','),...rows.map(r=>cols.map(c=>'"'+String(r[c]??'').replace(/"/g,'""')+'"').join(','))].join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download=`업무지원부_소액구매대장_${from||'전체'}_${to||'전체'}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
}

$("businessNo").addEventListener("input",e=>{e.target.value=formatBiz(e.target.value);refreshVendorStatus();});
$("amount").addEventListener("input",e=>{const n=parseAmount(e.target.value);e.target.value=n?n.toLocaleString("ko-KR"):"";});
["purchaseDate","vendorName","safetyException"].forEach(id=>$(id).addEventListener("input",()=>{if(id==="purchaseDate") refreshPeriodUI(); else refreshVendorStatus();}));
$("saveBtn").addEventListener("click",saveRecord); $("resetBtn").addEventListener("click",clearForm);
$("vendorSearch").addEventListener("input",renderVendorQuick); $("filterText").addEventListener("input",renderLedger); $("filterFrom").addEventListener("change",renderLedger); $("filterTo").addEventListener("change",renderLedger); $("filterResetBtn").addEventListener("click",()=>{const p=rulePeriod($("purchaseDate").value||todayStr());$("filterFrom").value=p.start;$("filterTo").value=p.end;$("filterText").value="";renderLedger();}); $("excelBtn").addEventListener("click",exportExcel);

$("loginBtn").addEventListener("click",async()=>{ $("loginMsg").textContent=""; try{await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value);}catch(e){$("loginMsg").textContent="로그인 실패: 이메일/비밀번호를 확인하세요.";}});
$("loginPassword").addEventListener("keydown",e=>{if(e.key==="Enter") $("loginBtn").click();});
$("logoutBtn").addEventListener("click",()=>signOut(auth));

onAuthStateChanged(auth,user=>{
  loginView.classList.toggle("hidden",!!user); appView.classList.toggle("hidden",!user);
  if(!user) return;
  if(!$("requester").value && user.email) $("requester").value=user.email.split("@")[0];
  $("purchaseDate").value=todayStr();
  const p=rulePeriod(todayStr()); $("filterFrom").value=p.start; $("filterTo").value=p.end;
  onValue(ref(db,`${DB_ROOT}/records`),snap=>{
    const v=snap.val()||{}; records=Object.entries(v).map(([id,r])=>({id,...r})); refreshStats(); renderLedger(); renderVendorQuick(); refreshVendorStatus();
  },err=>{console.error(err);alert("데이터베이스를 읽을 수 없습니다. Firebase Database Rules와 로그인 설정을 확인하세요.");});
});
