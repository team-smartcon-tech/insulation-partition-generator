# WORKFLOW.md

이 문서는 Woomi 신규 프로젝트에서 AI 에이전트와 개발자가 작업을 진행하는 표준 흐름을 정의한다.

`AGENTS.md`는 진입 규칙과 작업 라우팅을 담당한다. 이 문서는 **절차가 중요한 작업의 순서와 검증 방법**을 담당한다.

---

## 1. 기본 원칙

- 기존 패턴을 먼저 찾고, 새 패턴은 마지막에 만든다.
- 한 번의 작업은 가능한 작고 명확한 범위로 제한한다.
- 코드 변경과 문서 변경이 함께 필요한 경우 같은 작업에서 함께 처리한다.
- 사용자가 요청하지 않은 자동 커밋, 자동 푸시, 자동 배포는 하지 않는다.
- 불확실한 내용은 추측해서 확정하지 않고, 코드와 설정을 먼저 확인한다.

---

## 2. 작업 시작 전

작업 전 반드시 확인한다.

1. 현재 요청이 어떤 유형인지 분류한다.
2. `AGENTS.md`를 읽는다.
3. `AGENTS.md`의 `Task Routing` 표에서 필요한 문서만 확인한다.
4. 같은 도메인의 기존 구현을 검색한다.
5. 변경 대상 파일과 영향 범위를 파악한다.

작은 문구 수정, 단순 오타 수정, 명확한 단일 파일 수정에서는 전체 문서 세트를 읽지 않는다. 구조, 스택, 배포, DB, API 계약에 영향이 있을 때 관련 문서를 추가로 확인한다.

검색 기준:

```txt
같은 route
같은 feature
같은 entity
같은 API client
같은 repository
같은 schema
같은 store/hook
```

---

## 3. 기능 구현 흐름

일반 기능은 아래 순서로 진행한다.

1. 요구사항을 한 문장으로 정리한다.
2. 영향을 받는 도메인과 레이어를 찾는다.
3. 기존 타입, schema, hook, API client, repository를 먼저 확인한다.
4. 필요한 최소 파일만 수정한다.
5. 테스트 또는 검증 명령을 실행한다.
6. 변경한 파일과 남은 리스크를 사용자에게 보고한다.

새로운 도메인이나 큰 기능을 추가할 때는 먼저 구조를 제안하고, 기존 표준 안에 들어갈 수 있는지 확인한다.

---

## 4. 프론트엔드 작업 흐름

프론트엔드 작업은 React Router v7 Framework Mode와 FSD 계열 구조를 기준으로 한다.

작업 순서:

1. route 진입점이 필요한지 확인한다.
2. 사용자 행동이면 `features/`에 둔다.
3. 여러 feature가 공유하는 업무 명사면 `entities/`에 둔다.
4. 업무를 몰라도 쓰는 UI/유틸이면 `shared/`에 둔다.
5. route 파일에는 화면 조립, loader/action, error boundary 중심으로 둔다.
6. 복잡한 폼은 React Hook Form + Zod를 사용한다.
7. 서버 데이터 캐시/동기화는 TanStack Query를 사용한다.
8. URL로 표현 가능한 상태는 search params에 둔다.
9. URL로 표현하기 어려운 전역 UI 상태만 Zustand에 둔다.

금지:

- route 파일에 비즈니스 로직 몰아넣기
- 컴포넌트 안에서 raw fetch 반복 작성
- `shared/`에 도메인 지식 넣기
- 서버 데이터를 Zustand에 장기 저장하기
- 프론트엔드에서 service role key나 server secret 사용하기

UI 변경 후 확인:

- 로딩 상태
- 빈 상태
- 에러 상태
- 모바일/데스크톱 레이아웃
- 권한이 없을 때의 화면
- 주요 사용자 흐름

---

## 5. 백엔드 작업 흐름

백엔드 작업은 `route -> service -> repository -> db/platform` 흐름을 기준으로 한다.

작업 순서:

1. HTTP 입출력은 `*.route.ts`에 둔다.
2. 요청 검증은 Zod schema 또는 validator middleware로 처리한다.
3. 비즈니스 규칙은 `*.service.ts`에 둔다.
4. DB/RPC/storage 접근은 `*.repository.ts`에 둔다.
5. 공통 auth, env, db, response, error, middleware는 `platform/`을 사용한다.
6. 원자성이 필요한 작업은 PostgreSQL function/RPC 또는 명시적 보상 트랜잭션을 사용한다.

금지:

- route에서 Supabase 직접 접근
- repository에서 service 또는 route import
- service에서 HTTP response 객체 생성
- Supabase JS 체인으로 트랜잭션 흉내내기
- raw database error를 사용자에게 그대로 반환

API 변경 후 확인:

- happy path
- validation error
- auth/permission error
- not found
- DB/RPC error
- 응답 타입과 문서 동기화

---

## 6. DB / API 계약 변경 흐름

DB, RPC, RLS, API 계약이 바뀌면 코드와 문서를 함께 갱신한다.

DB 변경 시 확인:

```txt
Affected tables:
Affected RPC/functions:
Affected RLS policies:
Affected APIs:
Affected frontend screens:
Backfill needed:
Rollback plan:
```

함께 갱신할 문서:

- `.agents/data/DB_SCHEMA.md`
- `.agents/data/API_CONTRACT.md`
- `.agents/data/MIGRATION.md`
- 관련 README 또는 운영 문서

금지:

- 운영 데이터를 잃는 변경을 승인 없이 수행
- RLS 변경을 문서 없이 수행
- API 응답 구조 변경 후 프론트 타입 미갱신
- migration 없이 운영 DB만 직접 수정

---

## 7. Storage / 파일 업로드 흐름

신규 프로젝트에서 파일 업로드나 비공개 파일 저장이 필요하면 Cloudflare R2 bucket을 기본 storage로 설계한다.

프로젝트 시작 시 확인:

- 파일/이미지/PDF/도면/서명 등 binary storage가 필요한가?
- private 파일과 public 파일이 분리되어야 하는가?
- local/dev/staging/production 환경별 bucket이 필요한가?
- Cloudflare Worker binding 이름은 무엇인가?

bucket이 아직 없다면:

- Cloudflare R2 bucket 생성을 제안한다.
- production과 dev/staging bucket을 분리한다.
- `wrangler.jsonc`에 R2 binding을 명시한다.
- `.agents/DEPLOYMENT.md`에 bucket 이름, binding 이름, 환경별 차이를 기록한다.
- secret 또는 민감한 파일 URL을 코드에 하드코딩하지 않는다.

기존 bucket이 있다면:

- 새 bucket을 만들기 전에 기존 bucket을 우선 검토한다.
- 기능별 폴더를 만들어 구분한다.
- 경로는 `{feature}/{ownerId or siteId}/{uuid}.{ext}` 형태를 우선한다.
- 확장자, MIME, 크기, 권한을 검증한다.
- private 파일은 인증 없이 signed URL을 발급하지 않는다.

---

## 8. 문서 업데이트 흐름

다음 변경은 문서 갱신을 함께 검토한다.

| 변경 | 갱신 후보 |
|---|---|
| 새 도메인 | `ARCHITECTURE.md`, `DOMAIN_MODEL.md` |
| 새 API | `API_CONTRACT.md` |
| DB schema/RPC/RLS 변경 | `DB_SCHEMA.md`, `MIGRATION.md` |
| 스택 변경 | `STACK.md` |
| 배포/secret 변경 | `DEPLOYMENT.md` |
| 반복 실수 발견 | `BAD_EXAMPLES.md`, 관련 규칙 문서 |
| 좋은 패턴 정착 | `GOOD_EXAMPLES.md`, 관련 규칙 문서 |

문서가 아직 비어 있으면 추측해서 채우지 않는다. 실제 변경이 생긴 범위만 갱신한다.

---

## 9. 검증 명령

기본 검증:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Cloudflare Worker 검증:

```bash
pnpm --filter <worker-package> run typecheck
pnpm --filter <worker-package> run test
pnpm --filter <worker-package> run deploy:dry
```

