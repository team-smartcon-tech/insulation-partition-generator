# NEST_CF_WORKER.md

## 1) 목적

NestJS 애플리케이션을 Cloudflare Worker 런타임에서 동작시키고,
Supabase(PostgreSQL)와 Drizzle ORM을 연동할 때의 실무 기준을 정리한다.

이 문서는 특정 리포지토리 구조 설명이 아니라, 설정 포인트와 실행 절차만 다룬다.

## 2) 최소 전제

- `wrangler` 기반 Worker 실행
- `@nestjs/common`, `@nestjs/core` 기반 NestJS 앱
- `drizzle-orm`, `drizzle-kit` 사용
- `DATABASE_URL`은 Supabase 연결 문자열 사용

## 3) Wrangler 필수 설정

`wrangler.jsonc` 기준:

```jsonc
{
  "main": "src/worker.ts",
  "compatibility_flags": ["nodejs_compat"],
  "alias": {
    "@nestjs/microservices": "./src/empty-module.ts",
    "@nestjs/microservices/microservices-module": "./src/empty-module.ts",
    "@nestjs/websockets/socket-module": "./src/empty-module.ts",
    "@nestjs/platform-socket.io": "./src/empty-module.ts",
    "@grpc/grpc-js": "./src/empty-module.ts",
    "@grpc/proto-loader": "./src/empty-module.ts",
    "kafkajs": "./src/empty-module.ts",
    "mqtt": "./src/empty-module.ts",
    "nats": "./src/empty-module.ts",
    "ioredis": "./src/empty-module.ts",
    "amqplib": "./src/empty-module.ts",
    "amqp-connection-manager": "./src/empty-module.ts"
  }
}
```

핵심:

- Worker에서 불필요하거나 호환되지 않는 Nest transport/websocket 관련 패키지를 `alias`로 빈 모듈에 매핑한다.
- 빈 모듈 파일은 아래처럼 최소 형태로 둔다.

```ts
// src/empty-module.ts
export {};
```

## 4) Worker 엔트리에서 Nest 실행 패턴

- `src/worker.ts`를 Worker 엔트리로 사용한다.
- 요청마다 `NestFactory.createApplicationContext(AppModule)`로 컨텍스트를 만들고 닫는다.
- Worker `env` 바인딩의 `DATABASE_URL`을 `process.env.DATABASE_URL`로 주입해 Drizzle 설정과 연결한다.

권장 패턴 요약:

1. `fetch(request, env)` 진입
2. `env.DATABASE_URL -> process.env.DATABASE_URL` 적용
3. AppService 호출
4. Response 반환
5. appContext close

## 5) Drizzle 설정 기준 (`drizzle.config.ts`)

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: {
      rejectUnauthorized: false,
    },
  },
  verbose: true,
  strict: true,
});
```

체크포인트:

- `schema`와 `out` 경로를 명시적으로 고정한다.
- `dialect`는 `postgresql`.
- Supabase 연결 시 SSL 옵션을 함께 설정한다.
- 실행 전 `DATABASE_URL`이 반드시 준비되어야 한다.

## 6) Drizzle 스키마 작성 규칙

`src/db/schema.ts`에서 `pgTable` 중심으로 선언한다.

```ts
import { pgTable, integer, varchar } from 'drizzle-orm/pg-core';

export const usersTable = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  age: integer().notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
});
```

권장사항:

- `notNull`, `unique`, PK/identity를 코드에서 명시한다.
- 컬럼 제약은 DB에 위임하기 전에 schema 파일에서 먼저 선언한다.
- 스키마 변경 후에는 `generate -> migrate 또는 push` 순서로 반영한다.

## 7) package.json 실행 명령 기준

Cloudflare/Nest/Drizzle 관련 핵심 스크립트:

```bash
npm run start:cf:dev
npm run start:cf:dev:remote
npm run build:cf
npm run deploy:cf
npm run db:generate
npm run db:migrate
npm run db:push
npm run db:studio
```

권장 운영 순서:

1. `npm run db:generate`
2. `npm run db:migrate` (또는 환경에 따라 `npm run db:push`)
3. `npm run start:cf:dev`
4. 검증 후 `npm run deploy:cf`

## 8) 변경 작업 시 필수 검증

- 최소: `npm run build`
- Worker 기준 동작 확인: `npm run start:cf:dev`
- 스키마 변경 포함 시: `npm run db:generate` + 마이그레이션 반영 확인

## 9) 금지/주의

- Worker 런타임에서 사용하지 않는 transport 패키지를 alias 없이 직접 로딩하지 않는다.
- `DATABASE_URL` 누락 상태로 Worker를 기동하지 않는다.
- Drizzle 스키마 변경 후 반영 명령(`generate/migrate/push`) 생략 금지.
