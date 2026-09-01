'use strict';

const fs=require('fs');
const path=require('path');
const marketClient=require('./us-core-market-client');
const usWave=require('./us-wave-strategy');
const { marketTodayKey }=require('./market-calendar');

const DATA_FILE=path.join(__dirname,'us-wave-virtual-trades.json');
const TRACK_INTERVAL_MS=60*1000;
const PRICE_UPDATE_INTERVAL_MS=10*60*1000;
const DAILY_MILESTONES=[1,2,3,5];

let timer=null,tickRunning=false,lastTickAt=null,lastError=null;

const num=v=>Number.isFinite(Number(v))?Number(v):0;
const round=(v,d=2)=>Math.round(num(v)*10**d)/10**d;
const rr=(e,p)=>e>0?((p-e)/e)*100:0;

function empty(){return {version:1,strategy:'WAVE',virtualOnly:true,actualOrderEnabled:false,positions:[],updatedAt:null};}
function load(){
  try{
    if(!fs.existsSync(DATA_FILE))return empty();
    const x=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
    if(!Array.isArray(x.positions))x.positions=[];
    return x;
  }catch(e){lastError=e.message;return empty();}
}
function save(s){
  const t=`${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(t,JSON.stringify(s,null,2),'utf8');
  fs.renameSync(t,DATA_FILE);
}
function nyClock(iso){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
  const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${x.hour}:${x.minute}:${x.second}`;
}
async function latestPrice(exchange,symbol,date){
  const chart=await marketClient.getMinuteChart({exchange,symbol,startDate:date,minute:5,maxPages:1});
  const rows=(chart.rows||[]).filter(r=>num(r.close)>0).sort((a,b)=>
    `${a.businessDate||''}${String(a.time||'').padStart(6,'0')}`.localeCompare(
      `${b.businessDate||''}${String(b.time||'').padStart(6,'0')}`));
  return rows.length?num(rows.at(-1).close):0;
}
function calendarDays(a,b){
  const x=new Date(a),y=new Date(b);
  return Math.max(0,Math.floor((y-x)/(24*60*60*1000)));
}
function makePosition(row,now,date){
  const p=num(row.price);
  return {
    id:`WAVE:${date}:${row.exchange}:${row.symbol}`,
    strategy:'WAVE',
    marketDate:date,
    exchange:row.exchange,
    symbol:row.symbol,
    name:row.name,
    status:'OPEN',
    virtualOnly:true,
    entryAt:now,
    entryClockEt:nyClock(now),
    entryPrice:p,
    entryScore:num(row.score),
    entrySignal:{
      changeRate:num(row.changeRate),
      ma5:num(row.ma5),ma10:num(row.ma10),ma20:num(row.ma20),
      return5d:num(row.return5d),return20d:num(row.return20d),
      dailyVolumeRatio:num(row.dailyVolumeRatio),
      breakoutPositionRate:num(row.breakoutPositionRate),
      ma20ExtensionRate:num(row.ma20ExtensionRate),
      vwapGapRate:num(row.vwapGapRate),
      dayPositionRate:num(row.dayPositionRate),
      qqqChangeRate:num(row.qqqChangeRate),
      reason:row.reason||''
    },
    lastPrice:p,
    currentReturnRate:0,
    sampledMaxReturnRate:0,
    sampledMaxPrice:p,
    sampledMaxAt:now,
    sampledMinReturnRate:0,
    sampledMinPrice:p,
    sampledMinAt:now,
    samples:[{at:now,price:p,returnRate:0}],
    sampleCount:1,
    dayMilestones:Object.fromEntries(DAILY_MILESTONES.map(d=>[String(d),{days:d,capturedAt:null,price:null,returnRate:null}])),
    lastTrackedAt:now,
    lastPriceFetchAt:now
  };
}

async function tick(){
  if(tickRunning)return;
  tickRunning=true;

  const now=new Date().toISOString();
  const date=marketTodayKey('US');
  const clock=nyClock(now).slice(0,5);

  try{
    const state=load();
    const st=usWave.getWaveStatus();
    const ready=(st.lastScan?.candidates||[]).filter(r=>r.status==='READY');

    for(const row of ready){
      const sameOpen=state.positions.some(p=>p.status==='OPEN'&&p.exchange===row.exchange&&p.symbol===row.symbol);
      if(!sameOpen&&num(row.price)>0){
        const p=makePosition(row,now,date);
        state.positions.push(p);
        console.log('[US-WAVE 가상진입]',`${row.symbol} $${p.entryPrice} / ${p.entryScore}점 / 멀티데이 추적 / 실제주문 없음`);
      }
    }

    if(clock<'09:30'||clock>'16:00'){
      state.updatedAt=now;
      save(state);
      lastTickAt=now;
      lastError=null;
      return;
    }

    for(const p of state.positions.filter(x=>x.status==='OPEN')){
      if(Date.now()-new Date(p.lastPriceFetchAt||p.entryAt).getTime()<PRICE_UPDATE_INTERVAL_MS)continue;

      try{
        const price=await latestPrice(p.exchange,p.symbol,date);
        if(!(price>0))continue;

        const r=round(rr(p.entryPrice,price));
        p.lastPrice=price;
        p.currentReturnRate=r;
        p.lastTrackedAt=now;
        p.lastPriceFetchAt=now;
        p.samples.push({at:now,price,returnRate:r});
        p.sampleCount=p.samples.length;

        if(r>num(p.sampledMaxReturnRate)){
          p.sampledMaxReturnRate=r;p.sampledMaxPrice=price;p.sampledMaxAt=now;
        }
        if(r<num(p.sampledMinReturnRate)){
          p.sampledMinReturnRate=r;p.sampledMinPrice=price;p.sampledMinAt=now;
        }

        const days=calendarDays(p.entryAt,now);
        for(const d of DAILY_MILESTONES){
          const ms=p.dayMilestones[String(d)];
          if(ms&&!ms.capturedAt&&days>=d){
            ms.capturedAt=now;ms.price=price;ms.returnRate=r;
          }
        }
      }catch(e){
        lastError=`${p.symbol}: ${e.message}`;
      }
    }

    state.updatedAt=now;
    save(state);
    lastTickAt=now;
    lastError=null;
  }catch(e){
    lastError=e.message;
    console.error('[US-WAVE 가상추적 오류]',e.message);
  }finally{
    tickRunning=false;
  }
}

function getStatus({includePositions=false}={}){
  const s=load(),p=s.positions||[];
  const r={
    ok:true,
    strategy:'WAVE',
    virtualOnly:true,
    actualOrderEnabled:false,
    trackerRunning:Boolean(timer),
    tickRunning,
    trackIntervalMs:TRACK_INTERVAL_MS,
    priceUpdateIntervalMs:PRICE_UPDATE_INTERVAL_MS,
    dailyMilestones:DAILY_MILESTONES,
    lastTickAt,
    lastError,
    totalCount:p.length,
    openCount:p.filter(x=>x.status==='OPEN').length,
    updatedAt:s.updatedAt
  };
  if(includePositions)r.positions=JSON.parse(JSON.stringify(p));
  return r;
}

function startVirtualTracker(){
  if(timer)return timer;
  timer=setInterval(()=>tick().catch(()=>{}),TRACK_INTERVAL_MS);
  if(timer.unref)timer.unref();

  const t=setTimeout(()=>tick().catch(()=>{}),15000);
  if(t.unref)t.unref();

  console.log('[US-WAVE 가상추적] 시작 / READY 최초 가상진입 / 멀티데이 유지 / 실제주문 없음');
  return timer;
}

module.exports={startVirtualTracker,getStatus,tick};
