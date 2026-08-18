SY Quant WAVE UI 적용 안내 (2026-08-18)

1) 교체
- performance.html
- performance.js (내용 변경 없음, 배포 편의상 포함)

2) 신규 추가
- wave.html
- wave.js

3) WAVE V1.1을 아직 적용하지 않았다면 함께 적용
- server.js
- wave-strategy.js

4) 서버 재시작
pm2 restart kiwwm-server

5) 확인
https://sytrader.duckdns.org/performance.html
대시보드 상단의 '🌊 WAVE' 버튼 클릭

WAVE 화면은 30초마다 자동 갱신합니다.
표시 항목:
- WAVE 자산/실현손익/보유손익/현금
- WATCH/READY/보유/오늘매수
- 단계별 후보 개수
- 보유 종목의 현재수익률/최고수익/고점대비/추세점수
- 상위 후보의 WHY/MONEY/SECTOR/TREND/눌림/반등 점수
- 뉴스, 외국인·기관 수급 합계, 눌림폭
- 최근 WAVE 거래 및 후보 제외 사유
