/** 스마트폼 자료 옮기기 스크립트 — 가짜 Supabase(PostgREST+Storage) 두 개 사이에서 돌려 본다. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { run } from '../scripts/smart-forms-split/copy-data.mjs';

const SRC = 'https://srcproject0000000000.supabase.co';
const DST = 'https://dstproject0000000000.supabase.co';
const IPG = 'https://yzercziwazfrjsjnmbhr.supabase.co';
const env = { SRC_SUPABASE_URL: SRC, SRC_SERVICE_ROLE_KEY: 'SRCKEY-secret', DST_SUPABASE_URL: DST, DST_SERVICE_ROLE_KEY: 'DSTKEY-secret' };
const PK = { form_taxonomy: 'id', form_taxonomy_history: 'id', form_admins: 'email', form_sites: 'id', form_documents: 'id', form_feedback: 'id' };
const bytes = (s) => new TextEncoder().encode(s);
// URL 에서 뜻이 있는 글자(#·?·%·공백)와 한글 — 세그먼트마다 인코딩하지 않으면 경로가 잘린다.
const NAMED = 'template/d50/한글 양식 #1?50%.hwp';

function sourceProject() {
  // d01 이 뒤에 오는 d90 을 가리킨다 — 한 번에 넣으면 FK 에 걸리는 순서.
  const docs = [
    { id: 'd01', kind: 'site', site_id: 's1', template_id: 'd90', file_bucket: 'form-files', file_path: 'site/d01/a.xlsx', file_size: 3, content_type: 'application/vnd.ms-excel', sheets: { a: 1 } },
    { id: 'd02', kind: 'site', site_id: 's1', template_id: 'd50', file_bucket: null, file_path: null, file_size: null, content_type: null, sheets: null },
    { id: 'd50', kind: 'template', site_id: null, template_id: null, file_bucket: 'form-files', file_path: NAMED, file_size: 2, content_type: null, sheets: null },
    { id: 'd90', kind: 'template', site_id: null, template_id: null, file_bucket: 'form-files', file_path: 'template/d90/b.pdf', file_size: 4, content_type: 'application/x-wrong', sheets: null },
  ];
  // form_documents 는 20행씩 읽으므로 페이지를 넘기게 행을 더 둔다.
  for (let i = 0; i < 23; i++) docs.push({ id: `e${String(i).padStart(2, '0')}`, kind: 'template', site_id: null, template_id: null, file_bucket: null, file_path: null, file_size: null, content_type: null, sheets: null });
  return {
    key: 'SRCKEY-secret',
    buckets: new Set(['form-files']),
    objects: new Map([
      ['form-files/site/d01/a.xlsx', bytes('abc')],
      [`form-files/${NAMED}`, bytes('hi')],
      ['form-files/template/d90/b.pdf', bytes('%PDF')],
    ]),
    // 원천 Storage 가 기억하는 형식. 행의 content_type 보다 우선이어야 한다.
    types: new Map([['form-files/template/d90/b.pdf', 'application/pdf']]),
    tables: {
      form_taxonomy: [{ id: 'tx1', division: '공무관련', groups: [] }],
      form_taxonomy_history: [{ id: 'h1', taxonomy_id: 'tx1', groups: [] }],
      form_admins: [{ email: 'boss@wm.co.kr', name: '본사' }],
      form_sites: [{ id: 's1', name: '부산장안(B1)', members: [] }],
      form_documents: docs,
      form_feedback: [{ id: 'f1', title: '안 열림', status: 'open' }],
    },
  };
}

function emptyProject() {
  return { key: 'DSTKEY-secret', buckets: new Set(), objects: new Map(), types: new Map(), tables: Object.fromEntries(Object.keys(PK).map((t) => [t, []])) };
}

/** 가짜 fetch. 쓰기 요청(GET·HEAD 가 아닌 것)을 센다. */
function fakeFetch(projects) {
  const calls = [];
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push({ method, origin: url.origin, path: url.pathname });
    const p = projects[url.origin];
    const h = init.headers ?? {};
    if (!p || h.apikey !== p.key || h.Authorization !== `Bearer ${p.key}`) return json(401, { message: 'bad key' });

    if (url.pathname.startsWith('/rest/v1/')) {
      const name = url.pathname.slice('/rest/v1/'.length);
      const rows = p.tables[name];
      if (!rows) return json(404, { code: 'PGRST205', message: 'no table' });
      const pk = PK[name];
      const fkError = (r) =>
        name === 'form_documents' &&
        ((r.template_id && !rows.some((x) => x.id === r.template_id)) || (r.site_id && !p.tables.form_sites.some((s) => s.id === r.site_id)));
      if (method === 'GET') {
        const q = url.searchParams;
        // order 가 없으면 PostgREST 처럼 순서를 보장하지 않는다(요청마다 뒤섞는다) — 페이지 중복·누락이 드러나게.
        const col = q.get('order')?.replace(/\.asc$/, '');
        const sorted = col
          ? [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])))
          : [...rows].map((r) => [Math.random(), r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
        if ((h.Prefer ?? '').includes('count=exact')) return json(200, sorted.slice(0, 1), { 'content-range': `0-0/${rows.length}` });
        const offset = Number(q.get('offset') ?? 0);
        const page = sorted.slice(offset, offset + Number(q.get('limit') ?? 1000));
        const select = q.get('select');
        return json(200, select === '*' ? page : page.map((r) => Object.fromEntries(select.split(',').map((c) => [c, r[c] ?? null]))));
      }
      if (method === 'POST') {
        const merge = (h.Prefer ?? '').includes('resolution=merge-duplicates');
        for (const r of JSON.parse(init.body)) {
          if (fkError(r)) return json(409, { code: '23503', message: 'fk' });
          const i = rows.findIndex((x) => x[pk] === r[pk]);
          if (i >= 0 && !merge) return json(409, { code: '23505', message: 'duplicate' });
          if (i >= 0) rows[i] = { ...rows[i], ...r };
          else rows.push(r);
        }
        return new Response(null, { status: 201 });
      }
      if (method === 'PATCH') {
        const id = url.searchParams.get('id').replace(/^eq\./, '');
        const patch = JSON.parse(init.body);
        if (fkError(patch)) return json(409, { code: '23503', message: 'fk' });
        for (const r of rows) if (r.id === id) Object.assign(r, patch);
        return new Response(null, { status: 204 });
      }
    }
    if (url.pathname === '/storage/v1/bucket' && method === 'POST') {
      const { id } = JSON.parse(init.body);
      if (p.buckets.has(id)) return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      p.buckets.add(id);
      return json(200, { name: id });
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const key = url.pathname.slice('/storage/v1/object/'.length).split('/').map(decodeURIComponent).join('/');
      if (!p.buckets.has(key.split('/')[0])) return json(400, { statusCode: '404', error: 'Bucket not found' });
      if (method === 'POST') {
        if (p.objects.has(key) && h['x-upsert'] !== 'true') return json(400, { statusCode: '409', error: 'Duplicate' });
        p.objects.set(key, new Uint8Array(init.body));
        p.types.set(key, h['Content-Type']);
        return json(200, { Key: key });
      }
      const obj = p.objects.get(key);
      if (!obj) return json(400, { statusCode: '404', error: 'not_found' });
      const type = p.types.get(key);
      return new Response(method === 'HEAD' ? null : obj, {
        status: 200,
        headers: { 'content-length': String(obj.byteLength), ...(type ? { 'content-type': type } : {}) },
      });
    }
    return json(404, { message: `fake: ${method} ${url.pathname}` });
  };
  return { fetch, calls, writes: () => calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD') };
}

