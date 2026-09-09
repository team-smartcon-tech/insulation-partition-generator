// Woomi 코딩 에이전트 템플릿 임원 브리핑 — pptx 생성기
// 캔버스 덱(.dc.html, 1280x720 px)과 좌표를 1px = 1/96in 으로 맞춘다.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const PptxGenJS = require('pptxgenjs')

const OUT = process.argv[2]
if (!OUT) throw new Error('usage: node build-pptx.mjs <out.pptx>')

const I = (px) => px / 96 // px -> inch
const P = (px) => px * 0.75 // css px -> pt

const FONT = 'Malgun Gothic'

const C = {
  white: 'FFFFFF',
  dark: '0F172A',
  fg: '0F172A',
  muted: '64748B',
  slate700: '334155',
  slate400: '94A3B8',
  slate300: 'CBD5E1',
  slate200: 'E2E8F0',
  slateBg: 'F1F5F9',
  border: 'E2E8F0',
  primary: '4F46E5',
  primaryFg: '4338CA',
  accentBg: 'EEF2FF',
  accentBorder: 'C7D2FE',
  indigoLight: 'A5B4FC',
  indigoRing: '6366F1',
  success: '059669',
  warning: 'B45309',
  darkCard: '1A2436',
  darkLine: '2E3B4E',
}

const pres = new PptxGenJS()
pres.defineLayout({ name: 'DECK169', width: 13.3333, height: 7.5 })
pres.layout = 'DECK169'
pres.author = 'Woomi'
pres.title = 'Woomi 코딩 에이전트 템플릿 임원 브리핑'

// ---------- helpers ----------

function txt(slide, text, px, opts = {}) {
  const [x, y, w, h] = px
  slide.addText(text, {
    x: I(x),
    y: I(y),
    w: I(w),
    h: I(h),
    isTextBox: true,
    margin: 0,
    fontFace: FONT,
    valign: opts.valign ?? 'top',
    ...opts,
  })
}

function box(slide, px, opts = {}) {
  const [x, y, w, h] = px
  slide.addShape(pres.ShapeType.roundRect, {
    x: I(x),
    y: I(y),
    w: I(w),
    h: I(h),
    rectRadius: I(8),
    fill: opts.fill ? { color: opts.fill } : { color: C.white },
    line: opts.line ? { color: opts.line, width: opts.lineWidth ?? 1 } : { type: 'none' },
  })
}

function rect(slide, px, fill) {
  const [x, y, w, h] = px
  slide.addShape(pres.ShapeType.rect, {
    x: I(x),
    y: I(y),
    w: I(w),
    h: I(h),
    fill: { color: fill },
    line: { type: 'none' },
  })
}

function marker(slide, px, fill) {
  const [x, y, w, h] = px
  slide.addShape(pres.ShapeType.ellipse, {
    x: I(x),
    y: I(y),
    w: I(w),
    h: I(h),
    fill: { color: fill },
    line: { type: 'none' },
  })
}

function chip(slide, px, text) {
  const [x, y, w, h] = px
  slide.addShape(pres.ShapeType.roundRect, {
    x: I(x),
    y: I(y),
    w: I(w),
    h: I(h),
    rectRadius: I(6),
    fill: { color: C.accentBg },
    line: { type: 'none' },
  })
  txt(slide, text, [x, y + 5, w, h - 8], {
    fontSize: P(13),
    bold: true,
    color: C.primaryFg,
    align: 'center',
  })
}

function head(slide, { label, num, dark }) {
  const bx = dark ? 80 : 72
  const by = dark ? 64 : 56
  rect(slide, [bx, by, 4, 22], dark ? C.indigoRing : C.primary)
  txt(slide, label, [bx + 16, by + 1, 420, 20], {
    fontSize: P(15),
    bold: true,
    color: dark ? C.indigoLight : C.primary,
  })
  if (num) {
    txt(slide, num, [900, by + 2, 1280 - 900 - bx, 20], {
      fontSize: P(14),
      color: dark ? C.slate400 : C.muted,
      align: 'right',
    })
  }
}

