#!/usr/bin/env node
/**
 * 스마트폼 자료 옮기기 — IPG Supabase 의 form_* 표 6개와 Storage 버킷 form-files 를 새 프로젝트로 복사한다.
 *
 * 쓰는 법(Node 20+, 의존성 없음):
 *   SRC_SUPABASE_URL=... SRC_SERVICE_ROLE_KEY=... DST_SUPABASE_URL=... DST_SERVICE_ROLE_KEY=... \
 *     node scripts/smart-forms-split/copy-data.mjs              # 기본: 읽기만(dry-run)
 *     node scripts/smart-forms-split/copy-data.mjs --execute    # 대상에 쓴다(끝나면 verify 자동)
 *     node scripts/smart-forms-split/copy-data.mjs --verify     # 복사 없이 원천·대상 비교만
 *   되돌리기(새 DB → IPG 역복사)만 SRC/DST 를 바꾸고 --allow-ipg-target 을 더한다. SSX 는 어떤 경우에도 대상이 될 수 없다.
 *
 * 대상에는 docs/smart-forms-split/0001_smart_forms_init.sql 을 먼저 적용해 둔다.
 * PK 기준 upsert 라 다시 돌려도 행이 늘지 않는다. 원천에는 어떤 경우에도 쓰지 않는다.
 */
import { pathToFileURL } from 'node:url';

// 행의 file_bucket 값을 그대로 두려고 버킷 이름을 바꾸지 않는다.
const BUCKET = 'form-files';
// 운영 버킷 실측 한도(50MB). 원 마이그레이션 주석의 100MB 는 실제와 다르다.
const BUCKET_LIMIT = 52428800;
// IPG 는 --allow-ipg-target 일 때만(되돌리기) 대상이 된다. SSX(DCR) 운영·개발 DB 는 늘 거부.
const IPG_REF = 'yzercziwazfrjsjnmbhr';
const SSX_REFS = ['kejieugtzuksqpgtxbwg', 'shdsgyzzwtteqdbhkvny'];
// FK 때문에 이 순서로 넣는다. form_documents 는 sheets(jsonb) 가 커서 한 번에 조금씩.
const TABLES = [
  { name: 'form_taxonomy', pk: 'id', page: 500 },
  { name: 'form_taxonomy_history', pk: 'id', page: 500 },
  { name: 'form_admins', pk: 'email', page: 500 },
  { name: 'form_sites', pk: 'id', page: 500 },
  { name: 'form_documents', pk: 'id', page: 20 },
  { name: 'form_feedback', pk: 'id', page: 500 },
];

// WHATWG URL 이 정규화한 hostname(소문자·퍼센트 해제·전각→반각)으로 판단한다.
// 문자열로 비교하면 :443·경로·대문자·%2e 같은 변형으로 가드를 빠져나간다. 요청도 정규화한 origin 으로만 보낸다.
function projectOf(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  const m = u.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !m) return null;
  return { ref: m[1], url: `https://${u.hostname}` };
}
// 한글 파일명이 있을 수 있어 경로 세그먼트마다 인코딩한다('/' 는 그대로).
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
const table = (head, rows) =>
  [head, ...rows].map((r) => r.map((c, i) => String(c).padEnd(i === 0 ? 24 : 12)).join(' ').trimEnd());

