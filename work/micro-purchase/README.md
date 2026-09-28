# 업무지원부 소액계약 반복관리 v3 - 공용 비밀번호 방식

## 접속 방식
- 아이디 없음
- 공용 비밀번호: `1930`
- 비밀번호가 맞으면 메인 화면으로 진입
- 한 번 들어간 기기는 `잠금` 버튼을 누르기 전까지 접속 상태를 기억

## 발주자
로그인 아이디가 없으므로 구매 등록 시 발주자를 목록에서 선택합니다.
- 전성무
- 강준현
- 문무성
- 이영길
- 조동완
- 강성용
- 노자빈
- 박승민
- 이낭주
- 이서진

선택한 발주자는 해당 기기에서 기억되어 다음 등록 때 자동 선택됩니다.

## Firebase Realtime Database
사용 경로는 기존과 동일합니다.

`smallContract/records`

Firebase Authentication은 사용하지 않습니다. 대신 `database.rules.json`에서 `smallContract` 경로만 읽기/쓰기를 허용합니다. 프로젝트의 다른 데이터는 루트 규칙이 false라 공개되지 않습니다.

> 주의: 이 방식의 1930 비밀번호는 정적 웹페이지 수준의 간단한 출입 확인용이며 강한 보안 수단은 아닙니다. 중요한 개인정보나 민감한 자료 보관용으로는 적합하지 않습니다.

## Netlify 반영
현재 사이트의 `work/micro-purchase/public/`에 이 프로젝트의 `public` 폴더 내용을 덮어쓰면 됩니다.

다만 기존 Firebase Rules가 인증 사용자만 허용하고 있다면 웹페이지 반영만으로는 데이터가 보이지 않습니다. `database.rules.json`의 규칙도 Firebase Realtime Database Rules에 1회 반영해야 합니다.
