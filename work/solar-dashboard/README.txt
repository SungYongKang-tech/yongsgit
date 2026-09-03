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


[V5 화면 정리]
- '기존 포함 월별 발전량' -> '월별 발전량'
- 기존/수동 구분 열 제거
- 선택 연도에 발전실적이 없는 철거 설비 열 자동 숨김
- 월별 표 하단 연간 합계 추가
- 휴대폰 가로 화면에서 표 전체 표시하도록 반응형 개선
- '월 1회 인버터 화면 사진' -> '인버터 사진', 설명 문구 제거
- 화면의 비밀번호 1111 안내 문구 제거 (인증 기능은 유지)


[V6]
- 상단: 현재까지 전체 발전량 / 2026 예상 발전량 / 2026 누적 발전량 / 다음 검침일
- 기존 발전자료 등록 패널 제거, 미등록 시 자동 등록
- 누적 발전량 입력으로 제목 단순화
- 날짜별 누적값 제목을 표 상단에 표시
- 입력 화면에서 발전량/특이사항/입력자 제거
- 2026 예상 발전량 = 2026 저장 월 평균 × 12


[V7 월별 발전량 표]
- 태양광1/2/3 대신 설치위치 + 용량 표시
- 100.44: 옥외주차장 / 50.22: 체육관옥상A / 256: 옥외주차장 / 102.4: 강당옥상 / 46.08: 체육관옥상B
- 휴대폰 세로 화면에서 월별 발전량 표 가로 스크롤 제거
- 표 셀/패널 가로 여백 축소 및 글자 자동 압축


[V8 Cloudinary]
- Firebase Storage 제거
- Cloudinary cloud name: dqpcvlakz
- Unsigned upload preset: koen_solar
- Asset folder는 Cloudinary preset의 koen-solar 설정 사용
- 사진 업로드 후 secure_url을 Firebase Realtime Database에 저장
- JPG/PNG/WEBP, 5MB 이하 클라이언트 검사


[V8.1 Cloudinary 업로드 멈춤 수정]
- fetch 대신 XMLHttpRequest 업로드로 변경
- Unsigned 업로드 파라미터를 file + upload_preset으로 최소화
- 45초 타임아웃 추가
- 업로드 진행률(%) 표시
- Cloudinary 업로드 완료 후 Firebase URL 저장 단계 별도 표시
- 네트워크/Cloudinary 오류 문구를 화면과 콘솔에 표시


[V8.2]
- Cloudinary 업로드 시 asset_folder=koen-solar 강제 지정
- Cloudinary가 반환한 secure_url을 Firebase에 저장
