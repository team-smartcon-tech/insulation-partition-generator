/**
 * 우미 양식 모음집 — 엑셀 양식을 올려 내용을 채우는 화면.
 *
 * 양식(병합·테두리·칸 크기·글꼴)은 엑셀 원본 그대로 고정하고, 글자는 어느 칸이든
 * 고칠 수 있다. 올린 양식과 고친 글자는 브라우저에 저장돼 새로고침해도 남는다
 * ({@link ./formStore}). 서버 저장·공유는 다음 단계에서 이 위에 얹는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Check,
  FileSpreadsheet,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { parseFormWorkbook } from "./formParser";
import FormSheetView from "./FormSheetView";
import {
  deleteForm,
  getForm,
  isStorageAvailable,
  listForms,
  readLastOpenedId,
  saveForm,
  updateFormValues,
  writeLastOpenedId,
  type FormSummary,
} from "./formStore";
import type { FormSheet, FormValues } from "./types";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; id: string; fileName: string; sheets: FormSheet[] };

type SaveState = "idle" | "saving" | "saved" | "error";

const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
/** 글자를 칠 때마다 저장하면 과하다. 손을 멈춘 뒤 이만큼 있다가 저장한다. */
const SAVE_DELAY_MS = 400;

function formatWhen(time: number): string {
  const date = new Date(time);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const clock = date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `오늘 ${clock}`;
  return `${date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} ${clock}`;
}