function foot(slide) {
  rect(slide, [72, 648, 1136, 1], C.border)
  txt(slide, 'Woomi 코딩 에이전트 템플릿 · 표준 2.16-draft', [72, 660, 800, 20], {
    fontSize: P(14),
    color: C.muted,
  })
}

function titleBlock(slide, { title, titleH, sub, subH, y = 100 }) {
  txt(slide, title, [72, y, 1040, titleH], {
    fontSize: P(38),
    bold: true,
    color: C.fg,
    lineSpacingMultiple: 1.28,
  })
  if (sub) {
    txt(slide, sub, [72, y + titleH + 10, 960, subH], {
      fontSize: P(18),
      color: C.muted,
      lineSpacingMultiple: 1.6,
    })
  }
}

const cols3 = (gap = 16) => {
  const w = (1136 - gap * 2) / 3
  return { w, xs: [72, 72 + w + gap, 72 + (w + gap) * 2] }
}
const cols2 = (gap = 20) => {
  const w = (1136 - gap) / 2
  return { w, xs: [72, 72 + w + gap] }
}

// ---------- 01 표지 ----------
{
  const s = pres.addSlide()
  rect(s, [0, 0, 1280, 720], C.dark)
  head(s, { label: '내부 검토 자료', dark: true })

  txt(s, 'Woomi 코딩 에이전트 템플릿', [80, 194, 1120, 76], {
    fontSize: P(58),
    bold: true,
    color: C.white,
  })
  txt(s, 'AI가 우리 팀 방식대로 일하게 만드는 표준 문서 묶음', [80, 288, 1060, 34], {
    fontSize: P(23),
    color: C.slate200,
  })
  txt(
    s,
    '새 프로젝트에 이 문서를 먼저 얹어 두면, Claude Code · Codex · GitHub Copilot이 모두 같은 규칙을 읽고 같은 방향으로 일합니다.',
    [80, 334, 900, 62],
    { fontSize: P(17), color: C.slate400, lineSpacingMultiple: 1.6 },
  )

  const { w, xs } = cols3()
  const stats = [
    ['22종', 'AI가 읽는 규칙 문서'],
    ['3종', '동시 지원하는 AI 도구'],
    ['17회', '3개월간 표준 개정'],
  ]
  stats.forEach(([n, l], i) => {
    const x = xs[i] + 8
    box(s, [x, 468, w - 16, 104], { fill: C.darkCard, line: C.darkLine })
    txt(s, n, [x + 22, 486, 240, 38], { fontSize: P(34), bold: true, color: C.indigoLight })
    txt(s, l, [x + 22, 528, w - 60, 22], { fontSize: P(15), color: C.slate300 })
  })

  rect(s, [80, 624, 1120, 1], C.darkLine)
  txt(s, '표준 버전 2.16-draft · 최종 수정 2026-08-31', [80, 640, 620, 20], {
    fontSize: P(14),
    color: C.slate400,
  })
  txt(s, '[발표자 · 소속] · [발표일]', [700, 640, 500, 20], {
    fontSize: P(14),
    color: C.slate400,
    align: 'right',
  })
  s.addNotes('표지. 발표자·발표일은 대괄호 자리를 채워서 발표한다.')
}

