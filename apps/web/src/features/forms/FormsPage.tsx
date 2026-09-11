/**
 * 우미 양식 모음집 — 엑셀 양식을 올려 내용을 채우는 화면.
 *
 * 양식(병합·테두리·칸 크기·글꼴)은 엑셀 원본 그대로 고정하고, 글자는 어느 칸이든
 * 고칠 수 있다. 올린 양식과 고친 글자는 브라우저에 저장돼 새로고침해도 남는다
 * ({@link ./formStore}). 목록은 분류 탭·즐겨찾기로 고르는 서식함 모양이다
 * ({@link ./FormGallery}). 서버 저장·공유는 다음 단계에서 이 위에 얹는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Check,
  FileSpreadsheet,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { parseFormWorkbook } from "./formParser";
import FormGallery from "./FormGallery";
import FormTree from "./FormTree";
import FormSheetView, { type FormScale } from "./FormSheetView";
import {
  addCustomSheet,
  clearTaxonomy,
  deleteForm,
  findTemplateSheet,
  getForm,
  removeCustomSheet,
  renameCustomSheet,
  isStorageAvailable,
  listForms,
  readLastOpenedId,
  loadTaxonomy,
  reparseForm,
  saveForm,
  saveTaxonomy,
  setFormCode,
  touchForm,
  updateFormMeta,
  updateFormValues,
  writeLastOpenedId,
  type FormSummary,
} from "./formStore";
import type { FormSheet, FormValues } from "./types";
import {
  codeFromFileName,
  parseTaxonomySheet,
  type Taxonomy,
  type TaxonomyItem,
} from "./taxonomy";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; id: string; fileName: string; title: string; sheets: FormSheet[] };

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * 배율 선택지. 기본은 "가로 맞춤" — 21열짜리 넓은 양식은 어느 화면에도 안 들어가
 * 오른쪽이 잘린 것처럼 보인다. 줄이기만 하므로 좁은 양식은 100% 그대로다.
 */
const SCALES: { value: FormScale; label: string }[] = [
  { value: "fit", label: "가로 맞춤" },
  { value: 0.5, label: "50%" },
  { value: 0.7, label: "70%" },
  { value: 0.8, label: "80%" },
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.25, label: "125%" },
  { value: 1.5, label: "150%" },
];

/**
 * 글자 든 칸이 이보다 적으면서 시트가 이만큼 크면, 내용이 도형·그림으로 그려져
 * 있을 가능성이 높다. 그때 빈 상자만 띄우면 "고장 났다"로 보여서 이유를 알린다.
 */
const SPARSE_TEXT_CELLS = 3;
const SPARSE_MIN_AREA = 50;
/** 글자를 칠 때마다 저장하면 과하다. 손을 멈춘 뒤 이만큼 있다가 저장한다. */
const SAVE_DELAY_MS = 400;

