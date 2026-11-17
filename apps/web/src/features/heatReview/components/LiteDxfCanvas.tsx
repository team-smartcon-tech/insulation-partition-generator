/**
 * 대용량 도면 렌더 캔버스 — 선분 배열 전체를 **드로우콜 한 번**(THREE.LineSegments)으로 그린다.
 *
 * 단열 MAKER 의 PlanDxfCanvas 는 엔티티마다 Three.js 객체를 만들어 선택·편집을 지원하지만,
 * 여기서는 도면이 배경일 뿐이라 객체가 필요 없다. 선 수백만 개도 버퍼 하나면 된다.
 *
 * 좌표: 도면 좌표는 수십만 mm 단위라 float32 로 그대로 넣으면 떨린다 → 도면 중심(origin)을 뺀
 * 상대 좌표를 GPU 에 올리고, 카메라도 같은 origin 기준으로 맞춘다.
 * 화면 변환은 페이지와 같다: px = x·scale + offset.x, py = −y·scale + offset.y.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { LiteDxf } from "../engine/dxfLite";
import type { Pt } from "../types";

const BG_COLOR = 0x0b1220;
/** 휠이 멈춘 뒤 실제 렌더까지 기다리는 시간(ms) */
const RENDER_SETTLE_MS = 90;

export default function LiteDxfCanvas({
  dxf,
  scale,
  offset,
}: {
  dxf: LiteDxf | null;
  scale: number;
  offset: Pt;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const linesRef = useRef<THREE.LineSegments | null>(null);
  const originRef = useRef<Pt>({ x: 0, y: 0 });
  const sizeRef = useRef({ w: 1, h: 1 });
  const renderedViewRef = useRef<{ scale: number; offset: Pt } | null>(null);
  const settleRef = useRef(0);
  const viewRef = useRef({ scale, offset });
  viewRef.current = { scale, offset };

  const syncCamera = () => {
    const cam = cameraRef.current;
    if (!cam) return;
    const { w, h } = sizeRef.current;
    const { scale: s, offset: o } = viewRef.current;
    const og = originRef.current;
    cam.left = (0 - o.x) / s - og.x;
    cam.right = (w - o.x) / s - og.x;
    cam.top = o.y / s - og.y;
    cam.bottom = (o.y - h) / s - og.y;
    cam.updateProjectionMatrix();
  };

  const render = () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const cam = cameraRef.current;
    if (renderer && scene && cam) renderer.render(scene, cam);
  };

  const disposeLines = () => {
    const lines = linesRef.current;
    if (!lines) return;
    sceneRef.current?.remove(lines);
    lines.geometry.dispose();
    (lines.material as THREE.Material).dispose();
    linesRef.current = null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(BG_COLOR, 1);
    rendererRef.current = renderer;
    sceneRef.current = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    camera.position.set(0, 0, 5);
    cameraRef.current = camera;

    const container = canvas.parentElement;
    const applySize = () => {
      const w = Math.max(1, container?.clientWidth ?? 1);
      const h = Math.max(1, container?.clientHeight ?? 1);
      sizeRef.current = { w, h };
      renderer.setSize(w, h, false);
      syncCamera();
      render();
    };
    applySize();
    const ro = new ResizeObserver(applySize);
    if (container) ro.observe(container);
    return () => {
      ro.disconnect();
      disposeLines();
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // 도면 교체
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    disposeLines();
    if (dxf && dxf.stats.segments > 0) {
      const n = dxf.stats.segments;
      const ox = (dxf.fit.minX + dxf.fit.maxX) / 2;
      const oy = (dxf.fit.minY + dxf.fit.maxY) / 2;
      originRef.current = { x: ox, y: oy };
      const pos = new Float32Array(n * 4);
      const col = new Uint8Array(n * 6);
      const { segs, colors } = dxf;
      for (let i = 0; i < n; i++) {
        const a = i * 4;
        pos[a] = segs[a] - ox;
        pos[a + 1] = segs[a + 1] - oy;
        pos[a + 2] = segs[a + 2] - ox;
        pos[a + 3] = segs[a + 3] - oy;
        const c = i * 3;
        const d = i * 6;
        col[d] = col[d + 3] = colors[c];
        col[d + 1] = col[d + 4] = colors[c + 1];
        col[d + 2] = col[d + 5] = colors[c + 2];
      }
      const geo = new THREE.BufferGeometry();
      // 위치는 (x,y) 두 성분만 올린다 — z 는 셰이더에서 0 으로 채워진다
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 2));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false });
      const lines = new THREE.LineSegments(geo, mat);
      // 2성분 위치로는 Three.js 가 경계 구를 못 구한다(NaN 경고) → 도면 범위로 직접 준다.
      // 화면 밖 선은 어차피 GPU 가 잘라내므로 컬링은 끈다
      const radius = Math.hypot(dxf.bounds.maxX - dxf.bounds.minX, dxf.bounds.maxY - dxf.bounds.minY) + 1;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
      lines.frustumCulled = false;
      linesRef.current = lines;
      scene.add(lines);
    }
    renderedViewRef.current = { scale: viewRef.current.scale, offset: viewRef.current.offset };
    syncCamera();
    render();
  }, [dxf]);

  // 줌/팬 — 움직이는 동안은 마지막 렌더를 CSS 로 변환해 즉시 따라가고, 멈추면 한 번 진짜로 그린다
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = renderedViewRef.current;
    if (base) {
      const k = scale / base.scale;
      const tx = offset.x - base.offset.x * k;
      const ty = offset.y - base.offset.y * k;
      canvas.style.transformOrigin = "0 0";
      canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    }
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = 0;
      canvas.style.transform = "";
      renderedViewRef.current = { scale, offset };
      syncCamera();
      render();
    }, RENDER_SETTLE_MS);
    return () => {
      if (settleRef.current) clearTimeout(settleRef.current);
    };
  }, [scale, offset]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" />;
}