async function go(argv, projects, envOverride = env) {
  const logs = [];
  const f = fakeFetch(projects);
  const code = await run({ env: envOverride, argv, fetch: f.fetch, log: (s) => logs.push(s) });
  return { code, logs, text: logs.join('\n'), ...f };
}

const sortRows = (t, rows) => [...rows].sort((a, b) => String(a[PK[t]]).localeCompare(String(b[PK[t]])));

test('안전장치: 같은 URL·금지된 대상·키 누락이면 요청 하나 없이 거부한다', async () => {
  const cases = [
    { ...env, DST_SUPABASE_URL: `${SRC}/` },
    { ...env, DST_SUPABASE_URL: 'https://yzercziwazfrjsjnmbhr.supabase.co' },
    { ...env, DST_SUPABASE_URL: 'https://kejieugtzuksqpgtxbwg.supabase.co' },
    { ...env, DST_SUPABASE_URL: 'https://SHDSGYZZWTTEQDBHKVNY.supabase.co' },
    { ...env, DST_SERVICE_ROLE_KEY: '' },
    { ...env, SRC_SUPABASE_URL: undefined },
  ];
  for (const e of cases) {
    const r = await go(['--execute'], { [SRC]: sourceProject(), [DST]: emptyProject() }, e);
    assert.equal(r.code, 1, JSON.stringify(e));
    assert.equal(r.calls.length, 0);
    assert.match(r.text, /거부/);
  }
});

