본사사옥 태양광 발전관리 V1

구성
- index.html : 메인 화면
- styles.css : 모바일/PC 스타일
- app.js : Firebase 저장/조회, 일일 발전량 계산, 사진 업로드
- assets/roof-solar.jpg : 본사사옥 태양광 설치 전경

현재 기능
1) 3개 운영 설비 누적발전량 일일 입력
2) 전일 누적값 자동 조회 후 일일 발전량 계산
3) 최근 14일 실적 조회
4) 오늘/월/연 누적 요약
5) 비밀번호 1111로 입력/수정 잠금 해제
6) 2026-07부터 월별 인버터 화면 사진 3장 업로드
7) 철거 설비는 화면 하단 과거 설비로 표시

설비 기준
- 체육관 옥상 B: 46.08 kW (기존 45kW, 사진 상부 좌측)
- 체육관 옥상 A: 50.22 kW (기존 50kW, 사진 상부 우측)
- 강당 옥상: 102.4 kW (기존 103kW, 사진 하부 전체)

중요
- 강당 용량은 업로드된 기존 엑셀의 102.4 kWp를 기준으로 작성함.
- 실제가 10.24 kW라면 app.js EQUIPMENT에서 capacityKw: 102.4를 10.24로 수정.

Firebase 경로
- solar/daily/YYYY-MM-DD
- solar/monthlyPhotos/YYYY-MM
- Storage: solar/inverterPhotos/YYYY-MM/

보안 주의
- 비밀번호 1111은 HTML/JS 내부 간편 잠금이므로 강한 보안은 아님.
- Realtime Database/Storage 규칙이 public write이면 외부에서 직접 우회 가능.
- 실제 운영 안정화 후 Firebase Authentication 적용 권장.

배포
- 폴더 전체를 Netlify, GitHub Pages 등의 정적 호스팅에 업로드 가능.
- Firebase Storage CORS/Rules 및 Realtime Database Rules 설정 필요.
