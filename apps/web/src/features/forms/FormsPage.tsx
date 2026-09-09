/**
 * 우미 양식 모음집 — 3단계 임시 화면.
 *
 * 엑셀을 올려 "원본대로 그려지는지" 눈으로 확인하는 것까지만 한다.
 * 입력·저장과 프로토타입의 폴더/즐겨찾기 구조는 다음 단계에서 얹는다.
 */
import { useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, FileSpreadsheet, Upload } from "lucide-react";
import { parseFormWorkbook } from "./formParser";
import FormSheetView from "./FormSheetView";
import type { FormSheet } from "./types";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; fileName: string; sheets: FormSheet[] };

export default function FormsPage() {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [activeSheet, setActiveSheet] = useState(0);
  const [highlightInputs, setHighlightInputs] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 골라도 onChange 가 뜨도록 값을 비운다.
    event.target.value = "";
    if (!file) return;

    setState({ status: "loading" });
    setActiveSheet(0);
    try {
      const sheets = await parseFormWorkbook(await file.arrayBuffer());
      if (sheets.length === 0) {
        setState({ status: "error", message: "이 파일에는 시트가 없습니다." });
        return;
      }
      setState({ status: "ready", fileName: file.name, sheets });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? `엑셀을 읽지 못했습니다: ${error.message}`
            : "엑셀을 읽지 못했습니다.",
      });
    }
  }

  const sheet = state.status === "ready" ? state.sheets[activeSheet] : null;

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10 text-slate-800">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <Link
            href="/"
            className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft size={14} /> 도구 목록
          </Link>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">FORMS</p>
          <h1 className="mt-2 text-3xl font-bold">우미 양식 모음집</h1>
          <p className="mt-2 text-sm text-slate-600">
            엑셀 양식을 올리면 셀 병합·테두리·글꼴까지 원본 그대로 화면에 옮깁니다.
          </p>
        </header>

        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={state.status === "loading"}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Upload size={15} />
              {state.status === "loading" ? "읽는 중..." : "엑셀 양식 올리기"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFile}
            />

            {state.status === "ready" && (
              <>
                <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                  <FileSpreadsheet size={15} className="text-slate-400" />
                  {state.fileName}
                </span>
                <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={highlightInputs}
                    onChange={(event) => setHighlightInputs(event.target.checked)}
                    className="size-4 accent-blue-600"
                  />
                  입력칸으로 잡힌 곳 표시
                </label>
              </>
            )}
          </div>

          {state.status === "error" && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {state.message}
            </p>
          )}

          {state.status === "idle" && (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              아직 올린 양식이 없습니다. `.xlsx` 파일을 올리면 여기에 표시됩니다.
            </p>
          )}
        </section>

        {state.status === "ready" && sheet && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            {state.sheets.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {state.sheets.map((item, index) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => setActiveSheet(index)}
                    className={
                      index === activeSheet
                        ? "rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
                        : "rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                    }
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>시트 “{sheet.name}”</span>
              <span>
                {sheet.rowCount}행 × {sheet.colCount}열
              </span>
              <span>병합 {sheet.cells.filter((c) => c.rowSpan > 1 || c.colSpan > 1).length}곳</span>
              <span>입력칸 {sheet.cells.filter((c) => c.input).length}개</span>
            </div>

            <FormSheetView sheet={sheet} highlightInputs={highlightInputs} />
          </section>
        )}
      </div>
    </div>
  );
}