test('dry-run 은 어디에도 쓰지 않고 행 수·파일 수·바이트를 알려 준다', async () => {
  const dst = emptyProject();
  dst.tables.form_admins.push({ email: 'old@wm.co.kr' });
  delete dst.tables.form_feedback;
  const r = await go([], { [SRC]: sourceProject(), [DST]: dst });
  assert.equal(r.code, 0, r.text);
  assert.equal(r.writes().length, 0);
  assert.ok(r.calls.length > 0);
  assert.match(r.text, /form_documents\s+27\s+0/);
  assert.match(r.text, /form_feedback\s+1\s+없음\(404\)/);
  assert.match(r.text, /객체 3개, 총 9 바이트/);
  assert.match(r.text, /경고: 대상에 이미 행이 있다/);
});

test('execute: 대상이 원천과 같아지고 자기참조 template_id 도 복원된다', async () => {
  const src = sourceProject();
  const dst = emptyProject();
  const r = await go(['--execute'], { [SRC]: src, [DST]: dst });
  assert.equal(r.code, 0, r.text);
  for (const t of Object.keys(PK)) assert.deepEqual(sortRows(t, dst.tables[t]), sortRows(t, src.tables[t]), t);
  assert.equal(dst.tables.form_documents.find((d) => d.id === 'd01').template_id, 'd90');
  assert.equal(dst.tables.form_documents.find((d) => d.id === 'd02').template_id, 'd50');
  assert.deepEqual(dst.objects, src.objects);
  // 원천 응답 형식 → 행의 content_type → octet-stream 순서
  assert.equal(dst.types.get('form-files/template/d90/b.pdf'), 'application/pdf');
  assert.equal(dst.types.get('form-files/site/d01/a.xlsx'), 'application/vnd.ms-excel');
  assert.equal(dst.types.get(`form-files/${NAMED}`), 'application/octet-stream');
  assert.ok(dst.buckets.has('form-files'));
  // 원천에는 쓰지 않는다. 키 값은 로그에 나오지 않는다.
  assert.equal(r.writes().filter((c) => c.origin === SRC).length, 0);
  assert.doesNotMatch(r.text, /SRCKEY-secret|DSTKEY-secret/);
  assert.match(r.text, /버킷 form-files\s+3\s+3\s+같음/);
});

test('두 번 돌려도 행·파일이 늘지 않는다', async () => {
  const projects = { [SRC]: sourceProject(), [DST]: emptyProject() };
  assert.equal((await go(['--execute'], projects)).code, 0);
  const again = await go(['--execute'], projects);
  assert.equal(again.code, 0, again.text);
  assert.match(again.text, /버킷 form-files 이미 있음/);
  assert.equal(projects[DST].tables.form_documents.length, 27);
  assert.equal(projects[DST].tables.form_sites.length, 1);
  assert.equal(projects[DST].objects.size, 3);
});

test('파일 크기가 행과 다르거나 원천에 파일이 없으면 실패로 끝난다', async () => {
  const src = sourceProject();
  src.tables.form_documents.find((d) => d.id === 'd01').file_size = 999;
  src.objects.delete('form-files/template/d90/b.pdf');
  const r = await go(['--execute'], { [SRC]: src, [DST]: emptyProject() });
  assert.equal(r.code, 1);
  assert.match(r.text, /파일 site\/d01\/a\.xlsx: 크기 불일치 — 행 999, 올린 것 3/);
  assert.match(r.text, /파일 template\/d90\/b\.pdf: 원천에서 못 읽음/);
});

test('verify: 대상에 파일이 빠지거나 행 수가 다르면 실패로 끝난다', async () => {
  const projects = { [SRC]: sourceProject(), [DST]: emptyProject() };
  assert.equal((await go(['--execute'], projects)).code, 0);
  assert.equal((await go(['--verify'], projects)).code, 0);
  projects[DST].objects.delete(`form-files/${NAMED}`);
  projects[DST].tables.form_feedback.length = 0;
  const r = await go(['--verify'], projects);
  assert.equal(r.code, 1);
  assert.equal(r.writes().length, 0);
  assert.ok(r.text.includes(`verify 파일 ${NAMED}: 대상에 없음`), r.text);
  assert.match(r.text, /form_feedback\s+1\s+0\s+다름/);
});