// ---------- 02 배경 ----------
{
  const s = pres.addSlide()
  head(s, { label: '배경', num: '02 / 09' })
  titleBlock(s, {
    title: '속도는 올랐지만, 남는 것이 “아무도 손 못 대는 코드”입니다',
    titleH: 100,
    sub: 'AI에게 말로 시켜 만드는 방식(바이브 코딩)에서 가장 흔하게 반복되는 실패 경로입니다.',
    subH: 32,
  })

  box(s, [72, 254, 1136, 76], { fill: C.slateBg })
  txt(s, '“AI가 매번 다른 방식으로 코드를 짜서, 나중에 아무도 손을 못 대는 상태가 된다.”', [98, 278, 1084, 34], {
    fontSize: P(21),
    bold: true,
    color: C.fg,
  })

  const { w, xs } = cols3()
  const causes = [
    ['원인 01', 'AI는 우리 프로젝트의\n사정을 모릅니다', '아는 것은 많지만 우리 폴더 구조, 화면 규칙, 데이터 규칙은 모릅니다. 그래서 매번 자기 방식대로 만듭니다.'],
    ['원인 02', '도구가 셋이면 규칙도\n셋으로 갈라집니다', 'Claude Code, Codex, Copilot을 섞어 쓰면 지침이 도구마다 따로 관리되고, 시간이 지나며 서로 어긋납니다.'],
    ['원인 03', '위험한 작업에\n제동장치가 없습니다', '비밀키가 섞인 커밋, main 브랜치 직접 푸시, 승인 없는 배포를 사람이 매번 지켜봐야 합니다.'],
  ]
  causes.forEach(([lab, ti, de], i) => {
    const x = xs[i]
    box(s, [x, 350, w, 200], { line: C.border })
    txt(s, lab, [x + 24, 372, 200, 18], { fontSize: P(14), bold: true, color: C.primary })
    txt(s, ti, [x + 24, 398, w - 48, 58], {
      fontSize: P(19),
      bold: true,
      color: C.fg,
      lineSpacingMultiple: 1.4,
    })
    txt(s, de, [x + 24, 462, w - 48, 80], {
      fontSize: P(15),
      color: C.muted,
      lineSpacingMultiple: 1.65,
    })
  })
  foot(s)
  s.addNotes('문제 정의. 원인 셋을 순서대로 짚는다: 컨텍스트 부재, 도구 분산, 제동장치 부재.')
}

// ---------- 03 해결 방식 ----------
{
  const s = pres.addSlide()
  head(s, { label: '해결 방식', num: '03 / 09' })
  titleBlock(s, {
    title: '작업 전에 “우리 팀 방식”을 읽히면,\n열 번을 시켜도 같은 결과가 나옵니다',
    titleH: 104,
    sub: '모델을 바꾸는 것이 아니라, 모델에게 주는 정보를 바꿉니다. 이 템플릿은 AI가 작업을 시작할 때 가장 먼저 읽는 프로젝트 사용설명서입니다.',
    subH: 58,
  })

  const { w, xs } = cols2()
  const before = [
    '지시할 때마다 폴더 구조와 코드 방식이 달라집니다',
    '도구마다 지침을 따로 관리하고, 서로 어긋납니다',
    '위험한 작업도 사람이 매번 눈으로 확인합니다',
    '새로 온 사람에게 배경을 매번 다시 설명합니다',
  ]
  const after = [
    '문서에 적힌 하나의 구조를 따라갑니다',
    '세 도구가 같은 원본 문서를 읽습니다',
    '비밀키 커밋과 main 직접 푸시는 자동 차단됩니다',
    '명령 한 줄로 같은 절차가 반복됩니다',
  ]
  const cards = [
    { x: xs[0], fill: C.slateBg, line: C.border, head: '템플릿이 없을 때', headColor: C.muted, items: before, itemColor: C.slate700 },
    { x: xs[1], fill: C.accentBg, line: C.primary, head: '템플릿을 얹은 뒤', headColor: C.primaryFg, items: after, itemColor: C.fg },
  ]
  cards.forEach((c) => {
    box(s, [c.x, 292, w, 202], { fill: c.fill, line: c.line })
    txt(s, c.head, [c.x + 26, 314, 300, 22], { fontSize: P(16), bold: true, color: c.headColor })
    c.items.forEach((it, i) => {
      txt(s, it, [c.x + 26, 352 + i * 32, w - 52, 26], { fontSize: P(16), color: c.itemColor })
    })
  })

  box(s, [72, 510, 1136, 74], { line: C.border })
  txt(s, '담당자가 하는 일', [98, 532, 130, 20], { fontSize: P(14), bold: true, color: C.primary })
  txt(
    s,
    '폴더에 복사한다 → 안전장치를 한 번 켠다 → 준비된 프롬프트를 붙여넣는다.\n이후는 AI가 묻고, 담당자는 답만 고릅니다.',
    [240, 528, 946, 52],
    { fontSize: P(17), color: C.fg, lineSpacingMultiple: 1.5 },
  )
  foot(s)
  s.addNotes('해결 방식. 왼쪽/오른쪽 대비로 "정보를 먼저 준다"의 효과를 보인다.')
}