프로젝트마다 명령 이름이 다를 수 있다. 같은 역할의 명령은 `package.json`과 `README.md`에서 일치해야 한다.

검증을 실행하지 못한 경우, 이유를 최종 보고에 명시한다.

---

## 10. 배포 전 흐름

배포 안내 또는 실행 전에 반드시 Git 상태를 확인한다.

```bash
git status
git fetch
git status -sb
```

다음 상태이면 배포를 보류한다.

- 미커밋 변경 있음
- untracked 파일 있음
- remote 대비 ahead/behind 있음
- lint/typecheck/test/build 실패

사용자 승인 없이 실행하지 않는다.

- `git commit`
- `git push`
- `git pull`
- `pnpm deploy`
- `wrangler deploy`
- 운영 DB 변경

---

## 11. PR / Push 흐름

PR과 push는 코드 변경을 팀과 공유하는 단계다. AI 에이전트가 이 단계를 맡는 경우가 많으므로, 아래 순서를 실행 checklist처럼 따른다.

에이전트는 사용자가 명시적으로 요청하거나 승인한 경우에만 commit, push, PR 생성, merge를 수행한다. "수정해줘", "반영해줘"는 commit/push 승인으로 해석하지 않는다.

작업 브랜치 기준:

- production 배포 기준 브랜치는 `main`이다.
- 새 작업은 `feature/*`, `fix/*`, `chore/*` 같은 목적이 드러나는 브랜치를 우선 사용한다.
- `main` 직접 push는 원칙적으로 금지한다.
- 기존 프로젝트가 다른 브랜치 전략을 쓰면 `DEPLOYMENT.md`의 Project Override를 따른다.
- 브랜치 이름은 작업 목적이 드러나게 짧게 작성한다.

브랜치 이름 예:

```txt
feature/site-upload-flow
fix/admin-login-redirect
chore/update-agent-docs
```

### 11.1 Commit 전 확인

commit 전에는 변경 범위를 먼저 보여줄 수 있어야 한다.

```bash
git status
git diff --stat
git diff
```

확인할 것:

- 사용자가 요청한 변경만 포함되었는가?
- 의도하지 않은 파일, 임시 파일, 빌드 산출물이 섞이지 않았는가?
- `.env`, secret, token, service role key, private key가 포함되지 않았는가?
- 문서 변경이 필요한 코드 변경이면 문서도 함께 수정했는가?
- lint/typecheck/test/build 중 필요한 검증을 실행했거나, 실행하지 못한 이유를 설명할 수 있는가?

commit 메시지는 프로젝트 규칙을 우선한다. 별도 규칙이 없으면 Conventional Commits 형식을 따른다.

기본 형식:

```txt
<type>: <한국어 요약>
```

허용 type:

| type | 사용 시점 |
|---|---|
| `feat` | 사용자에게 보이는 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 변경 |
| `style` | 포맷, 세미콜론, 공백 등 동작 없는 스타일 변경 |
| `refactor` | 동작 변경 없는 코드 구조 개선 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드, 설정, 의존성, 자동화, 템플릿 정리 |
| `ci` | CI/CD 설정 변경 |
| `perf` | 성능 개선 |
| `revert` | 이전 커밋 되돌리기 |

제목은 72자 이내를 권장한다. type은 영어 소문자로 쓰고, 요약은 한국어로 써도 된다. breaking change가 있으면 본문에 `BREAKING CHANGE:`를 명시한다.

```txt
feat: 현장 파일 업로드 흐름 추가
fix: 관리자 로그인 리다이렉트 수정
docs: 에이전트 배포 문서 보강
chore: 바이브코딩 표준 템플릿 정비
```

### 11.2 Push 전 확인

push 전에는 원격 상태를 확인한다.

```bash
git fetch
git status -sb
```

push를 보류해야 하는 상태:

- 현재 브랜치가 `main`이다.
- remote 대비 behind 상태다.
- push 대상 remote/branch가 불명확하다.
- 검증 실패가 남아 있다.
- secret, `.env`, 임시 파일, 빌드 산출물이 포함되어 있다.
- GitHub Actions와 Cloudflare 자동 배포가 중복 실행될 수 있다.

