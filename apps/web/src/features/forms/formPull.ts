/**
 * 서버 → 브라우저: 다른 사람이 올린 배포 양식·현장 서류를 받아 온다(2026-10-15 사용자 요청).
 *
 * 화면은 브라우저(IndexedDB)에 있는 서류만 보여 주고, 저장할 때 서버로 **올리기만** 했다. 그래서
 * 다른 사람이 처음 열면 현장 서류함이 비어 "양식 없음"만 줄줄이 보이고 [배포 양식에서 가져오기]도
 * 고를 것이 없었다. 화면을 열 때 서버 목록과 견줘 없는 것·서버가 더 새것을 받아 온다.
 *
 * - **원본 파일은 나중에** 받는다. 서버 서류가 200건 넘게(150MB 넘게) 있어 처음에 다 받으면 화면이
 *   한참 멈춘다. 목록·격자·적은 글자만 받고 엑셀 원본은 그 서류를 열거나 복사할 때 받는다.
 * - 이 현장 서류 → 배포 양식 → 다른 현장 서류 순서로 받는다(지금 보는 화면부터 채운다).
 * - 서버가 1분 넘게 더 새것이면 적은 글자·결재·작성 부서를 덮는다. 원본 파일·줄 끼우기·즐겨찾기처럼
 *   서버에 없는 것은 그대로 둔다.
 * - 서버에서 받아 온 서류가 서버에서 지워졌으면 브라우저에서도 지운다.
 */
import { fetchDoc, fetchDocs, type DocRow } from "./formServer.ts";
import { listForms, pruneServerForms, storeServerForm, UNCATEGORIZED, type StoredForm } from "./formStore.ts";
import { readPendingDeletes } from "./pendingDeletes.ts";
import type { FormSheet } from "./types";

const timeOf = (iso: string | null | undefined): number | undefined => (iso ? new Date(iso).getTime() : undefined);
const record = <T>(value: unknown): T => (value && typeof value === "object" && !Array.isArray(value) ? (value as T) : ({} as T));

/** 서버가 이만큼 넘게 더 새것이어야 덮는다 — 내가 방금 올린 것의 서버 시각은 몇 초 늦다. */
const NEWER_MARGIN_MS = 60_000;
/** 한꺼번에 받는 수 */
const PARALLEL = 4;

/** 서버 한 건의 내용(적은 글자·결재 등) — 이미 있는 서류에 덮을 것 */
export function contentFromServer(row: DocRow): Partial<StoredForm> {
  return {
    title: row.title || row.file_name,
    code: row.code ?? undefined,
    taxonomyId: row.taxonomy_id ?? undefined,
    values: record(row.cell_values),
    customSheets: Array.isArray(row.custom_sheets) ? (row.custom_sheets as StoredForm["customSheets"]) : [],
    extraRows: record(row.extra_rows),
    approvalLines: record(row.approval_lines),
    approvals: record(row.approvals),
    sheetDepts: record(row.sheet_depts),
    sheetEditedAt: record(row.sheet_edited_at),
    updatedAt: timeOf(row.updated_at) ?? Date.now(),
  };
}

/**
 * 서버 한 건 → 브라우저 서류. 원본 파일은 비워 두고 `remoteBytes` 로 표시한다.
 *
 * 배포 양식의 "올라온 때"는 서버가 만든 때(created_at)가 아니라 **현장 사본이 기억하는 때**를 쓴다.
 * 브라우저에서 올린 뒤 나중에 [서버로 옮기기]를 한 양식은 서버 시각이 늦어, 그대로 쓰면 그 양식으로
 * 만든 서류마다 "새 판 있음"이 잘못 뜬다.
 */
export function formFromServer(row: DocRow, templateTimes: Map<string, number>): StoredForm {
  const created = timeOf(row.created_at) ?? Date.now();
  return {
    id: row.id,
    fileName: row.file_name,
    category: UNCATEGORIZED,
    siteId: row.kind === "site" ? (row.site_id ?? undefined) : undefined,
    kind: row.kind,
    batchId: row.batch_id ?? undefined,
    attachment: row.attachment || undefined,
    fileSize: row.file_size ?? undefined,
    templateId: row.template_id ?? undefined,
    templateUploadedAt: timeOf(row.template_uploaded_at),
    favorite: false,
    uploadedAt: (row.kind === "template" ? templateTimes.get(row.id) : undefined) ?? created,
    openedAt: 0,
    bytes: new ArrayBuffer(0),
    remoteBytes: true,
    fromServer: true,
    sheets: Array.isArray(row.sheets) ? (row.sheets as FormSheet[]) : [],
    parserVersion: row.parser_version ?? 0,
    rowInserts: {},
    mergeEdits: {},
    ...(contentFromServer(row) as Required<Pick<StoredForm, "title" | "values" | "customSheets" | "extraRows" | "approvalLines" | "approvals" | "updatedAt">>),
  };
}

/** 받아 올 순서 — 지금 보는 현장의 서류, 배포 양식, 나머지 */
export function pullOrder(rows: DocRow[], siteId: string | undefined): DocRow[] {
  const rank = (row: DocRow) => (row.kind === "site" && row.site_id === siteId ? 0 : row.kind === "template" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b));
}

export interface PullResult {
  added: number;
  updated: number;
  removed: number;
  failed: number;
}

/**
 * 서버 서류를 받아 온다. 서버에 못 닿으면 던진다(화면은 브라우저 것으로 돌아간다).
 * `onProgress` 는 받을 것이 있을 때만, 한 건 받을 때마다 부른다.
 */
export async function pullDocs(
  siteId: string | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<PullResult> {
  const result: PullResult = { added: 0, updated: 0, removed: 0, failed: 0 };
  const all = await fetchDocs();
  result.removed = await pruneServerForms(new Set(all.map((row) => row.id)));
  // 파일 올리기가 끝나지 않은 꼬리표는 열 수 없어 받지 않는다.
  const rows = all.filter((row) => row.file_size !== null || row.attachment);
  const pendingDeletes = new Set(readPendingDeletes());
  const local = new Map((await listForms()).map((form) => [form.id, form]));

  // 현장 사본이 기억하는 배포 양식의 올라온 때
  const templateTimes = new Map<string, number>();
  for (const row of rows) {
    const at = timeOf(row.template_uploaded_at);
    if (row.template_id && at !== undefined) templateTimes.set(row.template_id, at);
  }

  const todo = pullOrder(
    rows.filter((row) => {
      if (pendingDeletes.has(row.id)) return false;
      const mine = local.get(row.id);
      return !mine || (timeOf(row.updated_at) ?? 0) > mine.updatedAt + NEWER_MARGIN_MS;
    }),
    siteId,
  );
  if (todo.length === 0) return result;

  let done = 0;
  onProgress?.(0, todo.length);
  const queue = [...todo];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try {
        const full = await fetchDoc(row.id);
        const outcome = await storeServerForm(formFromServer(full, templateTimes), contentFromServer(full));
        if (outcome === "added") result.added += 1;
        if (outcome === "updated") result.updated += 1;
      } catch (error) {
        result.failed += 1;
        console.warn(`[스마트폼] 서버 서류 “${row.title}”을(를) 받아 오지 못했습니다:`, error);
      }
      done += 1;
      onProgress?.(done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return result;
}