// ---------- 04 구성 요소 ----------
{
  const s = pres.addSlide()
  head(s, { label: '구성 요소', num: '04 / 09' })
  titleBlock(s, {
    title: '다섯 개 블록으로 구성됩니다',
    titleH: 52,
    sub: '문서와 명령은 AI가 쓰고, 안전장치는 사람을 보호하고, 화면 뼈대와 시작 자료는 첫날을 줄입니다.',
    subH: 32,
  })

  const blocks = [
    ['규칙 문서', 'AI가 읽는 프로젝트 사용설명서. 폴더 구조, 화면 규칙, 데이터 규칙이 적혀 있습니다.', 'AGENTS.md + 22종', 210],
    ['도구별 명령', '“새 화면 만들어줘”를 명령 한 번으로. 온보딩, 화면, 서버, 검토, 커밋, 지식 기록까지.', '명령 9개 + 스킬 2개', 214],
    ['안전장치', '비밀키가 섞인 커밋과 main 브랜치 직접 푸시를 차단합니다. 세 도구에 똑같이 걸립니다.', 'Git 훅 + 도구별 훅', 200],
    ['관리자 화면 뼈대', '바로 실행되는 화면이 이미 들어 있습니다. 로그인, 대시보드, 목록, 상세, 구성원, 설정에 로딩·빈 화면·오류·권한 없음 상태까지.', 'apps/web · 화면 6종 + 상태 화면', 300],
    ['시작 자료와 지식 위키', '복사-붙여넣기용 시작 프롬프트와, 팀이 배운 것을 쌓아 두는 위키. 다음 사람이 같은 질문을 다시 하지 않게 합니다.', 'QUICKSTART + 위키 46면', 260],
  ]

  const g3 = cols3()
  blocks.slice(0, 3).forEach(([ti, de, ch, chw], i) => {
    const x = g3.xs[i]
    box(s, [x, 210, g3.w, 184], { line: C.border })
    box(s, [x + 22, 230, 22, 22], { fill: C.accentBg })
    txt(s, String(i + 1), [x + 22, 234, 22, 16], { fontSize: P(13), bold: true, color: C.primaryFg, align: 'center' })
    txt(s, ti, [x + 52, 232, g3.w - 76, 20], { fontSize: P(17), bold: true, color: C.fg })
    txt(s, de, [x + 22, 266, g3.w - 44, 80], { fontSize: P(15), color: C.muted, lineSpacingMultiple: 1.65 })
    chip(s, [x + 22, 350, chw, 26], ch)
  })

  const g2 = cols2(16)
  blocks.slice(3).forEach(([ti, de, ch, chw], i) => {
    const x = g2.xs[i]
    box(s, [x, 406, g2.w, 170], { line: C.border })
    box(s, [x + 22, 426, 22, 22], { fill: C.accentBg })
    txt(s, String(i + 4), [x + 22, 430, 22, 16], { fontSize: P(13), bold: true, color: C.primaryFg, align: 'center' })
    txt(s, ti, [x + 52, 428, g2.w - 76, 20], { fontSize: P(17), bold: true, color: C.fg })
    txt(s, de, [x + 22, 462, g2.w - 44, 56], { fontSize: P(15), color: C.muted, lineSpacingMultiple: 1.65 })
    chip(s, [x + 22, 528, chw, 26], ch)
  })
  foot(s)
  s.addNotes('구성 요소 다섯 블록. 각 블록의 효용을 담당자 관점으로 말한다.')
}

