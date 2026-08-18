SY Quant WAVE 1.1 - 2026-08-18 (09:00 시작형)

[목적]
WAVE는 당일 급등을 추격하지 않고, 재료·수급·섹터가 좋은 종목이 1차 상승 후 눌림을 만든 뒤 다시 상승하는 2차 파동을 모의매수하는 전략입니다.

[이번 ZIP의 수정/신규 파일]
1. server.js            : 수정
2. wave-strategy.js     : 신규
3. code-change-log.json : 변경기록

hot-scanner.js, auto-trader-core.js, open-market-data.js는 이번 WAVE 추가에서 수정하지 않았습니다.

[WAVE 점수]
WHY       30점 : 종목 직접 뉴스의 수주/계약/실적개선 등 재료
MONEY     20점 : 외국인/기관 최근 순매수 + 거래대금 + HOT 지속성
SECTOR    15점 : open-market 섹터 편향/뉴스 + HOT 섹터 동반강세
TREND     10점 : 5일/20일 추세, 고점·저점 구조
PULLBACK  15점 : 고점 대비 -2~-7% 중심 눌림 + 거래량 감소 + 20일선 지지
REBOUND   10점 : 재상승률, 전일고가 돌파, 당일위치, 거래량 회복

[초기 모의매수 기준]
- 최소 관찰: 1거래일
- WHY 최소: 12점
- WHY+MONEY+SECTOR: 35점 이상
- 총 WAVE SCORE: 65점 이상
- PULLBACK: 7점 이상
- REBOUND: 6점 이상
- 당일 상승률: +7% 이하에서만 신규진입
- 매수시간: 09:00~14:50
- 종목당 투자: WAVE 최초자산의 10%
- 최대 보유: 5종목
- 하루 신규매수: 최대 2종목

[초기 모의매도 기준]
- 손절: -5%
- 구조손절: 매수 전 눌림저점에서 추가 -1.5% 이탈 + 손실상태
- 최고수익 +5% 이후 현재수익 +0.5% 이하: 수익보호 매도
- 최고수익 +8% 이후 고점대비 -4%: 트레일링 매도
- 최고수익 +15% 이후 고점대비 -3%: 강한 트레일링 매도
- 10거래일 이후 수익 <2% 또는 추세점수 <4: 시간/추세 매도
- 15거래일: 강제 종료

[상태파일]
- paper-state-wave.json
- 파일이 없으면 WAVE 시작 시 1억원 독립 가상계좌로 자동 생성됩니다.
- CORE/VOLUME/OPEN paper-state-core.json과 자금을 분리했습니다. 따라서 전략 성과를 독립 비교할 수 있습니다.

[후보 흐름]
HOT 또는 MARKET_PRIORITY
  -> DISCOVERED
  -> WATCH
  -> READY
  -> HOLD
  -> PROTECT
  -> SOLD

같은 날 HOT 급등종목을 바로 사지 않습니다. 최소 1거래일 관찰 후 눌림과 재상승을 확인해야 신규매수가 가능합니다.

[서버 API]
GET  /api/wave-investor-flow?code=005930&days=5
GET  /api/wave-state
GET  /api/wave-summary
POST /api/wave-run-once

[배포]
- 기존 server.js를 이번 server.js로 교체
- wave-strategy.js를 server.js와 같은 폴더에 추가
- 기존 open-market-data.js, hot-scanner.js, auto-trader-core.js는 그대로 유지
- 서버 재시작

[오늘 저녁 배포 시]
서버 재시작 직후 WAVE가 오늘 hot-candidates-history.json 및 open-market.json을 읽어 WATCH 후보를 저장합니다.
장외시간에는 모의매수하지 않습니다. 다음 거래일 09:00부터 평가하고, 전일 WATCH/READY 후보가 조건을 충족하면 09:00부터 즉시 모의매수할 수 있습니다.
반복 실행은 5분 정각(09:00, 09:05, 09:10...)에 맞춰 동작합니다.

[아직 포함하지 않은 것]
- DART 공시 직접조회: DART API 키/종목코드-고유번호 매핑이 필요하므로 다음 단계로 분리했습니다.
- WAVE 전용 HTML 대시보드: 우선 전략을 실제 모의운영한 뒤 화면을 붙이는 순서가 안전합니다.

[2026-08-18 19:52 추가 변경]
- WAVE 후보평가 시작: 09:00
- WAVE 신규 모의매수 시작: 09:00
- WAVE 매수 종료: 14:50
- WAVE 매도점검: 09:00~15:20
- 5분 실행주기를 서버 재시작 시각이 아닌 5분 정각에 정렬
- 오늘 저녁 배포 후 서버를 재시작하면 오늘 HOT 후보를 paper-state-wave.json에 먼저 저장하고, 내일 09:00부터 재평가합니다.
- 최소 1거래일 관찰 조건은 유지하므로 내일 09:00에 새로 나타난 당일 HOT 종목을 즉시 WAVE가 추격매수하지는 않습니다.
