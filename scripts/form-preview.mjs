/**
 * 엑셀 양식을 실제 화면 컴포넌트로 렌더해 **단독 HTML 파일**로 뽑는다.
 *
 * 왜 필요한가: 이 저장소의 양식 기능은 "화면이 원본과 같은가"가 전부인데, 에이전트는
 * 브라우저를 띄워 볼 수 없다. 그래서 매번 사용자에게 눈으로 확인시키게 되고, 원인이
 * *그리기*에 있는지 *앱의 데이터 흐름*에 있는지 가르지 못한 채 왕복만 늘어난다.
 *
 * 이 도구는 앱(로그인·업로드·브라우저 저장소)을 걷어내고 **파싱 → 그리기**만 실행해
 * 결과를 파일 하나로 만든다. 여기서 보이면 그리기는 정상이고, 문제는 앱 쪽이다.
 *
 * 사용:
 *   node scripts/form-preview.mjs "apps/worker/samples/양식.xlsx" [나올파일.html]
 *
 * 전제: `pnpm --filter web build` 를 한 번 돌려 `apps/web/dist` 에 CSS 가 있어야 앱과
 * 같은 모양이 나온다. 없으면 뼈대만 나온다.
 */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { globSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (...parts) => path.join(ROOT, ...parts);

const [, , xlsxPath, outPath = fromRoot('tmp-preview.html')] = process.argv;
if (!xlsxPath) {
  console.error('사용법: node scripts/form-preview.mjs <xlsx 경로> [나올파일.html]');
  process.exit(1);
}

// esbuild 는 Vite 의 의존성이라 최상위에 없다. 설치된 자리를 직접 찾는다.
const require = createRequire(import.meta.url);
const esbuildMain = globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js', {
  cwd: ROOT,
})[0];
if (!esbuildMain) {
  console.error('esbuild 를 찾지 못했습니다. pnpm install 후 다시 시도하세요.');
  process.exit(1);
}
const esbuild = require(fromRoot(esbuildMain));

// 화면 컴포넌트는 .tsx 라 Node 가 그대로 못 읽는다(JSX 변환이 필요). esbuild 로 묶는다.
const ENTRY = fromRoot('tmp-form-preview-entry.mjs');
// react 는 apps/web/node_modules 에 있어, 묶은 결과를 거기 두어야 실행 시 찾는다.
const BUNDLE = fromRoot('apps/web/tmp-form-preview-bundle.mjs');

await writeFile(
  ENTRY,
  `
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFormWorkbook } from './apps/web/src/features/forms/formParser.ts';
import FormSheetView from './apps/web/src/features/forms/FormSheetView.tsx';

const buffer = await readFile(process.argv[2]);
const sheets = await parseFormWorkbook(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
);

globalThis.__PARTS__ = sheets
  .map((sheet) => {
    const body = renderToStaticMarkup(
      createElement(FormSheetView, { sheet, editable: false, values: {}, scale: 1 }),
    );
    return '<section><h2>' + sheet.name + '</h2><p class="meta">' +
      sheet.rowCount + '행 × ' + sheet.colCount + '열 · 그림 ' + sheet.images.length +
      '개 · 도형 ' + sheet.shapes.length + '개</p>' + body + '</section>';
  })
  .join('\\n');

globalThis.__SUMMARY__ = sheets
  .map((s) => s.name + '(그림 ' + s.images.length + ', 도형 ' + s.shapes.length + ')')
  .join(' · ');
`,
  'utf8',
);

try {
  await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: BUNDLE,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server', 'exceljs', 'node:*'],
    logLevel: 'error',
  });

  process.argv[2] = path.resolve(xlsxPath);
  await import(pathToFileURL(BUNDLE).href);

  // 실제 빌드된 Tailwind CSS 를 그대로 넣는다 — 앱과 같은 모양이어야 진단이 된다.
  const cssFile = globSync('apps/web/dist/assets/index-*.css', { cwd: ROOT })[0];
  const css = cssFile ? await readFile(fromRoot(cssFile), 'utf8') : '';
  if (!css) console.warn('경고: apps/web/dist 에 CSS 가 없어 뼈대만 나옵니다.');

  await writeFile(
    outPath,
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>양식 미리보기 — ${path.basename(xlsxPath)}</title>
<style>${css}</style>
<style>
  body { margin:0; padding:24px; background:#f1f5f9; font-family:system-ui,"맑은 고딕",sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; }
  .top { color:#475569; font-size:13px; margin:0 0 20px; }
  section { background:#fff; border-radius:12px; padding:20px; margin-bottom:20px; box-shadow:0 1px 3px #0002; }
  h2 { font-size:15px; margin:0 0 2px; }
  .meta { color:#64748b; font-size:12px; margin:0 0 14px; }
</style></head><body>
<h1>양식 미리보기 (앱 없이 그리기 결과만)</h1>
<p class="top">${globalThis.__SUMMARY__}</p>
${globalThis.__PARTS__}
</body></html>`,
    'utf8',
  );

  console.log('요약:', globalThis.__SUMMARY__);
  console.log('만든 파일:', outPath);
} finally {
  await rm(ENTRY, { force: true });
  await rm(BUNDLE, { force: true });
}