// ---------- 05 작동 방식 ----------
{
  const s = pres.addSlide()
  head(s, { label: '작동 방식', num: '05 / 09' })
  titleBlock(s, {
    title: '도구는 셋, 규칙의 원본은 하나입니다',
    titleH: 52,
    sub: '원본 문서 한 곳을 고치면 세 도구가 같이 바뀝니다. 도구별 문서에는 그 도구에만 있는 것만 담습니다.',
    subH: 32,
  })

  box(s, [72, 226, 1136, 66], { fill: C.accentBg, line: C.primary })
  s.addText(
    [
      { text: 'AGENTS.md + .agents/ 문서 22종', options: { bold: true, color: C.fg, fontSize: P(21) } },
      { text: '     모든 AI가 가장 먼저 읽는 1차 원본', options: { color: C.primaryFg, fontSize: P(16) } },
    ],
    {
      x: I(96),
      y: I(246),
      w: I(1088),
      h: I(30),
      isTextBox: true,
      margin: 0,
      fontFace: FONT,
      align: 'center',
      valign: 'top',
    },
  )

  // 분기 커넥터
  const arrow = (x, y, h) =>
    s.addShape(pres.ShapeType.line, {
      x: I(x),
      y: I(y),
      w: 0,
      h: I(h),
      line: { color: C.slate300, width: 1.25, endArrowType: 'triangle' },
    })
  rect(s, [640, 292, 1, 14], C.slate300)
  rect(s, [256, 306, 768, 1], C.slate300)
  arrow(256, 306, 26)
  arrow(640, 306, 26)
  arrow(1024, 306, 26)

  const g = cols3()
  const tools = [
    ['Claude Code', 'CLAUDE.md', '명령 9개 · 스킬 2개 · 위험 동작 차단 훅'],
    ['Codex', 'CODEX.md', '같은 워크플로우를 프롬프트로 제공'],
    ['GitHub Copilot', 'copilot-instructions', '같은 워크플로우를 프롬프트로 제공'],
  ]
  tools.forEach(([name, doc, line], i) => {
    const x = g.xs[i]
    box(s, [x, 344, g.w, 116], { line: C.border })
    txt(s, name, [x + 20, 364, g.w - 40, 24], { fontSize: P(18), bold: true, color: C.fg })
    s.addText(
      [
        { text: '보충 규칙 ', options: { color: C.muted } },
        { text: doc, options: { color: C.fg } },
        { text: '\n' + line, options: { color: C.muted } },
      ],
      {
        x: I(x + 20),
        y: I(396),
        w: I(g.w - 40),
        h: I(52),
        isTextBox: true,
        margin: 0,
        fontFace: FONT,
        fontSize: P(15),
        lineSpacingMultiple: 1.6,
        valign: 'top',
      },
    )
  })

  box(s, [72, 480, 1136, 74], { fill: C.slateBg })
  txt(s, '운영 원칙', [96, 502, 90, 20], { fontSize: P(14), bold: true, color: C.primary })
  txt(
    s,
    '규칙이 서로 충돌하면 원본이 이깁니다. 중요한 규칙을 특정 도구의 문서에만 숨겨 두지 않습니다\n— 도구를 바꾸는 순간 사라지기 때문입니다.',
    [196, 498, 990, 54],
    { fontSize: P(17), color: C.fg, lineSpacingMultiple: 1.5 },
  )
  foot(s)
  s.addNotes('단일 원본 구조. 도구를 늘리거나 바꿀 때 규칙이 흩어지지 않는다는 점이 핵심.')
}