test('키에 줄바꿈 등 헤더에 못 넣는 글자가 있으면 요청 없이 거부하고 키를 찍지 않는다', async () => {
  for (const k of ['SRC_SERVICE_ROLE_KEY', 'DST_SERVICE_ROLE_KEY']) {
    const r = await go(['--execute'], { [SRC]: sourceProject(), [DST]: emptyProject() }, { ...env, [k]: 'KEYHEAD\nKEYTAIL' });
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 0);
    assert.ok(r.text.includes(`${k} 형식이 올바르지 않음`), r.text);
    assert.doesNotMatch(r.text, /KEYHEAD|KEYTAIL/);
  }
});

test('오류 문구에 키가 섞여 나와도 로그에는 *** 로 찍는다', async () => {
  const logs = [];
  const fetch = async (_url, init = {}) => {
    throw new Error(`boom ${init.headers?.apikey}`);
  };
  const code = await run({ env, argv: ['--execute'], fetch, log: (s) => logs.push(s) });
  const text = logs.join('\n');
  assert.equal(code, 1);
  assert.match(text, /boom \*\*\*/);
  assert.doesNotMatch(text, /SRCKEY-secret|DSTKEY-secret/);
});

test('응답 본문을 200자로 자르는 경계에 키가 걸려도 앞부분이 새지 않는다', async () => {
  const logs = [];
  // 키가 200번째 글자를 가로지르게 둔다 — 자른 뒤에 가리면 'SRCKE' 가 남는다.
  const fetch = async () => new Response(`${'x'.repeat(195)}${env.SRC_SERVICE_ROLE_KEY} tail`, { status: 500 });
  const code = await run({ env, argv: [], fetch, log: (s) => logs.push(s) });
  const text = logs.join('\n');
  assert.equal(code, 1);
  assert.match(text, /x\*\*\*/);
  assert.doesNotMatch(text, /SRCKE/);
});

test('IPG 대상은 --allow-ipg-target 일 때만, SSX 는 늘 거부', async () => {
  const ipgEnv = { ...env, DST_SUPABASE_URL: IPG };
  const ipg = { ...emptyProject(), key: 'DSTKEY-secret' };
  const no = await go(['--execute'], { [SRC]: sourceProject(), [IPG]: ipg }, ipgEnv);
  assert.equal(no.code, 1);
  assert.equal(no.calls.length, 0);
  assert.match(no.text, /--allow-ipg-target/);

  const yes = await go(['--execute', '--allow-ipg-target'], { [SRC]: sourceProject(), [IPG]: ipg }, ipgEnv);
  assert.equal(yes.code, 0, yes.text);
  assert.match(yes.text, /경고: 운영 IPG\(yzercziwazfrjsjnmbhr\) 에 쓴다/);
  assert.equal(ipg.tables.form_documents.length, 27);

  for (const ref of ['kejieugtzuksqpgtxbwg', 'shdsgyzzwtteqdbhkvny']) {
    const r = await go(['--execute', '--allow-ipg-target'], {}, { ...env, DST_SUPABASE_URL: `https://${ref}.supabase.co` });
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 0);
    assert.match(r.text, /SSX/);
  }
});

test('URL 변형(대문자·:443·경로·퍼센트 인코딩·전각)으로 가드를 빠져나가지 못한다', async () => {
  const asIpg = [
    'https://YZERCZIWAZFRJSJNMBHR.supabase.co:443/rest/v1/',
    'https://yzercziwazfrjsjnmbhr.supabase.co/',
    'https://yzercziwazfrjsjnmbhr%2Esupabase.co',
    'https://ｙｚｅｒｃｚｉｗａｚｆｒｊｓｊｎｍｂｈｒ.supabase.co',
  ];
  for (const u of asIpg) {
    const r = await go(['--execute'], {}, { ...env, DST_SUPABASE_URL: u });
    assert.equal(r.code, 1, u);
    assert.equal(r.calls.length, 0, u);
    assert.match(r.text, /대상이 IPG/, u);
  }
  const sameAsSrc = await go(['--execute'], {}, { ...env, DST_SUPABASE_URL: `${SRC.toUpperCase().replace('HTTPS', 'https')}:443/rest/v1/` });
  assert.equal(sameAsSrc.code, 1);
  assert.match(sameAsSrc.text, /같은 프로젝트/);
  for (const u of ['http://dstproject0000000000.supabase.co', 'https://dstproject0000000000.supabase.co:8443', 'https://dstproject0000000000.supabase.co.', 'https://user@dstproject0000000000.supabase.co', 'dst']) {
    const r = await go(['--execute'], {}, { ...env, DST_SUPABASE_URL: u });
    assert.equal(r.code, 1, u);
    assert.equal(r.calls.length, 0, u);
  }
});
