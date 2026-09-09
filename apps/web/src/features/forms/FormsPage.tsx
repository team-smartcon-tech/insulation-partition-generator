/**
 * 우미 양식 모음집 — 엑셀 양식을 올려 내용을 채우는 화면.
 *
 * 양식(병합·테두리·칸 크기·글꼴)은 엑셀 원본 그대로 고정하고, 글자는 어느 칸이든
 * 고칠 수 있다. 저장·불러오기와 양식 목록은 다음 단계에서 얹는다.
 */
import { useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { parseFormWorkbook } from "./formParser";
import FormSheetView from "./FormSheetView";
import type { FormSheet, FormValues } from "./types";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; fileName: string; sheets: FormSheet[] };

const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

export default function FormsPage() {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [activeSheet, setActiveSheet] = useState(0);
  const [scale, setScale] = useState(1);
  const [editable, setEditable] = useState(true);
  const [values, setValues] = useState<FormValues>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 골라도 onChange 가 뜨도록 값을 비운다.
    event.target.value = "";
    if (!file) return;

    setState({ status: "loading" });
    setActiveSheet(0);
    // 다른 양식을 올리면 앞 양식에 적은 값은 의미가 없다.
    setValues({});
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
  const editedCount = Object.keys(values).length;

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
            엑셀 양식을 올리면 셀 병합·테두리·글꼴까지 원본 그대로 옮기고,{" "}
            <strong className="font-semibold text-slate-800">글자는 어느 칸이든 바로 고칠 수 있습니다.</strong>
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

                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-slate-300">
                    {[
                      { value: true, label: "편집" },
                      { value: false, label: "보기" },
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => setEditable(option.value)}
                        className={
                          editable === option.value
                            ? "bg-slate-800 px-3 py-1.5 text-xs font-medium text-white"
                            : "bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                    배율
                    <select
                      value={scale}
                      onChange={(event) => setScale(Number(event.target.value))}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                    >
                      {SCALES.map((value) => (
                        <option key={value} value={value}>
                          {Math.round(value * 100)}%
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => setValues({})}
                    disabled={editedCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:ring-slate-200"
                  >
                    <RotateCcw size={13} /> 원본으로 되돌리기
                  </button>
                </div>
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
              {editedCount > 0 && <span className="text-blue-600">고친 칸 {editedCount}개</span>}
              {editable && <span>칸을 눌러 바로 고칠 수 있습니다.</span>}
            </div>

            <FormSheetView
              sheet={sheet}
              editable={editable}
              values={values}
              onChangeValue={(cellKey, value) =>
                setValues((prev) => ({ ...prev, [cellKey]: value }))
              }
              scale={scale}
            />
          </section>
        )}
      </div>
    </div>
  );
}