// ---------- 06 리스크 관리 ----------
{
  const s = pres.addSlide()
  head(s, { label: '리스크 관리', num: '06 / 09' })
  titleBlock(s, {
    title: '자동 장치는 절반만 막습니다',
    titleH: 52,
    sub: '막지 못하는 것을 숨기지 않는 것이 이 템플릿의 방침입니다. 담당자가 어디를 직접 봐야 하는지 알 수 있어야 합니다.',
    subH: 32,
  })

  const { w, xs } = cols2()
  const panels = [
    {
      x: xs[0],
      color: C.success,
      head: '자동으로 막습니다',
      items: [
        '비밀 설정 파일 커밋',
        '흔한 형태의 비밀키가 코드에 섞이는 것',
        'main에 바로 올리는 것 (검토를 거치도록)',
        '민감 파일 수정과 위험한 명령 실행 시도',
      ],
    },
    {
      x: xs[1],
      color: C.warning,
      head: '사람이 봐야 합니다',
      items: [
        '채팅창에 붙여넣은 값, 이미 이력에 남은 값',
        '정해진 형태가 아닌 비밀번호와 접속 문자열',
        '안전장치를 켜지 않은 컴퓨터에서의 작업',
        'Copilot — 차단 장치가 따로 없습니다',
      ],
    },
  ]
  panels.forEach((p) => {
    box(s, [p.x, 226, w, 228], { line: C.border })
    marker(s, [p.x + 24, 248, 18, 18], p.color)
    txt(s, p.head, [p.x + 52, 248, w - 80, 24], { fontSize: P(18), bold: true, color: p.color })
    p.items.forEach((it, i) => {
      txt(s, it, [p.x + 24, 292 + i * 36, w - 48, 30], { fontSize: P(16), color: C.fg })
    })
  })

  box(s, [72, 470, 1136, 80], { fill: C.accentBg, line: C.accentBorder })
  txt(s, '필요한 결정', [98, 492, 100, 20], { fontSize: P(14), bold: true, color: C.primaryFg })
  txt(
    s,
    '저장소에 직접 걸어 두는 보호 규칙이 세 도구 모두에 적용되는 유일한 우회 불가 장치입니다.\n담당자 개인 설정이 아니라 조직 차원의 결정입니다.',
    [206, 488, 980, 56],
    { fontSize: P(17), color: C.fg, lineSpacingMultiple: 1.5 },
  )
  foot(s)
  s.addNotes('막는 것과 못 막는 것을 나란히. 저장소 보호 규칙은 조직 결정 사항으로 남긴다.')
}

