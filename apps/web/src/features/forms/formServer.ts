/**
 * 서버와 이야기하는 층 — 스마트폼의 자료를 **모두가 함께 보는 곳**에 둔다.
 *
 * 지금까지 현장·코드표·서류는 각자 브라우저 안에만 있었다(`formStore.ts`). 그래서 옆자리
 * 직원이 열면 비어 있고, 본사에서 현장 서류를 볼 방법이 없었다. 여기가 그 자리를 서버로 옮긴다.
 *
 * 서버 쪽 길은 `apps/worker/src/forms.ts`, 표는 `form_sites`·`form_documents`·`form_taxonomy`.
 *
 * 규칙 두 가지:
 * - **파일 바이트는 서버(Worker)를 지나가지 않는다.** 올릴 때는 짧은 유효시간 주소를 받아
 *   브라우저가 Supabase 로 직접 올리고, 받을 때도 짧은 주소를 받아 직접 내려받는다.
 * - 화면이 쓰는 말(`FormSite`·`Taxonomy`)과 서버가 쓰는 말(`sort_order`·`line_defaults`)이
 *   다르다. **그 통역은 전부 여기서 한다** — 화면과 서버 어느 쪽도 상대 말을 몰라도 되게.
 */
import type { FormSite } from "./sites.ts";
import type { Taxonomy } from "./taxonomy.ts";

/** 서버가 돌려주는 현장 한 줄 */
interface SiteRow {
  id: string;
  name: string;
  sort_order?: number;
  members?: unknown;
  line_defaults?: unknown;
  created_at?: string;
}

/** 서버가 돌려주는 코드표 한 벌 */
interface TaxonomyRow {
  id: string;
  division?: string;
  file_name?: string;
  groups?: unknown;
  conflicts?: unknown;
  sort_order?: number;
  updated_at?: string;
}

/** 서버에 닿지 못했을 때 화면이 알아볼 수 있는 오류 */
export class ServerUnavailable extends Error {
  constructor(message = "서버에 연결하지 못했습니다.") {
    super(message);
    this.name = "ServerUnavailable";
  }
}

/**
 * `/api/forms/...` 를 부른다.
 *
 * 로그인 쿠키를 함께 보내야 하므로 `credentials: "include"`. 서버가 답을 주지 못하는 것과
 * 답을 주면서 거절하는 것은 **화면에서 다르게 다뤄야 해서** 오류 종류를 나눈다.
 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/forms${path}`, {
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new ServerUnavailable(error instanceof Error ? error.message : undefined);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `서버가 거절했습니다(${res.status}).`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const time = (value: string | undefined) => (value ? new Date(value).getTime() : Date.now());

// ── 현장 ────────────────────────────────────────────────────────────────────

const toSite = (row: SiteRow): FormSite => ({
  id: row.id,
  name: row.name,
  createdAt: time(row.created_at),
  // 현장 조직·기본 결재선은 서버에 통째로(jsonb) 담아 둔다. 모양이 자주 바뀌고 서버가 그 안을
  // 들여다볼 일이 없다.
  members: Array.isArray(row.members) ? (row.members as FormSite["members"]) : undefined,
  lineDefaults:
    row.line_defaults && typeof row.line_defaults === "object"
      ? (row.line_defaults as FormSite["lineDefaults"])
      : undefined,
});

/** 본사 관리자 명단 한 줄 */
export interface FormAdmin {
  email: string;
  name?: string | null;
  added_by?: string | null;
  added_at?: string;
}

/** 지금 로그인한 사람이 **본사 관리자인지** 서버에 묻는다. */
export interface MeInfo {
  user: { id: string; name: string; email: string; role: string };
  /** 본사 관리자인가 — [배포 양식함]·[본사 점검] 탭을 보일지 정한다 */
  admin: boolean;
  /** 등급으로 얻은 권한인가(명단에서 뺄 수 없다) */
  byRole: boolean;
}

export const fetchMe = () => api<MeInfo>("/me");

export const fetchAdmins = async () => (await api<{ admins: FormAdmin[] }>("/admins")).admins;

export const addAdmin = async (email: string, name?: string) =>
  (await api<{ admin: FormAdmin }>("/admins", { method: "POST", body: JSON.stringify({ email, name }) })).admin;

export const removeAdmin = async (email: string) =>
  api<{ ok: true }>(`/admins/${encodeURIComponent(email)}`, { method: "DELETE" });

/* ── 오류·개선 의견 ───────────────────────────────────────────────────────── */

