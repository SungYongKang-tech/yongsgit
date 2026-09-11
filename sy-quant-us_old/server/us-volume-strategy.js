'use strict';

const marketClient = require('./us-core-market-client');
const activityStore = require('./us-dashboard-activity-store');
const paperAutoTrader = require('./us-paper-auto-trader');
const { marketTodayKey, isUsTradingDay } = require('./market-calendar');

// VOLUME v1.2: 일반 READY 유지 + 거래량 지속형 STRONG_READY 추가 / 청산은 AUTO v1.6
const VOLUME_CONFIG = Object.freeze({
  observerOnly: false,
  orderSubmissionEnabled: true,
  implemented: true,
  volumeStartEt: '10:00',
  volumeEndEt: '14:30',
  autoScanIntervalMs: 3 * 60 * 1000,
  analyzeCandidateCount: 12,
  candidateStoreCount: 18,
  minPrice: 8,
  minOpenChangeRate: 0.5,
  maxOpenChangeRate: 10.0,
  minDayPositionRate: 55,
  maxDayPositionRate: 97,
  minVwapGapRate: -0.10,
  maxVwapGapRate: 3.50,
  minRvol: 1.50,
  minRecentVolumeRatio: 1.00,
  minTrendPersistence: 0.50,
  minTradeValue: 12000000,
  readyScore: 72,
  watchScore: 48,
  qqqHardBlockChangeRate: -1.50,
  qqqHardBlockVwapGapRate: -0.60,
  dailyAverageLookback: 10,

  // STRONG_READY: RVOL만 소폭 완화하고 최근거래량·가격·추세를 더 강하게 요구
  strongReadyEnabled: true,
  strongReadyScore: 68,
  strongMinOpenChangeRate: 2.0,
  strongMaxOpenChangeRate: 8.5,
  strongMinDayPositionRate: 75,
  strongMaxDayPositionRate: 93,
  strongMinVwapGapRate: 0.20,
  strongMaxVwapGapRate: 3.00,
  strongMinRvol: 1.30,
  strongMinRecentVolumeRatio: 1.50,
  strongMinRecentPriceChangeRate: 0.10,
  strongMinTrendPersistence: 0.67,
  strongMinTradeValue: 12000000
});

const INVALID_SYMBOLS = new Set(['PSQL']);
const dailyVolumeCache = new Map();
let scanRunning = false;
let scanTimer = null;
let lastScan = { ok:true, strategy:'VOLUME', observerOnly: false, implemented: true, status:'WAITING', reason:'아직 US-VOLUME 후보 스캔을 실행하지 않았습니다.', updatedAt:null, market:null, candidates:[], errors:[] };

const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const round = (v,d=2) => Math.round(num(v) * 10 ** d) / 10 ** d;
const compactDate = v => String(v || '').replace(/-/g,'');