// ---------- 07 도입 절차 ----------
{
  const s = pres.addSlide()
  head(s, { label: '도입 절차', num: '07 / 09' })
  titleBlock(s, {
    title: '세 단계, 첫 세팅은 10–15분입니다',
    titleH: 52,
    sub: '담당자는 폴더를 준비하고 결정에만 답합니다. 나머지 실행은 AI가 직접 진행합니다.',
    subH: 32,
  })

  const { w, xs } = cols3()
  const steps = [
    ['01', '폴더 준비', '저장소를 ZIP으로 받아 압축을 풀고, 폴더 이름을 내 프로젝트 이름으로 바꿉니다.', '복제(clone) 대신 ZIP — 내 작업이 템플릿 저장소로 올라가는 사고를 막습니다', false],
    ['02', '안전장치 켜기', '명령 한 줄로 내 컴퓨터의 차단 장치를 켜고, GitHub 저장소에 main 보호 규칙을 한 번 걸어 둡니다.', '이 단계를 건너뛰면 앞 장의 자동 차단이 전혀 작동하지 않습니다', false],
    ['03', 'AI에게 맡기기', 'Claude Code에 /onboard 한 줄. 환경 설정, 안전장치, 프로젝트 정보 입력, 화면 한 곳 수정, 첫 작업 기록까지 AI가 진행합니다.', 'Codex · Copilot은 준비된 시작 프롬프트를 붙여넣습니다', true],
  ]
  steps.forEach(([n, ti, de, note, hl], i) => {
    const x = xs[i]
    box(s, [x, 210, w, 256], hl ? { fill: C.accentBg, line: C.primary } : { line: C.border })
    txt(s, n, [x + 26, 232, 120, 40], {
      fontSize: P(34),
      bold: true,
      color: hl ? C.primary : C.accentBorder,
    })
    txt(s, ti, [x + 26, 282, w - 52, 28], { fontSize: P(20), bold: true, color: C.fg })
    txt(s, de, [x + 26, 320, w - 52, 84], {
      fontSize: P(15),
      color: hl ? C.primaryFg : C.muted,
      lineSpacingMultiple: 1.65,
    })
    txt(s, note, [x + 26, 412, w - 52, 44], {
      fontSize: P(14),
      color: hl ? C.primaryFg : C.warning,
      lineSpacingMultiple: 1.55,
    })
  })

  const facts = [
    ['소요 시간', '프로젝트당 10–15분'],
    ['담당자 역할', 'AI가 제시한 선택지에 답하기'],
    ['사전 설치', '화면을 실행해 볼 때만 필요'],
  ]
  facts.forEach(([k, v], i) => {
    const x = xs[i]
    box(s, [x, 482, w, 62], { fill: C.slateBg })
    txt(s, k, [x + 20, 498, w - 40, 18], { fontSize: P(13), bold: true, color: C.muted })
    txt(s, v, [x + 20, 518, w - 40, 22], { fontSize: P(16), color: C.fg })
  })
  foot(s)
  s.addNotes('도입 절차. 2단계를 건너뛰면 안전장치가 작동하지 않는다는 점을 반드시 말한다.')
}

// ---------- 08 운영 현황 ----------
{
  const s = pres.addSlide()
  head(s, { label: '운영 현황', num: '08 / 09' })
  titleBlock(s, {
    title: '실제 프로젝트에서 겪은 문제를\n표준으로 되가져오며 17번 고쳤습니다',
    titleH: 104,
    sub: '한 번 쓰고 끝나는 문서가 아니라, 쓰면서 고쳐 나가는 표준입니다. 모든 변경은 버전별로 기록됩니다.',
    subH: 32,
  })

  box(s, [72, 250, 1136, 58], { fill: C.slateBg })
  txt(s, '2.0-draft', [96, 268, 100, 22], { fontSize: P(15), bold: true, color: C.muted })
  txt(s, '2026-05-28', [198, 271, 100, 18], { fontSize: P(13), color: C.muted })
  rect(s, [312, 279, 176, 1], C.slate300)
  txt(s, '개정 17회 · 약 3개월', [498, 268, 284, 22], {
    fontSize: P(15),
    bold: true,
    color: C.primary,
    align: 'center',
  })
  rect(s, [792, 279, 176, 1], C.slate300)
  txt(s, '2026-08-31', [982, 271, 100, 18], { fontSize: P(13), color: C.muted })
  txt(s, '2.16-draft', [1084, 268, 100, 22], { fontSize: P(15), bold: true, color: C.fg, align: 'right' })

  const { w, xs } = cols2(16)
  const cases = [
    [
      '2.15-draft · 2026-08-30',
      '분기한 프로젝트의 문제를 표준에 반영했습니다',
      '이 템플릿에서 갈라져 나간 프로젝트가 자기 지식 위키를 전수 점검하며 드러난 문제 둘을, 다시 표준으로 가져와 고쳤습니다. 표준이 현장에서 검증되는 경로가 실제로 작동합니다.',
    ],
    [
      '2.14-draft · 2026-08-19',
      '점검이 원본 규칙의 빠진 부분을 찾아냈습니다',
      '위키를 점검하자 정리본의 문제만 나온 것이 아니라, 규칙 원본에서 빠져 있던 항목 둘이 드러났습니다. 위키가 사본이 아니라 대조 장치로 작동했습니다.',
    ],
  ]
  cases.forEach(([lab, ti, de], i) => {
    const x = xs[i]
    box(s, [x, 324, w, 172], { line: C.border })
    txt(s, lab, [x + 24, 346, 300, 18], { fontSize: P(14), bold: true, color: C.primary })
    txt(s, ti, [x + 24, 372, w - 48, 28], { fontSize: P(19), bold: true, color: C.fg })
    txt(s, de, [x + 24, 410, w - 48, 76], { fontSize: P(15), color: C.muted, lineSpacingMultiple: 1.65 })
  })

  const g3 = cols3()
  const stats = [
    ['22', '규칙 문서'],
    ['46', '축적된 위키 페이지'],
    ['17', '기록된 표준 버전'],
  ]
  stats.forEach(([n, l], i) => {
    const x = g3.xs[i]
    box(s, [x, 512, g3.w, 56], { line: C.border })
    txt(s, n, [x + 20, 526, 60, 30], { fontSize: P(26), bold: true, color: C.primary })
    txt(s, l, [x + 86, 532, g3.w - 110, 22], { fontSize: P(15), color: C.muted })
  })
  foot(s)
  s.addNotes('운영 현황. 파생 프로젝트에서 표준으로 되돌아온 사례 둘이 이 장의 핵심 근거.')
}