export default function FormsPage() {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [scale, setScale] = useState<FormScale>("fit");
  const [editable, setEditable] = useState(true);
  const [values, setValues] = useState<FormValues>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taxonomyInputRef = useRef<HTMLInputElement>(null);
  /** 빈 칸을 눌러 올리는 중이면 그 코드. 읽고 나서 이 코드로 붙인다. */
  const pendingCodeRef = useRef<string | undefined>(undefined);

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
    setState({
      status: "ready",
      id: form.id,
      fileName: form.fileName,
      title: form.title,
      sheets: form.sheets,
    });
    writeLastOpenedId(form.id);
    // 저장본을 새 파서로 다시 읽지 못했으면 알린다. 조용히 넘기면 "기능이 안 되는" 걸로만 보인다.
    setStorageWarning(form.upgradeError ?? null);
    // "최근 사용" 정렬의 기준. 실패해도 여는 것 자체는 성공이므로 막지 않는다.
    void touchForm(form.id).catch(() => {});
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
      // 코드표가 있으면 트리로, 없으면 지금까지의 서식함 모양으로 보여준다.
      try {
        const saved = await loadTaxonomy();
        if (!cancelled) setTaxonomy(saved);
      } catch {
        // 코드표를 못 읽어도 양식 목록은 보여야 한다.
      }
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

      // 빈 칸을 눌러 올렸으면 그 코드, 아니면 파일 이름 앞 숫자로 정한다.
      const code = pendingCodeRef.current ?? codeFromFileName(file.name, taxonomy);
      pendingCodeRef.current = undefined;

      let id = "";
      try {
        const saved = await saveForm({ fileName: file.name, bytes, sheets, code });
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
      setState({
        status: "ready",
        id,
        fileName: file.name,
        title: file.name.replace(/\.xlsx$/i, ""),
        sheets,
      });
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
        message:
          error instanceof Error ? `양식을 열지 못했습니다: ${error.message}` : "양식을 열지 못했습니다.",
      });
    }
  }

  /** 코드표 엑셀을 읽어 저장한다. 한 번 올리면 계속 쓰인다. */
  async function handleTaxonomyFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setStorageWarning(null);
    try {
      const sheets = await parseFormWorkbook(await file.arrayBuffer());
      // 코드표가 여러 장일 수 있다. 읽히는 첫 장을 쓴다.
      let parsed: Taxonomy | null = null;
      for (const sheet of sheets) {
        parsed = parseTaxonomySheet(sheet, file.name);
        if (parsed) break;
      }
      if (!parsed) {
        setStorageWarning(
          "코드표를 읽지 못했습니다. `CODE`·`분류명` 머리글이 있는 표인지 확인해 주세요. (양식 파일을 올리신 건 아닌가요?)",
        );
        return;
      }
      await saveTaxonomy(parsed);
      setTaxonomy(parsed);

      // 이미 올려 둔 양식에도 파일 이름으로 코드를 붙여 준다 — 코드표를 나중에 올린 경우.
      let matched = 0;
      for (const form of forms) {
        if (form.code) continue;
        const code = codeFromFileName(form.fileName, parsed);
        if (!code) continue;
        await setFormCode(form.id, code);
        matched += 1;
      }
      await refreshList();

      const total = parsed.groups.reduce((sum, group) => sum + group.items.length, 0);
      setStorageWarning(
        `코드표를 읽었습니다: 분류 ${parsed.groups.length}개 · 서류 ${total}개` +
          (matched > 0 ? ` · 이미 올린 양식 ${matched}개에 코드를 붙였습니다.` : "") +
          (parsed.conflicts.length > 0
            ? ` ⚠ 겹치는 코드가 있습니다: ${parsed.conflicts.join(", ")}`
            : ""),
      );
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `코드표를 읽지 못했습니다: ${error.message}` : "코드표를 읽지 못했습니다.",
      );
    }
  }

  /** 빈 칸을 눌러 그 코드로 양식을 올린다. */
  function handleUploadFor(item: TaxonomyItem) {
    pendingCodeRef.current = item.code;
    fileInputRef.current?.click();
  }

  /** 1차 분류 이름(예: 공무관련)을 붙이거나 바꾼다. 코드표를 다시 올리지 않아도 된다. */
  async function handleRenameDivision() {
    if (!taxonomy) return;
    const name = window
      .prompt("코드표 전체를 묶을 1차 분류 이름을 적어 주세요. (예: 공무관련)", taxonomy.division ?? "")
      ?.trim();
    if (name === undefined || name === taxonomy.division) return;
    const next: Taxonomy = { ...taxonomy, division: name };
    try {
      await saveTaxonomy(next);
      setTaxonomy(next);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `이름을 바꾸지 못했습니다: ${error.message}` : "이름을 바꾸지 못했습니다.",
      );
    }
  }

  /** 코드표를 지운다. 올려 둔 양식은 그대로 남고 분류만 풀린다. */
  async function handleClearTaxonomy() {
    const ok = window.confirm(
      "코드표를 지웁니다.\n올려 둔 양식은 그대로 남고, 분류만 풀려 예전 목록 화면으로 돌아갑니다. 계속할까요?",
    );
    if (!ok) return;
    try {
      await clearTaxonomy();
      setTaxonomy(null);
      setStorageWarning(null);
    } catch (error) {
      setStorageWarning(
        error instanceof Error
          ? `코드표를 지우지 못했습니다: ${error.message}`
          : "코드표를 지우지 못했습니다.",
      );
    }
  }

  /** 이름·분류·즐겨찾기 바꾸기. 끝나면 목록을 되읽어 화면과 저장소를 다시 맞춘다. */
  async function patchMeta(
    id: string,
    patch: { title?: string; category?: string; favorite?: boolean },
  ) {
    try {
      await updateFormMeta(id, patch);
      if (patch.title && state.status === "ready" && state.id === id) {
        setState({ ...state, title: patch.title });
      }
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `바꾸지 못했습니다: ${error.message}` : "바꾸지 못했습니다.",
      );
    }
    void refreshList();
  }

  /** 저장된 엑셀 원본에서 다시 읽는다. "그림·순서도가 안 보인다" 할 때의 탈출구. */
  async function handleReparse() {
    if (state.status !== "ready") return;
    setStorageWarning(null);
    try {
      const form = await reparseForm(state.id);
      if (!form) {
        setStorageWarning("그 양식은 이미 지워졌습니다.");
        return;
      }
      setState({ ...state, sheets: form.sheets });
      setStorageWarning(form.upgradeError ?? null);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `다시 읽지 못했습니다: ${error.message}` : "다시 읽지 못했습니다.",
      );
    }
  }

  function handleRename() {
    if (state.status !== "ready") return;
    const next = window.prompt("서류 이름을 바꿉니다.", state.title)?.trim();
    if (!next || next === state.title) return;
    void patchMeta(state.id, { title: next });
  }

  async function handleDelete(summary: FormSummary) {
    const ok = window.confirm(
      `“${summary.title}”을(를) 지웁니다.\n적어 둔 내용도 함께 사라지고 되돌릴 수 없습니다. 계속할까요?`,
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

  /** 시트를 더하거나 지운 뒤 화면의 시트 목록을 저장소와 다시 맞춘다. */
  async function reloadSheets(keepName?: string) {
    if (state.status !== "ready") return;
    const form = await getForm(state.id);
    if (!form) return;
    justLoadedRef.current = { id: form.id, values: form.values };
    setValues(form.values);
    setState({ ...state, sheets: form.sheets });
    const index = keepName ? form.sheets.findIndex((s) => s.name === keepName) : -1;
    setActiveSheet(index >= 0 ? index : Math.min(activeSheet, form.sheets.length - 1));
    void refreshList();
  }

  async function handleAddSheet() {
    if (state.status !== "ready" || !sheet) return;
    // 지금 보는 시트가 아니라 **빈 양식(견본)** 을 복사한다. 직전 시트를 복사하면
    // 지난달 내용이 그대로 딸려 온다.
    const source = template ?? sheet;
    const name = window
      .prompt(
        `“${source.name}” 시트의 양식으로 새 장을 만듭니다.\n표·머리글은 그대로 두고 채워 넣은 내용은 비웁니다.\n\n새 시트 이름을 적어 주세요. (예: 2026-07)`,
        "",
      )
      ?.trim();
    if (!name) return;
    try {
      await addCustomSheet(state.id, { name, source: source.name });
      await reloadSheets(name);
    } catch (error) {
      setStorageWarning(error instanceof Error ? error.message : "시트를 더하지 못했습니다.");
    }
  }

  async function handleRenameSheet() {
    if (state.status !== "ready" || !sheet?.custom) return;
    const name = window.prompt("시트 이름을 바꿉니다.", sheet.name)?.trim();
    if (!name || name === sheet.name) return;
    try {
      await renameCustomSheet(state.id, sheet.name, name);
      await reloadSheets(name);
    } catch (error) {
      setStorageWarning(error instanceof Error ? error.message : "이름을 바꾸지 못했습니다.");
    }
  }

  async function handleDeleteSheet() {
    if (state.status !== "ready" || !sheet?.custom) return;
    const ok = window.confirm(
      `“${sheet.name}” 시트를 지웁니다.\n이 장에 적어 둔 내용도 함께 사라지고 되돌릴 수 없습니다. 계속할까요?`,
    );
    if (!ok) return;
    try {
      await removeCustomSheet(state.id, sheet.name);
      await reloadSheets();
    } catch (error) {
      setStorageWarning(error instanceof Error ? error.message : "시트를 지우지 못했습니다.");
    }
  }

  const sheet = state.status === "ready" ? state.sheets[activeSheet] : null;
  // 새 장을 만들 때 복사해 올 빈 양식. 없으면 지금 보는 시트를 쓴다.
  const template = state.status === "ready" ? findTemplateSheet(state.sheets) : undefined;
  // 고친 글자는 시트마다 따로 담긴다. 화면에는 지금 보는 시트 것만 넘긴다.
  const sheetValues = sheet ? (values[sheet.name] ?? {}) : {};
  const editedCount = Object.keys(sheetValues).length;
  const totalEdited = Object.values(values).reduce((sum, v) => sum + Object.keys(v).length, 0);

  // 글자도 그림도 도형도 거의 없는 큰 시트 — 우리가 못 읽는 것(SmartArt·차트·그룹
  // 도형)으로 그렸을 가능성이 높다. 도형을 읽어 냈다면 안내할 이유가 없다.
  const textCells = sheet ? sheet.cells.filter((c) => c.text.trim() !== "").length : 0;
  const looksDrawn =
    sheet !== null &&
    textCells <= SPARSE_TEXT_CELLS &&
    (sheet.shapes?.length ?? 0) === 0 &&
    (sheet.images?.length ?? 0) === 0 &&
    sheet.rowCount * sheet.colCount >= SPARSE_MIN_AREA;

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10 text-slate-800">
      {/* 넓은 양식(21열짜리 대장 등)이 있어 폭을 넉넉히 잡는다. 좁으면 "가로 맞춤"
          배율이 그만큼 더 줄여 버려 글자가 작아진다. */}
      <div className="mx-auto max-w-[1600px]">
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

        {/* 파일 고르기 상자는 보이지 않는다. 목록의 "양식 올리기"가 이걸 누른다. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleFile}
        />
        <input
          ref={taxonomyInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleTaxonomyFile}
        />

        {storageWarning && (
          <p className="mb-6 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>{storageWarning}</span>
          </p>
        )}

        {state.status === "error" && (
          <p className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {state.message}
          </p>
        )}

        <div className="mb-6">
          {/* 코드표가 있으면 회사 분류 트리로, 없으면 사용자가 만든 분류 탭으로 본다. */}
          {taxonomy ? (
            <FormTree
              taxonomy={taxonomy}
              forms={forms}
              activeId={state.status === "ready" ? state.id : null}
              busy={state.status === "loading"}
              onOpen={(id) => void handleOpen(id)}
              onToggleFavorite={(form) => void patchMeta(form.id, { favorite: !form.favorite })}
              onDelete={(form) => void handleDelete(form)}
              onUploadFor={handleUploadFor}
              onUpload={() => fileInputRef.current?.click()}
              onReplaceTaxonomy={() => taxonomyInputRef.current?.click()}
              onClearTaxonomy={() => void handleClearTaxonomy()}
              onRenameDivision={() => void handleRenameDivision()}
            />
          ) : (
            <FormGallery
              forms={forms}
              activeId={state.status === "ready" ? state.id : null}
              busy={state.status === "loading"}
              onOpen={(id) => void handleOpen(id)}
              onToggleFavorite={(form) => void patchMeta(form.id, { favorite: !form.favorite })}
              onChangeCategory={(form, category) => void patchMeta(form.id, { category })}
              onDelete={(form) => void handleDelete(form)}
              onUpload={() => fileInputRef.current?.click()}
              // 카드 목록 아래 작은 글씨로 두었더니 찾지 못했다. 도구 줄 버튼으로 둔다.
              onUploadTaxonomy={() => taxonomyInputRef.current?.click()}
            />
          )}
        </div>

        {state.status === "ready" && sheet && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            {/* 열려 있는 서류의 도구 줄 */}
            <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <FileSpreadsheet size={15} className="text-slate-400" />
                {state.title}
              </span>
              <button
                type="button"
                onClick={handleRename}
                title="서류 이름 바꾸기"
                className="rounded p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <Pencil size={13} />
              </button>
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
                    value={String(scale)}
                    onChange={(event) =>
                      setScale(event.target.value === "fit" ? "fit" : Number(event.target.value))
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                  >
                    {SCALES.map((option) => (
                      <option key={String(option.value)} value={String(option.value)}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() =>
                    // 지금 보는 시트만 되돌린다. 다른 장에 적어 둔 내용까지 지우면
                    // 되돌릴 수 없는 사고가 된다.
                    setValues((prev) => {
                      const next = { ...prev };
                      if (sheet) delete next[sheet.name];
                      return next;
                    })
                  }
                  disabled={editedCount === 0}
                  title="지금 보고 있는 시트만 엑셀 원본 상태로 되돌립니다."
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:ring-slate-200"
                >
                  <RotateCcw size={13} /> 이 시트 되돌리기
                </button>

                <button
                  type="button"
                  onClick={() => void handleReparse()}
                  title="저장된 엑셀 파일에서 표·그림·순서도를 다시 읽습니다. 적어 둔 글자는 그대로입니다."
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50"
                >
                  <RefreshCw size={13} /> 엑셀에서 다시 읽기
                </button>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              {state.sheets.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setActiveSheet(index)}
                  title={item.custom ? "앱에서 더한 시트입니다." : "원본 엑셀의 시트입니다."}
                  className={
                    index === activeSheet
                      ? "rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
                  }
                >
                  {item.name}
                  {/* 원본 엑셀에 없던 장은 표시해 둔다 — 이름 바꾸기·지우기가 여기에만 된다. */}
                  {item.custom && (
                    <span className={index === activeSheet ? "ml-1 text-blue-200" : "ml-1 text-slate-400"}>
                      +
                    </span>
                  )}
                </button>
              ))}

              <button
                type="button"
                onClick={() => void handleAddSheet()}
                title={`“${(template ?? sheet).name}” 시트의 양식으로 새 장을 만듭니다. 표·머리글은 그대로, 채워 넣은 내용과 견본 표시는 비워집니다.`}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-dashed ring-slate-300 transition hover:bg-slate-50"
              >
                <Plus size={13} /> 시트 추가
              </button>

              {sheet.custom && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleRenameSheet()}
                    title="이 시트 이름 바꾸기"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSheet()}
                    title="이 시트 지우기"
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>시트 “{sheet.name}”</span>
              <span>
                {sheet.rowCount}행 × {sheet.colCount}열
              </span>
              <span>병합 {sheet.cells.filter((c) => c.rowSpan > 1 || c.colSpan > 1).length}곳</span>
              {/* 그림이 안 보일 때 "못 읽은 것"인지 "그렸는데 안 보이는 것"인지 가른다. */}
              {(sheet.images?.length ?? 0) > 0 && <span>그림 {sheet.images.length}개</span>}
              {(sheet.shapes?.length ?? 0) > 0 && <span>도형 {sheet.shapes.length}개</span>}
              {sheet.printArea && (
                <span title="엑셀에 지정된 인쇄 영역 밖은 옮기지 않았습니다.">
                  인쇄 영역 {sheet.printArea}까지만 표시
                </span>
              )}
              {editedCount > 0 && <span className="text-blue-600">고친 칸 {editedCount}개</span>}
              {totalEdited > editedCount && (
                <span className="text-slate-400">전체 {totalEdited}개</span>
              )}
              {editable && <span>칸을 눌러 바로 고칠 수 있습니다.</span>}
            </div>

            {looksDrawn && (
              <p className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <TriangleAlert size={16} className="mt-0.5 shrink-0" />
                <span>
                  이 시트에서 글자가 든 칸은 {textCells}개뿐이고, 그림·도형도 찾지 못했습니다.
                  엑셀의{" "}
                  <strong className="font-semibold">SmartArt·차트·여러 도형을 그룹으로 묶은 것은 화면에 옮기지 못합니다.</strong>{" "}
                  묶음을 풀어 저장하면 나올 수 있습니다.
                </span>
              </p>
            )}

            <FormSheetView
              sheet={sheet}
              editable={editable}
              values={sheetValues}
              onChangeValue={(cellKey, value) =>
                setValues((prev) => ({
                  ...prev,
                  [sheet.name]: { ...(prev[sheet.name] ?? {}), [cellKey]: value },
                }))
              }
              scale={scale}
            />
          </section>
        )}
      </div>
    </div>
  );
}
