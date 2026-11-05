/**
 * 골조 매스 3D — 동을 층 블록으로 쌓아 타설 완료층·진행층·미시공층을 보여 주고, 타임머신으로 날짜순 재생한다.
 *
 * smart-schedule-X `client/src/components/schedule/FrameMass3DView.tsx`(f3029505, 2026-10-27) 이식본.
 * 바꾼 것: SSX 의 평면도 폴리곤 API(scheduleGetFramePlanOverlay)가 이 앱에 없어 오버레이는 늘 비어 있고
 * 동은 기본 배치(buildFallbackSlots)로 놓인다. 폴리곤 렌더 경로는 나중에 도면 배치를 붙일 때를 위해 남겨 둔다.
 * 높이는 공정표 탭 안에 들어가도록 맞췄다. 데이터 변환은 Frame3DPanel.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ArrowLeft,
  Building2,
  Clapperboard,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/** 평면도 동 폴리곤 (SSX FramePlanOverlay 와 같은 모양). 이 앱에는 아직 저장처가 없다 */
interface FramePlanOverlay {
  meters_per_unit: number;
  buildings: {
    building_id: string;
    name: string;
    polygon: [number, number][];
    floor_height_m: number;
  }[];
}

export interface FrameMassBuilding {
  id: string;
  name: string;
  above_floors: number;
  below_floors: number;
  ph_floors?: number;
}

export interface FrameMassRow {
  building_id: string;
  building_name: string;
  floor: number;
  actual_start?: string;
  actual_finish?: string;
}

interface FrameMass3DViewProps {
  siteName: string;
  siteId?: string;
  buildings: FrameMassBuilding[];
  rows: FrameMassRow[];
  progressRate: number;
  onBack: () => void;
  /** 위젯 임베드 모드: 우측 상단 컨트롤(골조표/회전/리셋) 숨김 */
  embedded?: boolean;
}

interface BuildingStat {
  building: FrameMassBuilding;
  totalFloors: number;
  completedFloors: number;
  currentFloor: number;
  rate: number;
  floorMap: Map<number, number>;
}

const TOWER_LAYOUT: Array<{
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
}> = [
  { x: -13.5, z: -4.5, rot: -0.2, w: 3.4, d: 6.4 },
  { x: -5.6, z: 2.5, rot: 0.12, w: 4.8, d: 5.4 },
  { x: 3.8, z: -2.3, rot: -0.36, w: 4.4, d: 6.6 },
  { x: 11.5, z: 2.6, rot: 0.2, w: 3.7, d: 6.0 },
  { x: 9.4, z: -8.8, rot: -0.08, w: 4.6, d: 4.8 },
  { x: -11.5, z: 8.2, rot: 0.35, w: 3.5, d: 5.5 },
  { x: 0, z: 10.5, rot: -0.15, w: 4.1, d: 5.4 },
];

export interface FallbackSlot {
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
}

/** 격자 한 칸 크기 — 가장 큰 동이 들어가고도 통로가 남게 잡는다. */
const FALLBACK_CELL_W = Math.max(...TOWER_LAYOUT.map(t => t.w)) + 2.4;
const FALLBACK_CELL_D = Math.max(...TOWER_LAYOUT.map(t => t.d)) + 2.4;
/** 도면 영역과 격자 사이에 띄울 간격. */
const FALLBACK_PLAN_GAP = 6.0;

/**
 * 도면 폴리곤이 없는 동을 놓을 자리를 만든다.
 *
 * 왜 필요한가: 종전에는 `TOWER_LAYOUT[idx % 7]` 이라 **8번째 동부터 1번째 동
 * 자리로 되돌아갔다.** 층수까지 같으면 완전히 포개져, 22개 동 현장이 7개 동만
 * 있는 것처럼 보였다(세종2차 임대 신고 건).
 *
 * - 동이 7개 이하면 기존 `TOWER_LAYOUT` 을 그대로 쓴다. 겹칠 일이 없고,
 *   손으로 잡아 둔 배치감(회전·크기 변주)이 격자보다 자연스럽다.
 * - 8개 이상이면 동 수에 맞춰 격자를 만든다. 형상(회전·폭·깊이)은
 *   `TOWER_LAYOUT` 을 팔레트로 돌려 써서 한 덩어리로 보이지 않게 한다.
 *
 * `occupied` 는 이미 도면 폴리곤이 차지한 영역(세계 좌표)이다. 주면 격자를
 * 그 **오른쪽에 이어 붙인다** — 도면은 원점 중앙 정렬이라, 안 밀면 폴백 동이
 * 도면 한가운데에 박힌다. 도면 트레이싱은 동별 수작업이라 "일부만 등록된"
 * 중간 상태가 정상적으로 생긴다.
 */
export function buildFallbackSlots(
  count: number,
  occupied: { minX: number; maxX: number; minZ: number; maxZ: number } | null
): FallbackSlot[] {
  if (count <= 0) return [];

  const slots: FallbackSlot[] = [];
  if (count <= TOWER_LAYOUT.length) {
    for (let i = 0; i < count; i++) slots.push({ ...TOWER_LAYOUT[i] });
  } else {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const shape = TOWER_LAYOUT[i % TOWER_LAYOUT.length];
      const col = i % cols;
      const row = Math.floor(i / cols);
      slots.push({
        x: (col - (cols - 1) / 2) * FALLBACK_CELL_W,
        z: (row - (rows - 1) / 2) * FALLBACK_CELL_D,
        rot: shape.rot,
        w: shape.w,
        d: shape.d,
      });
    }
  }

  if (occupied) {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    slots.forEach(s => {
      minX = Math.min(minX, s.x - s.w / 2);
      maxX = Math.max(maxX, s.x + s.w / 2);
      minZ = Math.min(minZ, s.z - s.d / 2);
      maxZ = Math.max(maxZ, s.z + s.d / 2);
    });
    const dx = occupied.maxX + FALLBACK_PLAN_GAP - minX;
    const dz = (occupied.minZ + occupied.maxZ) / 2 - (minZ + maxZ) / 2;
    slots.forEach(s => {
      s.x += dx;
      s.z += dz;
    });
  }

  return slots;
}

