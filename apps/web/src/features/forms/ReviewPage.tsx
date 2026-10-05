/**
 * 본사 점검 — **현장 폴더를 탐색기처럼 훑어보며** 서류를 열어 보고 부적합을 지적한다.
 *
 * 사용자가 원한 모습(신고): "항목별 점검 목록이 아니라, 현장 전체 파일 트리를 보고 세부 파일을
 * 눌러 보면서 부적합한 내용을 점검하는 형식". 지금 현장이 쓰는 공유폴더(`Z:\01. 공사`)를 그대로
 * 옮겨 놓은 모양이어야 본사 사람이 익숙하게 쓴다.
 *
 * 왼쪽: 분류 트리(100 공통일반 / 300 공사일지 …). **파일이 없는 칸도 보여 준다** — 점검에서는
 *       "안 올라온 서류"가 올라온 것만큼 중요하다.
 * 가운데: 고른 칸의 파일들.
 * 오른쪽(아래): 고른 파일의 **내용**. 엑셀은 격자를 그대로 그리고(내려받지 않아도 된다),
 *       사진·PDF 는 바로 띄우고, 그 밖의 것은 내려받아 본다. 그 자리에서 [확인]·[보완 요청].
 *
 * 이 화면만 **서버를 직접 본다.** 남이 올린 것을 보는 일이라 브라우저 사본으로는 할 수 없다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import {
  addAdmin,
  fetchAdmins,
  fetchDoc,
  fetchDocs,
  fetchSites,
  fetchTaxonomies,
  fileUrl,
  patchDoc,
  removeAdmin,
  ServerUnavailable,
  type DocRow,
  type FormAdmin,
} from "./formServer";
import { fileKind, fileSizeText } from "./library";
import FormSheetView from "./FormSheetView";
import type { FormSheet } from "./types";
import type { FormSite } from "./sites";
import { divisionLabel, type Taxonomy } from "./taxonomy";

const STATUS = {
  none: { label: "점검 전", tone: "bg-slate-100 text-slate-600" },
  requested: { label: "점검 요청", tone: "bg-amber-100 text-amber-800" },
  ok: { label: "확인됨", tone: "bg-emerald-100 text-emerald-800" },
  fix: { label: "보완 요청", tone: "bg-rose-100 text-rose-800" },
} as const;

/** 트리에서 고른 자리. 코드가 없는 서류는 따로 모은다. */
type Slot = { taxonomyId: string; code: string } | { taxonomyId: ""; code: "" };
const slotKey = (taxonomyId: string, code: string) => `${taxonomyId}:${code}`;