// ---------- 09 정리 ----------
{
  const s = pres.addSlide()
  rect(s, [0, 0, 1280, 720], C.dark)
  head(s, { label: '정리', num: '09 / 09', dark: true })

  txt(s, '세 줄로 정리하면', [80, 132, 900, 56], { fontSize: P(40), bold: true, color: C.white })

  const points = [
    ['01', 'AI 결과물이 흔들리는 원인은 모델이 아니라 정보입니다', '프로젝트의 사정을 문서로 먼저 읽히면, 같은 지시에서 같은 결과가 나옵니다.'],
    ['02', '도구가 늘어나도 규칙의 원본은 하나로 유지됩니다', '한 곳을 고치면 Claude Code · Codex · Copilot이 같이 바뀝니다. 도구 교체 비용이 낮습니다.'],
    ['03', '안전은 자동 장치와 사람의 확인을 함께 씁니다', '막는 것과 막지 못하는 것을 함께 적어 두었습니다. 남은 절반은 조직의 결정과 습관으로 막습니다.'],
  ]
  points.forEach(([n, ti, de], i) => {
    const y = 224 + i * 98
    txt(s, n, [80, y, 44, 30], { fontSize: P(22), bold: true, color: C.indigoLight })
    txt(s, ti, [134, y - 2, 1046, 32], { fontSize: P(22), bold: true, color: C.white })
    txt(s, de, [134, y + 36, 1046, 28], { fontSize: P(17), color: C.slate300 })
  })

  box(s, [80, 532, 1120, 122], { fill: C.darkCard, line: C.darkLine })
  txt(s, '논의가 필요한 것', [106, 554, 300, 20], { fontSize: P(14), bold: true, color: C.indigoLight })
  const asks = [
    '[검토 요청 1 — 예: 신규 프로젝트 기본 적용 범위]',
    '[검토 요청 2 — 예: 저장소 보호 규칙 표준 적용]',
    '[검토 요청 3 — 예: 파일럿 팀과 일정]',
  ]
  asks.forEach((a, i) => {
    txt(s, a, [106 + i * 358, 586, 340, 54], {
      fontSize: P(16),
      color: C.slate200,
      lineSpacingMultiple: 1.5,
    })
  })
  s.addNotes('정리. 대괄호 세 자리는 실제 요청 사항으로 바꿔서 발표한다.')
}

await pres.writeFile({ fileName: OUT })
console.log('wrote', OUT)