const FLOOR_HEIGHT = 0.46;

/**
 * 카메라가 모델을 바라보는 방향(아이소메트릭). 거리는 여기 담지 않는다 —
 * 거리는 fitCameraToTowers() 가 실제 모델 크기와 컨테이너 비율로 계산한다.
 */
const VIEW_DIR = new THREE.Vector3(18, 22, 26).normalize();
/** 모델 둘레에 남길 여백 배율. 위젯은 작아서 조금 더 띄운다. */
const FIT_MARGIN_EMBEDDED = 1.22;
const FIT_MARGIN_FULL = 1.12;

/**
 * 반지름 `radius` 인 모델이 화면에 다 들어오는 카메라 거리.
 *
 * 세로 화각만 보면 **세로로 긴 컨테이너에서 양끝이 잘린다** — 홈 위젯이 정확히
 * 그 모양(폭보다 높이가 큰 카드)이라 가로 화각까지 함께 보고 둘 중 먼 거리를 쓴다.
 * `aspect` 는 width/height 다.
 */
export function computeFitDistance(
  radius: number,
  fovDeg: number,
  aspect: number,
  margin: number
): number {
  const r = Math.max(radius, 0.001);
  const safeAspect = Math.max(aspect, 0.001);
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * safeAspect);
  return (
    Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2)) *
    Math.max(margin, 1)
  );
}

/** 동 라벨 기준 폭(px). 이보다 긴 글자는 캔버스를 늘려 잘리지 않게 한다. */
const TEXT_SPRITE_BASE_W = 256;

/**
 * 씬 팔레트. 전체화면은 어두운 디지털트윈 톤, 홈 위젯(embedded)은 흰 카드 대시보드와
 * 어울리도록 밝은 톤을 쓴다 — 위젯만 남색 배경이라 주변 카드와 동떨어져 보였다.
 */
const SCENE_PALETTE = {
  dark: {
    bg: 0x08111f,
    hemiSky: 0xb9dcff,
    hemiGround: 0x223241,
    hemiIntensity: 1.25,
    sunIntensity: 2.35,
    rim: 0x4fc3ff,
    rimIntensity: 1.25,
    ground: 0x152131,
    sitePad: 0x203149,
    road: 0x0e1623,
    landscape: 0x24563e,
    podium: 0x41546d,
    core: 0x243348,
    done: 0x22d3ee,
    doneEmissive: 0x036b7d,
    doneEmissiveIntensity: 0.34,
    pending: 0xb8c5d4,
    pendingOpacity: 0.26,
    edge: 0xd9ecff,
    edgeOpacity: 0.18,
    glow: 0x7dd3fc,
    glowAdditive: true,
    nameText: "#e5f2ff",
    floorText: "#fef3c7",
    textShadow: "rgba(0,0,0,0.6)",
  },
  light: {
    bg: 0xffffff,
    hemiSky: 0xffffff,
    hemiGround: 0xcbd5e1,
    hemiIntensity: 1.7,
    sunIntensity: 2.0,
    rim: 0xbfdbfe,
    rimIntensity: 0.6,
    ground: 0xffffff,
    sitePad: 0xe9eef4,
    road: 0xa8b4c3,
    landscape: 0x9fd1b3,
    podium: 0x94a3b8,
    core: 0x64748b,
    done: 0x0ea5c6,
    doneEmissive: 0x0e7490,
    doneEmissiveIntensity: 0.12,
    pending: 0x94a3b8,
    pendingOpacity: 0.3,
    edge: 0x334155,
    edgeOpacity: 0.22,
    glow: 0x0ea5e9,
    glowAdditive: false,
    nameText: "#0f172a",
    floorText: "#475569",
    textShadow: "rgba(255,255,255,0.9)",
  },
} as const;

function makeTextSprite(
  text: string,
  color = "#e5f2ff",
  shadow = "rgba(0,0,0,0.55)"
) {
  const canvas = document.createElement("canvas");
  const font = "700 30px Noto Sans KR, Malgun Gothic, sans-serif";
  const ctx = canvas.getContext("2d")!;
  // 캔버스를 키우기 전에 실제 글자 폭을 잰다. 고정 256px 에 가운데 정렬이라
  // 긴 이름("...동 · 22/24F · 도면 미등록")이 양옆으로 잘려 나갔다.
  ctx.font = font;
  const measured = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.width = Math.max(TEXT_SPRITE_BASE_W, measured);
  canvas.height = 96;
  // 캔버스 크기를 바꾸면 컨텍스트 상태가 초기화되므로 폰트를 다시 지정한다.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = shadow;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, 48);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  // 캔버스가 넓어진 만큼 스프라이트도 넓혀야 글자 비율이 안 눌린다.
  sprite.scale.set((4.2 * canvas.width) / TEXT_SPRITE_BASE_W, 1.55, 1);
  return sprite;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (Array.isArray(material)) material.forEach(m => m.dispose());
    else material?.dispose();
  });
}

