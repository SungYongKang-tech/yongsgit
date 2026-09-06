탁구 친선경기 PWA 최종 배포 파일

포함 기능
- 홈 화면 앱 아이콘 설치
- 앱 실행 시 전용 스플래시(대기화면) 후 경기입력 화면 표시
- 경기입력(index.html)
- 친선경기 리포트(report.html)
- 복식 경기 진행/휴대폰 심판/패드 전광판(doubles-match.html)
- 경기입력 → 복식 경기 → 경기입력 복귀 연결 유지
- Android/Chrome/Edge 설치 버튼 지원
- iPhone/iPad 홈 화면 추가 안내
- 서비스워커 및 기본 오프라인 화면

배포 방법
1) ZIP의 모든 파일을 동일한 웹 폴더에 업로드합니다.
2) 반드시 HTTPS 주소에서 index.html을 엽니다.
3) Android Chrome/PC Chrome·Edge에서는 화면의 [앱 설치] 버튼으로 설치합니다.
4) iPhone/iPad Safari에서는 [앱 설치] 안내에 따라 공유 → 홈 화면에 추가를 선택합니다.
5) 홈 화면 아이콘을 누르면 splash-9x16.png 대기화면을 거쳐 본 화면이 열립니다.
6) 패드 전광판은 doubles-match.html?role=display&auto=1 경로로 자동 연결됩니다.

주의
- Firebase 실시간 경기 데이터는 인터넷 연결이 필요합니다.
- 복식 경기 화면 사용을 위해 화면 회전은 세로/가로 모두 허용했습니다.