/** 의견 한 줄(서버 말 그대로 쓴다 — 화면에서만 쓰는 말이라 통역할 것이 없다) */
export interface FeedbackRow {
  id: string;
  kind: "bug" | "idea";
  title: string;
  body: string;
  where_at?: string | null;
  status: "open" | "doing" | "done" | "wont";
  reply?: string | null;
  replied_by?: string | null;
  replied_at?: string | null;
  author_id?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  created_at: string;
  updated_at?: string;
}

export const fetchFeedback = async () => (await api<{ feedback: FeedbackRow[] }>("/feedback")).feedback;

export const postFeedback = async (input: { kind: "bug" | "idea"; title: string; body: string; whereAt?: string }) =>
  (await api<{ item: FeedbackRow }>("/feedback", { method: "POST", body: JSON.stringify(input) })).item;

export const patchFeedback = async (
  id: string,
  patch: { kind?: "bug" | "idea"; title?: string; body?: string; whereAt?: string; status?: FeedbackRow["status"]; reply?: string },
) => (await api<{ item: FeedbackRow }>(`/feedback/${id}`, { method: "PATCH", body: JSON.stringify(patch) })).item;

export const deleteFeedback = (id: string) => api<{ ok: true }>(`/feedback/${id}`, { method: "DELETE" });

export async function fetchSites(): Promise<FormSite[]> {
  const { sites } = await api<{ sites: SiteRow[] }>("/sites");
  return (sites ?? []).map(toSite);
}

/**
 * 현장을 서버에 만든다(또는 조직·기본 결재선을 갱신한다).
 *
 * 같은 이름의 현장이 이미 있으면 서버가 **그것을 돌려준다** — 두 개가 생기면 서류가 갈린다.
 */
export async function pushSite(site: Pick<FormSite, "name"> & Partial<FormSite>): Promise<FormSite> {
  const { site: row } = await api<{ site: SiteRow }>("/sites", {
    method: "POST",
    body: JSON.stringify({
      // 브라우저가 만든 id 를 그대로 가져간다 — 서류가 어느 현장 것인지 연결이 끊기지 않게.
      id: site.id,
      name: site.name,
      members: site.members ?? [],
      lineDefaults: site.lineDefaults ?? {},
    }),
  });
  return toSite(row);
}

// ── 코드표 ──────────────────────────────────────────────────────────────────

const toTaxonomy = (row: TaxonomyRow): Taxonomy => ({
  id: row.id,
  division: row.division ?? "",
  groups: Array.isArray(row.groups) ? (row.groups as Taxonomy["groups"]) : [],
  fileName: row.file_name ?? "",
  updatedAt: time(row.updated_at),
  conflicts: Array.isArray(row.conflicts) ? (row.conflicts as string[]) : [],
});

export async function fetchTaxonomies(): Promise<Taxonomy[]> {
  const { taxonomies } = await api<{ taxonomies: TaxonomyRow[] }>("/taxonomy");
  return (taxonomies ?? []).map(toTaxonomy);
}

/**
 * 코드표 한 벌을 서버에 올린다. 로그인한 누구나 된다(2026-10-13 제약을 없앴다).
 * 바뀌기 전 것은 서버가 이력에 쌓아 두므로, 잘못 올려도 되돌릴 수 있다.
 */
export async function pushTaxonomy(taxonomy: Taxonomy, sortOrder = 0): Promise<Taxonomy> {
  const { taxonomy: row } = await api<{ taxonomy: TaxonomyRow }>("/taxonomy", {
    method: "PUT",
    body: JSON.stringify({
      id: taxonomy.id,
      division: taxonomy.division,
      fileName: taxonomy.fileName,
      groups: taxonomy.groups,
      conflicts: taxonomy.conflicts,
      sortOrder,
    }),
  });
  return toTaxonomy(row);
}

/** 코드표 한 벌을 서버에서 지운다. 로그인한 누구나 된다. 그 코드표의 서류는 "코드 없는 서류"가 된다. */
export const deleteTaxonomy = (id: string) =>
  api<{ ok: true }>(`/taxonomy/${encodeURIComponent(id)}`, { method: "DELETE" });

// ── 서류 ────────────────────────────────────────────────────────────────────

