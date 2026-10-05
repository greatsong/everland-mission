# everland-mission 작업 안내

하늘씨앗(HEAVEN SEED) 초등부 2026 가을 야유회(2026-10-24 토, 에버랜드, 10:00~15:30, 5~6팀, 팀당 6~7명과 선생님 2명)에서 사용하는 미션 웹앱이다.
선생님 휴대폰 한 대로 팀이 함께 사용하고, 본부(운영자)는 본부 화면에서 진행한다.

## 주소

- 팀 화면: https://greatsong.github.io/everland-mission/
- 본부 화면: 같은 주소 뒤에 `#hq`, 슬라이드쇼는 `#show`
- 입장 코드와 본부 코드: `_private/codes.txt` (저장소에 올리지 않는다. 대화나 커밋에 적지 않는다)
- 로컬 개발: 포트 4058. 미리보기 설정은 `greatsong-project/etc/.claude/launch.json`의 `everland-mission`

## 구조

- 화면: React + Vite, 서버 없음(정적). `src/`
  - `App.jsx` 팀 화면(빙고, 지령, 알림함, 팀 소개, 모두 탭), `Games.jsx` 퀴즈 대결, `Hq.jsx` 본부, `Show.jsx` 슬라이드쇼
  - `TeamMap.jsx` 위치 지도(Leaflet + 오픈스트리트맵), `shared.jsx` 공용 훅과 컴포넌트, `logic.js` 점수 계산, `store.js` 서버 호출과 기기 저장
  - `data.js` 빙고 미션 16개, 암송 구절(마태복음 1:23, 28:20), 기본 문제 묶음. 행사 내용은 이 파일에서 고친다
- 서버: Supabase **pythink2 프로젝트(fipdcjhtfslinfmalwjn)** 에 `evm_` 접두어로 얹었다. 전용 프로젝트는 무료 한도(2개) 때문에 만들지 못했다
  - 표는 RLS로 직접 접근을 막고, 코드를 확인하는 함수(`evm_*`)로만 읽고 쓴다
  - 스키마: `supabase/schema.sql` (여러 번 실행해도 된다). 제거: `supabase/teardown.sql`
  - 문제 추천: Edge Function `supabase/functions/evm-suggest` (Claude Sonnet 5.5, 비밀 값 `EVM_ANTHROPIC_API_KEY`)
- 기능: 사진 빙고, 본부 지령(사진·정답·타임어택), 퀴즈 대결(초성·성경 객관식/단답형·넌센스는 본부 출제, 몸으로 말해요는 팀 출제 후 본부 승인), 말씀 조각, 팀 위치와 이동 경로, 팀 소개, 인원 확인, 알림함

## 자주 하는 작업

스키마 적용(pythink2의 다른 표는 건드리지 않는다. `evm_` 이름만 다룬다):

```bash
npx -y supabase@latest db query --linked --project-ref fipdcjhtfslinfmalwjn -f supabase/schema.sql
npx -y supabase@latest db query --linked --project-ref fipdcjhtfslinfmalwjn "notify pgrst, 'reload schema'"
```

`schema.sql`을 고치면 `_private/setup.sql`(스키마 + 코드 등록)도 같은 내용으로 맞춘다.

Edge Function 배포:

```bash
npx -y supabase@latest functions deploy evm-suggest --project-ref fipdcjhtfslinfmalwjn --no-verify-jwt --use-api
```

배포(GitHub Pages): `main`에 소스를 푸시하고, `npx vite build` 결과(`dist/`)를 `.nojekyll`과 함께 `gh-pages` 가지에 강제 푸시한다. 배포 뒤에는 주소의 번들 파일 이름이 바뀌었는지 확인한다.

시험·행사 중 점검: 기기가 접속과 오류를 `evm_events`에 보낸다(`store.js`의 `report`). 본부 화면 "점검" 탭에서 보거나 아래 스크립트로 조회한다(읽기 전용, 인자는 최근 몇 분).

```bash
scripts/monitor.sh 120
```

## 지킬 것

- 운영 DB에서 시험한다. 시험 자료는 `[시험]` 표시를 붙여 넣고 끝나면 그것만 지운다. 사용자가 넣은 퀴즈·사진·팀 소개는 지우지 않는다. `evm_wipe`는 사용자가 직접 누른다
- 아이들 사진과 위치가 올라간다. 팀끼리 위치 보기는 본부가 허용할 때만 켜진다. 정답은 팀 화면으로 보내지 않는다
- 화면 문구는 합쇼체 평서형. 사용자의 글로벌 한글 문장 원칙을 따른다
- 속도 경쟁은 타임어택 지령에만 있다(사용자가 요청). 그 밖의 점수에는 속도를 넣지 않는다

## 아직 확인하지 못한 것 (2026-10-05 기준)

- 실제 휴대폰의 카메라 촬영과 위치 권한, 카카오톡 안 브라우저에서의 동작. 사용자가 선생님들과 시험할 예정
- 암송 구절 본문은 개역개정을 기억해 넣었다. 사용하는 성경과 대조가 필요하다
- 위치는 팀 화면이 켜져 있는 동안에만 3분마다 전송된다(미션 완료 시 추가 전송)
- 영상 미션은 넣지 않기로 했다
- 사진·포스터·가이드맵 그림은 앱에 넣지 않기로 했다. 가이드맵은 에버랜드 공식 지도 링크로만 연결한다
