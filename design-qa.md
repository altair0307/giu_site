# GIU 디자인 구현 QA

- source visual truth path: `docs/design/giu-boardgame-lending-primary-design.png`
- implementation screenshot path: `docs/design/implementation-home-desktop.png`
- mobile screenshot path: `docs/design/implementation-home-mobile.png`
- viewport: desktop 1488×1058 CSS px, mobile 390×844 CSS px
- source pixels: 1487×1058
- implementation pixels: 1488×1058
- density normalization: deviceScaleFactor 1, 높이 동일, 가로 1px 차이는 무시
- state: 관리자 로그인, 대여 목록 기본 상태

## Full-view comparison evidence

대표 시안과 구현 화면을 같은 1058px 높이에서 함께 열어 비교했다. 좌측 고정 탐색, 상단 제목/계정, 네 개의 요약 수치, 큰 검색 입력, 한 줄 필터, 전체 목록의 정보 계층과 포레스트 그린/아이보리 토큰이 동일한 방향으로 구현됐다. 실제 개발 DB의 게임 수와 콘텐츠 길이가 시안과 달라 행 수와 페이지네이션 밀도는 데이터 기반 차이로 분류했다.

## Focused region comparison evidence

- 검색/필터: 큰 검색 입력과 우측 1차 버튼, 아래 보조 필터 배열과 포커스 상태를 확인했다.
- 목록: 제목, 게임 정보, 상태 배지, 평점/대여 행동 순서와 행 구분선을 확인했다.
- 탐색: 대여·약속·내 대여·관리자 링크의 활성 상태와 모바일 전환을 확인했다.
- 확장 화면: `/account`, `/meetups/new`, `/admin`의 공통 프레임, 제목, 주요 콘텐츠와 콘솔 오류 여부를 확인했다.

## Required fidelity surfaces

- Fonts and typography: 시스템 한글 산세리프 스택과 700~800 강조를 사용했다. 시안과 유사한 밀도이며 텍스트 잘림이 없다.
- Spacing and layout rhythm: 148px 사이드바, 32px 본문 여백, 8~12px 반경, 얇은 구분선을 적용했다. 모바일은 2열 요약과 1열 목록으로 전환된다.
- Colors and visual tokens: 따뜻한 아이보리 `#fbfaf7`, 딥 그린 `#155c3b`, 세이지 표면, 차콜 본문, 제한적인 코랄 강조를 사용했다.
- Image quality and asset fidelity: 시안의 게임 표지는 현재 Game 모델에 이미지 필드가 없어 표시하지 않았다. 가짜 이미지나 자리표시자는 추가하지 않았으며 제목과 데이터 행을 보존했다.
- Copy and content: 실제 서비스의 게임, 대여 상태, 제한, 회원/관리자 데이터를 그대로 사용했다.

## Findings

- P3: 실제 게임 표지 자산이 없어 시안보다 목록의 시각적 식별성이 낮다.
  - 후속 개선: Game 이미지 URL/파일 필드를 제품 범위로 추가할 때 실제 표지를 연결한다.

## Interaction and runtime verification

- 큰 검색바에 `카탄`을 입력하고 결과 1개 및 URL 쿼리 반영을 확인했다.
- `/account`, `/meetups/new`, `/admin` 내비게이션과 각 페이지의 제목을 확인했다.
- 데스크톱 1488×1058, 모바일 390×844에서 레이아웃을 확인했다.
- 브라우저 콘솔 오류: 없음.
- `npm run lint`: 통과.
- `npm run build`: 통과.

## Comparison history

1. 첫 모바일 캡처에서 요약 수치가 세로 한 열로 길게 표시되는 P2 문제를 발견했다.
2. 560px 이하에서 요약 영역을 2×2 그리드로 변경하고 관리자 탐색을 복원했다.
3. 재캡처에서 요약 영역이 173px 두 열, 총 높이 152px로 표시되는 것을 확인했다.
4. 실제 인앱 브라우저에서 데스크톱 사이드바가 너무 일찍 상단 탐색으로 전환되고, 게임 정보가 하나의 셀에 합쳐진 P1 구조 차이를 확인했다.
5. 사이드바 전환점을 680px로 낮추고, 게임 목록을 게임명·장르·인원·베스트 인원·시간·웨이트·상태·작업의 8열 구조로 변경했다.
6. 월 대여 한도와 현재 대여 수를 상단 상태 스트립에 추가하고, 검색 필터 초기화를 추가했다.
7. 1280×720 실제 브라우저에서 좌측 사이드바, 8열 목록, 대여 상태 스트립, 검색·필터 계층과 최근 콘솔 오류가 없음을 재확인했다.
8. 내 페이지의 현재 대여 영역과 평점/브릿지 기록 탭, 약속 만들기의 실제 3단계 이동, 관리자 승인 목록/상세 패널을 추가했다.
9. 관리자 전체 하위 화면에 현재 위치 표시를 추가하고 전역 키보드 포커스 표시를 강화했다.

## Follow-up polish

- 실제 게임 표지 데이터가 마련되면 48~56px 썸네일 열을 추가한다.

final result: passed
