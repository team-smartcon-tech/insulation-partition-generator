#!/usr/bin/env node
'use strict'

// Claude Code / Codex 공용 훅 판정 로직.
//
// 판정 로직을 여기 한 곳에 둔다. 훅 정의 파일(.claude/settings.json, .codex/hooks.json)에
// 인라인 정규식을 두 벌 넣으면 JSON + 셸 이스케이프가 겹쳐 조용히 어긋난다. 실제로 그래서
// `git push`(refspec 없이 main 에서) 가 통과하고 있었다.
//
//   node scripts/agent-guard.cjs file|bash        PreToolUse. 훅 payload 를 stdin JSON 으로 받는다
//   node scripts/agent-guard.cjs stop-changelog   Stop. CHANGELOG 갱신 리마인더
//   node scripts/agent-guard.cjs commit-wiki      PostToolUse(Bash). 커밋 직후 위키 기록 리마인더
//   node scripts/agent-guard.cjs --selftest       판정 로직 자체 점검
//
// 차단은 exit code 2 + stderr 다(Claude Code 훅 규약). 그 외 실패는 통과시킨다 —
// 가드가 깨졌을 때 에이전트를 멈추게 하는 것보다 훅이 실제로 도는지 --selftest 로
// 확인하는 편이 낫다.

