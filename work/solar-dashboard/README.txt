본사사옥 태양광 발전관리 V4

[운영 방식]
- 매월 1일 1회 누적발전량 입력
- 이번달 1일 누적값 - 전월 1일 누적값 = 전월 발전량 자동 계산
- 현재 운영 설비 3개
  · 체육관 옥상 B 46.08 kW
  · 체육관 옥상 A 50.22 kW
  · 강당 옥상 102.4 kW
- 철거 설비 2개는 과거 발전량 분석용으로 보존
  · 옥외주차장 100.44 kW
  · 옥외주차장 256 kW
- 2026년 7월부터 매월 인버터 화면 사진 3장 업로드
- 입력/수정 잠금 비밀번호: 1111

[기존자료]
- 16년~ 소내 태양광 발전량 수정.xlsx 내용을 historical-data.js/json으로 포함
- 최초 1회 '기존자료 Firebase 등록' 버튼으로 solarHQ 경로에 이관
- 동일 월 수정 저장 시 덮어쓰기 확인창 표시

[Firebase]
- Realtime Database: solarHQ/...
- Storage: solarHQ/inverterPhotos/...

주의: 비밀번호 1111은 브라우저 코드에 포함된 간편 잠금입니다. 강한 보안이 필요하면 Firebase Authentication으로 변경하세요.


[V4.1 수정]
- setUnlocked()에서 DOM 요소가 없을 때 null.style 오류가 나지 않도록 방어코드 추가
- index.html / app.js 파일 버전 불일치 검사 추가
- styles.css, app.js에 캐시 무효화 쿼리 추가
