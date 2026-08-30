# SY Quant US

미국 주식용 독립 퀀트 시스템.

## 운영 원칙
- SY Quant KR과 완전히 분리해서 운영한다.
- 초기 운영은 PAPER 모드만 사용한다.
- 실제 주문(LIVE)은 별도 검증 후에만 활성화한다.
- 서버 경로는 /home/ubuntu/sy-quant-us 를 사용한다.
- KR 서버 /home/ubuntu/sy-quant-kr 는 수정하지 않는다.
- PM2 프로세스, 포트, 상태파일, 환경변수는 KR과 공유하지 않는다.
- API 키와 토큰은 GitHub에 저장하지 않는다.

## 예정 구조
- server/ : US 백엔드
- server/web/ : US 대시보드 및 관리 화면
