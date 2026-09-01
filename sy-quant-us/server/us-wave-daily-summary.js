'use strict';

const fs=require('fs');
const path=require('path');
const history=require('./us-wave-history-store');
const tracker=require('./us-wave-virtual-tracker');
const { marketTodayKey }=require('./market-calendar');

const REPORT_DIR=path.join(__dirname,'us-wave-reports');
const CHECK_MS=60000;
const FINALIZE_ET='16:20';
let timer=null,lastGeneratedDate=null,lastCheckAt=null,lastError=null;

const num=v=>Number.isFinite(Number(v))?Number(v):0;
const round=(v,d=2)=>Math.round(num(v)*10**d)/10**d;
function avg(xs){const a=xs.filter(v=>Number.isFinite(Number(v))).map(Number);return a.length?round(a.reduce((s,v)=>s+v,0)/a.length):null;}
function compact(d){return String(d).replace(/-/g,'');}
function jp(d){return path.join(REPORT_DIR,`us-wave-summary-${compact(d)}.json`);}
function tp(d){return path.join(REPORT_DIR,`us-wave-summary-${compact(d)}.txt`);}
function nyTime(now=new Date()){return new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);}

function buildSummary(date,{final=false}={}){
  const h=history.getHistory(date);
  const t=tracker.getStatus({includePositions:true});
  const all=t.positions||[];
  const todays=all.filter(p=>p.marketDate===date);
  const open=all.filter(p=>p.status==='OPEN');
  const candidates=h.summary?.candidates||[];
  const ready=candidates.filter(c=>num(c.readyCount)>0);

  return {
    ok:true,
    strategy:'WAVE',
    market:'US',
    observerOnly:true,
    actualOrderEnabled:false,
    reportType:final?'FINAL':'PREVIEW',
    tradingDate:date,
    generatedAt:new Date().toISOString(),
    candidates:{
      scanCount:num(h.summary?.scanCount),
      uniqueCandidateCount:num(h.summary?.uniqueCandidateCount),
      uniqueReadyCount:ready.length,
      uniqueWatchCount:candidates.filter(c=>num(c.watchCount)>0).length,
      readySymbols:ready.map(c=>c.symbol),
      topCandidates:candidates.slice(0,20)
    },
    virtual:{
      todayEntryCount:todays.length,
      openCount:open.length,
      averageCurrentReturnRate:avg(open.map(p=>p.currentReturnRate)),
      averageSampledMfeRate:avg(open.map(p=>p.sampledMaxReturnRate)),
      averageSampledMaeRate:avg(open.map(p=>p.sampledMinReturnRate)),
      positions:open.map(p=>({
        exchange:p.exchange,
        symbol:p.symbol,
        name:p.name,
        marketDate:p.marketDate,
        entryAt:p.entryAt,
        entryPrice:p.entryPrice,
        entryScore:p.entryScore,
        lastPrice:p.lastPrice,
        currentReturnRate:p.currentReturnRate,
        sampledMfeRate:p.sampledMaxReturnRate,
        sampledMaeRate:p.sampledMinReturnRate,
        day1:p.dayMilestones?.['1']?.returnRate??null,
        day2:p.dayMilestones?.['2']?.returnRate??null,
        day3:p.dayMilestones?.['3']?.returnRate??null,
        day5:p.dayMilestones?.['5']?.returnRate??null,
        entrySignal:p.entrySignal
      }))
    },
    marketSummary:{
      firstQqqChangeRate:h.day?.scans?.[0]?.market?.changeRate??null,
      lastQqqChangeRate:h.day?.scans?.at(-1)?.market?.changeRate??null,
      averageQqqChangeRate:avg((h.day?.scans||[]).map(s=>s.market?.changeRate)),
      scanErrorCount:(h.day?.scans||[]).reduce((s,x)=>s+(x.errors||[]).length,0)
    },
    consistency:{
      readyWithoutVirtualEntryCount:ready.filter(c=>!all.some(p=>p.symbol===c.symbol&&p.exchange===c.exchange&&p.marketDate===date)).length,
      readyWithoutVirtualEntry:ready.filter(c=>!all.some(p=>p.symbol===c.symbol&&p.exchange===c.exchange&&p.marketDate===date)).map(c=>c.symbol)
    }
  };
}
function text(s){
  return [
    '===== US-WAVE DAILY SUMMARY =====',
    `거래일: ${s.tradingDate}`,
    `보고서: ${s.reportType}`,
    `후보: ${s.candidates.uniqueCandidateCount} / READY: ${s.candidates.uniqueReadyCount}`,
    `오늘 가상진입: ${s.virtual.todayEntryCount}`,
    `현재 멀티데이 보유: ${s.virtual.openCount}`,
    `현재 평균수익률: ${s.virtual.averageCurrentReturnRate}%`,
    '',
    ...s.virtual.positions.map(p=>
      `${p.symbol} / ${p.entryScore}점 / 현재 ${p.currentReturnRate}% / D1 ${p.day1}% / D2 ${p.day2}% / D3 ${p.day3}% / D5 ${p.day5}%`
    )
  ].join('\n')+'\n';
}
function writeFinal(date){
  fs.mkdirSync(REPORT_DIR,{recursive:true});
  const s=buildSummary(date,{final:true});
  fs.writeFileSync(jp(date),JSON.stringify(s,null,2),'utf8');
  fs.writeFileSync(tp(date),text(s),'utf8');
  lastGeneratedDate=date;
  console.log(
    '[US-WAVE 일일요약]',
    `${date} / 후보 ${s.candidates.uniqueCandidateCount} / READY ${s.candidates.uniqueReadyCount} / 오늘진입 ${s.virtual.todayEntryCount} / 멀티데이보유 ${s.virtual.openCount} / 실제주문 없음`
  );
  return s;
}
function check(){
  lastCheckAt=new Date().toISOString();
  try{
    const d=marketTodayKey('US');
    if(nyTime()>=FINALIZE_ET&&lastGeneratedDate!==d)writeFinal(d);
    lastError=null;
  }catch(e){
    lastError=e.message;
    console.error('[US-WAVE 일일요약 오류]',e.message);
  }
}
function getSummary(date,{preview=true}={}){
  const d=/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))?String(date):marketTodayKey('US');
  if(fs.existsSync(jp(d)))return JSON.parse(fs.readFileSync(jp(d),'utf8'));
  return buildSummary(d,{final:!preview});
}
function getStatus(){
  return {
    ok:true,
    strategy:'WAVE',
    summaryEnabled:true,
    actualOrderEnabled:false,
    polling:Boolean(timer),
    checkIntervalMs:CHECK_MS,
    finalizeAtEt:FINALIZE_ET,
    reportDir:REPORT_DIR,
    lastGeneratedDate,
    lastCheckAt,
    lastError
  };
}
function startDailySummary(){
  if(timer)return timer;
  fs.mkdirSync(REPORT_DIR,{recursive:true});
  timer=setInterval(check,CHECK_MS);
  if(timer.unref)timer.unref();
  console.log('[US-WAVE 일일요약] 16:20 ET 자동생성 시작 / 멀티데이 상태 포함 / 실제주문 영향 없음');
  return timer;
}
module.exports={startDailySummary,getSummary,getStatus,buildSummary};
