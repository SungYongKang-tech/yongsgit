'use strict';

const marketClient = require('./us-core-market-client');
const activityStore = require('./us-dashboard-activity-store');
const paperAutoTrader = require('./us-paper-auto-trader');
const { marketTodayKey, isUsTradingDay } = require('./market-calendar');

const WAVE_CONFIG = Object.freeze({
  observerOnly: false,
  orderSubmissionEnabled: true,
  implemented: true,

  waveStartEt: '11:00',
  waveEndEt: '15:30',
  autoScanIntervalMs: 10 * 60 * 1000,

  analyzeCandidateCount: 15,
  candidateStoreCount: 20,

  minPrice: 10,
  minTradeValue: 15000000,
  minDayPositionRate: 45,
  minVwapGapRate: -0.50,
  maxIntradayChangeRate: 8.0,

  minDailyVolumeRatio: 1.10,
  maxMa20ExtensionRate: 15.0,
  minFiveDayReturnRate: 1.0,
  minTwentyDayReturnRate: 3.0,
  minBreakoutPositionRate: 85,

  readyScore: 72,
  watchScore: 50,

  qqqHardBlockChangeRate: -2.0,
  qqqHardBlockVwapGapRate: -0.80,
  dailyLookback: 60
});

const INVALID_SYMBOLS = new Set(['PSQL']);
let scanRunning = false;
let scanTimer = null;
let lastScan = {
  ok: true,
  strategy: 'WAVE',
  observerOnly: false,
  implemented: true,
  status: 'WAITING',
  reason: '아직 US-WAVE 후보 스캔을 실행하지 않았습니다.',
  updatedAt: null,
  market: null,
  candidates: [],
  errors: []
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(num(v) * f) / f;
}
function compactDate(v) {
  return String(v || '').replace(/-/g, '');
}
function nyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const x = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${x.hour}:${x.minute}`;
}
function clockMinutes(v) {
  const [h, m] = String(v || '00:00').split(':').map(Number);
  return num(h) * 60 + num(m);
}
function getSessionState(now = new Date()) {
  const date = marketTodayKey('US', now);
  const clockEt = nyClock(now);
  const tradingDay = isUsTradingDay(date);
  const cur = clockMinutes(clockEt);
  return {
    date,
    clockEt,
    tradingDay,
    regular: tradingDay && cur >= 570 && cur <= 960,
    waveWindow: tradingDay && clockEt >= WAVE_CONFIG.waveStartEt && clockEt <= WAVE_CONFIG.waveEndEt
  };
}

function minuteMetrics(rows = []) {
  const sorted = (rows || [])
    .filter(r => num(r.close) > 0)
    .sort((a,b) =>
      `${a.businessDate || ''}${String(a.time || '').padStart(6,'0')}`.localeCompare(
      `${b.businessDate || ''}${String(b.time || '').padStart(6,'0')}`));

  const latestDate = sorted.reduce(
    (m,r) => String(r.businessDate || '') > m ? String(r.businessDate || '') : m, ''
  );
  const bars = sorted.filter(r => String(r.businessDate || '') === latestDate);

  if (!bars.length) {
    return {
      businessDate: latestDate,
      price:0, open:0, high:0, low:0, volume:0,
      vwap:0, vwapGapRate:0, dayPositionRate:0, trendPersistence:0
    };
  }

  let volume=0,pv=0,high=0,low=Infinity;
  for(const b of bars){
    const v=Math.max(0,num(b.volume));
    const c=num(b.close),h=num(b.high),l=num(b.low);
    volume+=v;
    pv+=((h+l+c)/3)*v;
    high=Math.max(high,h,c);
    low=Math.min(low,l||Infinity,c||Infinity);
  }
  if(!Number.isFinite(low))low=0;

  const price=num(bars.at(-1).close);
  const open=num(bars[0].open||bars[0].close);
  const vwap=volume>0?pv/volume:price;
  const recent=bars.slice(-6);
  let good=0,steps=0;
  for(let i=1;i<recent.length;i++){steps++;if(num(recent[i].close)>=num(recent[i-1].close))good++;}

  return {
    businessDate:latestDate,
    price,open,high,low,volume,
    vwap:round(vwap,4),
    vwapGapRate:round(vwap>0?(price-vwap)/vwap*100:0),
    dayPositionRate:round(high>low?(price-low)/(high-low)*100:50,1),
    trendPersistence:round(steps?good/steps:0,2)
  };
}

function sma(values, n) {
  const xs = values.slice(-n);
  return xs.length === n ? xs.reduce((s,v)=>s+v,0)/n : 0;
}

function dailyMetrics(rows = []) {
  const sorted = (rows || [])
    .filter(r => String(r.date || '') && num(r.close) > 0)
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));

  if (!sorted.length) {
    return {
      latestDate:'', close:0, ma5:0, ma10:0, ma20:0,
      return5d:0, return20d:0, volumeRatio:0,
      high20:0, breakoutPositionRate:0, ma20ExtensionRate:0
    };
  }

  const closes = sorted.map(r => num(r.close));
  const latest = sorted.at(-1);
  const close = num(latest.close);
  const ma5 = sma(closes,5);
  const ma10 = sma(closes,10);
  const ma20 = sma(closes,20);

  const ret = days => {
    if (sorted.length <= days) return 0;
    const base = num(sorted.at(-(days+1)).close);
    return base > 0 ? ((close-base)/base)*100 : 0;
  };

  const prior20 = sorted.slice(-21,-1);
  const high20 = prior20.length
    ? Math.max(...prior20.map(r => Math.max(num(r.high),num(r.close))))
    : Math.max(...sorted.slice(-20).map(r => Math.max(num(r.high),num(r.close))));

  const recentVol = sorted.slice(-5).map(r=>num(r.volume)).filter(v=>v>0);
  const baseVol = sorted.slice(-25,-5).map(r=>num(r.volume)).filter(v=>v>0);
  const recentAvg = recentVol.length ? recentVol.reduce((s,v)=>s+v,0)/recentVol.length : 0;
  const baseAvg = baseVol.length ? baseVol.reduce((s,v)=>s+v,0)/baseVol.length : 0;
  const volumeRatio = baseAvg > 0 ? recentAvg/baseAvg : 0;

  const low20 = Math.min(...sorted.slice(-20).map(r => Math.min(num(r.low)||num(r.close),num(r.close))));
  const breakoutPositionRate = high20 > low20 ? ((close-low20)/(high20-low20))*100 : 50;

  return {
    latestDate:String(latest.date || ''),
    close,
    ma5:round(ma5,4),
    ma10:round(ma10,4),
    ma20:round(ma20,4),
    return5d:round(ret(5)),
    return20d:round(ret(20)),
    volumeRatio:round(volumeRatio,2),
    high20:round(high20,4),
    breakoutPositionRate:round(breakoutPositionRate,1),
    ma20ExtensionRate:round(ma20>0?((close-ma20)/ma20)*100:0)
  };
}

function scoreMarket(q){
  let s=0;
  if(q.changeRate>=0.5)s+=8;
  else if(q.changeRate>=0)s+=6;
  else if(q.changeRate>=-0.8)s+=3;
  if(q.vwapGapRate>=0.2)s+=7;
  else if(q.vwapGapRate>=0)s+=5;
  else if(q.vwapGapRate>=-0.4)s+=2;
  return Math.min(15,s);
}
function scoreTrend(d){
  let s=0;
  if(d.ma5>d.ma10 && d.ma10>d.ma20)s+=20;
  else if(d.ma5>d.ma20 && d.ma10>=d.ma20)s+=12;
  else if(d.close>d.ma20)s+=6;
  return s;
}
function scoreMomentum(d){
  let s=0;
  if(d.return5d>=5)s+=10;
  else if(d.return5d>=2)s+=8;
  else if(d.return5d>=1)s+=5;

  if(d.return20d>=12)s+=10;
  else if(d.return20d>=6)s+=8;
  else if(d.return20d>=3)s+=5;
  return s;
}
function scoreBreakout(d){
  if(d.breakoutPositionRate>=98)return 10;
  if(d.breakoutPositionRate>=95)return 15;
  if(d.breakoutPositionRate>=90)return 13;
  if(d.breakoutPositionRate>=85)return 10;
  if(d.breakoutPositionRate>=75)return 5;
  return 0;
}
function scoreVolume(d){
  if(d.volumeRatio>=2)return 15;
  if(d.volumeRatio>=1.5)return 12;
  if(d.volumeRatio>=1.2)return 9;
  if(d.volumeRatio>=1.1)return 6;
  return 0;
}
function scoreIntraday(m,change,tradeValue){
  let s=0;
  if(change>=0&&change<=4)s+=6;
  else if(change>4&&change<=8)s+=3;
  if(m.vwapGapRate>=0&&m.vwapGapRate<=2)s+=6;
  else if(m.vwapGapRate>=-0.5)s+=3;
  if(m.dayPositionRate>=65)s+=5;
  else if(m.dayPositionRate>=45)s+=3;
  if(m.trendPersistence>=0.6)s+=4;
  else if(m.trendPersistence>=0.4)s+=2;
  if(tradeValue>=50000000)s+=4;
  else if(tradeValue>=15000000)s+=2;
  return s;
}

async function getQqqState(){
  const chart=await marketClient.getMinuteChart({
    exchange:'ND',symbol:'QQQ',startDate:marketTodayKey('US'),minute:5,maxPages:2
  });
  const m=minuteMetrics(chart.rows);
  const changeRate=m.open>0?((m.price-m.open)/m.open)*100:0;
  const q={
    symbol:'QQQ',price:round(m.price,4),changeRate:round(changeRate),
    vwap:m.vwap,vwapGapRate:m.vwapGapRate,dayPositionRate:m.dayPositionRate,
    businessDate:m.businessDate
  };
  q.hardBlocked =
    q.changeRate<=WAVE_CONFIG.qqqHardBlockChangeRate ||
    q.vwapGapRate<=WAVE_CONFIG.qqqHardBlockVwapGapRate;
  q.marketScore=scoreMarket(q);
  return q;
}

function mergeRows(volumeRows=[],changeRows=[]){
  const map=new Map();
  function ingest(row,weight){
    const symbol=String(row.symbol||'').toUpperCase().trim();
    const exchange=marketClient.normalizeExchange(row.exchange);
    if(!symbol||!exchange||INVALID_SYMBOLS.has(symbol))return;

    const k=`${exchange}:${symbol}`;
    const p=map.get(k)||{
      exchange,symbol,name:row.name||symbol,
      price:0,open:0,high:0,low:0,volume:0,tradeValue:0,
      openChangeRate:0,sources:[],discoveryWeight:0
    };
    p.name=row.name||p.name;
    p.price=num(row.price)||p.price;
    p.open=num(row.open)||p.open;
    p.high=num(row.high)||p.high;
    p.low=num(row.low)||p.low;
    p.volume=Math.max(p.volume,num(row.volume));
    p.tradeValue=Math.max(p.tradeValue,num(row.tradeValue));
    p.openChangeRate=num(row.openChangeRate)||p.openChangeRate;
    p.discoveryWeight+=weight+Math.max(0,30-num(row.rank));
    if(row.source&&!p.sources.includes(row.source))p.sources.push(row.source);
    map.set(k,p);
  }

  volumeRows.slice(0,40).forEach(r=>ingest(r,12));
  changeRows.slice(0,40).forEach(r=>ingest(r,12));

  return [...map.values()]
    .filter(r=>r.price>=WAVE_CONFIG.minPrice)
    .sort((a,b)=>
      b.sources.length-a.sources.length ||
      b.discoveryWeight-a.discoveryWeight ||
      b.tradeValue-a.tradeValue
    );
}

async function analyzeCandidate(s,q,session){
  const [minuteChart,dailyChart]=await Promise.all([
    marketClient.getMinuteChart({
      exchange:s.exchange,symbol:s.symbol,startDate:session.date,minute:5,maxPages:2
    }),
    marketClient.getDailyChart({
      exchange:s.exchange,symbol:s.symbol,startDate:null,maxPages:2
    })
  ]);

  const m=minuteMetrics(minuteChart.rows);
  const d=dailyMetrics(dailyChart.rows);

  const price=num(s.price)||m.price||d.close;
  const open=num(s.open)||m.open;
  const change=num(s.openChangeRate)||(open>0?((price-open)/open)*100:0);
  const volume=Math.max(num(s.volume),m.volume);
  const tradeValue=Math.max(num(s.tradeValue),price*volume);

  const components={
    market:scoreMarket(q),
    dailyTrend:scoreTrend(d),
    momentum:scoreMomentum(d),
    breakout:scoreBreakout(d),
    dailyVolume:scoreVolume(d),
    intraday:scoreIntraday(m,change,tradeValue)
  };
  const score=Object.values(components).reduce((a,b)=>a+b,0);
  const blocks=[];

  if(q.hardBlocked)blocks.push('QQQ 강한 약세');
  if(!(d.ma5>d.ma20 && d.ma10>=d.ma20))blocks.push('일봉 추세 부족');
  if(d.return5d<WAVE_CONFIG.minFiveDayReturnRate)blocks.push('5일 모멘텀 부족');
  if(d.return20d<WAVE_CONFIG.minTwentyDayReturnRate)blocks.push('20일 모멘텀 부족');
  if(d.volumeRatio>0&&d.volumeRatio<WAVE_CONFIG.minDailyVolumeRatio)blocks.push('일봉 거래량 확장 부족');
  if(d.breakoutPositionRate<WAVE_CONFIG.minBreakoutPositionRate)blocks.push('20일 고점권 아님');
  if(d.ma20ExtensionRate>WAVE_CONFIG.maxMa20ExtensionRate)blocks.push('20일선 과이격');
  if(change>WAVE_CONFIG.maxIntradayChangeRate)blocks.push('당일 과열');
  if(m.dayPositionRate<WAVE_CONFIG.minDayPositionRate)blocks.push('당일 위치 낮음');
  if(m.vwapGapRate<WAVE_CONFIG.minVwapGapRate)blocks.push('VWAP 약세');
  if(tradeValue<WAVE_CONFIG.minTradeValue)blocks.push('거래대금 부족');
  if(m.businessDate!==compactDate(session.date))blocks.push('당일 분봉 없음');

  let status='OBSERVE';
  if(!blocks.length&&score>=WAVE_CONFIG.readyScore)status='READY';
  else if(score>=WAVE_CONFIG.watchScore)status='WATCH';

  const reason=[
    `5일 ${d.return5d>=0?'+':''}${d.return5d}%`,
    `20일 ${d.return20d>=0?'+':''}${d.return20d}%`,
    `MA5/10/20 ${round(d.ma5,2)}/${round(d.ma10,2)}/${round(d.ma20,2)}`,
    `20일고점권 ${round(d.breakoutPositionRate,0)}%`,
    `일봉거래량 ${d.volumeRatio}x`,
    `VWAP ${m.vwapGapRate>=0?'+':''}${m.vwapGapRate}%`,
    `당일위치 ${round(m.dayPositionRate,0)}%`,
    `QQQ ${q.changeRate>=0?'+':''}${q.changeRate}%`,
    blocks.length?blocks.slice(0,2).join('/'):null,
    'PAPER 자동주문 연결'
  ].filter(Boolean).join(' · ');

  return {
    strategy:'WAVE',
    exchange:s.exchange,
    symbol:s.symbol,
    name:s.name||s.symbol,
    status,
    score:round(score,0),
    price:round(price,4),
    changeRate:round(change),
    tradeValue:round(tradeValue,0),
    dayPositionRate:m.dayPositionRate,
    vwap:m.vwap,
    vwapGapRate:m.vwapGapRate,
    trendPersistence:m.trendPersistence,

    ma5:d.ma5,ma10:d.ma10,ma20:d.ma20,
    return5d:d.return5d,
    return20d:d.return20d,
    dailyVolumeRatio:d.volumeRatio,
    high20:d.high20,
    breakoutPositionRate:d.breakoutPositionRate,
    ma20ExtensionRate:d.ma20ExtensionRate,

    qqqChangeRate:q.changeRate,
    qqqVwapGapRate:q.vwapGapRate,
    sources:s.sources,
    blocks,
    components,
    reason,
    updatedAt:new Date().toISOString()
  };
}

async function runWaveScan({force=false}={}){
  if(scanRunning)return {...lastScan,ok:false,status:'BUSY',reason:'US-WAVE 스캔이 이미 실행 중입니다.'};

  const session=getSessionState();
  if(!force&&!session.waveWindow){
    lastScan={
      ...lastScan,
      ok:true,
      status:'WAITING',
      reason:session.tradingDay
        ? `US-WAVE 관찰시간 대기 (${WAVE_CONFIG.waveStartEt}~${WAVE_CONFIG.waveEndEt} ET)`
        : '미국시장 휴장일',
      session,
      updatedAt:new Date().toISOString()
    };
    return lastScan;
  }

  scanRunning=true;
  const startedAt=Date.now(),errors=[];

  try{
    const [q,volume,change]=await Promise.all([
      getQqqState(),
      marketClient.getTodayVolumeTop({maxPages:1}),
      marketClient.getChangeRateTopVsOpen({maxPages:1})
    ]);

    const snapshots=mergeRows(volume.rows,change.rows);
    const selected=snapshots.slice(0,WAVE_CONFIG.analyzeCandidateCount);
    const candidates=[];

    for(const s of selected){
      try{
        candidates.push(await analyzeCandidate(s,q,session));
      }catch(err){
        errors.push(`${s.symbol}: ${err.message}`);
      }
    }

    const rank=x=>x==='READY'?3:x==='WATCH'?2:1;
    candidates.sort((a,b)=>rank(b.status)-rank(a.status)||b.score-a.score);

    const stored=activityStore.setCandidates(
      'WAVE',
      candidates.slice(0,WAVE_CONFIG.candidateStoreCount)
    );

    await paperAutoTrader.processReadyCandidates('WAVE', stored);

    lastScan={
      ok:true,
      strategy:'WAVE',
      observerOnly: false,
      orderSubmissionEnabled: true,
      implemented: true,
      status:'OBSERVING',
      reason:'일봉 추세·20일 고점권·거래량 확장 후보를 관찰합니다. READY 후보는 설정 허용 시 PAPER 자동주문으로 연결합니다.',
      session,
      market:q,
      discoveredCount:snapshots.length,
      analyzedCount:selected.length,
      candidateCount:stored.length,
      readyCount:stored.filter(x=>x.status==='READY').length,
      watchCount:stored.filter(x=>x.status==='WATCH').length,
      candidates:stored,
      errors,
      elapsedMs:Date.now()-startedAt,
      updatedAt:new Date().toISOString()
    };

    console.log(
      '[US-WAVE 관찰]',
      `후보 ${lastScan.candidateCount} / READY ${lastScan.readyCount} / WATCH ${lastScan.watchCount}`,
      `QQQ ${q.changeRate>=0?'+':''}${q.changeRate}%`,
      'PAPER AUTO'
    );
    return lastScan;
  }catch(err){
    lastScan={
      ok:false,
      strategy:'WAVE',
      observerOnly: false,
      orderSubmissionEnabled: true,
      implemented: true,
      status:'ERROR',
      reason:err.message,
      session,
      errors:[err.message],
      elapsedMs:Date.now()-startedAt,
      updatedAt:new Date().toISOString()
    };
    console.error('[US-WAVE 관찰 오류]',err.message);
    return lastScan;
  }finally{
    scanRunning=false;
  }
}

function getWaveStatus(){
  return {
    ok:true,
    strategy:'WAVE',
    observerOnly: false,
    orderSubmissionEnabled: true,
    implemented: true,
    scanRunning,
    config:WAVE_CONFIG,
    session:getSessionState(),
    lastScan
  };
}

function startWaveObserver(){
  if(scanTimer)return scanTimer;

  scanTimer=setInterval(
    ()=>runWaveScan().catch(err=>console.error('[US-WAVE 자동관찰 오류]',err.message)),
    WAVE_CONFIG.autoScanIntervalMs
  );
  if(scanTimer.unref)scanTimer.unref();

  const t=setTimeout(
    ()=>runWaveScan().catch(err=>console.error('[US-WAVE 초기관찰 오류]',err.message)),
    30000
  );
  if(t.unref)t.unref();

  console.log(
    '[US-WAVE]',
    `관찰모드 시작 ${WAVE_CONFIG.waveStartEt}~${WAVE_CONFIG.waveEndEt} ET /`,
    '멀티데이 추세전략 / PAPER 자동주문 연결 / implemented=true'
  );
  return scanTimer;
}

module.exports={
  WAVE_CONFIG,
  startWaveObserver,
  runWaveScan,
  getWaveStatus,
  computeMinuteMetrics:minuteMetrics,
  computeDailyMetrics:dailyMetrics,
  getSessionState
};
