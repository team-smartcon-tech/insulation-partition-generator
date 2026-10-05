/**
 * 서버 올리기 띠 — **아직 서버에 없는 서류**를 찾아 올리고, 그 상황을 알린다.
 *
 * 스마트폼은 오래 브라우저(IndexedDB)에만 자료를 두었다. 서버 저장이 붙은 뒤에 만든 것은
 * 저장할 때 따라 올라가지만(`formSync.ts`), **그 전에 쌓아 둔 것은 그대로 남아 있다.**
 * 그래서 본사 점검 화면이 "아직 올라온 서류가 없습니다"로 보였다(사용자 신고).
 *
 * 그래서 이 띠는 두 가지를 한다.
 * 1. 화면을 열면 **서버에 없는 것을 찾아 스스로 올린다.** 사용자가 단추를 눌러야만 올라가면,
 *    누르는 걸 잊은 사람의 서류는 본사에 영영 안 보인다.
 * 2. 올리는 동안·끝난 뒤 무슨 일이 있었는지 보여 준다. 실패는 숨기지 않는다.
 *
 * 판단은 **건수가 아니라 id** 로 한다. 건수로 보면 "서버에 남이 올린 5건, 내게 다른 3건"을
 * 놓친다 — 여럿이 쓰면 늘 이런 모양이 된다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CloudUpload, Check, TriangleAlert, X } from "lucide-react";
import { ServerUnavailable } from "./formServer";
import { migrateLocalToServer, pendingUploads, type MigrateProgress, type MigrateResult } from "./formMigrate";
import { flushPendingDeletes } from "./formSync";

type Phase =
  | { kind: "checking" }
  /** 서버에 못 닿는다 — 조용히 한 줄만(사무실 밖에서 쓰는 중일 수 있다) */
  | { kind: "offline"; message: string }
  | { kind: "working"; progress: MigrateProgress; auto: boolean }
  | { kind: "done"; result: MigrateResult; auto: boolean }
  /** 올릴 것이 없다 */
  | { kind: "clean" };

export default function ServerSyncBanner({ localCount }: { localCount: number }) {
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [hidden, setHidden] = useState(false);
  /** 한 번 자동으로 올렸으면 다시 하지 않는다(화면을 다시 그릴 때마다 올리면 안 된다). */
  const tried = useRef(false);

  const run = useCallback(async (auto: boolean) => {
    setPhase({ kind: "working", progress: { step: "준비", done: 0, total: 0 }, auto });
    try {
      const result = await migrateLocalToServer((progress) => setPhase({ kind: "working", progress, auto }));
      setPhase({ kind: "done", result, auto });
    } catch (error) {
      if (error instanceof ServerUnavailable) {
        setPhase({ kind: "offline", message: error.message });
        return;
      }
      setPhase({
        kind: "done",
        auto,
        result: { sites: 0, taxonomies: 0, docs: 0, skipped: 0, failed: [(error as Error).message] },
      });
    }
  }, []);

  /**
   * 서버가 꺼져 있을 때 지운 서류를 **다시 지우라고 보낸다.**
   *
   * 안 보내면 브라우저에서만 사라지고 서버에는 남아, 본사 점검에 유령 서류가 보인다
   * (사용자 신고로 실제 13건+1건이 남아 있었다). 화면을 열 때와 인터넷이 돌아올 때 보낸다.
   * 조용히 한다 — 성공하든 실패하든 사용자가 할 일이 없다.
   */
  useEffect(() => {
    const flush = () => void flushPendingDeletes().catch(() => undefined);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);

  useEffect(() => {
    if (tried.current || localCount === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const missing = await pendingUploads();
        if (cancelled) return;
        if (missing.length === 0) {
          setPhase({ kind: "clean" });
          return;
        }
        tried.current = true;
        await run(true);
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
  }, [localCount, run]);

  if (hidden || phase.kind === "checking" || phase.kind === "clean") return null;

  if (phase.kind === "offline") {
    return (
      <p className="mb-4 rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-500 ring-1 ring-slate-200">
        서버에 연결하지 못했습니다. 지금 작업은 이 브라우저에만 저장되고, 연결되면 자동으로 올라갑니다. ({phase.message})
      </p>
    );
  }

  return (
    <div className="mb-5 rounded-2xl bg-blue-50 px-5 py-4 ring-1 ring-blue-200">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
          <CloudUpload size={17} />
        </span>

        {phase.kind === "working" && (
          <span className="min-w-0 flex-1 text-sm text-blue-900">
            <b className="font-semibold">서버로 올리는 중</b> — {phase.progress.step}{" "}
            {phase.progress.total > 0 ? `${phase.progress.done}/${phase.progress.total}` : ""}
            <span className="mt-0.5 block text-xs text-blue-800/80">
              이 브라우저에만 있던 자료를 올리고 있습니다. 끝나면 본사에서도 보입니다. 창을 닫지 마세요.
            </span>
          </span>
        )}

        {phase.kind === "done" && (
          <>
            <span className="min-w-0 flex-1 text-sm text-blue-900">
              <b className="inline-flex items-center gap-1 font-semibold">
                {phase.result.failed.length === 0 ? <Check size={14} /> : <TriangleAlert size={14} />}
                서버에 올렸습니다
              </b>{" "}
              — 현장 {phase.result.sites} · 코드표 {phase.result.taxonomies} · 서류 {phase.result.docs}
              {phase.result.skipped > 0 ? ` · 이미 있던 것 ${phase.result.skipped}` : ""}
              {phase.result.failed.length > 0 ? (
                <span className="mt-1 block text-xs text-rose-700">
                  올리지 못한 것 {phase.result.failed.length}건:
                  <ul className="mt-0.5 list-disc pl-4">
                    {phase.result.failed.slice(0, 5).map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => void run(false)}
                    className="mt-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50"
                  >
                    다시 시도
                  </button>
                </span>
              ) : (
                <span className="mt-0.5 block text-xs text-blue-800/80">
                  이제 [본사 점검]에서 보이고, 다른 PC 에서도 같은 자료를 봅니다.
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
