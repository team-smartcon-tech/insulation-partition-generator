# 단열재 나누기도 생성기 (insulation-partition-generator)

DXF 도면에서 외벽을 트레이싱해 **세대 단열재 나누기도**(입면 전개 + 단열재 보드 분할)를 만들고,
동·타입·세대수 매트릭스로 물량 산출서를 뽑아 DXF/SVG/CSV/XLSX/ZIP로 내보내는 웹 앱입니다.

SSX(`smart-schedule-X`)의 본사 "세대 단열재 나누기도" 기능을 **동작 그대로** 독립 저장소로 떼어낸 것으로,
독립 Cloudflare Worker + 독립 Supabase 프로젝트에서 운영합니다. 원본 SSX는 읽기 전용 참조입니다.

- **라이브**: https://insulation-partition-generator.jogh.workers.dev
- **스택**: Vite + React 19 + wouter + TypeScript · Hono + Cloudflare Worker · Supabase · Tailwind v4 + shadcn/ui
- **저장소**: `team-smartcon-tech/insulation-partition-generator` (기본 브랜치 `main`)

---

## 기능

- DXF 업로드 → 외벽 트레이싱(다중 체인) → 입면 전개
- 세그먼트별 단열 스펙(직접/간접외기 1P·2P 두께), 나누기도(보드 분할·조인트·번호)
- 동·타입·세대수 매트릭스 기반 물량 산출서
- DXF(통합/분할)·SVG·CSV·XLSX·ZIP 내보내기
- 프로젝트/리비전(REV) 저장·불러오기 (Supabase DB + Storage)

---

## 개발

```bash
# 사전: Node 20+, pnpm 10.x
pnpm install                 # 워크스페이스 전체

pnpm --filter web dev        # 화면 개발 서버 → http://localhost:5173 (/api 는 로컬 worker(8787)로 프록시)
pnpm --filter worker dev     # 저장/불러오기 Worker → http://127.0.0.1:8787
pnpm --filter web build      # 프로덕션 빌드(타입체크 포함)
pnpm -r typecheck            # 전체 타입 검사

# /api 프록시 타깃 변경(예: 배포된 Worker 로):  IPG_API_TARGET=<url> pnpm --filter web dev
```

- 로컬에서 Supabase 실호출까지 보려면 `apps/worker/.dev.vars` 에 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY` 를 넣습니다(커밋 금지).

---

## 구조 (pnpm 모노레포)

```txt
apps/
  web/                        # 화면 (Vite + React 19 + wouter + Tailwind v4)
    src/features/elevation/
      ElevationGeneratorPage.tsx  # 메인 화면
      api.ts / hooks.ts           # 저장/불러오기 API 클라이언트 + react-query 훅
      types.ts                    # @ipg/shared 재수출
      utils/*.ts                  # 계산·도면 로직(geometry/insulation/exporter/…)
      components/OutputPanel.tsx
  worker/                     # 저장/불러오기 + SPA 서빙 (Hono + Cloudflare Worker)
    src/index.ts              # /api/elevation-projects* + Supabase REST/Storage 헬퍼
    wrangler.jsonc            # account_id + assets(SPA fallback, run_worker_first)
packages/shared/src/index.ts  # web·worker 공용 타입(ElevState/ElevSummary/DbElev*)
supabase/migrations/          # 20260702000001_elev_projects.sql (신규 DB 적용 완료)
docs/                         # 핸드오프 / 이관계획
```

---

## 데이터 / 인프라

- **Supabase 프로젝트**: `yzercziwazfrjsjnmbhr` (전용 — SSX DB 아님)
  - 테이블: `public.elev_projects`, `public.elev_revisions` (RLS service_role 전용)
  - Storage 버킷: `elev-dxf` (private, 경로 `elevation/{projectId}/{revId}.dxf`)
- **Cloudflare 계정**: Smarttech(`2b025f536a98444871b3306efbfd6b2a`) — SSX와 동일 팀 계정
- **Worker 시크릿**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Cloudflare Secrets, 커밋 금지)
- **접근 제어**: 현재 없음(사내 도구). 도입 시 `apps/worker/src/index.ts` 라우트 앞단 미들웨어로 추가.

라우팅: `/api/*`·`/health` 는 Worker, 그 외는 정적 자산(SPA fallback → index.html).

---

## 배포

정식 경로는 **GitHub 연결 Cloudflare Workers Builds**(main 머지 시 자동 배포)입니다.

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Root directory | `apps/worker` |
| Build command | `pnpm --filter web build` |
| Deploy command | `npx wrangler deploy` |

- 로컬 부트스트랩 배포(최초 Worker 생성/시크릿 주입용): `cd apps/worker && pnpm --filter web build && npx wrangler deploy` (Smarttech 계정, `wrangler login` OAuth). 셸에 무효 `CLOUDFLARE_API_TOKEN` 이 있으면 `unset` 후 진행.

---

## 브랜치 전략 / 안전장치

- `feature/{닉네임}` → PR → `main` → (승격) → `deploy`. **`main` 직접 push 금지.**
- `pnpm install` 시 `prepare` 스크립트가 `core.hooksPath=.githooks` 를 설정 → `.env` 커밋 차단 + `main` 직접 push 차단 훅 자동 활성화.
- 비밀값은 Cloudflare Secrets 로만 관리(코드·문서·`.env` 커밋 금지). service_role 키 프론트 노출 금지.
- 커밋/푸시/배포/운영 DB 변경은 사용자 승인 후에만.

---

## 문서

- `docs/2026-07-02-단열재나누기도-핸드오프.md` — 현재 상태 / 실행법 / 남은 일 / 정한 것
- `docs/2026-07-02-단열재나누기도-이관계획.md` — 이관 지도·원본 파일 매핑·단계 계획
- `AGENTS.md` · `.agents/*` — AI 에이전트 작업 규칙(이 저장소는 Vite+wouter Project Override, `.agents/STACK.md` 참조)