export default function FormsPage() {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [scale, setScale] = useState(1);
  const [editable, setEditable] = useState(true);
  const [values, setValues] = useState<FormValues>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 방금 저장소에서 읽어 온 값. 이것과 같으면 저장할 게 없다. */
  const justLoadedRef = useRef<{ id: string; values: FormValues } | null>(null);
  /** 아직 저장되지 않은 변경. 창을 닫을 때 마지막으로 한 번 더 써 본다. */
  const pendingRef = useRef<{ id: string; values: FormValues } | null>(null);

  const refreshList = useCallback(async () => {
    try {
      setForms(await listForms());
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? error.message : "저장된 양식 목록을 읽지 못했습니다.",
      );
    }
  }, []);

  const openStored = useCallback(async (id: string) => {
    const form = await getForm(id);
    if (!form) return false;
    justLoadedRef.current = { id: form.id, values: form.values };
    setValues(form.values);
    setActiveSheet(0);
    setState({ status: "ready", id: form.id, fileName: form.fileName, sheets: form.sheets });
    writeLastOpenedId(form.id);
    return true;
  }, []);

  // 화면에 들어오면 저장해 둔 목록을 읽고, 마지막에 보던 양식을 그대로 다시 연다.
  useEffect(() => {
    if (!isStorageAvailable()) {
      setStorageWarning(
        "이 브라우저에서는 저장 기능을 쓸 수 없습니다(시크릿 창이거나 사이트 데이터가 차단된 상태). 양식 작성은 되지만 새로고침하면 사라집니다.",
      );
      return;
    }
    let cancelled = false;
    void (async () => {
      await refreshList();
      const lastId = readLastOpenedId();
      if (!lastId || cancelled) return;
      try {
        const opened = await openStored(lastId);
        if (!opened) writeLastOpenedId(null);
      } catch {
        writeLastOpenedId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openStored, refreshList]);

  // 고친 글자를 자동 저장한다.
  useEffect(() => {
    // id 가 비어 있으면 저장에 실패한 양식이다(경고는 이미 띄웠다). 헛되이 쓰지 않는다.
    if (state.status !== "ready" || state.id === "") return;
    const loaded = justLoadedRef.current;
    // 막 불러온 값 그대로면 다시 쓸 필요가 없다(수정 시각만 괜히 밀린다).
    if (loaded && loaded.id === state.id && loaded.values === values) return;

    const id = state.id;
    pendingRef.current = { id, values };
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      updateFormValues(id, values)
        .then(() => {
          if (pendingRef.current?.values === values) pendingRef.current = null;
          setSaveState("saved");
          void refreshList();
        })
        .catch((error) => {
          setSaveState("error");
          setStorageWarning(
            error instanceof Error ? `저장하지 못했습니다: ${error.message}` : "저장하지 못했습니다.",
          );
        });
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [values, state, refreshList]);

  // 저장 대기(0.4초) 중에 창을 닫으면 마지막 몇 글자가 날아간다. 그때 한 번 더 써 본다.
  useEffect(() => {
    function flush() {
      const pending = pendingRef.current;
      if (pending) void updateFormValues(pending.id, pending.values).catch(() => {});
    }
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 같은 파일을 다시 골라도 onChange 가 뜨도록 값을 비운다.
    event.target.value = "";
    if (!file) return;

    setState({ status: "loading" });
    setActiveSheet(0);
    // 다른 양식을 올리면 앞 양식에 적은 값은 의미가 없다.
    // 아래 justLoadedRef 와 같은 객체를 써야 "방금 불러온 그대로"로 인식돼 헛저장을 안 한다.
    const emptyValues: FormValues = {};
    setValues(emptyValues);
    pendingRef.current = null;
    try {
      const bytes = await file.arrayBuffer();
      const sheets = await parseFormWorkbook(bytes);
      if (sheets.length === 0) {
        setState({ status: "error", message: "이 파일에는 시트가 없습니다." });
        return;
      }

      let id = "";
      try {
        const saved = await saveForm({ fileName: file.name, bytes, sheets });
        id = saved.id;
        writeLastOpenedId(id);
        setSaveState("saved");
        void refreshList();
      } catch (error) {
        // 저장에 실패해도 화면에서 작성은 되게 둔다. 다만 사라진다는 걸 알린다.
        setSaveState("error");
        setStorageWarning(
          error instanceof Error
            ? `이 양식을 저장하지 못했습니다(새로고침하면 사라집니다): ${error.message}`
            : "이 양식을 저장하지 못했습니다. 새로고침하면 사라집니다.",
        );
      }
      justLoadedRef.current = { id, values: emptyValues };
      setState({ status: "ready", id, fileName: file.name, sheets });
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

  async function handleOpen(id: string) {
    if (state.status === "ready" && state.id === id) return;
    try {
      const opened = await openStored(id);
      if (!opened) {
        setStorageWarning("그 양식은 이미 지워졌습니다.");
        void refreshList();
        return;
      }
      setSaveState("saved");
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? `양식을 열지 못했습니다: ${error.message}` : "양식을 열지 못했습니다.",
      });
    }
  }

  async function handleDelete(summary: FormSummary) {
    const ok = window.confirm(
      `“${summary.fileName}”을(를) 지웁니다.\n적어 둔 내용도 함께 사라지고 되돌릴 수 없습니다. 계속할까요?`,
    );
    if (!ok) return;
    try {
      await deleteForm(summary.id);
      if (state.status === "ready" && state.id === summary.id) {
        pendingRef.current = null;
        justLoadedRef.current = null;
        setValues({});
        setState({ status: "idle" });
        setSaveState("idle");
      }
      void refreshList();
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `지우지 못했습니다: ${error.message}` : "지우지 못했습니다.",
      );
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
            <strong className="font-semibold text-slate-800">글자는 어느 칸이든 바로 고칠 수 있습니다.</strong>{" "}
            올린 양식과 적은 내용은 <strong className="font-semibold text-slate-800">자동으로 저장</strong>돼
            새로고침해도 남습니다.
          </p>
        </header>

        {storageWarning && (
          <p className="mb-6 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>{storageWarning}</span>
          </p>
        )}

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
                {saveState === "saving" && <span className="text-xs text-slate-400">저장 중...</span>}
                {saveState === "saved" && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <Check size={13} /> 저장됨
                  </span>
                )}

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

          {state.status === "idle" && forms.length === 0 && (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              아직 올린 양식이 없습니다. `.xlsx` 파일을 올리면 여기에 표시됩니다.
            </p>
          )}
        </section>

        {forms.length > 0 && (
          <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-sm font-semibold text-slate-700">
              저장된 양식 <span className="font-normal text-slate-400">{forms.length}개</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              이 PC의 이 브라우저에 저장돼 있습니다. 다른 기기에서는 보이지 않습니다.
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {forms.map((form) => {
                const isOpen = state.status === "ready" && state.id === form.id;
                return (
                  <li
                    key={form.id}
                    className={
                      isOpen
                        ? "flex items-center gap-3 rounded-xl bg-blue-50 p-3 ring-1 ring-blue-300"
                        : "flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => void handleOpen(form.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <FileSpreadsheet
                        size={18}
                        className={isOpen ? "shrink-0 text-blue-500" : "shrink-0 text-slate-400"}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {form.fileName}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {formatWhen(form.updatedAt)}
                          {form.editedCount > 0 && ` · 고친 칸 ${form.editedCount}개`}
                          {form.sheetNames.length > 1 && ` · 시트 ${form.sheetNames.length}개`}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(form)}
                      aria-label={`${form.fileName} 지우기`}
                      title="지우기"
                      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

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
