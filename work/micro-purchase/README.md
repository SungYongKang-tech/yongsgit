# 업무지원부 소액계약 동일업체 반복관리 웹앱

## 구현 기능
- Firebase Realtime Database 실시간 저장/조회
- Firebase Email/Password 로그인(신규가입 화면 없음)
- 입력항목: 날짜, 업체명, 사업자번호, 구매내역, 구매금액, 발주자
- 순번 자동부여(화면/엑셀에서 날짜·등록순 기준)
- 사업자번호 기준 동일업체 횟수 자동 집계
- 2026년 6/30~12/31, 2027년부터 연 1/1~12/31 자동 적용
- 6회째부터 반복구매 사유 미입력 시 저장 차단
- 안전·보건 법령상 예외 건 별도 표시 및 산정 제외
- 업체 빠른 검색 및 구매이력 확인
- 기간/검색 조건별 Excel(xlsx) 다운로드
- Q&A 24개 검색/펼침 보기 + 원문 PDF 연결
- 삭제는 soft-delete 방식으로 감사기록 유지

## 1. Firebase Authentication 설정
Firebase Console > Authentication > Sign-in method에서 Email/Password를 활성화합니다.
부서원 계정은 Firebase Console에서 관리자만 생성하는 것을 권장합니다.

## 2. Realtime Database Rules
프로젝트 폴더에서 다음 명령으로 적용할 수 있습니다.

```bash
firebase deploy --only database
```

기본 규칙은 로그인 사용자만 `smallContract` 경로를 읽고 쓸 수 있습니다.

## 3. Hosting 주의사항
이 Firebase 프로젝트(`work-schedule-b3c4e`)에 이미 다른 Hosting 사이트가 운영 중이면
`firebase deploy --only hosting`을 바로 실행하면 기존 사이트가 바뀔 수 있습니다.

안전한 방법은 Firebase Hosting에서 **새 Site를 추가**하고 multi-site target으로 연결하는 것입니다.
예: site id를 `small-contract-ledger`로 만들었다면:

```bash
firebase target:apply hosting smallcontract small-contract-ledger
```

그 다음 `firebase.json`의 hosting을 target 방식으로 바꿉니다.

```json
{
  "hosting": {
    "target": "smallcontract",
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "cleanUrls": true
  }
}
```

배포:
```bash
firebase deploy --only hosting:smallcontract
```

## 4. 규정 운영 모드
`public/app.js` 상단:

```js
const STRICT_BLOCK_AFTER_5 = false;
```

- `false`: 규정 그대로 운영. 6회째부터 사유가 있으면 등록 가능.
- `true`: 업무지원부 자체 내부방침으로 6회째 등록 자체를 차단.

## 5. 참고
Firebase 웹 apiKey는 원래 브라우저에 포함되는 식별 정보입니다. 보안의 핵심은 Authentication과 Database Rules입니다.
