'use strict';

const marketClient = require('./us-core-market-client');
const activityStore = require('./us-dashboard-activity-store');
const paperAutoTrader = require('./us-paper-auto-trader');
const { marketTodayKey, isUsTradingDay } = require('./market-calendar');

// FAST v1.2:
// - STRONG_READY: 조건 충족 시 즉시 PAPER 자동주문
// - 일반 READY: 2회 연속 READY 자격 + accelerationRate >= 0 확인 후 주문
// - 음수 가속도는 일반 READY 매수 보류
// - 손절/익절 규칙은 AUTO v1.6 기존값 유지
const FAST_CONFIG = Object.freeze({
  observerOnly: false,
  orderSubmissionEnabled: true,
  implemented: true,
  fastStartEt: '09:35',
  fastEndEt: '10:30',
  autoScanIntervalMs: 2 * 60 * 1000,
  analyzeCandidateCount: 10,
  candidateStoreCount: 15,
  minPrice: 10,
  minOpenChangeRate: 1.5,
  maxOpenChangeRate: 12.0,
  minDayPositionRate: 70,
  maxDayPositionRate: 98,
  minVwapGapRate: 0.20,
  maxVwapGapRate: 4.00,
  minRvol: 1.20,
  minTrendPersistence: 0.60,
  minTradeValue: 10000000,
  readyScore: 72,
  watchScore: 50,
  qqqHardBlockChangeRate: -1.50,
  qqqHardBlockVwapGapRate: -0.60,
  dailyAverageLookback: 10,

  // 일반 READY 진입확인
  readyConfirmScans: 2,
  readyMinAccelerationRate: 0.00,

  // STRONG_READY: 일반 READY 기준은 유지하고, 직전 스캔부터 강도가 유지되는 후보만 제한 허용
  strongReadyEnabled: true,
  strongReadyScore: 70,
  strongMinOpenChangeRate: 2.5,
  strongMaxOpenChangeRate: 10.0,
  strongMinDayPositionRate: 82,
  strongMaxDayPositionRate: 93,
  strongMinVwapGapRate: 0.30,
  strongMaxVwapGapRate: 3.00,
  strongMinRvol: 1.00,
  strongMinTrendPersistence: 0.80,
  strongMinTradeValue: 10000000,
  strongMinAccelerationRate: 0.00,
  strongSurgeRvol: 2.00,
  strongSurgeAccelerationRate: 0.20
});

const INVALID_SYMBOLS = new Set(['PSQL']);
const dailyVolumeCache = new Map();
let scanRunning = false;
let scanTimer = null;
let lastScan = {
  ok: true, strategy: 'FAST', observerOnly: false, implemented: true,
  status: 'WAITING', reason: '아직 US-FAST 후보 스캔을 실행하지 않았습니다.',
  updatedAt: null, market: null, candidates: [], errors: []
};

const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const round = (v, d = 2) => Math.round(num(v) * 10 ** d) / 10 ** d;
const compactDate = v => String(v || '').replace(/-/g, '');

function nyClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
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
  const open = 570, close = 960, cur = clockMinutes(clockEt);
  return {
    date, clockEt, tradingDay,
    regular: tradingDay && cur >= open && cur <= close,
    fastWindow: tradingDay && clockEt >= FAST_CONFIG.fastStartEt && clockEt <= FAST_CONFIG.fastEndEt,
    progress: Math.max(0, Math.min(1, (cur - open) / (close - open)))
  };
}