export default function FrameMass3DView({
  siteName,
  siteId,
  buildings,
  rows,
  progressRate,
  onBack,
  embedded = false,
}: FrameMass3DViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const frameRef = useRef<number | null>(null);
  /** 현재 씬 기준 카메라 맞춤 함수. 씬을 다시 만들 때마다 교체된다. */
  const fitCameraRef = useRef<(() => void) | null>(null);
  /** 사용자가 직접 돌리거나 줌한 뒤에는 리사이즈가 시점을 되돌리지 않게 한다. */
  const userMovedRef = useRef(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const autoRotateRef = useRef(true);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);
  // 도면 배치 저장처가 생기면 siteId 로 불러와 채운다 (지금은 기본 배치)
  const planOverlay = null as FramePlanOverlay | null;

  // ── 타임머신(타임라인 재생): 층을 날짜순으로 보여줌 ──
  const [timelineOn, setTimelineOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // ms
  const timelineOnRef = useRef(false);
  const currentTimeRef = useRef(0);
  const timeRangeRef = useRef<{ min: number; max: number } | null>(null);
  const holdRef = useRef(false); // 위젯 반복재생: 끝에서 잠깐 멈춤 플래그
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // 입력 rows → (building_id, floor) → 타설일 론도 조회 맵
  const floorDateMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      const date = r.actual_finish || r.actual_start || "";
      if (!date) continue;
      const key = `${r.building_id}::${r.floor}`;
      // 이미 더 와수한 론도(actual_finish)가 있으면 유지
      if (!m.has(key)) m.set(key, date);
      else if (r.actual_finish) m.set(key, r.actual_finish);
    }
    return m;
  }, [rows]);

  // 타임라인 재생 범위(최초~최종 타설일). 날짜 없으면 null → 재생 비활성.
  // 3D에 그려지는 지상층(floor ≥ 1)만 기준 — 지하층/초기 데이터의 이른 날짜가
  // 앞부분 빈 재생시간(딜레이)을 만들지 않도록 한다.
  const timeRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      if (!(r.floor >= 1)) continue;
      const d = r.actual_finish || r.actual_start;
      if (!d) continue;
      const t = new Date(d).getTime();
      if (!Number.isFinite(t)) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    return Number.isFinite(min) && max > min ? { min, max } : null;
  }, [rows]);
  useEffect(() => {
    timeRangeRef.current = timeRange;
  }, [timeRange]);

  // 위젯(embedded): 타임라인을 켜고 자동 반복재생
  useEffect(() => {
    if (embedded && timeRange) {
      setTimelineOn(true);
      setCurrentTime(timeRange.min);
      setPlaying(true);
    }
  }, [embedded, timeRange]);

  const stats = useMemo<BuildingStat[]>(() => {
    return buildings.map(building => {
      const relevant = rows.filter(
        r => r.building_id === building.id && r.floor > 0
      );
      const floorMap = new Map<number, number>();
      for (let floor = 1; floor <= building.above_floors; floor++) {
        const floorRows = relevant.filter(r => r.floor === floor);
        if (floorRows.length === 0) {
          floorMap.set(floor, 0);
          continue;
        }
        const done = floorRows.filter(
          r => r.actual_finish || r.actual_start
        ).length;
        floorMap.set(floor, done / floorRows.length);
      }
      const completedFloors = Array.from(floorMap.entries()).filter(
        ([, v]) => v > 0
      ).length;
      const currentFloor =
        Array.from(floorMap.entries())
          .filter(([, v]) => v > 0)
          .map(([floor]) => floor)
          .sort((a, b) => b - a)[0] ?? 0;
      const totalFloors = Math.max(1, building.above_floors);
      return {
        building,
        totalFloors,
        completedFloors,
        currentFloor,
        rate: Math.round((completedFloors / totalFloors) * 100),
        floorMap,
      };
    });
  }, [buildings, rows]);

  const activeStats = useMemo(
    () => stats.filter(s => s.building.above_floors > 0),
    [stats]
  );
  const completedSum = stats.reduce((sum, s) => sum + s.completedFloors, 0);
  const totalSum = stats.reduce((sum, s) => sum + s.totalFloors, 0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const pal = embedded ? SCENE_PALETTE.light : SCENE_PALETTE.dark;
    renderer.setClearColor(pal.bg, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(pal.bg, 30, 78);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
    // 위치·거리는 아래 fitCameraToTowers() 가 실제 모델 크기에 맞춰 잡는다.
    // 여기서는 바라보는 "방향"(아이소메트릭 느낌)만 정한다 — 그 방향은 유지된다.
    camera.position.copy(VIEW_DIR).multiplyScalar(40);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.45;
    controls.maxPolarAngle = Math.PI * 0.46;
    controlsRef.current = controls;
    // 사용자가 한 번이라도 조작하면 리사이즈 때 시점을 다시 맞추지 않는다.
    userMovedRef.current = false;
    controls.addEventListener("start", () => {
      userMovedRef.current = true;
    });

    scene.add(
      new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiIntensity)
    );
    const sun = new THREE.DirectionalLight(0xffffff, pal.sunIntensity);
    sun.position.set(-18, 34, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -38;
    sun.shadow.camera.right = 38;
    sun.shadow.camera.top = 38;
    sun.shadow.camera.bottom = -38;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(pal.rim, pal.rimIntensity);
    rim.position.set(20, 16, -22);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(58, 42),
      new THREE.MeshStandardMaterial({
        color: pal.ground,
        roughness: 0.92,
        metalness: 0.04,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const sitePad = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.08, 24),
      new THREE.MeshStandardMaterial({
        color: pal.sitePad,
        roughness: 0.85,
        metalness: 0.05,
      })
    );
    sitePad.position.y = 0.02;
    sitePad.receiveShadow = true;
    scene.add(sitePad);

    const roadMat = new THREE.MeshStandardMaterial({
      color: pal.road,
      roughness: 0.72,
      metalness: 0.12,
    });
    [
      { x: 0, z: -17.2, w: 62, d: 4.2, r: 0.08 },
      { x: -24, z: 0, w: 5, d: 42, r: -0.18 },
      { x: 24, z: 2.8, w: 5.5, d: 46, r: 0.26 },
    ].forEach(road => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(road.w, 0.06, road.d),
        roadMat
      );
      mesh.position.set(road.x, 0.08, road.z);
      mesh.rotation.y = road.r;
      mesh.receiveShadow = true;
      scene.add(mesh);
    });

    // 조경(초록)·광장(갈색)은 실제 배치와 무관한 고정 좌표 장식이다.
    // 홈 위젯(밝은 톤)에서는 실제 시설처럼 도드라져 오해를 사므로 전체보기에서만 그린다.
    if (!embedded) {
      const landscapeMat = new THREE.MeshStandardMaterial({
        color: pal.landscape,
        roughness: 0.95,
        metalness: 0.02,
      });
      [
        { x: -7, z: -9, w: 8, d: 5 },
        { x: 3.5, z: 7.2, w: 10, d: 4 },
        { x: 14.5, z: -2.5, w: 4, d: 10 },
      ].forEach(g => {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(g.w, 0.09, g.d),
          landscapeMat
        );
        mesh.position.set(g.x, 0.11, g.z);
        mesh.receiveShadow = true;
        scene.add(mesh);
      });

      const plazaMat = new THREE.MeshStandardMaterial({
        color: 0xc2b18c,
        roughness: 0.9,
      });
      const plaza = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 7), plazaMat);
      plaza.position.set(0.5, 0.14, -4.2);
      plaza.rotation.y = 0.15;
      plaza.receiveShadow = true;
      scene.add(plaza);
    }

    const podiumMat = new THREE.MeshStandardMaterial({
      color: pal.podium,
      roughness: 0.68,
      metalness: 0.18,
    });
    const doneMat = new THREE.MeshStandardMaterial({
      color: pal.done,
      emissive: pal.doneEmissive,
      emissiveIntensity: pal.doneEmissiveIntensity,
      roughness: 0.38,
      metalness: 0.28,
      transparent: true,
      opacity: 0.96,
    });
    const partialMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0x8f5f00,
      emissiveIntensity: 0.26,
      roughness: 0.42,
      metalness: 0.22,
      transparent: true,
      opacity: 0.94,
    });
    const pendingMat = new THREE.MeshStandardMaterial({
      color: pal.pending,
      roughness: 0.52,
      metalness: 0.2,
      transparent: true,
      opacity: pal.pendingOpacity,
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: pal.core,
      roughness: 0.45,
      metalness: 0.24,
    });
    const edgeMat = new THREE.LineBasicMaterial({
      color: pal.edge,
      transparent: true,
      opacity: pal.edgeOpacity,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: pal.glow,
      transparent: true,
      opacity: 0.22,
      // 가산 혼합은 밝은 배경에서 보이지 않으므로 밝은 톤은 일반 혼합
      blending: pal.glowAdditive
        ? THREE.AdditiveBlending
        : THREE.NormalBlending,
      depthWrite: false,
    });

    // ── 폴리곤 기반 렌더 헬퍼 ─────────────────────────────────
    const WORLD_PER_M = FLOOR_HEIGHT / 3.0; // 한 층 3m 가정 → 0.46 world unit
    const polyByBuildingId = new Map<
      string,
      { polygon: [number, number][]; floorHeightM: number; name: string }
    >();
    if (planOverlay && planOverlay.buildings.length > 0) {
      const mpu = planOverlay.meters_per_unit || 1;
      planOverlay.buildings.forEach(b => {
        polyByBuildingId.set(b.building_id, {
          polygon: (b.polygon as [number, number][]).map(p => [
            p[0] * mpu,
            p[1] * mpu,
          ]),
          floorHeightM: b.floor_height_m || 3.0,
          name: b.name,
        });
      });
    }

    // 폴리곤 셋이 있으면 전체 도면을 (0,0) 기준 중앙 정렬
    let polyOffset: [number, number] = [0, 0];
    if (polyByBuildingId.size > 0) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      polyByBuildingId.forEach(p => {
        p.polygon.forEach(([x, y]) => {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        });
      });
      polyOffset = [(minX + maxX) / 2, (minY + maxY) / 2];
    }

    function formatPourDate(s: string): string {
      // ISO YYYY-MM-DD → MM/DD
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[2]}/${m[3]}`;
      return s.slice(0, 10);
    }

    function makeFloorLabel(text: string) {
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 56;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "600 22px Noto Sans KR, Malgun Gothic, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.shadowColor = pal.textShadow;
      ctx.shadowBlur = 6;
      ctx.fillStyle = pal.floorText;
      ctx.fillText(text, 8, 28);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(2.4, 0.7, 1);
      return sprite;
    }

    const hasPolygon = (stat: BuildingStat) => {
      const p = polyByBuildingId.get(stat.building.id);
      return !!p && p.polygon.length >= 3;
    };

    // 도면이 이미 차지한 영역(세계 좌표). 폴백 격자를 그 옆에 붙이는 데 쓴다.
    let polyExtent: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    } | null = null;
    if (polyByBuildingId.size > 0) {
      let pMinX = Infinity,
        pMaxX = -Infinity,
        pMinZ = Infinity,
        pMaxZ = -Infinity;
      polyByBuildingId.forEach(p => {
        p.polygon.forEach(([x, y]) => {
          const wx = (x - polyOffset[0]) * WORLD_PER_M;
          const wz = (y - polyOffset[1]) * WORLD_PER_M;
          if (wx < pMinX) pMinX = wx;
          if (wx > pMaxX) pMaxX = wx;
          if (wz < pMinZ) pMinZ = wz;
          if (wz > pMaxZ) pMaxZ = wz;
        });
      });
      polyExtent = { minX: pMinX, maxX: pMaxX, minZ: pMinZ, maxZ: pMaxZ };
    }

    // 폴백 동은 "전체 동 중 몇 번째" 가 아니라 "폴백 중 몇 번째" 로 자리를
    // 잡아야 격자가 빈칸 없이 채워진다.
    const fallbackIdxById = new Map<string, number>();
    activeStats.forEach(stat => {
      if (!hasPolygon(stat))
        fallbackIdxById.set(stat.building.id, fallbackIdxById.size);
    });
    const fallbackSlots = buildFallbackSlots(fallbackIdxById.size, polyExtent);
    /** 도면 일부만 등록된 현장인지. 라벨에 표시해 구분한다. */
    const mixedPlanCoverage =
      polyByBuildingId.size > 0 && fallbackIdxById.size > 0;

    // 카메라 맞춤의 기준. 바닥판·도로·광장 같은 배경은 넣지 않는다 —
    // 그것까지 담으려 하면 건물이 화면에서 작아진다.
    const towerGroups: THREE.Group[] = [];

    activeStats.forEach(stat => {
      const poly = polyByBuildingId.get(stat.building.id);

      // ── 폴리곤 경로: 평면도에서 외곽선을 딴 경우 ───────────
      if (poly && poly.polygon.length >= 3) {
        const group = new THREE.Group();
        const floorHeightWorld = poly.floorHeightM * WORLD_PER_M;
        // PDF 좌표(x→right, y→down) → 세계 좌표(x→right, z→down).
        // 아래 rotateX(-π/2) 는 (x, y, z) → (x, z, −y) 라서 Shape 의 y 를 그대로
        // 넣으면 도면이 상하 거울상이 된다(건물은 뒤집히고 라벨·폴백 범위는
        // +z 라 서로 어긋남). y 부호를 미리 뒤집어 회전 후 z = 도면 y 가 되게 한다.
        // ExtrudeGeometry 가 winding 을 정규화하므로 면 방향은 깨지지 않는다.
        const shape = new THREE.Shape(
          poly.polygon.map(
            ([x, y]) =>
              new THREE.Vector2(
                (x - polyOffset[0]) * WORLD_PER_M,
                -(y - polyOffset[1]) * WORLD_PER_M
              )
          )
        );

        // 라벨 위치 산정용 (폴리곤 첫 정점 기준)
        const labelV = new THREE.Vector2(
          (poly.polygon[0][0] - polyOffset[0]) * WORLD_PER_M,
          (poly.polygon[0][1] - polyOffset[1]) * WORLD_PER_M
        );

        for (let floor = 1; floor <= stat.totalFloors; floor++) {
          const ratio = stat.floorMap.get(floor) ?? 0;
          const material =
            ratio >= 1 ? doneMat : ratio > 0 ? partialMat : pendingMat;
          // 타임라인 태깅용 층 타설 시각(ms). 날짜 없으면 null.
          const dateKey = `${stat.building.id}::${floor}`;
          const pourDate = floorDateMap.get(dateKey);
          const ft = pourDate ? new Date(pourDate).getTime() : null;
          const geo = new THREE.ExtrudeGeometry(shape, {
            depth: floorHeightWorld * 0.94,
            bevelEnabled: false,
          });
          // ExtrudeGeometry는 XY 평면에 만들어지고 Z로 extrude → 눕혀서 Y가 높이가 되게
          geo.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(geo, material);
          mesh.position.y = 0.55 + (floor - 1) * floorHeightWorld;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.t = ft;
          group.add(mesh);

          if (floor % 3 === 0 || floor === stat.currentFloor) {
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(geo),
              edgeMat
            );
            edges.position.copy(mesh.position);
            edges.userData.t = ft;
            group.add(edges);
          }

          // 층 라벨: "층번호 · 타설일자"
          const labelText = pourDate
            ? `${floor}F · ${formatPourDate(pourDate)}`
            : `${floor}F`;
          const fl = makeFloorLabel(labelText);
          fl.position.set(
            labelV.x + 1.4,
            mesh.position.y + floorHeightWorld * 0.5,
            labelV.y
          );
          fl.userData.t = ft;
          group.add(fl);
        }

        // 동 이름 라벨 (상단)
        const topY = 0.55 + stat.totalFloors * floorHeightWorld + 1.2;
        const nameLabel = makeTextSprite(
          `${stat.building.name} · ${stat.completedFloors}/${stat.totalFloors}F`,
          pal.nameText,
          pal.textShadow
        );
        nameLabel.position.set(labelV.x, topY, labelV.y);
        group.add(nameLabel);

        towerGroups.push(group);
        scene.add(group);
        return; // 폴리곤 경로 종료
      }

      // ── 폴백: 도면 폴리곤이 없는 동 ─────────────────────────
      const slotIdx = fallbackIdxById.get(stat.building.id) ?? 0;
      const layout = fallbackSlots[slotIdx] ?? TOWER_LAYOUT[0];
      const group = new THREE.Group();
      group.position.set(layout.x, 0.12, layout.z);
      group.rotation.y = layout.rot;

      const podium = new THREE.Mesh(
        new THREE.BoxGeometry(layout.w + 1.0, 0.55, layout.d + 0.9),
        podiumMat
      );
      podium.position.y = 0.28;
      podium.castShadow = true;
      podium.receiveShadow = true;
      group.add(podium);

      const core = new THREE.Mesh(
        new THREE.BoxGeometry(
          layout.w * 0.34,
          stat.totalFloors * FLOOR_HEIGHT + 0.8,
          layout.d * 0.28
        ),
        coreMat
      );
      core.position.set(0, (stat.totalFloors * FLOOR_HEIGHT) / 2 + 0.65, 0);
      core.castShadow = true;
      group.add(core);

      for (let floor = 1; floor <= stat.totalFloors; floor++) {
        const ratio = stat.floorMap.get(floor) ?? 0;
        const material =
          ratio >= 1 ? doneMat : ratio > 0 ? partialMat : pendingMat;
        // 타임라인 태깅용 층 타설 시각(ms). 날짜 없으면 null.
        const dateKey = `${stat.building.id}::${floor}`;
        const pourDate = floorDateMap.get(dateKey);
        const ft = pourDate ? new Date(pourDate).getTime() : null;
        const geometry = new THREE.BoxGeometry(
          layout.w * (floor % 5 === 0 ? 0.97 : 1),
          FLOOR_HEIGHT * 0.78,
          layout.d * (floor % 7 === 0 ? 0.96 : 1)
        );
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = 0.55 + floor * FLOOR_HEIGHT;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.t = ft;
        group.add(mesh);

        if (floor % 3 === 0 || floor === stat.currentFloor) {
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            edgeMat
          );
          edges.position.copy(mesh.position);
          edges.userData.t = ft;
          group.add(edges);
        }

        if (floor === stat.currentFloor && stat.currentFloor > 0) {
          const glow = new THREE.Mesh(
            new THREE.BoxGeometry(
              layout.w + 0.32,
              FLOOR_HEIGHT * 0.38,
              layout.d + 0.32
            ),
            glowMat
          );
          glow.position.y = mesh.position.y + FLOOR_HEIGHT * 0.08;
          glow.userData.t = ft;
          group.add(glow);
        }

        // 층 라벨 (박스 폴백 경로도 동일하게)
        const labelText = pourDate
          ? `${floor}F · ${formatPourDate(pourDate)}`
          : `${floor}F`;
        const fl = makeFloorLabel(labelText);
        fl.position.set(layout.w * 0.6 + 0.6, mesh.position.y, 0);
        fl.userData.t = ft;
        group.add(fl);
      }

      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(layout.w * 0.74, 0.26, layout.d * 0.56),
        new THREE.MeshStandardMaterial({
          color: 0xd7e5ee,
          roughness: 0.4,
          metalness: 0.18,
        })
      );
      roof.position.y = 0.55 + (stat.totalFloors + 0.7) * FLOOR_HEIGHT;
      roof.castShadow = true;
      group.add(roof);

      // 도면이 일부만 등록된 현장에서는 폴백 동임을 라벨로 알린다 —
      // 실제 배치가 아니라 임시 격자 자리라는 뜻이다.
      const label = makeTextSprite(
        `${stat.building.name} · ${stat.completedFloors}/${stat.totalFloors}F${
          mixedPlanCoverage ? " · 도면 미등록" : ""
        }`,
        pal.nameText,
        pal.textShadow
      );
      label.position.set(0, 1.4 + stat.totalFloors * FLOOR_HEIGHT, 0);
      group.add(label);

      towerGroups.push(group);
      scene.add(group);
    });

    // 바닥판은 고정 크기(58x42)다. 동이 많아 격자가 그보다 넓어지면 건물이
    // 바닥 밖으로 떠 보이므로, 실제 배치 범위를 덮도록 늘린다(줄이지는 않는다).
    if (towerGroups.length > 0) {
      const footprint = new THREE.Box3();
      towerGroups.forEach(g => footprint.expandByObject(g));
      if (!footprint.isEmpty()) {
        const spanX =
          Math.max(Math.abs(footprint.min.x), Math.abs(footprint.max.x)) * 2 +
          10;
        const spanZ =
          Math.max(Math.abs(footprint.min.z), Math.abs(footprint.max.z)) * 2 +
          10;
        ground.scale.set(Math.max(1, spanX / 58), Math.max(1, spanZ / 42), 1);
      }
    }

    /**
     * 카메라를 실제 동(棟) 크기에 맞춘다 — 컨테이너 한가운데에 모델 전체가 들어온다.
     *
     * 왜 필요한가: 종전에는 위치(18,22,26)·타깃(0,4.8,0)이 **하드코딩**이었다.
     * 그 값은 `TOWER_LAYOUT` 박스 7칸을 전제로 맞춘 것이라(지금은 동 수에
     * 맞춰 격자를 만드는 `buildFallbackSlots()` 로 대체됐다),
     *  - 도면 폴리곤(`frame-plan-overlay`)이 등록된 현장은 실제 미터 스케일로 그려져
     *    프레임을 벗어나고,
     *  - 동 수가 적으면 배치가 한쪽으로 쏠려 중심이 x=0 이 아니며,
     *  - 카드가 좁아지면 가로 화각이 줄어 양끝 동이 잘렸다.
     * 세 경우 모두 "모델이 화면 중심에서 벗어난다" 는 같은 증상으로 나타난다.
     *
     * 세로 화각뿐 아니라 **가로 화각까지 함께 보고** 둘 중 먼 거리를 쓴다.
     * 그래야 세로로 긴 위젯에서도 양끝이 잘리지 않는다.
     */
    /**
     * 안개는 **현재 카메라 거리**를 따라간다.
     *
     * 종전에는 `Fog(30, 78)` 고정이었다. 모델이 크면 카메라가 그만큼 물러나는데
     * 안개는 그대로라 뒷쪽 동이 배경색(#08111f)에 그대로 묻혔다 — 이번 신고에서
     * "건물은 안 보이고 라벨만 보인다" 가 된 직접 원인이다(뒷면 88% 소실).
     * 거리에 연동하면 확대·축소 어디서도 뒷면 흐려짐이 약 31% 로 일정하다.
     */
    let fogRadius = 0;
    const syncFog = () => {
      if (!(scene.fog instanceof THREE.Fog) || fogRadius <= 0) return;
      const d = camera.position.distanceTo(controls.target);
      scene.fog.near = Math.max(1, d - fogRadius);
      scene.fog.far = d + fogRadius * 5.5;
    };

    const fitCameraToTowers = () => {
      if (towerGroups.length === 0) return;
      scene.updateMatrixWorld(true);

      const box = new THREE.Box3();
      towerGroups.forEach(g => box.expandByObject(g));
      if (box.isEmpty()) return;

      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const center = sphere.center;
      const radius = Math.max(sphere.radius, 0.001);

      const dist = computeFitDistance(
        radius,
        camera.fov,
        camera.aspect,
        embedded ? FIT_MARGIN_EMBEDDED : FIT_MARGIN_FULL
      );

      camera.position.copy(center).addScaledVector(VIEW_DIR, dist);

      // 줌 한계도 모델 크기에 맞춰 준다 — 고정값(18~58)이면 큰 단지에서 맞춤 거리를
      // 넘어서 버려 아무리 줌아웃해도 전체가 안 들어왔다.
      const minDist = dist * 0.35;
      const maxDist = dist * 2.4;
      controls.target.copy(center);
      controls.minDistance = minDist;
      controls.maxDistance = maxDist;

      // near/far 는 **줌 양끝에서도** 모델이 안 잘리게 잡는다. 맞춤 거리 기준으로만
      // 잡으면 확대했을 때 near 평면이 모델 앞을 잘라 카드가 통째로 비어 버린다.
      camera.near = Math.max(0.1, minDist * 0.05);
      camera.far = maxDist + radius * 2 + 10;
      camera.updateProjectionMatrix();
      controls.update();

      // 안개 갱신에 쓸 모델 반지름. 실제 near/far 는 매 프레임 현재 카메라
      // 거리로 다시 잡는다(아래 syncFog) — 한 번만 잡아 두면 줌할 때마다
      // 뒷동이 배경색에 묻힌다.
      fogRadius = radius;
      syncFog();
    };
    fitCameraRef.current = fitCameraToTowers;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      // 세 번째 인자(updateStyle)를 생략해 three.js 가 canvas 의 CSS 크기까지
      // 맞추게 한다. false 로 두면 style 이 비어 캔버스가 드로잉 버퍼 픽셀 수
      // (= CSS 크기 x devicePixelRatio)만큼 커져, DPR 2 화면에서 컨테이너의
      // 2배로 그려지며 좌상단만 보인다.
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height));
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
      // 비율이 바뀌면 맞춤 거리도 달라진다. 단, 사용자가 직접 돌린 뒤에는
      // 시점을 빼앗지 않는다.
      if (!userMovedRef.current) fitCameraToTowers();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const clock = new THREE.Clock();
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      syncFog();
      const tlOn = timelineOnRef.current;
      const ct = currentTimeRef.current;
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.material === glowMat) {
          (obj.material as THREE.MeshBasicMaterial).opacity =
            0.18 + Math.sin(elapsed * 2.5) * 0.08;
        }
        // 타임라인 ON: 타설일이 현재 시점 이하인 층만 표시.
        // 날짜 없는(미시공) 층은 재생이 끝(최종일)에 도달하면 함께 표시.
        if (tlOn) {
          const t = (obj.userData as { t?: number | null }).t;
          if (t !== undefined) {
            const tr = timeRangeRef.current;
            const atEnd = !tr || ct >= tr.max;
            obj.visible = t === null ? atEnd : t <= ct;
          }
        }
      });
      controls.autoRotate = autoRotateRef.current;
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      ro.disconnect();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
      controlsRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
      // 씬이 사라진 뒤 리셋 버튼이 옛 클로저를 호출하지 않게 끊는다.
      fitCameraRef.current = null;
    };
  }, [activeStats, planOverlay, floorDateMap, embedded]);

  // 타임라인 ON/OFF: OFF로 돌아오면 모든 층을 다시 보이게 복원
  useEffect(() => {
    timelineOnRef.current = timelineOn;
    if (!timelineOn && sceneRef.current) {
      sceneRef.current.traverse(obj => {
        if ((obj.userData as { t?: number | null }).t !== undefined)
          obj.visible = true;
      });
    }
  }, [timelineOn]);

  // 재생: currentTime 을 min→max 로 전진.
  //  - 전체보기: 끝에서 정지(미시공층 포함 전체 표시)
  //  - 위젯(embedded): 끝에서 잠깐 멈췄다 처음부터 무한 반복
  useEffect(() => {
    if (!playing || !timeRange) return;
    const DURATION = embedded ? 11000 : 9000;
    const HOLD = 2200;
    const span = timeRange.max - timeRange.min || 1;
    let raf = 0;
    let holdTimer = 0;
    let last = performance.now();
    // 현재 위치에서 이어 재생(슬라이더로 옮긴 위치 반영). 끝이면 처음부터.
    let cur = currentTimeRef.current;
    if (!Number.isFinite(cur) || cur < timeRange.min || cur >= timeRange.max) {
      cur = timeRange.min;
    }
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      cur += (span / DURATION) * dt;
      if (cur >= timeRange.max) {
        cur = timeRange.max;
        setCurrentTime(cur);
        if (embedded) {
          // 끝(전체 표시)에서 잠깐 멈췄다 처음부터 반복
          if (!holdRef.current) {
            holdRef.current = true;
            holdTimer = window.setTimeout(() => {
              holdRef.current = false;
              cur = timeRange.min;
              setCurrentTime(cur);
              last = performance.now();
              raf = requestAnimationFrame(step);
            }, HOLD);
          }
          return; // hold 중 일시정지
        }
        setPlaying(false);
        return;
      }
      setCurrentTime(cur);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (holdTimer) clearTimeout(holdTimer);
      holdRef.current = false;
    };
  }, [playing, timeRange, embedded]);

  // 타임라인 토글: 켜면 시작점(min)에서 자동 재생, 끄면 정지
  const toggleTimeline = () => {
    if (!timeRange) return;
    const next = !timelineOnRef.current;
    setTimelineOn(next);
    if (next) {
      setCurrentTime(timeRange.min);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  };

  // ▶/⏸: 끝에서 다시 누르면 처음부터
  const togglePlay = () => {
    if (!timeRange) return;
    const willPlay = !playing;
    if (willPlay && currentTimeRef.current >= timeRange.max) {
      setCurrentTime(timeRange.min);
    }
    setPlaying(willPlay);
  };

  const resetCamera = () => {
    // 하드코딩 좌표로 되돌리지 않는다 — 씬을 만들 때와 같은 기준으로 다시 맞춘다.
    userMovedRef.current = false;
    fitCameraRef.current?.();
  };

  return (
    <div
      className={
        embedded
          ? "relative h-full w-full overflow-hidden bg-white text-slate-900"
          : "relative h-[calc(100vh-11rem)] min-h-[520px] overflow-hidden rounded-xl bg-[#08111f] text-white"
      }
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        data-frame-mass-3d-canvas
      />

      {!embedded && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(56,189,248,0.18),transparent_34%),linear-gradient(to_bottom,rgba(8,17,31,0.12),rgba(8,17,31,0.48))]" />
      )}

      {embedded ? (
        <div className="pointer-events-none absolute left-4 top-3 flex items-end gap-4">
          <div>
            <p className="text-[10px] font-semibold text-slate-500">
              골조 진행률
            </p>
            <p className="text-3xl font-black text-[#004791] tabular-nums leading-tight">
              {progressRate.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">
              타설 완료
            </p>
            <p className="text-base font-black text-slate-800 tabular-nums leading-tight">
              {completedSum}/{Math.max(1, totalSum)}층
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">동수</p>
            <p className="text-base font-black text-slate-800 tabular-nums leading-tight">
              {activeStats.length}개 동
            </p>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute left-5 top-5 max-w-[520px]">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-sky-200/80">
            <Sparkles className="h-3.5 w-3.5" />
            Frame Progress Digital Twin
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
            {siteName}
          </h1>
          <div className="mt-3 flex items-end gap-5">
            <div>
              <p className="text-[11px] font-semibold text-white/45">
                골조 진행률
              </p>
              <p className="text-4xl font-black text-cyan-200 tabular-nums">
                {progressRate.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-white/45">
                타설 완료
              </p>
              <p className="text-xl font-black text-white tabular-nums">
                {completedSum}/{Math.max(1, totalSum)}층
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-white/45">동수</p>
              <p className="text-xl font-black text-white tabular-nums">
                {activeStats.length}개 동
              </p>
            </div>
          </div>
        </div>
      )}

      {!embedded && (
        <div className="absolute right-5 top-5 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white"
            onClick={onBack}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            골조표
          </Button>
          {timeRange && (
            <Button
              size="sm"
              variant="outline"
              className={`h-8 border-white/20 backdrop-blur hover:text-white ${
                timelineOn
                  ? "bg-cyan-400/30 text-cyan-100 hover:bg-cyan-400/40"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
              onClick={toggleTimeline}
            >
              <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
              타임머신
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white"
            onClick={() => setAutoRotate(v => !v)}
          >
            {autoRotate ? "회전 중" : "회전"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white"
            onClick={resetCamera}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {!embedded && timelineOn && timeRange && (
        <div className="absolute bottom-28 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/15 bg-[#0a1830]/85 px-4 py-2.5 shadow-lg backdrop-blur">
          <button
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/90 text-[#08111f] transition-colors hover:bg-cyan-300"
            aria-label={playing ? "일시정지" : "재생"}
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 translate-x-[1px]" />
            )}
          </button>
          <input
            type="range"
            min={timeRange.min}
            max={timeRange.max}
            step={86400000}
            value={Math.round(currentTime)}
            onChange={e => {
              setPlaying(false);
              setCurrentTime(Number(e.target.value));
            }}
            className="h-1.5 w-[42vw] max-w-[560px] cursor-pointer accent-cyan-400"
          />
          <span className="w-[88px] text-right text-sm font-bold tabular-nums text-cyan-100">
            {(() => {
              const d = new Date(currentTime);
              return Number.isNaN(d.getTime())
                ? "-"
                : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
            })()}
          </span>
        </div>
      )}

      <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
        <div className="no-scrollbar flex max-w-[72vw] gap-2 overflow-x-auto pb-1">
          {!embedded &&
            activeStats.map(stat => (
              <div
                key={stat.building.id}
                className="w-[172px] shrink-0 border border-white/12 bg-white/[0.07] px-3 py-2 backdrop-blur-md"
              >
                <div className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-black text-white">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                    <span className="truncate">{stat.building.name}</span>
                  </span>
                  <span className="text-xs font-black text-cyan-200">
                    {stat.rate}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden bg-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-300 to-emerald-300"
                    style={{ width: `${Math.min(100, stat.rate)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] font-semibold text-white/50">
                  <span>완료 {stat.completedFloors}F</span>
                  <span>현재 {stat.currentFloor || "-"}F</span>
                </div>
              </div>
            ))}
        </div>

        <div
          className={
            embedded
              ? "hidden shrink-0 rounded-md border border-slate-200 bg-white/85 px-3 py-2 text-[11px] font-semibold text-slate-600 backdrop-blur md:block"
              : "hidden shrink-0 border border-white/12 bg-black/20 px-3 py-2 text-[11px] font-semibold text-white/65 backdrop-blur md:block"
          }
        >
          완료층 청록 · 진행층 금색 · 미시공층 유리 매스
        </div>
      </div>
    </div>
  );
}