export default function ReviewPage() {
  const [sites, setSites] = useState<FormSite[]>([]);
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const [siteId, setSiteId] = useState<string>("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [slot, setSlot] = useState<Slot | null>(null);
  /** 고른 파일(격자·적은 글자까지 받아 온 것) */
  const [opened, setOpened] = useState<DocRow | null>(null);
  const [openedBytes, setOpenedBytes] = useState<ArrayBuffer | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState("loading");
    try {
      const [siteRows, taxonomyRows, docRows] = await Promise.all([
        fetchSites(),
        fetchTaxonomies(),
        fetchDocs({ kind: "site" }),
      ]);
      setSites(siteRows);
      setTaxonomies(taxonomyRows);
      setDocs(docRows);
      setSiteId((current) => current || siteRows[0]?.id || "");
      setState("ready");
      setMessage(null);
    } catch (error) {
      setState("offline");
      setMessage(
        error instanceof ServerUnavailable
          ? "서버에 연결하지 못했습니다. 사무실 망에 있는지 확인해 주세요."
          : (error as Error).message,
      );
    }
  }, []);

  useEffect(() => {
    void load();
    // 점검하는 사람은 화면을 열어 둔 채 기다린다. 30초마다 조용히 다시 읽는다.
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  /** 이 현장의 서류만. 칸(분류+코드)별로 모아 둔다. */
  const bySlot = useMemo(() => {
    const map = new Map<string, DocRow[]>();
    for (const doc of docs) {
      if (siteId && doc.site_id !== siteId) continue;
      const key = slotKey(doc.taxonomy_id ?? "", doc.code ?? "");
      const list = map.get(key);
      if (list) list.push(doc);
      else map.set(key, [doc]);
    }
    return map;
  }, [docs, siteId]);

  const inSlot = slot ? (bySlot.get(slotKey(slot.taxonomyId, slot.code)) ?? []) : [];
  const unfiled = bySlot.get(slotKey("", "")) ?? [];
  const siteDocs = useMemo(() => docs.filter((doc) => !siteId || doc.site_id === siteId), [docs, siteId]);
  const needFix = siteDocs.filter((doc) => doc.review_status === "fix").length;
  const notChecked = siteDocs.filter((doc) => doc.review_status === "none" || doc.review_status === "requested").length;

  async function openFile(doc: DocRow) {
    setBusy(true);
    setOpenedBytes(null);
    setSheetIndex(0);
    try {
      // 목록에는 무거운 칸(격자·적은 글자)이 빠져 있다. 열 때 한 건만 통째로 받아 온다.
      const full = await fetchDoc(doc.id);
      setOpened(full);
      // 사진·PDF 는 그 자리에서 보여 준다. 엑셀은 격자가 이미 있어 파일을 받을 필요가 없다.
      const kind = fileKind(full.file_name);
      if (full.attachment && kind.preview) {
        const { url } = await fileUrl(full.id);
        const res = await fetch(url);
        if (res.ok) setOpenedBytes(await res.arrayBuffer());
      }
    } catch (error) {
      setMessage(`서류를 열지 못했습니다: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function decide(doc: DocRow, status: "ok" | "fix") {
    let note = doc.review_note ?? "";
    if (status === "fix") {
      // 보완 요청은 **이유를 반드시 적는다.** 이유 없는 반려는 현장에서 또 묻게 된다.
      const typed = window.prompt(`“${doc.title}” 무엇이 부적합한지 적어 주세요.`, note);
      if (typed === null) return;
      if (!typed.trim()) {
        window.alert("부적합한 내용을 적어 주세요.");
        return;
      }
      note = typed.trim();
    }
    setBusy(true);
    try {
      const saved = await patchDoc(doc.id, { reviewStatus: status, reviewNote: status === "fix" ? note : "" });
      setDocs((list) => list.map((item) => (item.id === doc.id ? { ...item, ...saved } : item)));
      setOpened((current) => (current && current.id === doc.id ? { ...current, ...saved } : current));
    } catch (error) {
      setMessage(`점검 결과를 저장하지 못했습니다: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function download(doc: DocRow) {
    setBusy(true);
    try {
      const { url } = await fileUrl(doc.id);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setMessage(`파일을 열지 못했습니다: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const toggleGroup = (key: string) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900">본사 점검</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            현장 서류함을 그대로 펼쳐 봅니다. 왼쪽에서 칸을 고르고, 파일을 눌러 <b>내용을 보면서</b> 확인하거나 보완을
            요청하세요.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs">
          {notChecked > 0 && (
            <span className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-800">점검 전 {notChecked}</span>
          )}
          {needFix > 0 && (
            <span className="rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-700">보완 요청 {needFix}</span>
          )}
        </span>
        <select
          value={siteId}
          onChange={(event) => {
            setSiteId(event.target.value);
            setSlot(null);
            setOpened(null);
          }}
          aria-label="현장 고르기"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          {sites.length === 0 && <option value="">현장 없음</option>}
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
        >
          <RefreshCw size={13} /> 새로 읽기
        </button>
      </div>

      {message && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">{message}</p>
      )}
      {state === "loading" && <p className="py-10 text-center text-sm text-slate-500">서버에서 읽는 중입니다…</p>}

      {state === "ready" && (
        <div className="mt-4 grid gap-5 lg:grid-cols-4">
          {/* ── 왼쪽: 현장 폴더 트리 ── */}
          {/* 왼쪽 한 칸은 트리, 나머지 세 칸은 파일과 내용 — 흔한 탐색기 배치다. */}
          <nav
            className="max-h-[70vh] overflow-y-auto border-t border-slate-100 pt-3 lg:col-span-1"
            aria-label="현장 폴더"
          >
            {taxonomies.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-slate-400">
                분류 코드표가 아직 서버에 없습니다. 현장에서 한 번 열면 올라갑니다.
              </p>
            )}
            {taxonomies.map((taxonomy) => (
              <div key={taxonomy.id} className="mb-3">
                <p className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {divisionLabel(taxonomy.division) || "분류"}
                </p>
                {taxonomy.groups.map((group) => {
                  const key = `${taxonomy.id}:${group.code}`;
                  const open = openGroups.has(key);
                  const count = group.items.reduce(
                    (sum, item) => sum + (bySlot.get(slotKey(taxonomy.id, item.code))?.length ?? 0),
                    0,
                  );
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(key)}
                        className="flex w-full items-center gap-1 rounded-lg px-1.5 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                      >
                        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <FolderOpen size={13} className="text-slate-400" />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="tabular-nums text-slate-500">{group.code}</span> {group.name}
                        </span>
                        <span className={"shrink-0 text-[11px] " + (count > 0 ? "font-semibold text-blue-700" : "text-slate-300")}>
                          {count}
                        </span>
                      </button>
                      {open &&
                        group.items.map((item) => {
                          const files = bySlot.get(slotKey(taxonomy.id, item.code)) ?? [];
                          const active = slot?.taxonomyId === taxonomy.id && slot?.code === item.code;
                          return (
                            <button
                              key={`${key}:${item.code}`}
                              type="button"
                              onClick={() => {
                                setSlot({ taxonomyId: taxonomy.id, code: item.code });
                                setOpened(null);
                              }}
                              className={
                                "flex w-full items-center gap-2 rounded-lg py-1 pl-8 pr-2 text-left text-[12.5px] transition " +
                                (active ? "bg-blue-50 font-semibold text-blue-800" : "hover:bg-slate-50") +
                                (files.length === 0 && !active ? " text-slate-400" : " text-slate-700")
                              }
                            >
                              <span className="min-w-0 flex-1 truncate">
                                <span className="tabular-nums">{item.code}</span> {item.name}
                              </span>
                              <span className="shrink-0 text-[11px] text-slate-400">
                                {files.length > 0 ? files.length : "없음"}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  );
                })}
              </div>
            ))}

            {unfiled.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSlot({ taxonomyId: "", code: "" });
                  setOpened(null);
                }}
                className={
                  "mt-2 flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[13px] transition " +
                  (slot?.taxonomyId === "" && slot?.code === ""
                    ? "bg-blue-50 font-semibold text-blue-800"
                    : "text-slate-700 hover:bg-slate-50")
                }
              >
                <FolderOpen size={13} className="text-slate-400" />
                <span className="min-w-0 flex-1 truncate">분류 없는 서류</span>
                <span className="shrink-0 text-[11px] font-semibold text-blue-700">{unfiled.length}</span>
              </button>
            )}
          </nav>

          {/* ── 오른쪽: 파일 목록 + 내용 ── */}
          <div className="min-w-0 lg:col-span-3">
            {!slot && (
              <p className="py-16 text-center text-sm text-slate-500">
                왼쪽에서 볼 칸을 골라 주세요. 숫자는 그 칸에 올라온 파일 수입니다.
              </p>
            )}

            {slot && (
              <>
                <ul className="divide-y divide-slate-100 border-y border-slate-100">
                  {inSlot.length === 0 && (
                    <li className="py-8 text-center text-sm text-slate-500">이 칸에는 아직 올라온 서류가 없습니다.</li>
                  )}
                  {inSlot.map((doc) => {
                    const status = STATUS[doc.review_status] ?? STATUS.none;
                    const active = opened?.id === doc.id;
                    return (
                      <li key={doc.id}>
                        <button
                          type="button"
                          onClick={() => void openFile(doc)}
                          className={
                            "flex w-full items-center gap-3 px-2 py-2.5 text-left transition " +
                            (active ? "bg-blue-50" : "hover:bg-slate-50")
                          }
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            {doc.attachment ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <b className="truncate text-sm font-semibold text-slate-900">{doc.title}</b>
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${status.tone}`}>
                                {status.label}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-[11.5px] text-slate-500">
                              {[
                                doc.uploader_name ? `올린이 ${doc.uploader_name}` : null,
                                fileSizeText(doc.file_size ?? undefined),
                                new Date(doc.updated_at).toLocaleDateString("ko-KR"),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {opened && <FileReview doc={opened} bytes={openedBytes} busy={busy} sheetIndex={sheetIndex} onSheet={setSheetIndex} onDownload={() => void download(opened)} onDecide={(status) => void decide(opened, status)} />}
              </>
            )}
          </div>
        </div>
      )}

      <AdminList />
    </section>
  );
}

/**
 * 본사 관리자 명단 — **누가 [배포 양식함]·[본사 점검]을 볼 수 있나.**
 *
 * 등급(최고·시스템 관리자)은 회사 공용 로그인 시스템이 정하는 것이라 여기서 못 바꾼다.
 * 그래서 이 명단에 이메일을 넣어 **스마트폼 안에서만** 본사 권한을 준다(2026-09-11에 정한 규칙).
 * 이 화면 자체가 본사만 들어오는 곳이라 여기에 둔다.
 */
function AdminList() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FormAdmin[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchAdmins());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "명단을 읽지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    if (open && rows === null) void load();
  }, [open, rows, load]);

  return (
    <div className="mt-6 border-t border-dashed border-slate-200 pt-4">
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} 본사 관리자 명단
        {rows && <span className="font-normal text-slate-400">{rows.length}명</span>}
      </button>

      {open && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <p className="mb-2 text-xs text-slate-500">
            여기 있는 사람만 [배포 양식함]과 [본사 점검]을 볼 수 있습니다. 최고·시스템 관리자 등급은 명단에 없어도
            볼 수 있습니다.
          </p>
          {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}

          <ul className="mb-3 space-y-1">
            {(rows ?? []).map((row) => (
              <li key={row.email} className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs">
                <span className="font-medium text-slate-800">{row.name || row.email}</span>
                <span className="text-slate-400">{row.email}</span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`${row.name || row.email} 님을 본사 관리자에서 뺄까요?`)) return;
                    try {
                      await removeAdmin(row.email);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "빼지 못했습니다.");
                    }
                    await load();
                  }}
                  className="ml-auto rounded px-2 py-0.5 font-medium text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50"
                >
                  빼기
                </button>
              </li>
            ))}
            {rows !== null && rows.length === 0 && (
              <li className="px-1 text-xs text-slate-400">명단이 비어 있습니다(등급으로만 들어오고 있습니다).</li>
            )}
          </ul>

          <div className="flex flex-wrap gap-2">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="이메일"
              className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-blue-500"
            />
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="이름(선택)"
              className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-blue-500"
            />
            <button
              type="button"
              disabled={email.trim() === ""}
              onClick={async () => {
                try {
                  await addAdmin(email.trim(), name.trim() || undefined);
                  setEmail("");
                  setName("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "넣지 못했습니다.");
                }
                await load();
              }}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-900 disabled:bg-slate-300"
            >
              본사 관리자로 넣기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 고른 파일 한 건의 내용과 점검 단추 */
function FileReview({
  doc,
  bytes,
  busy,
  sheetIndex,
  onSheet,
  onDownload,
  onDecide,
}: {
  doc: DocRow;
  bytes: ArrayBuffer | null;
  busy: boolean;
  sheetIndex: number;
  onSheet: (index: number) => void;
  onDownload: () => void;
  onDecide: (status: "ok" | "fix") => void;
}) {
  const kind = fileKind(doc.file_name);
  const sheets = (Array.isArray(doc.sheets) ? doc.sheets : []) as FormSheet[];
  const values = (doc.cell_values ?? {}) as Record<string, Record<string, string>>;
  const sheet = sheets[Math.min(sheetIndex, sheets.length - 1)];

  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes || !kind.preview) {
      setPreview(null);
      return;
    }
    const type = kind.preview === "pdf" ? "application/pdf" : "image/*";
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    setPreview(url);
    // 다 보고 나면 되돌려 놓는다 — 안 그러면 브라우저가 그 바이트를 계속 붙들고 있다.
    return () => URL.revokeObjectURL(url);
  }, [bytes, kind.preview]);

  return (
    <div className="mt-5 rounded-2xl ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <b className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{doc.file_name}</b>
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <Download size={13} /> 내려받기
        </button>
        {doc.review_status === "ok" ? (
          <button
            type="button"
            onClick={() => onDecide("fix")}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
          >
            <Undo2 size={13} /> 보완 요청으로
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onDecide("ok")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:bg-slate-300"
            >
              <Check size={13} /> 확인
            </button>
            <button
              type="button"
              onClick={() => onDecide("fix")}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
            >
              <TriangleAlert size={13} /> 보완 요청
            </button>
          </>
        )}
      </div>

      {doc.review_status === "fix" && doc.review_note && (
        <p className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          보완 요청: {doc.review_note}
          {doc.reviewer_name ? ` (${doc.reviewer_name})` : ""}
        </p>
      )}

      {/* 엑셀 — 격자를 그대로 그린다. 내려받지 않아도 내용을 본다. */}
      {!doc.attachment && sheets.length > 0 && (
        <div className="p-4">
          {sheets.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {sheets.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onSheet(index)}
                  className={
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition " +
                    (index === sheetIndex ? "bg-blue-600 text-white" : "text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50")
                  }
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
          {sheet && (
            <div className="overflow-auto">
              <FormSheetView sheet={sheet} editable={false} values={values[sheet.name] ?? {}} tint={false} scale="fit" />
            </div>
          )}
        </div>
      )}

      {/* 사진·PDF — 그 자리에서 보여 준다 */}
      {doc.attachment && preview && (
        <div className="p-4">
          {kind.preview === "image" ? (
            <img src={preview} alt={doc.file_name} className="max-h-[60vh] rounded-lg ring-1 ring-slate-200" />
          ) : (
            <object data={preview} type="application/pdf" className="h-[60vh] w-full rounded-lg ring-1 ring-slate-200">
              <p className="p-4 text-sm text-slate-500">이 브라우저에서는 PDF 를 바로 볼 수 없습니다.</p>
            </object>
          )}
        </div>
      )}

      {/* 화면에서 볼 수 없는 것(한글·도면·압축) — 내려받아 본다 */}
      {doc.attachment && !kind.preview && (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          {kind.label} 파일은 화면에서 바로 볼 수 없습니다. [내려받기]로 확인해 주세요.
        </p>
      )}
      {!doc.attachment && sheets.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          이 서류에는 화면에 그릴 내용이 없습니다. [내려받기]로 확인해 주세요.
        </p>
      )}
    </div>
  );
}