function minuteMetrics(rows = []) {
  const sorted = rows.filter(r => num(r.close) > 0).sort((a,b) =>
    `${a.businessDate || ''}${String(a.time || '').padStart(6,'0')}`.localeCompare(
      `${b.businessDate || ''}${String(b.time || '').padStart(6,'0')}`));
  const latest = sorted.reduce((m,r) => String(r.businessDate || '') > m ? String(r.businessDate || '') : m, '');
  const bars = sorted.filter(r => String(r.businessDate || '') === latest);
  if (!bars.length) return { businessDate: latest, price:0, open:0, high:0, low:0, volume:0, vwap:0, vwapGapRate:0, dayPositionRate:0, trendPersistence:0, accelerationRate:0 };

  let volume=0, pv=0, high=0, low=Infinity;
  for (const b of bars) {
    const v=Math.max(0,num(b.volume)), c=num(b.close), h=num(b.high), l=num(b.low);
    volume += v; pv += ((h+l+c)/3)*v; high=Math.max(high,h,c); low=Math.min(low,l||Infinity,c||Infinity);
  }
  if (!Number.isFinite(low)) low=0;
  const price=num(bars.at(-1).close), open=num(bars[0].open || bars[0].close);
  const vwap=volume>0 ? pv/volume : price;
  const trend=bars.slice(-6); let good=0, steps=0;
  for(let i=1;i<trend.length;i++){ steps++; if(num(trend[i].close)>=num(trend[i-1].close)) good++; }
  const a=bars.slice(-4); let accelerationRate=0;
  if(a.length===4){
    const early=num(a[0].close)>0 ? (num(a[1].close)-num(a[0].close))/num(a[0].close)*100 : 0;
    const late=num(a[2].close)>0 ? (num(a[3].close)-num(a[2].close))/num(a[2].close)*100 : 0;
    accelerationRate=late-early;
  }
  return {
    businessDate:latest, price, open, high, low, volume,
    vwap:round(vwap,4),
    vwapGapRate:round(vwap>0?(price-vwap)/vwap*100:0),
    dayPositionRate:round(high>low?(price-low)/(high-low)*100:50,1),
    trendPersistence:round(steps?good/steps:0,2),
    accelerationRate:round(accelerationRate)
  };
}

