# 동아리방 보드게임 대여 사이트

Railway 배포를 염두에 둔 Next.js + Prisma + PostgreSQL MVP입니다.

## 로컬 확인 방법

1. 의존성 설치

```bash
npm install
```

2. 환경변수 설정

`.env.example`을 참고해서 `.env`를 만들고 값을 채웁니다.

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
SESSION_SECRET="change-this-to-a-long-random-secret"
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

3. DB 마이그레이션

```bash
npm run db:migrate
```

4. 샘플 데이터 넣기

```bash
npm run db:seed
```

기본 테스트 계정은 아래와 같습니다.

```text
관리자 ID: admin
비밀번호: admin1234

일반 사용자 ID: user
비밀번호: user1234
```

5. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속합니다.

## 기능 확인 체크리스트

- 회원가입 후 자동 로그인되는지 확인
- 로그인 실패가 과도하게 반복될 때 rate limit 메시지가 나오는지 확인
- 관리자 계정으로 `/admin`에서 게임을 추가/수정할 수 있는지 확인
- 관리자 계정으로 `/admin`에서 회원 권한을 수정하고 비밀번호를 `1981`로 초기화할 수 있는지 확인
- 초기화된 회원이 `1981`로 로그인한 뒤 `/account/password`에서 새 비밀번호를 설정할 수 있는지 확인
- 관리자 계정으로 `/admin`에서 엑셀 파일을 업로드해 게임 DB를 교체할 수 있는지 확인
- 관리자 계정으로 `/admin/games/export`에서 현재 게임 DB를 내려받을 수 있는지 확인
- 개최자 또는 관리자가 게임 약속을 완료/취소해서 목록에서 제거할 수 있는지 확인
- 일반 사용자 계정이 `/admin`에 접근할 수 없는지 확인
- 일반 회원이 게임을 대여하고 반납할 수 있는지 확인
- 다른 회원이 이미 대여 중인 게임을 다시 대여할 수 없는지 확인
- 원형/중형/대형 테이블 중 하나를 선택해서 게임 약속을 만들고 참여/취소할 수 있는지 확인
- 보드게임이 많을 때 검색, 상세 필터, 상태 필터, 페이지 이동이 동작하는지 확인
- 모바일 너비에서도 카드와 폼이 겹치지 않는지 확인

## Railway 배포 확인 방법

1. Railway에서 PostgreSQL 플러그인을 추가합니다.
2. 서비스 환경변수에 `DATABASE_URL`과 `SESSION_SECRET`을 설정합니다.
3. 배포 후 Railway Shell 또는 로컬에서 아래 명령을 실행합니다.

```bash
npm run db:deploy
npm run db:seed
```

4. Railway 배포 로그에서 `prisma generate`와 `next build`가 성공했는지 확인합니다.
5. 배포 URL에 접속해서 관리자 계정으로 로그인합니다.

## Discord 알림 설정

반납 요청 알림과 반납 지연 알림은 Discord Webhook으로 발송합니다.

1. Discord에서 알림을 받을 채널을 만들고 Webhook URL을 복사합니다.
2. Railway 서비스 환경변수에 `DISCORD_WEBHOOK_URL`을 추가합니다.
3. 반납 요청 알림은 사용자가 반납 요청을 올릴 때 즉시 발송됩니다.
4. 반납 지연 알림은 Railway Cron 서비스에서 아래 명령을 실행하도록 설정합니다.

```bash
npm run notify:loans
```

Railway Cron은 UTC 기준입니다. 매일 오전 10시 KST에 실행하려면 `0 1 * * *`로 설정합니다.

## 보드게임 엑셀 양식

관리자 업로드는 첫 번째 시트의 A~K 컬럼을 읽습니다.

```text
제목 | 인원(명) | 베스트 인원 | 시간(분) | 수량(개) | 비고 | 소유자 | 장르 | 존재 여부 | 난이도(웨이트) | 보드게임 정보 사이트
```

- `소유자` 열은 DB에 저장하지 않습니다.
- `보드게임 정보 사이트` 열은 관리자 DB 관리용으로 저장하고, 사용자 대여 화면에는 표시하지 않습니다.
- 빈칸은 빈칸으로 저장하고 화면에서도 표시를 강제하지 않습니다.
- `시간(분)`과 `난이도(웨이트)`는 `∞`, `30~60`, `1.28` 같은 원본 표현을 보존합니다.
- 업로드는 현재 게임 목록을 엑셀 기준으로 교체합니다.
- 대여 중인 게임이 있으면 업로드를 막습니다.

## 과부하 방지 대책

- 로그인/회원가입/대여/반납/약속 생성/참여 요청에 rate limit 적용
- 세션은 DB에 저장하고 만료 시간을 둠
- 자주 조회하는 필드에 DB 인덱스 적용
- 대여 처리는 트랜잭션으로 묶어 중복 대여를 방지
- Railway에서는 필요 시 서비스 리소스 제한, 배포 로그, PostgreSQL 메트릭을 함께 확인
