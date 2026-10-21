---
type: source
원본: ../../.agents/code/NEST_CF_WORKER.md
넣은날: 2026-08-19
목적: NestJS를 Cloudflare Worker에서 돌릴 때의 설정 포인트를 위키에서 찾을 수 있게 하려고
---

# 원본 · .agents/code/NEST_CF_WORKER.md

저장소 규칙 문서다. **진짜 원본은 [../../.agents/code/NEST_CF_WORKER.md](../../.agents/code/NEST_CF_WORKER.md)에 있고, 여기서는 고치지 않는다.** (조건부 문서 — NestJS + Cloudflare Worker + Drizzle 조합에만 적용된다.)

- 무엇: `wrangler.jsonc` 필수 설정(`nodejs_compat`, transport 패키지 alias), Worker 엔트리에서 Nest 실행 패턴, `drizzle.config.ts` 기준, Drizzle 스키마 규칙, 실행 명령과 운영 순서, 금지·주의
- 정리한 노트: [NestJS 프로젝트 규칙](../rules/nestjs.md)