export async function run({ env, argv, fetch, log }) {
  const mode = argv.includes('--execute') ? 'execute' : argv.includes('--verify') ? 'verify' : 'dry-run';
  const allowIpg = argv.includes('--allow-ipg-target');

  // 무엇을 찍든 키 문자열은 '***' 로 바꾼 뒤에 내보낸다(서버·fetch 오류 문구에 키가 섞여 나올 수 있다).
  const secrets = [env.SRC_SERVICE_ROLE_KEY, env.DST_SERVICE_ROLE_KEY]
    .flatMap((k) => [String(k ?? ''), String(k ?? '').trim()])
    .filter((k) => k.trim())
    .sort((a, b) => b.length - a.length);
  const redact = (s) => secrets.reduce((t, k) => t.split(k).join('***'), String(s));
  const print = log;
  log = (s) => print(redact(s));

  // 안전장치 — 하나라도 걸리면 아무 요청도 보내지 않고 끝낸다. 키 값은 절대 찍지 않는다.
  const missing = ['SRC_SUPABASE_URL', 'SRC_SERVICE_ROLE_KEY', 'DST_SUPABASE_URL', 'DST_SERVICE_ROLE_KEY'].filter(
    (k) => !String(env[k] ?? '').trim(),
  );
  if (missing.length) {
    log(`거부: 환경변수 없음 — ${missing.join(', ')}`);
    return 1;
  }
  // 헤더에 못 넣는 문자(줄바꿈 등)가 있으면 fetch 가 키 전체를 담은 오류를 던진다. 보내기 전에 막는다.
  for (const k of ['SRC_SERVICE_ROLE_KEY', 'DST_SERVICE_ROLE_KEY']) {
    if (!/^[\x21-\x7e]+$/.test(env[k].trim())) {
      log(`거부: ${k} 형식이 올바르지 않음(공백·줄바꿈·비ASCII 문자)`);
      return 1;
    }
  }
  const srcProject = projectOf(env.SRC_SUPABASE_URL);
  const dstProject = projectOf(env.DST_SUPABASE_URL);
  for (const [name, p] of [['SRC_SUPABASE_URL', srcProject], ['DST_SUPABASE_URL', dstProject]]) {
    if (!p) {
      log(`거부: ${name} 는 https://<ref>.supabase.co 꼴이어야 한다(포트·계정 정보 없이).`);
      return 1;
    }
  }
  const src = { url: srcProject.url, key: env.SRC_SERVICE_ROLE_KEY.trim() };
  const dst = { url: dstProject.url, key: env.DST_SERVICE_ROLE_KEY.trim() };
  if (srcProject.ref === dstProject.ref) {
    log('거부: 원천과 대상이 같은 프로젝트다.');
    return 1;
  }
  if (SSX_REFS.includes(dstProject.ref)) {
    log(`거부: 대상이 SSX 프로젝트(${dstProject.ref})다. 어떤 경우에도 대상이 될 수 없다.`);
    return 1;
  }
  if (dstProject.ref === IPG_REF && !allowIpg) {
    log(`거부: 대상이 IPG(${IPG_REF})다. 되돌리기(역복사)라면 --allow-ipg-target 을 더한다.`);
    return 1;
  }
  if (dstProject.ref === IPG_REF && mode === 'execute') {
    log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    log(`!! 경고: 운영 IPG(${IPG_REF}) 에 쓴다 — 되돌리기 전용.`);
    log('!! PK 가 같은 행과 같은 경로의 파일을 원천 값으로 덮어쓴다.');
    log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  }

  const auth = (side) => ({ apikey: side.key, Authorization: `Bearer ${side.key}` });
  const failures = [];
  const fail = (what, why) => failures.push(`${what}: ${why}`);
  // 먼저 가리고 자른다 — 자른 뒤에 가리면 경계에 걸린 키의 앞부분이 남는다.
  const errText = async (res) => `${res.status} ${redact(await res.text().catch(() => '')).slice(0, 200)}`;

  async function readAll(side, t, select = '*') {
    const rows = [];
    for (let offset = 0; ; offset += t.page) {
      const url = `${side.url}/rest/v1/${t.name}?select=${select}&order=${t.pk}.asc&limit=${t.page}&offset=${offset}`;
      const res = await fetch(url, { headers: auth(side) });
      if (!res.ok) throw new Error(`${t.name} 읽기 실패 ${await errText(res)}`);
      const page = await res.json();
      rows.push(...page);
      if (page.length < t.page) return rows;
    }
  }

  // 행 수만 센다(Content-Range 의 '/' 뒤). 표가 없으면 null.
  async function count(side, t) {
    const res = await fetch(`${side.url}/rest/v1/${t.name}?select=${t.pk}&limit=1`, {
      headers: { ...auth(side), Prefer: 'count=exact' },
    });
    if (!res.ok) return { n: null, why: await errText(res) };
    const n = Number((res.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(n) ? { n } : { n: null, why: 'Content-Range 없음' };
  }

  const docsTable = TABLES.find((t) => t.name === 'form_documents');
  const fileRows = async () =>
    (await readAll(src, { ...docsTable, page: 500 }, 'id,file_bucket,file_path,file_size,content_type')).filter(
      (r) => r.file_path,
    );
  const objectUrl = (side, r) => `${side.url}/storage/v1/object/${r.file_bucket || BUCKET}/${encodePath(r.file_path)}`;

  async function dryRun() {
    log(`dry-run — 읽기만 한다. 원천 ${src.url} → 대상 ${dst.url}`);
    const rows = [];
    let warn = false;
    for (const t of TABLES) {
      const s = await count(src, t);
      const d = await count(dst, t);
      if (s.n === null) fail(`원천 ${t.name}`, s.why);
      if (d.n > 0) warn = true;
      rows.push([t.name, s.n ?? '실패', d.n === null ? `없음(${d.why.split(' ')[0]})` : d.n]);
    }
    for (const line of table(['표', '원천 행', '대상 행'], rows)) log(line);
    const files = await fileRows();
    const bytes = files.reduce((sum, r) => sum + Number(r.file_size ?? 0), 0);
    log(`버킷 ${BUCKET}: 객체 ${files.length}개, 총 ${bytes} 바이트 (form_documents.file_path·file_size 기준)`);
    if (warn) log('경고: 대상에 이미 행이 있다. --execute 는 PK 가 같은 행을 원천 값으로 덮어쓴다.');
  }

  async function ensureBucket() {
    const res = await fetch(`${dst.url}/storage/v1/bucket`, {
      method: 'POST',
      headers: { ...auth(dst), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: BUCKET_LIMIT }),
    });
    if (res.ok) return log(`버킷 ${BUCKET} 만듦`);
    const text = await res.text().catch(() => '');
    // Supabase 는 이미 있으면 400 + {"statusCode":"409", ... "already exists"} 로도 답한다.
    if (res.status === 409 || /already exists|"409"/i.test(text)) return log(`버킷 ${BUCKET} 이미 있음`);
    fail(`버킷 ${BUCKET} 만들기`, `${res.status} ${redact(text).slice(0, 200)}`);
  }

  async function copyTables() {
    const templates = [];
    for (const t of TABLES) {
      let rows;
      try {
        rows = await readAll(src, t);
      } catch (err) {
        fail(t.name, err.message);
        continue;
      }
      if (t.name === 'form_documents') {
        // template_id 는 같은 표를 가리켜서, 가리키는 행이 아직 없으면 넣을 수 없다. 1차는 비우고 2차에 채운다.
        for (const r of rows) if (r.template_id) templates.push({ id: r.id, template_id: r.template_id });
        rows = rows.map((r) => ({ ...r, template_id: null }));
      }
      let done = 0;
      for (let i = 0; i < rows.length; i += t.page) {
        const chunk = rows.slice(i, i + t.page);
        const res = await fetch(`${dst.url}/rest/v1/${t.name}`, {
          method: 'POST',
          headers: { ...auth(dst), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(chunk),
        });
        if (res.ok) done += chunk.length;
        else fail(`${t.name} ${i + 1}~${i + chunk.length}행`, await errText(res));
      }
      log(`${t.name}: ${done}/${rows.length}행 넣음`);
    }
    let linked = 0;
    for (const r of templates) {
      const res = await fetch(`${dst.url}/rest/v1/form_documents?id=eq.${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        headers: { ...auth(dst), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ template_id: r.template_id }),
      });
      if (res.ok) linked++;
      else fail(`form_documents ${r.id} template_id`, await errText(res));
    }
    log(`form_documents: template_id ${linked}/${templates.length}건 채움`);
  }

  async function copyFiles() {
    const files = await fileRows();
    let done = 0;
    // ponytail: 한 파일씩 통째로 메모리에 올린다(버킷 한도 50MB). 더 큰 파일이 생기면 스트리밍으로.
    for (const r of files) {
      const what = `파일 ${r.file_path}`;
      try {
        const got = await fetch(objectUrl(src, r), { headers: auth(src) });
        if (!got.ok) {
          fail(what, `원천에서 못 읽음 ${await errText(got)}`);
          continue;
        }
        const bytes = new Uint8Array(await got.arrayBuffer());
        // 원천 Storage 가 기억하는 형식이 가장 정확하다. 없을 때만 행의 값.
        const type = got.headers.get('content-type') || r.content_type || 'application/octet-stream';
        const put = await fetch(objectUrl(dst, r), {
          method: 'POST',
          headers: { ...auth(dst), 'x-upsert': 'true', 'Content-Type': type },
          body: bytes,
        });
        if (!put.ok) {
          fail(what, `대상에 못 올림 ${await errText(put)}`);
          continue;
        }
        if (r.file_size != null && bytes.byteLength !== Number(r.file_size)) {
          fail(what, `크기 불일치 — 행 ${r.file_size}, 올린 것 ${bytes.byteLength}`);
          continue;
        }
        done++;
      } catch (err) {
        fail(what, err.message);
      }
    }
    log(`버킷 ${BUCKET}: ${done}/${files.length}개 복사`);
  }

  async function verify() {
    log('verify — 원천·대상 비교');
    const rows = [];
    for (const t of TABLES) {
      const s = await count(src, t);
      const d = await count(dst, t);
      const same = s.n !== null && s.n === d.n;
      if (!same) fail(`verify ${t.name}`, `원천 ${s.n ?? s.why} / 대상 ${d.n ?? d.why}`);
      rows.push([t.name, s.n ?? '실패', d.n ?? '실패', same ? '같음' : '다름']);
    }
    const files = await fileRows();
    let present = 0;
    for (const r of files) {
      try {
        let res = await fetch(objectUrl(dst, r), { method: 'HEAD', headers: auth(dst) });
        if (res.status === 405 || res.status === 501) res = await fetch(objectUrl(dst, r), { headers: auth(dst) });
        const len = res.headers.get('content-length');
        if (!res.ok) fail(`verify 파일 ${r.file_path}`, `대상에 없음 ${res.status}`);
        else if (len != null && r.file_size != null && Number(len) !== Number(r.file_size))
          fail(`verify 파일 ${r.file_path}`, `크기 다름 — 행 ${r.file_size}, 대상 ${len}`);
        else present++;
      } catch (err) {
        fail(`verify 파일 ${r.file_path}`, err.message);
      }
    }
    rows.push([`버킷 ${BUCKET}`, files.length, present, files.length === present ? '같음' : '다름']);
    for (const line of table(['표', '원천', '대상', '결과'], rows)) log(line);
  }

  try {
    if (mode === 'dry-run') await dryRun();
    if (mode === 'execute') {
      log(`execute — 원천 ${src.url} → 대상 ${dst.url}`);
      await ensureBucket();
      await copyTables();
      await copyFiles();
    }
    if (mode !== 'dry-run') await verify();
  } catch (err) {
    fail('중단', err.message);
  }

  if (failures.length) {
    log(`실패 ${failures.length}건:`);
    for (const f of failures) log(`  - ${f}`);
    return 1;
  }
  log('끝 — 실패 없음');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run({ env: process.env, argv: process.argv.slice(2), fetch: globalThis.fetch, log: console.log });
}
