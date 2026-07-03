/**
 * 평면 DXF 렌더 캔버스 — Three.js (@jakkelab-aec/rw-dxf-engine-ts/renderer).
 *
 * DXF 지오메트리(sceneEntities)를 DXFImportedObject3D 로 씬에 올리고,
 * 직교(Orthographic) 카메라를 페이지의 scale/offset 상태와 동기화한다.
 * 카메라 프러스텀이 기존 toPx 변환(px = world.x*scale+offset.x, py = -world.y*scale+offset.y)과
 * 정확히 일치하므로, 위에 겹쳐지는 2D 오버레이 캔버스(체인/스냅/개구부)와 픽셀 단위로 정렬된다.
 *
 * 마우스 이벤트는 받지 않는다(pointer-events-none) — 상호작용은 오버레이 캔버스 담당.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  DXFImportedObject3D,
  type DXFSceneEntity,
} from "@jakkelab-aec/rw-dxf-engine-ts/renderer";
import type { Point2D } from "../utils/geometry";

interface PlanDxfCanvasProps {
  sceneEntities: DXFSceneEntity[] | null;
  hiddenLayers: Set<string>;
  showText: boolean;
  scale: number;
  offset: Point2D;
}

const BG_COLOR = 0x0b1220;

export default function PlanDxfCanvas({
  sceneEntities,
  hiddenLayers,
  showText,
  scale,
  offset,
}: PlanDxfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const importedRef = useRef<DXFImportedObject3D | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  // 최신 뷰 상태를 리사이즈 콜백에서도 쓰도록 ref 로 미러링
  const viewRef = useRef({ scale, offset });
  viewRef.current = { scale, offset };

  /** 카메라 프러스텀을 scale/offset 과 동기화 (toPx 역변환) */
  const syncCamera = () => {
    const cam = cameraRef.current;
    if (!cam) return;
    const { w, h } = sizeRef.current;
    const { scale: s, offset: o } = viewRef.current;
    cam.left = (0 - o.x) / s;
    cam.right = (w - o.x) / s;
    cam.top = o.y / s;
    cam.bottom = (o.y - h) / s;
    cam.updateProjectionMatrix();
  };

  const render = () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const cam = cameraRef.current;
    if (renderer && scene && cam) renderer.render(scene, cam);
  };

  /** 레이어 숨김/텍스트 표시 상태를 씬 오브젝트 visible 로 반영 */
  const applyVisibility = () => {
    const imported = importedRef.current;
    if (!imported) return;
    for (const obj of imported.selectableObjects.values()) {
      const ent = obj.userData?.entity as DXFSceneEntity | undefined;
      if (!ent) continue;
      const layerHidden = hiddenLayers.has(ent.layer || "0");
      const textHidden =
        !showText && (ent.type === "TEXT" || ent.type === "MTEXT");
      obj.visible = !layerHidden && !textHidden;
    }
  };

  // 초기화 + 리사이즈 감시
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(BG_COLOR, 1);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2D 도면 정면 뷰 — 근/원거리는 z 값이 있는 도면도 잘리지 않게 넉넉히
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1e9, 1e9);
    camera.position.set(0, 0, 10);
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
      if (importedRef.current) {
        scene.remove(importedRef.current);
        importedRef.current.dispose();
        importedRef.current = null;
      }
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // DXF 교체
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (importedRef.current) {
      scene.remove(importedRef.current);
      importedRef.current.dispose();
      importedRef.current = null;
    }
    if (sceneEntities && sceneEntities.length > 0) {
      const imported = new DXFImportedObject3D(sceneEntities, {
        name: "plan-dxf",
      });
      importedRef.current = imported;
      scene.add(imported);
      applyVisibility();
    }
    render();
  }, [sceneEntities]);

  // 레이어/텍스트 표시 토글
  useEffect(() => {
    applyVisibility();
    render();
  }, [hiddenLayers, showText]);

  // 줌/팬 동기화
  useEffect(() => {
    syncCamera();
    render();
  }, [scale, offset]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block h-full w-full pointer-events-none"
    />
  );
}
