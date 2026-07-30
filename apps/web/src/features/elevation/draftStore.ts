/**
 * 작업 초안(로컬 자동 저장) — 새로고침·화면 이동으로 작업이 날아가는 것을 막는 안전망.
 *
 * 왜 IndexedDB 인가: 초안에는 원본 DXF 텍스트가 포함되고 이 파일은 수 MB 가 흔하다.
 * localStorage(약 5MB, 동기 API)로는 큰 도면에서 저장이 실패하거나 입력이 멈춘다.
 *
 * 저장 원천은 여전히 Supabase(프로젝트 REV) 다. 이 초안은 "저장 버튼을 누르기 전"
 * 작업 내용을 잃지 않기 위한 로컬 캐시이며, REV 를 대체하지 않는다.
 *  - state 레코드: 설정·입면·오프닝·동타입 매트릭스(작을 때마다 디바운스 저장)
 *  - dxf 레코드: 원본 DXF 텍스트(도면을 열거나 편집할 때만 저장 — 매번 쓰면 무겁다)
 */
import type { ElevState } from "./types";

const DB_NAME = "ipg-draft";
const DB_VER = 1;
const STORE = "draft";
const STATE_KEY = "state";
const DXF_KEY = "dxf";

export interface DraftStateRecord {
  state: ElevState;
  /** 초안을 만든 시각(ISO) — 복원 안내에 표시 */
  savedAt: string;
  /** 작업 중이던 프로젝트(있으면) — 복원 후 저장 대상 유지 */
  projectId: string | null;
}

export interface DraftDxfRecord {
  name: string;
  text: string;
  savedAt: string;
}

/** IndexedDB 미지원(사파리 프라이빗 등)이면 초안 기능만 조용히 꺼진다 */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VER);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // 용량 초과 등은 무시(초안은 보조 수단)
    tx.onabort = () => resolve();
  });
  db.close();
}

async function get<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  const v = await new Promise<T | null>(resolve => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return v;
}

export function saveDraftState(
  state: ElevState,
  projectId: string | null
): Promise<void> {
  const rec: DraftStateRecord = {
    state,
    projectId,
    savedAt: new Date().toISOString(),
  };
  return put(STATE_KEY, rec);
}

export function saveDraftDxf(name: string, text: string): Promise<void> {
  const rec: DraftDxfRecord = { name, text, savedAt: new Date().toISOString() };
  return put(DXF_KEY, rec);
}

export function loadDraftState(): Promise<DraftStateRecord | null> {
  return get<DraftStateRecord>(STATE_KEY);
}

export function loadDraftDxf(): Promise<DraftDxfRecord | null> {
  return get<DraftDxfRecord>(DXF_KEY);
}

/** 초안 비우기 — '새로 시작' 또는 초기화 시 */
export async function clearDraft(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

/** 초안에 실제 작업물이 있는지 — 빈 상태를 복원했다고 안내하지 않기 위함 */
export function draftHasWork(rec: DraftStateRecord | null): boolean {
  if (!rec) return false;
  const st = rec.state;
  const walls = Array.isArray(st.walls) ? st.walls.length : 0;
  const openings = Array.isArray(st.openings) ? st.openings.length : 0;
  const types = st.typeMatrix?.types?.length ?? 0;
  const buildings = st.typeMatrix?.buildings?.length ?? 0;
  return walls + openings + types + buildings > 0;
}
