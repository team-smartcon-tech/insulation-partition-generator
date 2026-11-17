/**
 * 동절기 열원검토 — 저장 계층 (이 브라우저).
 *
 * 검토서 문서는 localStorage, 도면은 용량이 커서 IndexedDB 에 둔다.
 * 도면은 DXF 원문이 아니라 **파싱한 결과(선분 배열)** 를 넣는다 — 98MB 도면도 10MB 남짓이고,
 * 다시 열 때 파싱 없이 바로 뜬다.
 * 고칠 때마다 자동 저장되므로 화면을 닫았다 열어도 구역이 그대로 남는다.
 *
 * 서버(팀 공유) 저장은 아직 없다 — 다른 PC 로 옮길 때는 "내보내기/가져오기(JSON)" 를 쓴다.
 * 화면은 이 파일의 함수만 부르므로, 서버 저장을 붙일 때 여기만 바꾸면 된다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createProject, normalizeProject } from "./defaults";
import type { LiteDxf } from "./engine/dxfLite";
import type { HeatProject, ProjectIndexEntry, ZoneKind } from "./types";

const INDEX_KEY = "heat-review:v1:index";
const LAST_KEY = "heat-review:v1:last";
const docKey = (id: string) => `heat-review:v1:doc:${id}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadIndex(): ProjectIndexEntry[] {
  const list = readJson<ProjectIndexEntry[]>(INDEX_KEY);
  return Array.isArray(list) ? list : [];
}

export function loadProject(id: string): HeatProject | null {
  return normalizeProject(readJson<unknown>(docKey(id)));
}

/** 문서 저장 + 목록 갱신. 실패(용량 초과 등)하면 false */
export function saveProject(p: HeatProject): boolean {
  try {
    localStorage.setItem(docKey(p.id), JSON.stringify(p));
    const entry: ProjectIndexEntry = {
      id: p.id,
      name: p.name,
      zoneCount: p.zones.length,
      updatedAt: p.updatedAt,
    };
    const rest = loadIndex().filter((e) => e.id !== p.id);
    localStorage.setItem(INDEX_KEY, JSON.stringify([entry, ...rest]));
    localStorage.setItem(LAST_KEY, p.id);
    return true;
  } catch {
    return false;
  }
}

export function removeProject(id: string): void {
  try {
    localStorage.removeItem(docKey(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(loadIndex().filter((e) => e.id !== id)));
  } catch {
    /* 저장소를 못 쓰는 환경 — 화면 상태만 바뀐다 */
  }
  void deleteDrawings(id);
}

// ── 도면 (IndexedDB) ─────────────────────────────────────────────────────────

const DB_NAME = "heat-review";
const STORE = "drawings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** 도면 키 — 검토서 하나에 종류별로 한 장씩 */
const drawingKey = (projectId: string, sheet: ZoneKind) => `${projectId}:${sheet}`;

export async function saveDrawing(projectId: string, sheet: ZoneKind, dxf: LiteDxf): Promise<boolean> {
  try {
    await idb("readwrite", (s) => s.put(dxf, drawingKey(projectId, sheet)));
    return true;
  } catch {
    return false;
  }
}

export async function loadDrawing(projectId: string, sheet: ZoneKind): Promise<LiteDxf | null> {
  try {
    let v = await idb<unknown>("readonly", (s) => s.get(drawingKey(projectId, sheet)));
    // 도면이 한 장이던 때의 키(검토서 id) — 주차장 도면으로 본다
    if (v == null && sheet === "parking") v = await idb<unknown>("readonly", (s) => s.get(projectId));
    // 모양이 다른 값(예전 형식)은 없는 것으로 본다 — 도면만 다시 불러오면 된다
    const d = v as Partial<LiteDxf> | null;
    return d &&
      d.segs instanceof Float64Array &&
      d.colors instanceof Uint8Array &&
      d.stats &&
      d.fit &&
      d.textPos instanceof Float64Array &&
      d.textPos.length === (d.textStr?.length ?? -1) * 5
      ? (d as LiteDxf)
      : null;
  } catch {
    return null;
  }
}

export async function deleteDrawing(projectId: string, sheet: ZoneKind): Promise<void> {
  try {
    await idb("readwrite", (s) => s.delete(drawingKey(projectId, sheet)));
    if (sheet === "parking") await idb("readwrite", (s) => s.delete(projectId));
  } catch {
    /* 없는 도면 */
  }
}

/** 검토서의 도면 전부 */
export async function deleteDrawings(projectId: string): Promise<void> {
  for (const sheet of ["unit", "core", "parking"] as const) await deleteDrawing(projectId, sheet);
}

// ── 화면용 훅 ────────────────────────────────────────────────────────────────

export type SaveState = "saved" | "saving" | "error";

function initialProject(): HeatProject {
  const last = localStorage.getItem(LAST_KEY);
  const fromLast = last ? loadProject(last) : null;
  if (fromLast) return fromLast;
  for (const e of loadIndex()) {
    const p = loadProject(e.id);
    if (p) return p;
  }
  const fresh = createProject("새 검토서");
  saveProject(fresh);
  return fresh;
}

export function useHeatStore() {
  const [project, setProject] = useState<HeatProject>(initialProject);
  const [index, setIndex] = useState<ProjectIndexEntry[]>(loadIndex);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const timer = useRef(0);
  const pending = useRef<HeatProject | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = 0;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setSaveState(saveProject(p) ? "saved" : "error");
    setIndex(loadIndex());
  }, []);

  /** 문서를 고친다 — 잠깐 모았다가 자동 저장 */
  const update = useCallback(
    (fn: (p: HeatProject) => HeatProject) => {
      setProject((prev) => {
        const next = { ...fn(prev), updatedAt: new Date().toISOString() };
        pending.current = next;
        return next;
      });
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 400);
    },
    [flush],
  );

  // 탭을 닫거나 다른 화면으로 갈 때 모아 둔 변경을 놓치지 않는다
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flush]);

  const open = useCallback(
    (id: string) => {
      flush();
      const p = loadProject(id);
      if (!p) return false;
      localStorage.setItem(LAST_KEY, id);
      setProject(p);
      return true;
    },
    [flush],
  );

  const create = useCallback(
    (name: string) => {
      flush();
      const p = createProject(name);
      saveProject(p);
      setProject(p);
      setIndex(loadIndex());
      return p;
    },
    [flush],
  );

  /** 가져온 문서를 새 검토서로 넣는다 */
  const adopt = useCallback(
    (p: HeatProject) => {
      flush();
      saveProject(p);
      setProject(p);
      setIndex(loadIndex());
    },
    [flush],
  );

  const remove = useCallback(
    (id: string) => {
      flush();
      removeProject(id);
      const rest = loadIndex();
      setIndex(rest);
      if (id !== project.id) return;
      const next = rest.map((e) => loadProject(e.id)).find(Boolean) ?? null;
      if (next) {
        localStorage.setItem(LAST_KEY, next.id);
        setProject(next);
      } else {
        const fresh = createProject("새 검토서");
        saveProject(fresh);
        setProject(fresh);
        setIndex(loadIndex());
      }
    },
    [flush, project.id],
  );

  return { project, index, saveState, update, open, create, adopt, remove };
}