/** 서버가 돌려주는 서류 한 줄(목록에서는 무거운 칸이 빠져 있다) */
export interface DocRow {
  id: string;
  kind: "template" | "site";
  site_id: string | null;
  taxonomy_id: string | null;
  code: string | null;
  title: string;
  file_name: string;
  attachment: boolean;
  file_size: number | null;
  content_type: string | null;
  sheets?: unknown;
  parser_version: number | null;
  cell_values?: unknown;
  custom_sheets?: unknown;
  extra_rows?: unknown;
  approval_lines?: unknown;
  approvals?: unknown;
  template_id: string | null;
  template_uploaded_at: string | null;
  batch_id: string | null;
  uploaded_by: string | null;
  uploader_name: string | null;
  review_status: "none" | "requested" | "ok" | "fix";
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocFilter {
  kind?: "template" | "site";
  siteId?: string;
  /** 본사 점검함 — 점검을 요청했거나 결과가 달린 것만 */
  reviewOnly?: boolean;
}

export async function fetchDocs(filter: DocFilter = {}): Promise<DocRow[]> {
  const query = new URLSearchParams();
  if (filter.kind) query.set("kind", filter.kind);
  if (filter.siteId) query.set("siteId", filter.siteId);
  if (filter.reviewOnly) query.set("review", "1");
  const suffix = query.toString();
  const { docs } = await api<{ docs: DocRow[] }>(`/docs${suffix ? `?${suffix}` : ""}`);
  return docs ?? [];
}

export async function fetchDoc(id: string): Promise<DocRow> {
  const { doc } = await api<{ doc: DocRow }>(`/docs/${encodeURIComponent(id)}`);
  return doc;
}

export interface NewDoc {
  /** 브라우저에 이미 있던 서류를 옮길 때, 그 id 를 그대로 가져간다 */
  id?: string;
  kind: "template" | "site";
  siteId?: string | null;
  taxonomyId?: string | null;
  code?: string | null;
  title?: string;
  fileName: string;
  attachment: boolean;
  contentType?: string | null;
  /** 엑셀이면 화면에 그릴 격자. 첨부는 없다. */
  sheets?: unknown;
  parserVersion?: number;
  templateId?: string | null;
  templateUploadedAt?: string | null;
  batchId?: string | null;
}

/**
 * 서류 1건을 올린다 — 꼬리표를 만들고 **파일은 Supabase 로 직접** 보낸다.
 *
 * 세 걸음으로 나뉘는 이유: 파일 바이트가 Worker 를 지나가면 요청 크기 제한에 걸린다.
 * ① 서버에 꼬리표를 만들고 올리기 주소를 받는다 → ② 그 주소로 파일을 직접 올린다
 * → ③ 다 올렸다고 알린다(크기 기록).
 */
export async function uploadDoc(doc: NewDoc, bytes: ArrayBuffer): Promise<DocRow> {
  const created = await api<{ doc: DocRow; upload: { url: string; token: string } }>("/docs", {
    method: "POST",
    body: JSON.stringify(doc),
  });

  const put = await fetch(`${created.upload.url}?token=${encodeURIComponent(created.upload.token)}`, {
    method: "PUT",
    headers: { "Content-Type": doc.contentType || "application/octet-stream" },
    body: bytes,
  });
  if (!put.ok) {
    // 꼬리표만 남고 파일이 없는 서류는 목록에서 "열리지 않는 서류"가 된다. 흔적을 지운다.
    await deleteDoc(created.doc.id).catch(() => {});
    throw new Error(`파일을 올리지 못했습니다(${put.status}).`);
  }

  const { doc: saved } = await api<{ doc: DocRow }>(`/docs/${created.doc.id}/uploaded`, {
    method: "POST",
    body: JSON.stringify({ fileSize: bytes.byteLength }),
  });
  return saved;
}

/** 적은 글자·결재·점검을 갱신한다. **보낸 것만** 바뀐다. */
export async function patchDoc(
  id: string,
  patch: {
    title?: string;
    cellValues?: unknown;
    customSheets?: unknown;
    extraRows?: unknown;
    approvalLines?: unknown;
    approvals?: unknown;
    /** 시트 이름 → 그 장을 쓰는 부서 */
    sheetDepts?: unknown;
    sheets?: unknown;
    parserVersion?: number;
    taxonomyId?: string | null;
    code?: string | null;
    /** 본사 점검 — 점검자·시각은 서버가 적는다 */
    reviewStatus?: "none" | "requested" | "ok" | "fix";
    reviewNote?: string;
  },
): Promise<DocRow> {
  const { doc } = await api<{ doc: DocRow }>(`/docs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return doc;
}

export async function deleteDoc(id: string): Promise<void> {
  await api<{ ok: true }>(`/docs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 파일을 내려받을 짧은 유효시간 주소(5분). 원래 파일 이름으로 내려간다. */
export async function fileUrl(id: string): Promise<{ url: string; fileName: string }> {
  return api<{ url: string; fileName: string }>(`/docs/${encodeURIComponent(id)}/file`);
}

/** 서류의 원본 바이트를 받아 온다(엑셀 내려받기·다시 읽기에 쓴다). */
export async function fetchDocBytes(id: string): Promise<ArrayBuffer> {
  const { url } = await fileUrl(id);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`파일을 받지 못했습니다(${res.status}).`);
  return res.arrayBuffer();
}