force push는 사용자가 명시적으로 요청한 경우에만 고려한다. 이때도 덮어쓸 commit 범위를 먼저 설명한다.

### 11.3 PR 생성 전 확인

PR 생성 전에는 아래 검증을 우선한다.

```bash
git status
git fetch
git status -sb
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

프로젝트에 없는 명령은 억지로 만들지 않는다. 실행하지 못한 검증은 PR 본문에 명시한다.

PR 대상은 기본적으로 `main`이다. dev/staging 브랜치를 쓰는 프로젝트는 `DEPLOYMENT.md`의 브랜치 전략을 따른다.

PR 본문에는 다음을 포함한다.

```txt
Summary:
Changed files:
Validation:
Risk:
Related docs:
```

PR 본문 작성 기준:

- Summary: 무엇을 바꿨는지 2~4줄로 설명한다.
- Changed files: 핵심 파일만 묶어서 적는다.
- Validation: 실행한 명령과 결과를 적는다.
- Risk: 남은 리스크, 영향 범위, 확인 못 한 부분을 적는다.
- Related docs: 함께 수정한 문서 또는 수정이 필요 없는 이유를 적는다.

PR 제목은 변경 의도가 드러나게 쓰며, commit 메시지와 같은 Conventional Commits type을 사용한다. 제목과 본문 내용은 한국어로 작성해도 된다.

```txt
feat: 파일 업로드 R2 저장 흐름 추가
fix: 관리자 권한 검증 누락 수정
docs: 표준 배포 문서 보강
```

### 11.4 Merge 전 확인

merge는 배포로 이어질 수 있으므로 push보다 더 보수적으로 판단한다.

merge 전 확인:

- PR checks가 통과했는가?
- 리뷰 또는 사용자 승인이 있었는가?
- production 배포가 자동 실행되는지 확인했는가?
- DB migration, secret, binding 변경이 있으면 `DEPLOYMENT.md`와 `.agents/data/MIGRATION.md`가 갱신되었는가?
- rollback 방법을 설명할 수 있는가?

merge를 보류해야 하는 상태:

- CI 실패
- 리뷰 미완료
- 배포 환경/secret/binding 불명확
- 운영 DB 변경의 rollback 계획 없음
- 사용자 승인 없음

### 11.5 보고 형식

AI 에이전트가 commit, push, PR을 수행하거나 안내할 때는 다음 형식으로 보고한다.

```txt
Branch:
Base branch:
Commit:
Push target:
PR URL:
Checks:
Skipped checks:
Deploy trigger:
Risks:
```

아직 수행하지 않은 항목은 "아직 수행하지 않음"이라고 적는다.

금지:

- 사용자 승인 없는 `git commit`
- 사용자 승인 없는 `git push`
- 사용자 승인 없는 PR 생성/merge
- 검증 실패 상태에서 production 기준 브랜치로 push
- GitHub Actions와 Cloudflare 자동 배포가 중복 실행되는 상태로 merge
- secret 또는 `.env`가 포함된 commit 생성
- 작업 범위 밖의 파일을 함께 묶어 commit

---

## 12. 리뷰 요청 흐름

사용자가 "리뷰"를 요청하면 구현 설명보다 문제 발견을 우선한다.

리뷰 우선순위:

1. 버그
2. 보안 위험
3. 데이터 손실 가능성
4. 권한/인증 문제
5. 회귀 가능성
6. 누락된 테스트
7. 문서 불일치

문제가 없으면 "발견한 문제 없음"이라고 명확히 말하고, 남은 리스크와 검증 공백을 적는다.

---

## 13. 최종 보고 형식

작업 완료 후 사용자에게 짧게 보고한다.

포함할 내용:

- 변경한 핵심 내용
- 수정한 주요 파일
- 실행한 검증
- 실행하지 못한 검증과 이유
- 남은 리스크

간단한 작업은 한두 문단으로 끝낸다. 긴 작업은 목록으로 정리한다.