function nyClock(now=new Date()) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const x = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${x.hour}:${x.minute}`;
}
function clockMinutes(v){ const [h,m]=String(v||'00:00').split(':').map(Number); return num(h)*60+num(m); }
function getSessionState(now=new Date()){
  const date=marketTodayKey('US',now), clockEt=nyClock(now), tradingDay=isUsTradingDay(date), cur=clockMinutes(clockEt), open=570, close=960;
  return {date,clockEt,tradingDay,regular:tradingDay&&cur>=open&&cur<=close,volumeWindow:tradingDay&&clockEt>=VOLUME_CONFIG.volumeStartEt&&clockEt<=VOLUME_CONFIG.volumeEndEt,progress:Math.max(0,Math.min(1,(cur-open)/(close-open)))};
}
function dateDaysAgo(days){const d=new Date();d.setUTCDate(d.getUTCDate()-days);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;}
function expectedVolumeCurve(progress){const p=Math.max(.01,Math.min(1,num(progress)));return Math.min(1,p**.65);}

function computeMinuteMetrics(rows=[]){
  const sorted=(rows||[]).filter(r=>num(r.close)>0).sort((a,b)=>`${a.businessDate||''}${String(a.time||'').padStart(6,'0')}`.localeCompare(`${b.businessDate||''}${String(b.time||'').padStart(6,'0')}`));
  const latest=sorted.reduce((m,r)=>String(r.businessDate||'')>m?String(r.businessDate||''):m,'');
  const bars=sorted.filter(r=>String(r.businessDate||'')===latest);
  if(!bars.length)return {businessDate:latest,price:0,open:0,high:0,low:0,volume:0,vwap:0,vwapGapRate:0,dayPositionRate:0,trendPersistence:0,recentVolumeRatio:0,recentPriceChangeRate:0};
  let volume=0,pv=0,high=0,low=Infinity;
  for(const b of bars){const v=Math.max(0,num(b.volume)),c=num(b.close),h=num(b.high),l=num(b.low);volume+=v;pv+=((h+l+c)/3)*v;high=Math.max(high,h,c);low=Math.min(low,l||Infinity,c||Infinity);}
  if(!Number.isFinite(low))low=0;
  const price=num(bars.at(-1).close),open=num(bars[0].open||bars[0].close),vwap=volume>0?pv/volume:price;
  const trend=bars.slice(-6);let good=0,steps=0;for(let i=1;i<trend.length;i++){steps++;if(num(trend[i].close)>=num(trend[i-1].close))good++;}
  const recent=bars.slice(-6),prev=bars.slice(-12,-6),rv=recent.reduce((s,b)=>s+Math.max(0,num(b.volume)),0),pv6=prev.reduce((s,b)=>s+Math.max(0,num(b.volume)),0);
  const firstRecent=recent.length?num(recent[0].close):price;
  return {businessDate:latest,price,open,high,low,volume,vwap:round(vwap,4),vwapGapRate:round(vwap>0?(price-vwap)/vwap*100:0),dayPositionRate:round(high>low?(price-low)/(high-low)*100:50,1),trendPersistence:round(steps?good/steps:0,2),recentVolumeRatio:round(pv6>0?rv/pv6:0,2),recentPriceChangeRate:round(firstRecent>0?(price-firstRecent)/firstRecent*100:0)};
}

async function avgDailyVolume(exchange,symbol){
  const k=`${exchange}:${symbol}`,c=dailyVolumeCache.get(k);if(c&&Date.now()-c.savedAt<21600000)return c;
  const chart=await marketClient.getDailyChart({exchange,symbol,startDate:dateDaysAgo(35),maxPages:1}),today=compactDate(marketTodayKey('US'));
  const xs=(chart.rows||[]).filter(r=>String(r.date||'')!==today).map(r=>num(r.volume)).filter(v=>v>0).slice(0,VOLUME_CONFIG.dailyAverageLookback);
  const value={average:xs.length?xs.reduce((s,v)=>s+v,0)/xs.length:0,sampleCount:xs.length,savedAt:Date.now()};dailyVolumeCache.set(k,value);return value;
}

function scoreMarket(q){let s=0;if(q.changeRate>=.5)s+=8;else if(q.changeRate>=0)s+=6;else if(q.changeRate>=-.5)s+=3;if(q.vwapGapRate>=.2)s+=7;else if(q.vwapGapRate>=0)s+=5;else if(q.vwapGapRate>=-.3)s+=2;return Math.min(15,s);}
function scoreChange(v){if(v<0)return 0;if(v<.5)return 5;if(v<=2)return 12;if(v<=5)return 16;if(v<=8)return 12;if(v<=10)return 6;return 0;}
function scorePosition(v){if(v<40)return 0;if(v<55)return 6;if(v<=85)return 15;if(v<=93)return 12;if(v<=97)return 6;return 0;}
function scoreVwap(v){if(v<-.5)return 0;if(v<0)return 6;if(v<=1.2)return 18;if(v<=2)return 14;if(v<=3.5)return 7;return 0;}
function scoreRvol(v){if(v<1)return 0;if(v<1.5)return 6;if(v<2)return 14;if(v<2.5)return 18;if(v<4)return 22;return 18;}
function scoreRecentVolume(v){if(v<.8)return 0;if(v<1)return 4;if(v<1.3)return 8;if(v<1.8)return 12;return 15;}
function scoreTrend(v){if(v<.4)return 0;if(v<.5)return 4;if(v<.67)return 8;return 12;}
function scoreLiquidity(v){if(v>=1e8)return 5;if(v>=5e7)return 4;if(v>=1.2e7)return 3;if(v>=5e6)return 1;return 0;}

async function getQqqState(){
  const chart=await marketClient.getMinuteChart({exchange:'ND',symbol:'QQQ',startDate:marketTodayKey('US'),minute:5,maxPages:2}),m=computeMinuteMetrics(chart.rows);
  const changeRate=m.open>0?(m.price-m.open)/m.open*100:0,q={symbol:'QQQ',price:round(m.price,4),changeRate:round(changeRate),vwap:m.vwap,vwapGapRate:m.vwapGapRate,dayPositionRate:m.dayPositionRate,businessDate:m.businessDate};
  q.hardBlocked=q.changeRate<=VOLUME_CONFIG.qqqHardBlockChangeRate||q.vwapGapRate<=VOLUME_CONFIG.qqqHardBlockVwapGapRate;q.marketScore=scoreMarket(q);return q;
}

function mergeRows(volumeRows=[],changeRows=[]){
  const map=new Map();
  const ingest=(row,w)=>{const symbol=String(row.symbol||'').toUpperCase().trim(),exchange=marketClient.normalizeExchange(row.exchange);if(!symbol||!exchange||INVALID_SYMBOLS.has(symbol))return;const k=`${exchange}:${symbol}`,p=map.get(k)||{exchange,symbol,name:row.name||symbol,price:0,open:0,high:0,low:0,volume:0,tradeValue:0,openChangeRate:0,sources:[],weight:0};p.name=row.name||p.name;p.price=num(row.price)||p.price;p.open=num(row.open)||p.open;p.high=num(row.high)||p.high;p.low=num(row.low)||p.low;p.volume=Math.max(p.volume,num(row.volume));p.tradeValue=Math.max(p.tradeValue,num(row.tradeValue));p.openChangeRate=num(row.openChangeRate)||p.openChangeRate;p.weight+=w+Math.max(0,30-num(row.rank));if(row.source&&!p.sources.includes(row.source))p.sources.push(row.source);map.set(k,p);};
  volumeRows.slice(0,45).forEach(r=>ingest(r,18));changeRows.slice(0,25).forEach(r=>ingest(r,8));
  return [...map.values()].filter(r=>r.price>=VOLUME_CONFIG.minPrice).sort((a,b)=>Number(b.sources.includes('VOLUME_TOP'))-Number(a.sources.includes('VOLUME_TOP'))||b.weight-a.weight||b.tradeValue-a.tradeValue);
}


function previousCandidate(symbol) {
  return (lastScan?.candidates || []).find(
    row => row && String(row.symbol || '').toUpperCase() === String(symbol || '').toUpperCase()
  ) || null;
}

function isVolumeStrongReady({ symbol, q, score, price, change, pos, gap, rvol, recentVolumeRatio, recentPriceChangeRate, trend, tradeValue }) {
  if (!VOLUME_CONFIG.strongReadyEnabled || q.hardBlocked) return false;
  if (score < VOLUME_CONFIG.strongReadyScore) return false;
  if (change < VOLUME_CONFIG.strongMinOpenChangeRate || change > VOLUME_CONFIG.strongMaxOpenChangeRate) return false;
  if (pos < VOLUME_CONFIG.strongMinDayPositionRate || pos > VOLUME_CONFIG.strongMaxDayPositionRate) return false;
  if (gap < VOLUME_CONFIG.strongMinVwapGapRate || gap > VOLUME_CONFIG.strongMaxVwapGapRate) return false;
  if (rvol < VOLUME_CONFIG.strongMinRvol) return false;
  if (recentVolumeRatio < VOLUME_CONFIG.strongMinRecentVolumeRatio) return false;
  if (recentPriceChangeRate < VOLUME_CONFIG.strongMinRecentPriceChangeRate) return false;
  if (trend < VOLUME_CONFIG.strongMinTrendPersistence) return false;
  if (tradeValue < VOLUME_CONFIG.strongMinTradeValue) return false;

  const prev = previousCandidate(symbol);
  if (!prev) return false;
  if (num(prev.price) <= 0 || num(prev.score) <= 0) return false;
  if (price < num(prev.price) * 0.998) return false;
  if (score < num(prev.score)) return false;
  if (num(prev.recentVolumeRatio) > 0 && recentVolumeRatio < num(prev.recentVolumeRatio) * 0.90) return false;
  return true;
}

async function analyzeCandidate(s,q,session){
  const chart=await marketClient.getMinuteChart({exchange:s.exchange,symbol:s.symbol,startDate:session.date,minute:5,maxPages:2}),m=computeMinuteMetrics(chart.rows),d=await avgDailyVolume(s.exchange,s.symbol);
  const price=num(s.price)||m.price,open=num(s.open)||m.open,high=Math.max(num(s.high),m.high),low=num(s.low)>0&&m.low>0?Math.min(num(s.low),m.low):num(s.low)||m.low;
  const change=num(s.openChangeRate)||(open>0?(price-open)/open*100:0),pos=high>low?(price-low)/(high-low)*100:m.dayPositionRate,volume=Math.max(num(s.volume),m.volume),tradeValue=Math.max(num(s.tradeValue),price*volume),expected=d.average>0?d.average*expectedVolumeCurve(session.progress):0,rvol=expected>0?volume/expected:0,gap=m.vwap>0?(price-m.vwap)/m.vwap*100:0;
  const components={market:scoreMarket(q),change:scoreChange(change),dayPosition:scorePosition(pos),vwap:scoreVwap(gap),rvol:scoreRvol(rvol),recentVolume:scoreRecentVolume(m.recentVolumeRatio),trend:scoreTrend(m.trendPersistence),liquidity:scoreLiquidity(tradeValue)};
  const score=Object.values(components).reduce((a,b)=>a+b,0),blocks=[];
  if(q.hardBlocked)blocks.push('QQQ 약세');if(change<VOLUME_CONFIG.minOpenChangeRate)blocks.push('시가대비 상승 부족');if(change>VOLUME_CONFIG.maxOpenChangeRate)blocks.push('상승 과열');if(pos<VOLUME_CONFIG.minDayPositionRate)blocks.push('당일 위치 낮음');if(pos>VOLUME_CONFIG.maxDayPositionRate)blocks.push('고점 추격');if(gap<VOLUME_CONFIG.minVwapGapRate)blocks.push('VWAP 아래');if(gap>VOLUME_CONFIG.maxVwapGapRate)blocks.push('VWAP 과이격');if(rvol>0&&rvol<VOLUME_CONFIG.minRvol)blocks.push('RVOL 부족');if(m.recentVolumeRatio>0&&m.recentVolumeRatio<VOLUME_CONFIG.minRecentVolumeRatio)blocks.push('최근 거래량 둔화');if(m.trendPersistence<VOLUME_CONFIG.minTrendPersistence)blocks.push('단기 추세 약함');if(tradeValue<VOLUME_CONFIG.minTradeValue)blocks.push('거래대금 부족');if(change>=7&&pos>=94&&gap>=2)blocks.push('과열 추격');if(m.businessDate!==compactDate(session.date))blocks.push('당일 분봉 없음');
  let status='OBSERVE';
  const strongReady = isVolumeStrongReady({
    symbol:s.symbol, q, score, price, change, pos, gap, rvol,
    recentVolumeRatio:m.recentVolumeRatio,
    recentPriceChangeRate:m.recentPriceChangeRate,
    trend:m.trendPersistence, tradeValue
  });
  if(!blocks.length&&score>=VOLUME_CONFIG.readyScore)status='READY';
  else if(strongReady)status='STRONG_READY';
  else if(score>=VOLUME_CONFIG.watchScore)status='WATCH';
  return {strategy:'VOLUME',exchange:s.exchange,symbol:s.symbol,name:s.name||s.symbol,status,score:round(score,0),price:round(price,4),changeRate:round(change),dayPositionRate:round(pos,1),vwap:m.vwap,vwapGapRate:round(gap),rvol:round(rvol),recentVolumeRatio:m.recentVolumeRatio,recentPriceChangeRate:m.recentPriceChangeRate,tradeValue:round(tradeValue,0),trendPersistence:m.trendPersistence,qqqChangeRate:q.changeRate,qqqVwapGapRate:q.vwapGapRate,sources:s.sources,blocks,components,reason:[status==='STRONG_READY'?'STRONG_READY':null,`상승 ${change>=0?'+':''}${round(change)}%`,`RVOL ${round(rvol)}x`,`최근거래량 ${round(m.recentVolumeRatio)}x`,`VWAP ${gap>=0?'+':''}${round(gap)}%`,`위치 ${round(pos,0)}%`,`추세 ${round(m.trendPersistence*100,0)}%`,`QQQ ${q.changeRate>=0?'+':''}${q.changeRate}%`,blocks.length?blocks.slice(0,2).join('/'):null,'PAPER 자동주문 연결'].filter(Boolean).join(' · '),updatedAt:new Date().toISOString()};
}

async function runVolumeScan({force=false}={}){
  if(scanRunning)return {...lastScan,ok:false,status:'BUSY',reason:'US-VOLUME 스캔이 이미 실행 중입니다.'};
  const session=getSessionState();if(!force&&!session.volumeWindow){lastScan={...lastScan,ok:true,status:'WAITING',reason:session.tradingDay?`US-VOLUME 관찰시간 대기 (${VOLUME_CONFIG.volumeStartEt}~${VOLUME_CONFIG.volumeEndEt} ET)`:'미국시장 휴장일',session,updatedAt:new Date().toISOString()};return lastScan;}
  scanRunning=true;const startedAt=Date.now(),errors=[];
  try{const [q,volume,change]=await Promise.all([getQqqState(),marketClient.getTodayVolumeTop({maxPages:1}),marketClient.getChangeRateTopVsOpen({maxPages:1})]);const snapshots=mergeRows(volume.rows,change.rows),selected=snapshots.slice(0,VOLUME_CONFIG.analyzeCandidateCount),candidates=[];for(const s of selected){try{candidates.push(await analyzeCandidate(s,q,session));}catch(e){errors.push(`${s.symbol}: ${e.message}`);}}const rank=x=>x==='READY'?4:x==='STRONG_READY'?3:x==='WATCH'?2:1;candidates.sort((a,b)=>rank(b.status)-rank(a.status)||b.score-a.score);const stored=activityStore.setCandidates('VOLUME',candidates.slice(0,VOLUME_CONFIG.candidateStoreCount));

    await paperAutoTrader.processReadyCandidates('VOLUME', stored);lastScan={ok:true,strategy:'VOLUME',observerOnly: false,orderSubmissionEnabled: true,implemented: true,status:'OBSERVING',reason:'거래량 급증·VWAP·추세 후보만 관찰합니다. READY 후보는 설정 허용 시 PAPER 자동주문으로 연결합니다.',session,market:q,discoveredCount:snapshots.length,analyzedCount:selected.length,candidateCount:stored.length,readyCount:stored.filter(x=>x.status==='READY').length,strongReadyCount:stored.filter(x=>x.status==='STRONG_READY').length,watchCount:stored.filter(x=>x.status==='WATCH').length,candidates:stored,errors,elapsedMs:Date.now()-startedAt,updatedAt:new Date().toISOString()};console.log('[US-VOLUME 관찰]',`후보 ${lastScan.candidateCount} / READY ${lastScan.readyCount} / STRONG ${lastScan.strongReadyCount || 0} / WATCH ${lastScan.watchCount}`,`QQQ ${q.changeRate>=0?'+':''}${q.changeRate}%`,'PAPER AUTO');return lastScan;}catch(e){lastScan={ok:false,strategy:'VOLUME',observerOnly: false,orderSubmissionEnabled: true,implemented: true,status:'ERROR',reason:e.message,session,errors:[e.message],elapsedMs:Date.now()-startedAt,updatedAt:new Date().toISOString()};console.error('[US-VOLUME 관찰 오류]',e.message);return lastScan;}finally{scanRunning=false;}
}
function getVolumeStatus(){return {ok:true,strategy:'VOLUME',observerOnly: false,orderSubmissionEnabled: true,implemented: true,scanRunning,config:VOLUME_CONFIG,session:getSessionState(),lastScan};}
function startVolumeObserver(){if(scanTimer)return scanTimer;scanTimer=setInterval(()=>runVolumeScan().catch(e=>console.error('[US-VOLUME 자동관찰 오류]',e.message)),VOLUME_CONFIG.autoScanIntervalMs);if(scanTimer.unref)scanTimer.unref();const t=setTimeout(()=>runVolumeScan().catch(e=>console.error('[US-VOLUME 초기관찰 오류]',e.message)),25000);if(t.unref)t.unref();console.log('[US-VOLUME v1.2]',`관찰모드 시작 ${VOLUME_CONFIG.volumeStartEt}~${VOLUME_CONFIG.volumeEndEt} ET /`,'거래량 급증전략 / PAPER 자동주문 연결 / implemented=true');return scanTimer;}
module.exports={VOLUME_CONFIG,startVolumeObserver,runVolumeScan,getVolumeStatus,computeMinuteMetrics,getSessionState};
