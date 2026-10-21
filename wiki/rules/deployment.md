---
type: rule
updated: 2026-08-19
tags: [area/배포]
---

# 배포

배포 환경·secret·Cloudflare/Wrangler 운영 규칙. "배포는 코드 변경보다 위험하다. 에이전트는 사용자 승인 없이 자동 배포하지 않는다."

## 환경 분리

모든 프로젝트는 최소 세 환경(local / dev·staging / production)을 구분하고, Worker명·DB URL·R2·KV·Queue·Service Binding·secret을 환경별로 분리한다.

Wrangler의 `env.dev`/`env.staging`은 top-level 설정을 **자동 상속하지 않는다** — vars·kv_namespaces·r2_buckets·services 등을 환경별로 다시 선언한다. dev/staging이 production 리소스를 바라보게 두지 않는다.

## Worker 구성

`wrangler.jsonc` 기준으로 배포한다. 규모·도메인 수에 따라 단일 Worker 통합 또는 여러 Worker 분리를 선택하고, Worker 간 내부 호출은 외부 URL `fetch`보다 Service Binding을 우선한다 — [계층 아키텍처](layered-architecture.md).

R2는 production/dev bucket을 분리하고, private 파일은 인증 없이 signed URL을 발급하지 않는다. 경로는 `{feature}/{ownerId or siteId}/{uuid}.{ext}` 우선.

## 배포 전 확인

`git status`/`git fetch`/`git status -sb` → `pnpm lint/typecheck/test/build` → dry-run(`pnpm --filter <worker-package> run deploy:dry`). 미커밋·untracked·ahead/behind·검증 실패·dry-run 실패·production secret 누락·dev가 prod 리소스 참조·문서와 `package.json` 불일치면 배포를 보류한다.

**이 스캐폴드에는 `lint`와 `deploy:dry`가 없다** — 실제로 돌리는 것은 `typecheck`·`test`·`build`뿐이고, 없는 명령을 만들어 채우지 않는다. 건너뛴 검증은 배포 보고에 명시한다 — [테스트와 검증](testing.md), [기술 스택](stack.md).

배포 명령 컨벤션: `pnpm deploy`(production) / `deploy:dry` / `deploy:dev` / `deploy:dev:dry`. 명령 이름은 `package.json`과 `README.md`에서 일치해야 한다.

## Secret

secret 하드코딩, `.env` 실제 값 커밋, 프론트엔드에 service role key 노출, production secret의 dev/staging 재사용 금지. Worker secret은 Cloudflare Worker Secrets(`wrangler secret put ...`, `--env dev` 분리)에 저장한다 — [절대 금지·필수 규칙](non-negotiable-rules.md).

## CI/CD

기본값은 GitHub Actions(`main → production`). Cloudflare Git Integration/Workers Builds는 개인·프로토타입·소규모에 한해 예외 허용하되, 예외라도 PR 리뷰·검증·환경별 secret 분리·production 승인·문서화는 생략할 수 없다. GitHub Actions와 Cloudflare 자동 배포를 동시 활성해 중복 배포되는 상태로 merge하지 않는다.

## Rollback

rollback도 승인 없이 실행하지 않는다 — 영향 범위·되돌릴 대상을 보고한 뒤 승인받는다. DB가 얽힌 rollback은 [마이그레이션](migration.md)의 rollback 계획을 먼저 확인한다(코드 rollback만으로 복구가 안 될 수 있다).

## 함께 보기

- [절대 금지·필수 규칙](non-negotiable-rules.md)
- [작업 흐름](workflow.md)
- [테스트와 검증](testing.md)
- [기술 스택](stack.md)
- [마이그레이션](migration.md)
- [도구 사용 기준](tooling.md)
- [진입 규칙](agents-entry.md)

## 출처

- [원본 · .agents/DEPLOYMENT.md](../sources/deployment.md)
