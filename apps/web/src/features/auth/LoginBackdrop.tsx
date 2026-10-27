/**
 * 로그인 배경 — "도면 위에 골조가 올라간다".
 *
 * 홈 배너와 같은 딥블루 바탕 위에
 *  1) 천천히 흐르는 도면 격자(가는 선 + 5칸마다 굵은 선)
 *  2) CAD 커서처럼 화면을 가로지르는 헤어라인 두 줄(세로·가로가 서로 다른 주기로 오간다)
 *  3) 등각 와이어프레임 골조 세 동 + 타워크레인이 선 단위로 그려지고(한 번만), 그 뒤로는
 *     트롤리가 지브를 오가고 레벨 스캔선이 아래에서 위로 쓸고 지나간다
 *  4) 떠다니는 광원 두 개
 * 를 겹친다. 선 데이터는 `loginScene.ts`(순수 계산) 가 만든다.
 *
 * 성능: 전부 SVG + CSS 키프레임이라 JS 가 매 프레임 돌지 않는다. `prefers-reduced-motion` 이면
 * 그리기·이동 애니메이션을 전부 끄고 완성된 그림만 보여 준다(`index.css` 의 `.ambient-anim`·`.draft-stroke`).
 * 장면은 헤드라인 열과 로그인 카드 사이 빈 틈에 탑이 서도록 `--scene-w` 로 자리를 잡는다.
 */
import { CRANE, SCENE, SCENE_H, SCENE_W } from "./loginScene";

const STROKE = {
  main: { color: "rgba(176,226,255,0.92)", width: 1.5 },
  sub: { color: "rgba(176,226,255,0.55)", width: 1 },
  dim: { color: "rgba(176,226,255,0.32)", width: 0.8 },
} as const;

