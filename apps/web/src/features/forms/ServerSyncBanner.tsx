/**
 * 서버로 옮기기 안내 띠 — **이 브라우저에만 있는 자료**가 있으면 알리고, 한 번에 올린다.
 *
 * 스마트폼은 지금까지 자료를 브라우저(IndexedDB)에만 두었다. 그래서 옆자리 직원이 열면 비어
 * 있고, 본사가 현장 서류를 볼 수 없었다. 서버 자리가 생겼으니 **쌓아 둔 것을 한 번 옮겨야** 한다.
 *
 * 무섭지 않게 만드는 것이 이 화면의 목적이다:
 * - 옮겨도 **브라우저 쪽은 지우지 않는다**(잘못돼도 원래 자리에 그대로).
 * - 여러 번 눌러도 안전하다(이미 올라간 것은 건너뛴다).
 * - 무엇이 안 됐는지 숨기지 않고 그대로 보여 준다.
 */
import { useEffect, useState } from "react";
import { CloudUpload, Check, TriangleAlert, X } from "lucide-react";
import { fetchDocs, ServerUnavailable } from "./formServer";
import { migrateLocalToServer, type MigrateProgress, type MigrateResult } from "./formMigrate";

type Phase =
  | { kind: "checking" }
  /** 서버에 못 닿는다 — 조용히 접어 둔다(사무실 밖에서 쓰는 중일 수 있다) */
  | { kind: "offline"; message: string }
  /** 옮길 것이 있다 */
  | { kind: "ready"; local: number; onServer: number }
  | { kind: "working"; progress: MigrateProgress }
  | { kind: "done"; result: MigrateResult }
  /** 옮길 것이 없다(이미 다 서버에 있다) */
  | { kind: "clean" };

export default function ServerSyncBanner({ localCount }: { localCount: number }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docs = await fetchDocs();
        if (cancelled) return;
        // 브라우저에 있는 것이 서버보다 많으면 아직 안 옮긴 것이 있다는 뜻이다.
        setPhase(localCount > docs.length ? { kind: "ready", local: localCount, onServer: docs.length } : { kind: "clean" });
      } catch (error) {
        if (cancelled) return;
        setPhase({
          kind: "offline",
          message: error instanceof ServerUnavailable ? "서버에 연결하지 못했습니다." : (error as Error).message,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localCount]);

  if (hidden || phase.kind === "checking" || phase.kind === "clean") return null;
  // 서버에 못 닿는 것은 사용자가 할 수 있는 일이 없다. 조용히 한 줄만.
  if (phase.kind === "offline") {
    return (
      <p className="mb-4 rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-500 ring-1 ring-slate-200">
        서버에 연결하지 못했습니다. 지금 작업은 이 브라우저에만 저장됩니다. ({phase.message})
      </p>
    );
  }

  const start = async () => {
    setPhase({ kind: "working", progress: { step: "준비", done: 0, total: 0 } });
    try {
      const result = await migrateLocalToServer((progress) => setPhase({ kind: "working", progress }));
      setPhase({ kind: "done", result });
    } catch (error) {
      setPhase({
        kind: "done",
        result: { sites: 0, taxonomies: 0, docs: 0, skipped: 0, failed: [(error as Error).message] },
      });
    }
  };

  return (
    <div className="mb-5 rounded-2xl bg-blue-50 px-5 py-4 ring-1 ring-blue-200">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
          <CloudUpload size={17} />
        </span>

        {phase.kind === "ready" && (
          <>
            <span className="min-w-0 flex-1 text-sm text-blue-900">
              <b className="font-semibold">이 브라우저에만 있는 자료가 {phase.local}건</b> 있습니다. 서버로 옮기면 다른
              PC·본사에서도 같은 자료를 봅니다.
              <span className="mt-0.5 block text-xs text-blue-800/80">
                옮겨도 이 브라우저의 자료는 지우지 않습니다. 여러 번 눌러도 안전합니다.
              </span>
            </span>
            <button
              type="button"
              onClick={() => void start()}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              서버로 옮기기
            </button>
          </>
        )}

        {phase.kind === "working" && (
          <span className="min-w-0 flex-1 text-sm text-blue-900">
            <b className="font-semibold">{phase.progress.step}</b> 옮기는 중…{" "}
            {phase.progress.total > 0 ? `${phase.progress.done}/${phase.progress.total}` : ""}
            <span className="mt-0.5 block text-xs text-blue-800/80">
              파일이 크면 시간이 걸립니다. 이 창을 닫지 마세요.
            </span>
          </span>
        )}

        {phase.kind === "done" && (
          <>
            <span className="min-w-0 flex-1 text-sm text-blue-900">
              <b className="inline-flex items-center gap-1 font-semibold">
                {phase.result.failed.length === 0 ? <Check size={14} /> : <TriangleAlert size={14} />}
                옮기기 끝
              </b>{" "}
              — 현장 {phase.result.sites} · 코드표 {phase.result.taxonomies} · 서류 {phase.result.docs}
              {phase.result.skipped > 0 ? ` · 이미 있던 것 ${phase.result.skipped}` : ""}
              {phase.result.failed.length > 0 && (
                <span className="mt-1 block text-xs text-rose-700">
                  옮기지 못한 것 {phase.result.failed.length}건:
                  <ul className="mt-0.5 list-disc pl-4">
                    {phase.result.failed.slice(0, 5).map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setHidden(true)}
              aria-label="닫기"
              className="shrink-0 rounded-lg p-1.5 text-blue-700 hover:bg-blue-100"
            >
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