function dateDaysAgo(days) {
  const d=new Date(); d.setUTCDate(d.getUTCDate()-days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

async function avgDailyVolume(exchange,symbol) {
  const k=`${exchange}:${symbol}`, c=dailyVolumeCache.get(k);
  if(c && Date.now()-c.savedAt<21600000) return c;
  const chart=await marketClient.getDailyChart({exchange,symbol,startDate:dateDaysAgo(35),maxPages:1});
  const today=compactDate(marketTodayKey('US'));
  const xs=(chart.rows||[]).filter(r=>String(r.date||'')!==today).map(r=>num(r.volume)).filter(v=>v>0).slice(0,10);
  const value={average:xs.length?xs.reduce((s,v)=>s+v,0)/xs.length:0,savedAt:Date.now()};
  dailyVolumeCache.set(k,value); return value;
}

function scoreMarket(q){let s=0;if(q.changeRate>=.5)s+=8;else if(q.changeRate>=0)s+=6;else if(q.changeRate>=-.5)s+=3;if(q.vwapGapRate>=.2)s+=7;else if(q.vwapGapRate>=0)s+=5;else if(q.vwapGapRate>=-.3)s+=2;return Math.min(15,s);}
function scoreChange(v){if(v<1)return 0;if(v<1.5)return 5;if(v<=4)return 20;if(v<=7)return 18;if(v<=10)return 12;if(v<=12)return 6;return 0;}
function scorePosition(v){if(v<60)return 0;if(v<70)return 6;if(v<=90)return 15;if(v<=96)return 10;if(v<=98)return 5;return 0;}
function scoreVwap(v){if(v<0)return 0;if(v<.2)return 5;if(v<=1.5)return 20;if(v<=2.5)return 15;if(v<=4)return 8;return 0;}
function scoreRvol(v){if(v<.8)return 0;if(v<1)return 5;if(v<1.2)return 8;if(v<1.5)return 12;if(v<2)return 15;return 18;}
function scoreTrend(v){if(v<.4)return 0;if(v<.6)return 4;if(v<.8)return 8;return 12;}
function scoreAccel(v){if(v>=.3)return 8;if(v>=.1)return 5;if(v>=-.1)return 2;return 0;}
function scoreLiquidity(v){if(v>=1e8)return 5;if(v>=5e7)return 4;if(v>=1e7)return 3;if(v>=5e6)return 1;return 0;}

async function getQqqState() {
  const chart=await marketClient.getMinuteChart({exchange:'ND',symbol:'QQQ',startDate:marketTodayKey('US'),minute:5,maxPages:2});
  const m=minuteMetrics(chart.rows);
  const changeRate=m.open>0?(m.price-m.open)/m.open*100:0;
  const q={symbol:'QQQ',price:round(m.price,4),changeRate:round(changeRate),vwap:m.vwap,vwapGapRate:m.vwapGapRate,dayPositionRate:m.dayPositionRate,businessDate:m.businessDate};
  q.hardBlocked=q.changeRate<=FAST_CONFIG.qqqHardBlockChangeRate || q.vwapGapRate<=FAST_CONFIG.qqqHardBlockVwapGapRate;
  q.marketScore=scoreMarket(q); return q;
}

function mergeRows(volumeRows=[],changeRows=[]) {
  const map=new Map();
  const ingest=(row,w)=>{
    const symbol=String(row.symbol||'').toUpperCase().trim();
    const exchange=marketClient.normalizeExchange(row.exchange);
    if(!symbol||!exchange||INVALID_SYMBOLS.has(symbol))return;
    const k=`${exchange}:${symbol}`, p=map.get(k)||{exchange,symbol,name:row.name||symbol,price:0,open:0,high:0,low:0,volume:0,tradeValue:0,openChangeRate:0,sources:[],weight:0};
    p.name=row.name||p.name;p.price=num(row.price)||p.price;p.open=num(row.open)||p.open;p.high=num(row.high)||p.high;p.low=num(row.low)||p.low;
    p.volume=Math.max(p.volume,num(row.volume));p.tradeValue=Math.max(p.tradeValue,num(row.tradeValue));p.openChangeRate=num(row.openChangeRate)||p.openChangeRate;
    p.weight+=w+Math.max(0,25-num(row.rank));if(row.source&&!p.sources.includes(row.source))p.sources.push(row.source);map.set(k,p);
  };
  volumeRows.slice(0,35).forEach(r=>ingest(r,12)); changeRows.slice(0,35).forEach(r=>ingest(r,15));
  return [...map.values()].filter(r=>r.price>=FAST_CONFIG.minPrice).sort((a,b)=>b.sources.length-a.sources.length||b.weight-a.weight||b.tradeValue-a.tradeValue);
}

function previousCandidate(symbol) {
  return (lastScan?.candidates || []).find(
    row => row && String(row.symbol || '').toUpperCase() === String(symbol || '').toUpperCase()
  ) || null;
}

function isFastStrongReady({ symbol, q, score, price, change, pos, gap, rvol, trend, accel, tradeValue }) {
  if (!FAST_CONFIG.strongReadyEnabled || q.hardBlocked) return false;
  if (score < FAST_CONFIG.strongReadyScore) return false;
  if (change < FAST_CONFIG.strongMinOpenChangeRate || change > FAST_CONFIG.strongMaxOpenChangeRate) return false;
  if (pos < FAST_CONFIG.strongMinDayPositionRate || pos > FAST_CONFIG.strongMaxDayPositionRate) return false;
  if (gap < FAST_CONFIG.strongMinVwapGapRate || gap > FAST_CONFIG.strongMaxVwapGapRate) return false;
  if (rvol < FAST_CONFIG.strongMinRvol) return false;
  if (tradeValue < FAST_CONFIG.strongMinTradeValue) return false;
  if (accel < FAST_CONFIG.strongMinAccelerationRate) return false;

  const momentumOk =
    trend >= FAST_CONFIG.strongMinTrendPersistence ||
    (rvol >= FAST_CONFIG.strongSurgeRvol && accel >= FAST_CONFIG.strongSurgeAccelerationRate);
  const momentumOk =
    trend >= FAST_CONFIG.strongMinTrendPersistence ||
    (rvol >= FAST_CONFIG.strongSurgeRvol && accel >= FAST_CONFIG.strongSurgeAccelerationRate);

  if (!momentumOk) return false;

  const prev = previousCandidate(symbol);
  if (!prev) return false;
  if (num(prev.price) <= 0 || num(prev.score) <= 0) return false;
  if (price < num(prev.price) * 0.998) return false;
  if (score < num(prev.score)) return false;
  return true;
}

async function analyzeCandidate(s,q,session) {
  const chart=await marketClient.getMinuteChart({exchange:s.exchange,symbol:s.symbol,startDate:session.date,minute:5,maxPages:2});
  const m=minuteMetrics(chart.rows), d=await avgDailyVolume(s.exchange,s.symbol);
  const price=num(s.price)||m.price, open=num(s.open)||m.open, high=Math.max(num(s.high),m.high);
  const low=num(s.low)>0&&m.low>0?Math.min(num(s.low),m.low):num(s.low)||m.low;
  const change=num(s.openChangeRate)||(open>0?(price-open)/open*100:0);
  const pos=high>low?(price-low)/(high-low)*100:m.dayPositionRate;
  const volume=Math.max(num(s.volume),m.volume), tradeValue=Math.max(num(s.tradeValue),price*volume);
  const expected=d.average>0?d.average*Math.min(1,Math.max(.01,session.progress)**.65):0;
  const rvol=expected>0?volume/expected:0, gap=m.vwap>0?(price-m.vwap)/m.vwap*100:0;

  const components={market:scoreMarket(q),change:scoreChange(change),dayPosition:scorePosition(pos),vwap:scoreVwap(gap),rvol:scoreRvol(rvol),trend:scoreTrend(m.trendPersistence),acceleration:scoreAccel(m.accelerationRate),liquidity:scoreLiquidity(tradeValue)};
  const score=Object.values(components).reduce((a,b)=>a+b,0), blocks=[];
  if(q.hardBlocked)blocks.push('QQQ 약세');
  if(change<FAST_CONFIG.minOpenChangeRate)blocks.push('상승 탄력 부족');
  if(change>FAST_CONFIG.maxOpenChangeRate)blocks.push('상승 과열');
  if(pos<FAST_CONFIG.minDayPositionRate)blocks.push('당일 위치 낮음');
  if(pos>FAST_CONFIG.maxDayPositionRate)blocks.push('고점 추격');
  if(gap<FAST_CONFIG.minVwapGapRate)blocks.push('VWAP 탄력 부족');
  if(gap>FAST_CONFIG.maxVwapGapRate)blocks.push('VWAP 과이격');
  if(rvol>0&&rvol<FAST_CONFIG.minRvol)blocks.push('RVOL 부족');
  if(m.trendPersistence<FAST_CONFIG.minTrendPersistence)blocks.push('단기 추세 약함');
  if(tradeValue<FAST_CONFIG.minTradeValue)blocks.push('거래대금 부족');
  if(change>=7&&pos>=94&&gap>=2)blocks.push('과열 추격');
  if(m.businessDate!==compactDate(session.date))blocks.push('당일 분봉 없음');

  const strongReady = isFastStrongReady({
    q, score, change, pos, gap, rvol,
    trend:m.trendPersistence, accel:m.accelerationRate, tradeValue
  });

  const baseReady = !blocks.length && score >= FAST_CONFIG.readyScore;
  const accelerationOk = m.accelerationRate >= FAST_CONFIG.readyMinAccelerationRate;
  const readyQualified = baseReady && accelerationOk;
  const prev = previousCandidate(s.symbol);
  const prevReadyStreak = prev && prev.readyQualified ? Math.max(1, num(prev.readyStreak)) : 0;
  const readyStreak = readyQualified ? prevReadyStreak + 1 : 0;
  const readyConfirmed = readyQualified && readyStreak >= FAST_CONFIG.readyConfirmScans;

  let status='OBSERVE';
  const strongReady = isFastStrongReady({
    symbol:s.symbol, q, score, price, change, pos, gap, rvol,
    trend:m.trendPersistence, accel:m.accelerationRate, tradeValue
  });

  const entryNotes=[];
  if (strongReady) {
    status='STRONG_READY';
    entryNotes.push('STRONG_READY 즉시진입');
  } else if (!blocks.length && score >= FAST_CONFIG.readyScore) {
    status='READY';
    entryNotes.push(`READY ${Math.min(readyStreak, FAST_CONFIG.readyConfirmScans)}/${FAST_CONFIG.readyConfirmScans}`);
  } else if (readyConfirmed) {
    status='READY';
    entryNotes.push(`READY ${readyStreak}/${FAST_CONFIG.readyConfirmScans} 확인`);
  } else if (baseReady && !accelerationOk) {
    status='WATCH';
    entryNotes.push(`READY 가속 음수 보류 ${m.accelerationRate>=0?'+':''}${round(m.accelerationRate)}%`);
  } else if (readyQualified) {
    status='WATCH';
    entryNotes.push(`READY 재확인 ${Math.min(readyStreak, FAST_CONFIG.readyConfirmScans)}/${FAST_CONFIG.readyConfirmScans}`);
  } else if(score>=FAST_CONFIG.watchScore) {
    status='WATCH';
  }

  const reasonParts = [];
  if(status==='STRONG_READY') reasonParts.push('STRONG_READY');
  reasonParts.push(
    `상승 ${change>=0?'+':''}${round(change)}%`,
    `VWAP ${gap>=0?'+':''}${round(gap)}%`,
    `RVOL ${round(rvol)}x`,
    `위치 ${round(pos,0)}%`,
    `추세 ${round(m.trendPersistence*100,0)}%`,
    `가속 ${m.accelerationRate>=0?'+':''}${round(m.accelerationRate)}%`,
    `QQQ ${q.changeRate>=0?'+':''}${q.changeRate}%`
  );
  if(entryNotes.length) reasonParts.push(entryNotes.join('/'));
  if(blocks.length) reasonParts.push(blocks.slice(0, 2).join('/'));
  reasonParts.push('PAPER 자동주문 연결');

  return {
    strategy:'FAST',
    exchange:s.exchange,
    symbol:s.symbol,
    name:s.name||s.symbol,
    status,
    score:round(score,0),
    price:round(price,4),
    changeRate:round(change),
    dayPositionRate:round(pos,1),
    vwap:m.vwap,
    vwapGapRate:round(gap),
    rvol:round(rvol),
    tradeValue:round(tradeValue,0),
    trendPersistence:m.trendPersistence,
    accelerationRate:m.accelerationRate,
    qqqChangeRate:q.changeRate,
    qqqVwapGapRate:q.vwapGapRate,
    sources:s.sources,
    blocks,
    components,
    readyQualified,
    readyStreak,
    readyConfirmed,
    entryNotes,
    reason:reasonParts.join(' · '),
    updatedAt:new Date().toISOString()
  };
}

async function runFastScan({force=false}={}) {
  if(scanRunning)return {...lastScan,ok:false,status:'BUSY',reason:'US-FAST 스캔이 이미 실행 중입니다.'};
  const session=getSessionState();
  if(!force&&!session.fastWindow){
    lastScan={...lastScan,ok:true,status:'WAITING',reason:session.tradingDay?`US-FAST 관찰시간 대기 (${FAST_CONFIG.fastStartEt}~${FAST_CONFIG.fastEndEt} ET)`:'미국시장 휴장일',session,updatedAt:new Date().toISOString()};
    return lastScan;
  }
  scanRunning=true; const startedAt=Date.now(), errors=[];
  try{
    const [q,volume,change]=await Promise.all([
      getQqqState(),
      marketClient.getTodayVolumeTop({maxPages:1}),
      marketClient.getChangeRateTopVsOpen({maxPages:1})
    ]);
    const snapshots=mergeRows(volume.rows,change.rows), selected=snapshots.slice(0,FAST_CONFIG.analyzeCandidateCount), candidates=[];
    for(const s of selected){
      try{candidates.push(await analyzeCandidate(s,q,session));}
      catch(e){errors.push(`${s.symbol}: ${e.message}`);}
    }

    const rankStatus=x=>x==='STRONG_READY'?4:x==='READY'?3:x==='WATCH'?2:1;
    candidates.sort((a,b)=>rankStatus(b.status)-rankStatus(a.status)||b.score-a.score);
    const stored=activityStore.setCandidates('FAST',candidates.slice(0,FAST_CONFIG.candidateStoreCount));

    // AUTO v1.6은 READY/STRONG_READY만 주문하므로
    // 첫 READY(WATCH 표시)와 음수 가속 READY(WATCH 표시)는 자동으로 주문 제외된다.
    await paperAutoTrader.processReadyCandidates('FAST', stored);
    lastScan={
      ok:true,
      strategy:'FAST',
      observerOnly:false,
      orderSubmissionEnabled:true,
      implemented:true,
      status:'OBSERVING',
      reason:'STRONG_READY는 즉시진입, 일반 READY는 2회 연속 확인 + 가속도 0 이상에서 PAPER 자동주문으로 연결합니다.',
      session,
      market:q,
      discoveredCount:snapshots.length,
      analyzedCount:selected.length,
      candidateCount:stored.length,
      readyCount:stored.filter(x=>x.status==='READY').length,
      strongReadyCount:stored.filter(x=>x.status==='STRONG_READY').length,
      readyConfirmWaitingCount:stored.filter(x=>x.status==='WATCH'&&x.readyQualified&&!x.readyConfirmed).length,
      negativeAccelerationHoldCount:stored.filter(x=>x.status==='WATCH'&&x.entryNotes?.some(v=>String(v).includes('가속 음수'))).length,
      watchCount:stored.filter(x=>x.status==='WATCH').length,
      candidates:stored,
      errors,
      elapsedMs:Date.now()-startedAt,
      updatedAt:new Date().toISOString()
    };

    console.log(
      '[US-FAST 관찰]',
      `후보 ${lastScan.candidateCount} / READY ${lastScan.readyCount} / STRONG ${lastScan.strongReadyCount || 0} / 재확인대기 ${lastScan.readyConfirmWaitingCount || 0} / 가속보류 ${lastScan.negativeAccelerationHoldCount || 0} / WATCH ${lastScan.watchCount}`,
      `QQQ ${q.changeRate>=0?'+':''}${q.changeRate}%`,
      'PAPER AUTO'
    );
    return lastScan;
  }catch(e){
    lastScan={ok:false,strategy:'FAST',observerOnly:false,orderSubmissionEnabled:true,implemented:true,status:'ERROR',reason:e.message,session,errors:[e.message],elapsedMs:Date.now()-startedAt,updatedAt:new Date().toISOString()};
    console.error('[US-FAST 관찰 오류]',e.message);
    return lastScan;
  }finally{
    scanRunning=false;
  }
}

function getFastStatus(){
  return {
    ok:true,
    strategy:'FAST',
    observerOnly:false,
    orderSubmissionEnabled:true,
    implemented:true,
    version:'1.2-entry-confirm',
    scanRunning,
    config:FAST_CONFIG,
    session:getSessionState(),
    lastScan
  };
}

function startFastObserver(){
  if(scanTimer)return scanTimer;
  scanTimer=setInterval(
    ()=>runFastScan().catch(e=>console.error('[US-FAST 자동관찰 오류]',e.message)),
    FAST_CONFIG.autoScanIntervalMs
  );
  if(scanTimer.unref)scanTimer.unref();
  const t=setTimeout(
    ()=>runFastScan().catch(e=>console.error('[US-FAST 초기관찰 오류]',e.message)),
    20000
  );
  if(t.unref)t.unref();

  console.log(
    '[US-FAST v1.2]',
    `관찰모드 시작 ${FAST_CONFIG.fastStartEt}~${FAST_CONFIG.fastEndEt} ET /`,
    `STRONG 즉시 / READY ${FAST_CONFIG.readyConfirmScans}회 확인 / 가속 ${FAST_CONFIG.readyMinAccelerationRate}% 이상 /`,
    'PAPER 자동주문 연결 / implemented=true'
  );
  return scanTimer;
}

module.exports={
  FAST_CONFIG,
  startFastObserver,
  runFastScan,
  getFastStatus,
  computeMinuteMetrics:minuteMetrics,
  getSessionState
};