// ── 파일 경로 ───────────────────────────────────────────────────────────────
// 값이 들어 있는 파일만 막는다. `app/lib/secrets.ts` 처럼 secret 을 다루는 소스 코드는
// 편집 대상이지 차단 대상이 아니다(기존 규칙은 경로에 'secret' 이 있으면 전부 막았다).
function blockedFile(input) {
    const path = String(input || '').replace(/\\/g, '/')
    const base = path.split('/').pop()

    // .env.example / .env.*.example 은 .gitignore 의 `!.env.example` 과 같은 기준으로 허용한다.
    if (/^\.env($|\.)/.test(base) && !/\.example$/.test(base)) return '.env 계열 파일'
    if (/\.(pem|key|p12|pfx|jks)$/i.test(base)) return '키·인증서 파일'
    if (/^secrets?\.(json|ya?ml|toml|txt|enc)$/i.test(base)) return 'secret 값 파일'
    if (/(^|\/)secrets?\//i.test(path)) return 'secret 디렉터리 안의 파일'
    return null
}

// ── Bash 명령 ───────────────────────────────────────────────────────────────
// 문장 시작에 있는 git 호출만 본다. `grep 'git push'` 같은 인용은 잡지 않는다.
const STMT = '(?:^|\\n|&&|\\|\\||;|\\|)\\s*'
const PROTECTED = /^(?:refs\/heads\/)?(?:main|master)$/

// 플래그를 판정하기 전에 인용 문자열을 지운다. `git commit -m "fix -n bug"` 오탐 방지.
const unquote = s => s.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ')

function gitArgs(command, sub) {
    const m = command.match(new RegExp(STMT + 'git\\s+(?:-\\S+\\s+)*' + sub + '\\b([^\\n&|;]*)'))
    return m ? unquote(m[1]) : null
}

function currentBranch() {
    try {
        return require('child_process')
            .execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
            .trim()
    } catch {
        return ''
    }
}

function blockedBash(input, branch) {
    const command = String(input || '')

    const commit = gitArgs(command, 'commit')
    // commit 에서 -n 은 --no-verify 다. -nm 같은 묶음 형태도 같은 우회다.
    if (commit !== null && /(?:^|\s)(?:--no-verify|-[a-z]*n[a-z]*)(?:\s|$)/i.test(commit)) {
        return '안전 훅을 건너뛰는 커밋'
    }

    const push = gitArgs(command, 'push')
    // push 에서 -n 은 --dry-run 이다. 원격을 바꾸지 않으므로 전부 통과시킨다.
    if (push !== null && !/(?:^|\s)(?:-n|--dry-run)(?:\s|$)/.test(push)) {
        if (/(?:^|\s)--no-verify(?:\s|$)/.test(push)) return '안전 훅을 건너뛰는 푸시'
        if (/(?:^|\s)(?:--all|--mirror)(?:\s|$)/.test(push)) return '모든 ref 를 한 번에 푸시'

        // 플래그를 걷어내고 남은 토큰은 [remote, refspec...] 이다.
        const refs = push.trim().split(/\s+/).filter(t => t && !t.startsWith('-')).slice(1)
        const dst = refs.map(r => r.split(':').pop())
        if (dst.some(d => PROTECTED.test(d))) return 'main 브랜치 직접 푸시'
        // ref 를 안 적었거나 HEAD 면 현재 브랜치로 판정한다. 명시한 ref 가 main 이 아니면
        // (태그·피처 브랜치) 통과 — AGENTS.md 10장의 `git push origin v<버전>` 이 여기 걸리면 안 된다.
        if ((dst.length === 0 || dst.includes('HEAD')) && PROTECTED.test(branch)) {
            return 'main 브랜치 직접 푸시'
        }
    }

    if (new RegExp(STMT + 'git\\s+reset\\s+[^\\n&|;]*--hard').test(command)) return 'git reset --hard (사용자 변경 소실)'
    if (new RegExp(STMT + 'supabase\\s+db\\s+reset').test(command)) return 'supabase db reset (DB 초기화)'

    return null
}

// ── CHANGELOG 리마인더 (Stop 훅) ────────────────────────────────────────────
// AGENTS.md 10장이 CHANGELOG 갱신을 요구하는 대상만 본다. 무관한 임시 파일 하나에도
// 매 턴 발화하면 리마인더가 소음이 되어 정작 필요할 때 무시된다.
const CHANGELOG_SCOPE = /^(?:AGENTS|CLAUDE|CODEX|README|QUICKSTART)\.md$|^\.(?:agents|claude|codex|github|githooks)\//
const CHANGELOG_SCOPE2 = /^(?:apps|packages|scripts)\/|^(?:package\.json|pnpm-workspace\.yaml|tsconfig[^/]*\.json|\.gitignore|\.gitattributes)$/
const GENERATED = /(?:^|\/)node_modules\/|\/build\/|\.react-router\//

function needsChangelog(files) {
    const inScope = files.filter(f => !GENERATED.test(f) && (CHANGELOG_SCOPE.test(f) || CHANGELOG_SCOPE2.test(f)))
    return inScope.length > 0 && !files.includes('CHANGELOG.md')
}

// ── 위키 기록 리마인더 (커밋 직후 PostToolUse 훅) ──────────────────────────
// wiki/README.md·AGENTS.md §1: 남길 것이 생기면 에이전트가 먼저 위키에 남긴다.
// 파생 프로젝트에서 실작업 커밋 26건이 위키 갱신 0건으로 지나간 사례가 있었고, 소급 복원은 커밋
// 메시지에 남은 사실까지만 됐다("왜"는 유실) — 커밋 직후가 맥락이 살아 있어 가장 싸다.
// CHANGELOG 와 달리 코드·규칙 변경만 본다. 문서·설정 잔손질에까지 발화하면 소음이 된다.
const WIKI_SCOPE = /^(?:apps|packages|supabase)\/|^\.agents\/|^scripts\//

function needsWikiNote(files) {
    if (files.some(f => f.startsWith('wiki/'))) return false
    return files.some(f => !GENERATED.test(f) && WIKI_SCOPE.test(f))
}

// `git status --porcelain` 한 줄에서 경로만 뽑는다. 비ASCII 경로는 인용되고, rename 은 `a -> b` 다.
function porcelainPath(line) {
    const p = line.slice(3)
    const renamed = p.includes(' -> ') ? p.split(' -> ').pop() : p
    return renamed.replace(/^"|"$/g, '')
}

// ── 자체 점검 ───────────────────────────────────────────────────────────────
function selftest() {
    const assert = require('assert')
    const block = (c, br) => assert.ok(blockedBash(c, br), 'BLOCK 이어야 함: ' + c + ' @' + br)
    const pass = (c, br) => assert.strictEqual(blockedBash(c, br), null, '통과여야 함: ' + c + ' @' + br)

    // main 직접 푸시 — 기존 인라인 훅이 놓친 형태들
    block('git push', 'main')
    block('git push origin', 'main')
    block('git push -u origin HEAD', 'main')
    block('git push origin HEAD:main', 'feature/x')
    block('git push --force origin main', 'feature/x')
    block('git push origin :main', 'feature/x')
    block('git push --all', 'feature/x')
    block('pnpm build && git push', 'main')

    // 허용해야 하는 것 — 태그 푸시(AGENTS.md 10장)와 피처 브랜치
    pass('git push origin v2.7-draft', 'main')
    pass('git push origin feature/x', 'main')
    pass('git push', 'feature/x')
    pass('git push -n', 'main') // --dry-run
    pass("grep -n 'git push' README.md", 'main')

    // 훅 우회
    block('git commit --no-verify -m "x"', 'feature/x')
    block('git commit -nm "x"', 'feature/x')
    block('git push --no-verify origin feature/x', 'feature/x')
    pass('git commit -m "fix -n flag handling"', 'feature/x')
    pass('git commit -am "x"', 'feature/x')

    // 파괴적 명령
    block('git reset --hard HEAD~1', 'feature/x')
    block('supabase db reset', 'feature/x')

    // 파일 경로
    const bf = (p, want) => assert.strictEqual(!!blockedFile(p), want, p)
    bf('.env', true)
    bf('.env.production', true)
    bf('apps/web/.env.local', true)
    bf('certs/server.pem', true)
    bf('supabase/secrets.json', true)
    bf('secrets/prod.yaml', true)
    bf('.env.example', false)
    bf('.env.production.example', false)
    bf('apps/web/app/lib/secrets.ts', false) // secret 을 다루는 소스 코드는 편집 대상
    bf('apps/web/app/routes/settings.tsx', false)

    // CHANGELOG 리마인더 대상
    const nc = (files, want) => assert.strictEqual(needsChangelog(files), want, files.join(','))
    nc(['AGENTS.md'], true)
    nc(['.agents/code/TESTING.md'], true)
    nc(['apps/web/app/root.tsx'], true)
    nc(['scripts/agent-guard.cjs'], true)
    nc(['package.json'], true)
    nc(['AGENTS.md', 'CHANGELOG.md'], false) // 이미 갱신했으면 침묵
    nc(['.userdocs/메모.md'], false) // 설계 기록은 대상 아님
    nc(['apps/web/build/index.js'], false) // 빌드 산출물
    nc(['node_modules/x/index.js'], false)
    nc([], false)

    // 위키 기록 리마인더 대상
    const nw = (files, want) => assert.strictEqual(needsWikiNote(files), want, files.join(','))
    nw(['apps/web/app/root.tsx'], true)
    nw(['supabase/migrations/20260825_x.sql'], true)
    nw(['.agents/DEPLOYMENT.md'], true)
    nw(['scripts/agent-guard.cjs'], true)
    nw(['apps/web/app/root.tsx', 'wiki/log.md'], false) // 같은 커밋에 위키가 있으면 침묵
    nw(['wiki/log.md', 'wiki/index.md'], false) // 위키만 고친 커밋
    nw(['CHANGELOG.md', 'AGENTS.md'], false) // 루트 문서만 — CHANGELOG 리마인더의 몫
    nw(['apps/web/build/index.js'], false) // 빌드 산출물
    nw([], false)

    assert.strictEqual(porcelainPath('?? "\\355\\225\\234.md"'), '\\355\\225\\234.md')
    assert.strictEqual(porcelainPath('R  old.md -> new.md'), 'new.md')

    console.log('agent-guard selftest OK')
}

const mode = process.argv[2]

if (mode === '--selftest') {
    selftest()
} else if (mode === 'commit-wiki') {
    try {
        const fs = require('fs')
        const cp = require('child_process')
        const run = cmd => cp.execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

        const payload = JSON.parse(fs.readFileSync(0, 'utf8'))
        const command = String((payload.tool_input || {}).command || '')
        // 커밋 명령이 아니면 즉시 통과. 위키가 없는 저장소(템플릿 이식처)도 통과.
        if (gitArgs(command, 'commit') === null || !fs.existsSync('wiki')) process.exit(0)

        // 방금 만든 커밋인지 확인한다 — 커밋이 실패했으면 HEAD 는 옛 커밋이라 오탐이 된다.
        const age = Date.now() / 1000 - Number(run('git log -1 --format=%ct').trim())
        if (!(age >= 0 && age < 300)) process.exit(0)

        // 위키 수정이 작업트리에 남아 있으면(따로 커밋할 계획) 침묵한다.
        if (run('git status --porcelain -- wiki').trim()) process.exit(0)

        const files = run('git log -1 --name-only --format=').split('\n').filter(Boolean)
        if (needsWikiNote(files)) {
            process.stdout.write(JSON.stringify({
                decision: 'block',
                reason: '방금 커밋에 위키 기록이 없습니다. wiki/log.md 에 항목을 덧붙이고, 배운 것·정한 것이 있으면 관련 정리본도 갱신하세요(규칙은 wiki/rules/, 화면·경로는 wiki/systems/, 두 번 이상 반복된 실패는 wiki/patterns/)(규칙: wiki/CLAUDE.md). 정말 남길 것이 없는 사소한 변경이면 그렇게 판단했다고 사용자에게 한 줄 보고하고 넘어갑니다.',
            }))
        }
    } catch {
        // 저장소가 아니거나 git 이 없으면 조용히 넘어간다.
    }
} else if (mode === 'stop-changelog') {
    try {
        const out = require('child_process').execSync('git status --porcelain', { encoding: 'utf8' })
        const files = out.split('\n').filter(Boolean).map(porcelainPath)
        if (needsChangelog(files)) {
            process.stdout.write(JSON.stringify({
                systemMessage: 'REMINDER: 변경사항이 있습니다. CHANGELOG.md에 항목을 추가하고 AGENTS.md/README.md의 표준 버전·최종 수정일을 갱신하세요. (AGENTS.md 10장)',
            }))
        }
    } catch {
        // 저장소가 아니거나 git 이 없으면 조용히 넘어간다.
    }
} else {
    let why = null
    try {
        const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'))
        const toolInput = payload.tool_input || {}
        why = mode === 'file' ? blockedFile(toolInput.file_path) : blockedBash(toolInput.command, currentBranch())
    } catch {
        process.exit(0)
    }
    if (why) {
        console.error('BLOCK: ' + why + ' — 사용자 승인이 필요합니다. (AGENTS.md 6장)')
        process.exit(2)
    }
}