export default function LoginBackdrop() {
  const { trolley } = CRANE;
  const scanTravel = SCENE.scanBottom - SCENE.scanTop;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* 바탕 그라데이션 — 홈 배너와 동일 */}
      <div className="absolute inset-0 bg-[linear-gradient(105deg,#00224a_0%,#0a5aa8_38%,#1478d6_62%,#043a74_100%)]" />
      {/* 자사 현장 사진(`public/login-bg.jpg`) 이 있으면 어둡게 깔린다 — 없으면 브라우저가 조용히 무시 */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40"
        style={{ backgroundImage: "url(/login-bg.jpg)", filter: "brightness(0.5) saturate(0.5)" }}
      />

      {/* 도면 격자 — 가는 선 위에 5칸마다 굵은 선. 둘 다 같은 방향으로 아주 천천히 흐른다 */}
      <div
        className="ambient-anim absolute inset-[-80px] opacity-[0.13]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "36px 36px",
          animation: "gridDrift 46s linear infinite",
          maskImage: "radial-gradient(120% 130% at 72% 10%, #000 12%, transparent 74%)",
          WebkitMaskImage: "radial-gradient(120% 130% at 72% 10%, #000 12%, transparent 74%)",
        }}
      />
      <div
        className="ambient-anim absolute inset-[-80px] opacity-[0.1]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1.5px, transparent 1.5px), linear-gradient(to bottom, #fff 1.5px, transparent 1.5px)",
          backgroundSize: "180px 180px",
          animation: "gridDrift 230s linear infinite",
          maskImage: "radial-gradient(120% 130% at 72% 10%, #000 12%, transparent 74%)",
          WebkitMaskImage: "radial-gradient(120% 130% at 72% 10%, #000 12%, transparent 74%)",
        }}
      />

      {/* 광원 둘 — 은은하게 떠다닌다 */}
      <div
        className="ambient-anim absolute -right-24 -top-40 h-[520px] w-[640px] rounded-full blur-[90px]"
        style={{
          background: "radial-gradient(circle, #4fc3ff 0%, transparent 70%)",
          opacity: 0.3,
          animation: "ambientFloatA 19s ease-in-out infinite",
        }}
      />
      <div
        className="ambient-anim absolute -bottom-40 left-[8%] h-[420px] w-[640px] rounded-full blur-[90px]"
        style={{
          background: "radial-gradient(ellipse, #0d2f66 0%, transparent 70%)",
          opacity: 0.6,
          animation: "ambientFloatB 23s ease-in-out infinite 1s",
        }}
      />

      {/* CAD 커서 헤어라인 — 세로·가로가 각자 다른 주기로 오가 교차점이 느리게 떠돈다 */}
      <div
        className="ambient-anim absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-[#9fdcff]/40 to-transparent"
        style={{ animation: "hairlineX 38s ease-in-out infinite" }}
      />
      <div
        className="ambient-anim absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#9fdcff]/30 to-transparent"
        style={{ animation: "hairlineY 31s ease-in-out infinite 4s" }}
      />

      {/* 와이어프레임 골조 장면 */}
      <svg
        viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
        className="absolute bottom-[-14px] w-[var(--scene-w)] opacity-[0.78] max-lg:left-1/2 max-lg:w-[min(900px,150vw)] max-lg:-translate-x-1/2 max-lg:opacity-40"
        style={
          {
            // 탑(viewBox 가로 47.5% 지점)이 헤드라인과 카드 사이 틈(뷰포트 58%)에 서도록 왼쪽을 맞춘다
            "--scene-w": "clamp(620px, 52vw, 1000px)",
            left: "calc(58vw - 0.475 * var(--scene-w))",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          } as React.CSSProperties
        }
      >
        <defs>
          <linearGradient id="login-scan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#bfe7ff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#bfe7ff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#bfe7ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="login-scan-x" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#bfe7ff" stopOpacity="0" />
            <stop offset="0.2" stopColor="#bfe7ff" stopOpacity="1" />
            <stop offset="0.8" stopColor="#bfe7ff" stopOpacity="1" />
            <stop offset="1" stopColor="#bfe7ff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 선 하나하나가 제 지연 시각에 그어진다 — pathLength=1 이라 길이와 무관하게 dashoffset 1→0 */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {SCENE.strokes.map((s, i) => (
            <path
              key={i}
              d={s.d}
              pathLength={1}
              stroke={STROKE[s.kind].color}
              strokeWidth={STROKE[s.kind].width}
              className="draft-stroke"
              style={{ animationDelay: `${s.delay}s` }}
            />
          ))}
        </g>

        {/* 치수 숫자 — 치수선이 그어진 뒤 떠오른다 */}
        {SCENE.labels.map((l) => (
          <text
            key={l.text}
            x={l.x}
            y={l.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9.5}
            letterSpacing="0.04em"
            fill="rgba(200,235,255,0.75)"
            transform={l.rotate ? `rotate(${l.rotate} ${l.x} ${l.y})` : undefined}
            className="draft-fade"
            style={{ animationDelay: `${l.delay}s` }}
          >
            {l.text}
          </text>
        ))}

        {/* 트롤리 + 후크 — 지브를 따라 오간다 */}
        <g className="draft-fade" style={{ animationDelay: `${trolley.appear}s` }}>
          <g
            className="ambient-anim"
            style={
              {
                transform: `translate(${trolley.x}px, ${trolley.y}px)`,
                "--trolley-x": `${trolley.x}px`,
                "--trolley-y": `${trolley.y}px`,
                "--tx": `${trolley.dx}px`,
                "--ty": `${trolley.dy}px`,
                animation: "trolleyRun 17s ease-in-out infinite 1.5s",
              } as React.CSSProperties
            }
          >
            <rect x={-4} y={-3.5} width={8} height={5} rx={1} fill="rgba(200,235,255,0.95)" />
            <line x1={0} y1={1.5} x2={0} y2={trolley.hookDrop} stroke="rgba(176,226,255,0.55)" strokeWidth={0.8} />
            <path
              d={`M-3.5 ${trolley.hookDrop} h7 M0 ${trolley.hookDrop} v4 a2.4 2.4 0 1 1 -3.2 2.2`}
              fill="none"
              stroke="rgba(200,235,255,0.95)"
              strokeWidth={1.1}
              strokeLinecap="round"
            />
          </g>
        </g>

        {/* 레벨 스캔선 — 지면에서 크레인 탑까지 쓸고 올라간다 */}
        <g
          className="ambient-anim"
          style={
            {
              transform: `translateY(${SCENE.scanBottom}px)`,
              "--scan-from": `${SCENE.scanBottom}px`,
              "--scan": `${-scanTravel}px`,
              // both: 지연 동안 0% 상태(투명)로 머물러 바닥에 정지선이 보이지 않는다
              animation: "draftScan 9s cubic-bezier(.45,0,.3,1) infinite 5.5s both",
            } as React.CSSProperties
          }
        >
          <rect x={120} y={-14} width={SCENE_W - 260} height={28} fill="url(#login-scan)" opacity={0.2} />
          <rect x={120} y={-0.5} width={SCENE_W - 260} height={1} fill="url(#login-scan-x)" opacity={0.6} />
        </g>
      </svg>

      {/* 상단 가는 빛줄 */}
      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
    </div>
  );
}
