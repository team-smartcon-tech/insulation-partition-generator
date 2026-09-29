/**
 * 본사 점검 — 현장에 가지 않고 **서버에 올라온 현장 서류를 보고 확인·보완 요청**을 남긴다.
 *
 * 현장 공유폴더를 이 앱으로 대신하려는 이유의 절반이 여기 있다. 지금까지 본사는 서류가
 * 올라왔는지 알 방법이 없어 전화로 묻거나 폴더를 뒤졌다.
 *
 * 이 화면만 **서버를 직접 본다.** 나머지 화면은 브라우저 저장소로 돌고 저장할 때 서버로
 * 따라 올린다(`formSync.ts`). 점검은 "다른 사람이 올린 것"을 보는 일이라 브라우저 사본으로는
 * 아예 할 수 없다.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { fetchDocs, fetchSites, fileUrl, patchDoc, ServerUnavailable, type DocRow } from "./formServer";
import { fileKind, fileSizeText } from "./library";
import type { FormSite } from "./sites";

/** 점검 상태별 이름표 — 목록에서 한눈에 갈라 보이게 */
const STATUS = {
  none: { label: "점검 전", tone: "bg-slate-100 text-slate-600" },
  requested: { label: "점검 요청", tone: "bg-amber-100 text-amber-800" },
  ok: { label: "확인됨", tone: "bg-emerald-100 text-emerald-800" },
  fix: { label: "보완 요청", tone: "bg-rose-100 text-rose-800" },
} as const;

type Filter = "all" | "todo" | "ok" | "fix";

export default function ReviewPage() {
  const [sites, setSites] = useState<FormSite[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [siteId, setSiteId] = useState<string>("");
  /** 지금 처리 중인 서류 id — 두 번 누르는 것을 막는다 */
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    // 30초마다 도는 자동 새로고침이 화면을 "읽는 중"으로 깜빡이게 하면 눈이 아프다.
    if (!quiet) setState("loading");
    try {
      const [siteRows, docRows] = await Promise.all([fetchSites(), fetchDocs({ kind: "site" })]);
      setSites(siteRows);
      setDocs(docRows);
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
    /*
     * 점검하는 사람은 이 화면을 **열어 둔 채로** 기다린다(현장이 올릴 때까지). 새로고침을 눌러야만
     * 보이면 "바로바로 안 뜬다"가 된다(사용자 신고). 30초마다 조용히 다시 읽는다.
     * 화면이 안 보일 때(다른 탭)는 건너뛴다 — 안 보는 화면 때문에 서버를 두드릴 이유가 없다.
     */
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const shown = docs.filter((doc) => {
    if (siteId && doc.site_id !== siteId) return false;
    if (filter === "todo") return doc.review_status === "requested" || doc.review_status === "none";
    if (filter === "ok") return doc.review_status === "ok";
    if (filter === "fix") return doc.review_status === "fix";
    return true;
  });

  const siteName = (id: string | null) => sites.find((site) => site.id === id)?.name ?? "(현장 없음)";

  async function decide(doc: DocRow, status: "ok" | "fix") {
    // 보완 요청은 **이유를 반드시 적는다.** 이유 없는 반려는 현장에서 또 묻게 된다.
    let note = doc.review_note ?? "";
    if (status === "fix") {
      const typed = window.prompt(`“${doc.title}” 무엇을 보완해야 하는지 적어 주세요.`, note);
      if (typed === null) return;
      if (!typed.trim()) {
        window.alert("보완할 내용을 적어 주세요.");
        return;
      }
      note = typed.trim();
    }
    setBusy(doc.id);
    try {
      const saved = await patchDoc(doc.id, { reviewStatus: status, reviewNote: status === "fix" ? note : "" });
      setDocs((list) => list.map((item) => (item.id === doc.id ? saved : item)));
    } catch (error) {
      setMessage(`점검 결과를 저장하지 못했습니다: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function download(doc: DocRow) {
    setBusy(doc.id);
    try {
      const { url } = await fileUrl(doc.id);
      // 새 창으로 연다 — 서명 주소는 5분만 살아 있어 저장해 둘 수 없다.
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setMessage(`파일을 열지 못했습니다: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const counts = {
    all: docs.length,
    todo: docs.filter((d) => d.review_status === "requested" || d.review_status === "none").length,
    ok: docs.filter((d) => d.review_status === "ok").length,
    fix: docs.filter((d) => d.review_status === "fix").length,
  };

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900">본사 점검</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            현장이 올린 서류입니다. 열어 보고 <b>확인</b> 또는 <b>보완 요청</b>을 남기면 현장에서 바로 보입니다.
          </p>
        </div>
        <select
          value={siteId}
          onChange={(event) => setSiteId(event.target.value)}
          aria-label="현장 고르기"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">현장 전체</option>
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

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["all", `전체 ${counts.all}`],
          ["todo", `볼 것 ${counts.todo}`],
          ["fix", `보완 요청 ${counts.fix}`],
          ["ok", `확인됨 ${counts.ok}`],
        ] as [Filter, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition " +
              (filter === value ? "bg-slate-900 text-white" : "text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {message && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">{message}</p>
      )}

      {state === "loading" && <p className="py-10 text-center text-sm text-slate-500">서버에서 읽는 중입니다…</p>}

      {state === "ready" && shown.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">
          {docs.length === 0
            ? "아직 현장에서 올라온 서류가 없습니다."
            : "이 조건에 해당하는 서류가 없습니다."}
        </p>
      )}

      {state === "ready" && shown.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {shown.map((doc) => {
            const kind = fileKind(doc.file_name);
            const status = STATUS[doc.review_status] ?? STATUS.none;
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  {doc.attachment ? <FileText size={16} /> : <FileSpreadsheet size={16} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="truncate text-sm font-semibold text-slate-900">{doc.title}</b>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${status.tone}`}>
                      {status.label}
                    </span>
                    {doc.attachment && (
                      <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                        {kind.label}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-slate-500">
                    {[
                      siteName(doc.site_id),
                      doc.code ? `${doc.code} 칸` : null,
                      doc.uploader_name ? `올린이 ${doc.uploader_name}` : null,
                      fileSizeText(doc.file_size ?? undefined),
                      new Date(doc.updated_at).toLocaleDateString("ko-KR"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {doc.review_status === "fix" && doc.review_note && (
                    <span className="mt-1 block text-[11.5px] text-rose-700">보완 요청: {doc.review_note}</span>
                  )}
                  {doc.review_status === "ok" && doc.reviewer_name && (
                    <span className="mt-1 block text-[11.5px] text-emerald-700">
                      {doc.reviewer_name} 확인 ·{" "}
                      {doc.reviewed_at ? new Date(doc.reviewed_at).toLocaleDateString("ko-KR") : ""}
                    </span>
                  )}
                </span>

                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy === doc.id}
                    onClick={() => void download(doc)}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Download size={13} /> 열기
                  </button>
                  {doc.review_status === "ok" ? (
                    <button
                      type="button"
                      disabled={busy === doc.id}
                      onClick={() => void decide(doc, "fix")}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Undo2 size={13} /> 보완 요청으로
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy === doc.id}
                        onClick={() => void decide(doc, "ok")}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:bg-slate-300"
                      >
                        <Check size={13} /> 확인
                      </button>
                      <button
                        type="button"
                        disabled={busy === doc.id}
                        onClick={() => void decide(doc, "fix")}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <TriangleAlert size={13} /> 보완 요청
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
