KOEN AI 경진대회 소액구매 심사용 웹앱 (익명 자동 로그인 버전)

현재 프로젝트: koen-ai-contest (Firebase Spark), RTDB asia-southeast1

1. Firebase Authentication > Sign-in method > 익명(Anonymous) 활성화 (사용자 완료).
2. Realtime Database > 규칙(Rules) 탭에서 database.rules.json 전체를 붙여넣고 게시(Publish)합니다.
   기존 운영 프로젝트가 아닌 koen-ai-contest 프로젝트에서만 실행하세요.
   경로 contestDemo/smallContract 이외의 읽기/쓰기는 차단합니다.
3. 이 폴더의 정적 파일(index.html, app.js, style.css, qa.html, firebase-config.js)을
   Firebase Hosting으로 배포합니다. Hosting 배포는 별도 안내에 따라 나중에 진행 가능합니다.
4. 주소를 열면 별도 가입 없이 익명 로그인됩니다. 데이터가 비어 있으면
   '시연 데이터 5건 준비' 버튼을 누릅니다.
5. 사업자번호 123-45-67890으로 6번째 등록하여 사유 입력 필수 흐름을 시연합니다.

주의
- 익명 인증은 '심사위원만' 접속시키는 인증이 아닙니다. 링크를 아는 모든 방문자가
  익명 로그인 후 가상 구매내역을 읽고 수정/삭제할 수 있습니다.
- 데모에는 가상 담당자, 가상 업체, 가상 구매내역만 사용하세요.
- 심사 종료 후 가상 데이터/익명 계정/Hosting 사이트를 정리하세요.
- Database URL에 직접 접속하는 것은 웹앱 배포가 아닙니다.
- 데이터 검증은 일부 클라이언트에서 수행하므로 외부 방문자에 의한 임의 데이터 변경까지
  막는 구조가 아닙니다. 따라서 실제 사내 업무 자료를 절대 넣지 마세요.
- 구매횟수 검증은 동시 저장 경쟁상황을 완벽히 방지하지 않습니다.
- 부서별 독립관리 기능은 아직 미구현입니다.
