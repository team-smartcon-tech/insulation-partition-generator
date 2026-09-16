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
import BrandWordmark from "@/components/brand/BrandWordmark";
import { HeroChip, SmartBackground, SmartHeader, SmartHero } from "@/components/layout/SmartShell";
import {
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { buildFilledWorkbook, downloadBytes, filledFileName } from "./formExport";
import { parseFormWorkbook } from "./formParser";
import { withExtraRows } from "./sheetRows";
import FormGallery from "./FormGallery";
import FormTree from "./FormTree";
import FormSheetView, { type FormScale } from "./FormSheetView";
import {
  addCustomSheet,
  deleteForm,
  findTemplateSheet,
  getForm,
  removeCustomSheet,
  renameCustomSheet,
  isStorageAvailable,
  listForms,
  readLastOpenedId,
  loadTaxonomies,
  reparseForm,
  saveForm,
  saveTaxonomies,
  setExtraRows,
  setFormCode,
  touchForm,
  updateFormMeta,
  updateFormValues,
  writeLastOpenedId,
  type FormSummary,
} from "./formStore";
import type { FormSheet, FormValues } from "./types";
import {
  addGroup,
  addItem,
  applyPastedLines,
  createTaxonomy,
  editGroup,
  editItem,
  findItem,
  parsePastedTaxonomy,
  parseTaxonomySheet,
  placeByFileName,
  moveGroup,
  moveItem,
  removeGroup as removeGroupFromTaxonomy,
  removeItem,
  renumberGroup,
  taxonomyIdOf,
  upsertTaxonomies,
  type PastedLine,
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
  /** 코드표 목록 — 1차 분류(공무관련·품질관련 …)마다 한 벌 */
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  // 코드표 편집 모드 — 켜면 목록에 더하기·고치기·지우기 버튼이 붙는다.
  const [editingTaxonomy, setEditingTaxonomy] = useState(false);
  // 붙여넣기 상자를 연 코드표 id. null 이면 닫혀 있다.
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);
  /** 시트 이름 → 아래에 더한 빈 줄 수 */
  const [extraRows, setExtraRowsState] = useState<Record<string, number>>({});
  /** 내려받기 선택 메뉴가 열려 있나 */
  const [downloadOpen, setDownloadOpen] = useState(false);
  /** 고칠 수 있는 칸을 하늘색으로 칠할까. 인쇄하거나 원본 모양을 볼 때 끌 수 있다. */
  const [showEditableTint, setShowEditableTint] = useState(true);
  /**
   * 되돌리기(Ctrl+Z)·다시하기(Ctrl+Y) 기록.
   *
   * 글자 한 자씩이 아니라 **칸 하나를 고치고 빠져나온 것**을 한 걸음으로 센다. 잘못 덮어쓴
   * 칸을 한 번에 되돌리는 것이 목적이라(사용자 신고: 원래 글자를 지워 버림), 자 단위로
   * 쌓으면 되돌리기를 수십 번 눌러야 한다. 화면을 다시 그릴 필요가 없어 ref 에 담는다.
   */
  const historyRef = useRef<{
    past: { sheet: string; key: string; before: string | undefined; after: string }[];
    future: { sheet: string; key: string; before: string | undefined; after: string }[];
  }>({ past: [], future: [] });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const taxonomyInputRef = useRef<HTMLInputElement>(null);
  /** 빈 칸을 눌러 올리는 중이면 그 칸(코드표 id + 코드). 읽고 나서 이 칸에 붙인다. */
  const pendingPlaceRef = useRef<{ taxonomyId: string; code: string } | undefined>(undefined);
  /** 그냥 올릴 때 보고 있던 1차 분류. 파일 이름 번호가 여러 코드표에 겹칠 때 쓴다. */
  const preferredTaxonomyRef = useRef<string | undefined>(undefined);

  /** 지금 보고 있는 시트 이름 — 되돌리기 기록에 어느 시트인지 적어 두려고 들고 있다. */
  const sheetNameRef = useRef<string>("");

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
    // 되돌리기 기록은 양식 하나짜리다. 다른 양식의 걸음을 여기에 적용하면 엉뚱한 칸이 바뀐다.
    historyRef.current = { past: [], future: [] };
    justLoadedRef.current = { id: form.id, values: form.values };
    setValues(form.values);
    setExtraRowsState(form.extraRows ?? {});
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
        const saved = await loadTaxonomies();
        if (!cancelled) setTaxonomies(saved);
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

  /**
   * 고른 파일(들)을 읽어 저장한다. 여러 개를 한 번에 골라도 된다.
   *
   * 한 장씩 올리면 서른 장을 올릴 때 서른 번을 반복해야 한다. 파일 이름 앞 번호로 갈 자리가
   * 정해지므로, 여러 개를 한꺼번에 받아 하나씩 읽어 제자리에 넣는다. 다 되면 **첫 장을 펴 준다** —
   * 올리자마자 뭐가 들어왔는지 눈으로 확인하는 것이 보통이다.
   */
  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // 같은 파일을 다시 골라도 onChange 가 뜨도록 값을 비운다.
    event.target.value = "";
    if (files.length === 0) return;

    // 빈 칸의 "올리기"로 골랐으면 **고른 파일 전부**를 그 칸에 넣는다. 한 칸에 여러 장
    // (월별·차수별)이 들어가는 것이 정상이고, 그 칸을 눌러 고른 것이 곧 "여기에 넣어라"다.
    // 위쪽 "양식 올리기"로 골랐으면 파일 이름 앞 번호로 각자 자리를 찾는다.
    const pendingPlace = pendingPlaceRef.current;
    const preferred = preferredTaxonomyRef.current;
    pendingPlaceRef.current = undefined;
    preferredTaxonomyRef.current = undefined;

    setState({ status: "loading" });
    setActiveSheet(0);
    setExtraRowsState({});
    historyRef.current = { past: [], future: [] };
    // 다른 양식을 올리면 앞 양식에 적은 값은 의미가 없다.
    // 아래 justLoadedRef 와 같은 객체를 써야 "방금 불러온 그대로"로 인식돼 헛저장을 안 한다.
    const emptyValues: FormValues = {};
    setValues(emptyValues);
    pendingRef.current = null;

    const opened: { id: string; fileName: string; sheets: FormSheet[] }[] = [];
    const failed: string[] = [];
    let placed = 0;
    let saveFailed = false;

    for (const file of files) {
      // 여러 개를 올리면 한참 걸린다(큰 양식은 한 장에 몇 초). 어디까지 했는지 보여 준다.
      if (files.length > 1) {
        setStorageWarning(`양식 ${files.length}개 중 ${opened.length + failed.length + 1}번째를 읽는 중입니다…`);
      }
      try {
        const bytes = await file.arrayBuffer();
        const sheets = await parseFormWorkbook(bytes);
        if (sheets.length === 0) {
          failed.push(`${file.name}: 시트가 없습니다`);
          continue;
        }
        const place = pendingPlace ?? placeByFileName(file.name, taxonomies, preferred);
        if (place) placed += 1;

        let id = "";
        try {
          const saved = await saveForm({
            fileName: file.name,
            bytes,
            sheets,
            code: place?.code,
            taxonomyId: place?.taxonomyId,
          });
          id = saved.id;
        } catch (error) {
          // 저장에 실패해도 화면에서 작성은 되게 둔다. 다만 사라진다는 걸 알린다.
          saveFailed = true;
          failed.push(
            error instanceof Error ? `${file.name}: 저장하지 못했습니다(${error.message})` : `${file.name}: 저장하지 못했습니다`,
          );
        }
        opened.push({ id, fileName: file.name, sheets });
      } catch (error) {
        failed.push(
          error instanceof Error ? `${file.name}: 엑셀을 읽지 못했습니다(${error.message})` : `${file.name}: 엑셀을 읽지 못했습니다`,
        );
      }
    }

    if (opened.length === 0) {
      setState({ status: "error", message: failed.join(" / ") || "엑셀을 읽지 못했습니다." });
      return;
    }

    const first = opened[0];
    if (first.id) {
      writeLastOpenedId(first.id);
      setSaveState("saved");
    } else {
      setSaveState("error");
    }
    void refreshList();
    justLoadedRef.current = { id: first.id, values: emptyValues };
    setState({
      status: "ready",
      id: first.id,
      fileName: first.fileName,
      title: first.fileName.replace(/\.xlsx$/i, ""),
      sheets: first.sheets,
    });

    // 한 장이면 굳이 알리지 않는다(화면에 그 양식이 떠 있는 것이 곧 결과다).
    const notes: string[] = [];
    if (files.length > 1) {
      notes.push(
        `양식 ${opened.length}개를 올렸습니다` +
          (placed > 0 ? ` · 코드 칸에 들어간 것 ${placed}개` : "") +
          (opened.length - placed > 0 ? ` · 코드 없는 서류 ${opened.length - placed}개` : ""),
      );
    }
    if (failed.length > 0) notes.push(`⚠ ${failed.join(" / ")}`);
    if (saveFailed) notes.push("저장하지 못한 양식은 새로고침하면 사라집니다.");
    setStorageWarning(notes.length > 0 ? notes.join(" ") : null);
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

  /**
   * 코드표 엑셀을 읽어 저장한다. 한 번 올리면 계속 쓰인다.
   *
   * 시트마다 코드표 한 벌(= 1차 분류 하나)로 읽는다. 같은 1차 분류 이름이 이미 있으면
   * 그 코드표만 바꾸고(서류는 그대로 붙어 있다), 처음 보는 이름이면 옆에 새로 더한다.
   */
  async function handleTaxonomyFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setStorageWarning(null);
    try {
      const sheets = await parseFormWorkbook(await file.arrayBuffer());
      const parsed = sheets
        .map((sheet) => parseTaxonomySheet(sheet, file.name))
        .filter((item): item is Taxonomy => item !== null);
      if (parsed.length === 0) {
        setStorageWarning(
          "코드표를 읽지 못했습니다. `CODE`·`분류명` 머리글이 있는 표인지 확인해 주세요. (양식 파일을 올리신 건 아닌가요?)",
        );
        return;
      }

      const next = upsertTaxonomies(taxonomies, parsed, () => crypto.randomUUID());
      await saveTaxonomies(next);
      setTaxonomies(next);

      // 이미 올려 둔 양식 중 아직 칸이 없는 것에 파일 이름으로 칸을 붙여 준다.
      let matched = 0;
      for (const form of forms) {
        if (form.code) continue;
        const place = placeByFileName(form.fileName, next);
        if (!place) continue;
        await setFormCode(form.id, place.code, place.taxonomyId);
        matched += 1;
      }
      await refreshList();

      const nameOf = (taxonomy: Taxonomy) => taxonomy.division || "이름 없음";
      const conflicts = parsed.flatMap((taxonomy) =>
        taxonomy.conflicts.map((code) => `${nameOf(taxonomy)} ${code}`),
      );
      setStorageWarning(
        `코드표를 읽었습니다: ${parsed.map(nameOf).join(", ")}` +
          (matched > 0 ? ` · 이미 올린 양식 ${matched}개에 코드를 붙였습니다.` : "") +
          (conflicts.length > 0 ? ` ⚠ 겹치는 코드가 있습니다: ${conflicts.join(", ")}` : ""),
      );
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `코드표를 읽지 못했습니다: ${error.message}` : "코드표를 읽지 못했습니다.",
      );
    }
  }

  // ─── 사이트에서 코드표 고치기 ───────────────────────────────
  // 엑셀을 고쳐 다시 올리지 않고 화면에서 바로 칸을 만들고 지운다. 고친 코드표는
  // 바로 저장한다 — 저장에 실패하면 화면도 되돌려, 보이는 것과 저장된 것이 갈리지 않게.

  async function applyTaxonomies(next: Taxonomy[], message: string | null = null) {
    try {
      await saveTaxonomies(next);
      setTaxonomies(next);
      setStorageWarning(message);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `코드표를 저장하지 못했습니다: ${error.message}` : "코드표를 저장하지 못했습니다.",
      );
    }
  }

  /** 코드표 한 벌만 바꿔 끼운다. */
  function replaceTaxonomy(taxonomyId: string, change: (taxonomy: Taxonomy) => Taxonomy): Taxonomy[] {
    return taxonomies.map((taxonomy) => (taxonomy.id === taxonomyId ? change(taxonomy) : taxonomy));
  }

  /** `100 공통/일반` 처럼 번호와 이름을 한 줄로 받아 나눈다. */
  function askCodeAndName(title: string, code: string, name: string): { code: string; name: string } | null {
    const answer = window.prompt(`${title}
번호와 이름을 한 줄로 적어 주세요. (예: 100 공통일반)`, `${code} ${name}`.trim());
    if (answer === null) return null;
    const match = /^\s*(\S+)\s+(.*)$/.exec(answer.trim());
    if (!match || !match[2].trim()) {
      setStorageWarning("번호와 이름을 함께 적어 주세요. (예: 101 이해관계자 니즈와 기대)");
      return null;
    }
    return { code: match[1], name: match[2].trim() };
  }

  async function handleAddDivision() {
    const name = window.prompt("새 1차 분류 이름을 적어 주세요. (예: 공사관련)", "")?.trim();
    if (!name) return;
    if (taxonomies.some((taxonomy) => taxonomy.division === name)) {
      setStorageWarning(`“${name}” 1차 분류가 이미 있습니다.`);
      return;
    }
    const created: Taxonomy = { ...createTaxonomy(name), id: crypto.randomUUID() };
    await applyTaxonomies([...taxonomies, created], `“${name}” 분류를 만들었습니다. 중분류부터 더해 보세요.`);
  }

  async function handleAddGroup(taxonomyId: string) {
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    if (!target) return;
    const name = window.prompt("새 중분류 이름을 적어 주세요. (예: 공통일반)", "")?.trim();
    if (!name) return;
    const next = replaceTaxonomy(taxonomyId, (taxonomy) => addGroup(taxonomy, name));
    await applyTaxonomies(next, null);
  }

  async function handleAddItem(taxonomyId: string, groupCode: string) {
    const name = window.prompt("새 서류 칸 이름을 적어 주세요. (예: 작업일보)", "")?.trim();
    if (!name) return;
    await applyTaxonomies(replaceTaxonomy(taxonomyId, (taxonomy) => addItem(taxonomy, groupCode, name)), null);
  }

  async function handleEditGroup(taxonomyId: string, groupCode: string) {
    const group = taxonomies
      .find((taxonomy) => taxonomy.id === taxonomyId)
      ?.groups.find((item) => item.code === groupCode);
    if (!group) return;
    const answer = askCodeAndName("중분류 고치기", group.code, group.name);
    if (!answer) return;
    const next = replaceTaxonomy(taxonomyId, (taxonomy) => editGroup(taxonomy, groupCode, answer));
    await applyTaxonomies(next, null);
  }

  async function handleEditItem(taxonomyId: string, item: TaxonomyItem) {
    const answer = askCodeAndName("서류 칸 고치기", item.code, item.name);
    if (!answer) return;
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    if (answer.code !== item.code && target && findItem(target, answer.code)) {
      setStorageWarning(`${answer.code} 번호는 이미 쓰고 있습니다. 다른 번호를 적어 주세요.`);
      return;
    }
    const next = replaceTaxonomy(taxonomyId, (taxonomy) => editItem(taxonomy, item.code, answer));
    await applyTaxonomies(next, null);
    // 번호가 바뀌면 그 칸에 올려 둔 서류도 새 번호를 따라가야 같은 자리에 남는다.
    if (answer.code !== item.code) {
      for (const form of forms) {
        if (form.code === item.code && taxonomyIdOf(form, taxonomies) === taxonomyId) {
          await setFormCode(form.id, answer.code, taxonomyId);
        }
      }
      await refreshList();
    }
  }

  /** 지운 칸에 있던 서류는 지우지 않고 "코드 없는 서류"로 내려보낸다. */
  async function detachForms(taxonomyId: string, codes: string[]) {
    if (codes.length === 0) return 0;
    let moved = 0;
    for (const form of forms) {
      if (!form.code || !codes.includes(form.code)) continue;
      if (taxonomyIdOf(form, taxonomies) !== taxonomyId) continue;
      await setFormCode(form.id, undefined, undefined);
      moved += 1;
    }
    if (moved > 0) await refreshList();
    return moved;
  }

  function formsInCodes(taxonomyId: string, codes: string[]): number {
    return forms.filter(
      (form) => form.code && codes.includes(form.code) && taxonomyIdOf(form, taxonomies) === taxonomyId,
    ).length;
  }

  async function handleRemoveGroup(taxonomyId: string, groupCode: string) {
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    const group = target?.groups.find((item) => item.code === groupCode);
    if (!target || !group) return;
    const codes = group.items.map((item) => item.code);
    const affected = formsInCodes(taxonomyId, codes);
    const ok = window.confirm(
      `“${group.code} ${group.name}” 중분류와 그 아래 칸 ${codes.length}개를 지웁니다.` +
        (affected > 0 ? `
올려 둔 서류 ${affected}개는 지워지지 않고 "코드 없는 서류"로 옮겨집니다.` : "") +
        "\n계속할까요?",
    );
    if (!ok) return;
    const result = removeGroupFromTaxonomy(target, groupCode);
    await applyTaxonomies(replaceTaxonomy(taxonomyId, () => result.taxonomy), null);
    const moved = await detachForms(taxonomyId, result.codes);
    if (moved > 0) setStorageWarning(`서류 ${moved}개를 "코드 없는 서류"로 옮겼습니다.`);
  }

  async function handleRemoveItem(taxonomyId: string, item: TaxonomyItem) {
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    if (!target) return;
    const affected = formsInCodes(taxonomyId, [item.code]);
    const ok = window.confirm(
      `“${item.code} ${item.name}” 칸을 지웁니다.` +
        (affected > 0 ? `
올려 둔 서류 ${affected}개는 지워지지 않고 "코드 없는 서류"로 옮겨집니다.` : "") +
        "\n계속할까요?",
    );
    if (!ok) return;
    const result = removeItem(target, item.code);
    await applyTaxonomies(replaceTaxonomy(taxonomyId, () => result.taxonomy), null);
    const moved = await detachForms(taxonomyId, result.codes);
    if (moved > 0) setStorageWarning(`서류 ${moved}개를 "코드 없는 서류"로 옮겼습니다.`);
  }

  /** 끌어다 놓아 칸 순서를 바꾼다. 번호는 그대로 두고 자리만 옮긴다. */
  async function handleMoveItem(taxonomyId: string, code: string, toGroupCode: string, before?: string) {
    const next = replaceTaxonomy(taxonomyId, (taxonomy) => moveItem(taxonomy, code, toGroupCode, before));
    await applyTaxonomies(next, null);
  }

  async function handleMoveGroup(taxonomyId: string, code: string, before?: string) {
    await applyTaxonomies(replaceTaxonomy(taxonomyId, (taxonomy) => moveGroup(taxonomy, code, before)), null);
  }

  /** 지금 순서대로 번호를 다시 매긴다. 그 칸에 올려 둔 서류의 번호도 함께 바꾼다. */
  async function handleRenumberGroup(taxonomyId: string, groupCode: string) {
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    if (!target) return;
    const { taxonomy: renumbered, changes } = renumberGroup(target, groupCode);
    if (changes.length === 0) {
      setStorageWarning("번호를 바꿀 것이 없습니다(다른 중분류와 번호가 겹치면 바꾸지 않습니다).");
      return;
    }
    const ok = window.confirm(
      `이 중분류의 칸 번호를 지금 순서대로 다시 매깁니다. 번호가 바뀌는 칸 ${changes.length}개.
` +
        "그 칸에 올려 둔 서류도 새 번호를 따라갑니다. 계속할까요?",
    );
    if (!ok) return;

    await applyTaxonomies(replaceTaxonomy(taxonomyId, () => renumbered), null);
    // 서류의 코드도 같이 옮긴다. 옛 번호를 한꺼번에 읽어 두고 바꿔야, 바꾸는 도중의
    // 번호와 부딪혀 엉뚱한 칸으로 가지 않는다.
    const moving = forms.filter(
      (form) => form.code && taxonomyIdOf(form, taxonomies) === taxonomyId && changes.some((c) => c.from === form.code),
    );
    for (const form of moving) {
      const change = changes.find((c) => c.from === form.code);
      if (change) await setFormCode(form.id, change.to, taxonomyId);
    }
    if (moving.length > 0) await refreshList();
    setStorageWarning(`번호를 정리했습니다. 칸 ${changes.length}개` + (moving.length > 0 ? `, 서류 ${moving.length}개` : ""));
  }

  /** 붙여넣기 상자에서 [이대로 넣기] 를 누르면 여기로 온다. */
  async function handlePasteApply(taxonomyId: string, lines: PastedLine[]) {
    const next = replaceTaxonomy(taxonomyId, (taxonomy) => applyPastedLines(taxonomy, lines));
    const added = next.find((taxonomy) => taxonomy.id === taxonomyId);
    const count = added ? added.groups.reduce((sum, group) => sum + group.items.length, 0) : 0;
    setPasteTarget(null);
    await applyTaxonomies(next, `붙여넣기로 채웠습니다. 지금 서류 칸 ${count}개입니다.`);
  }

  /** 한 칸에 적은 값을 되돌리기 기록에 남긴다. */
  const handleCommitValue = useCallback(
    (cellKey: string, before: string | undefined, after: string) => {
      const sheetName = sheetNameRef.current;
      if (!sheetName) return;
      historyRef.current.past.push({ sheet: sheetName, key: cellKey, before, after });
      // 새로 고치면 "다시하기"로 돌아갈 길은 사라진다(글쓰기 프로그램과 같은 규칙).
      historyRef.current.future = [];
    },
    [],
  );

  /** 되돌리기·다시하기 공통 — 한 걸음을 꺼내 그 칸의 값을 되돌려 놓는다. */
  const stepHistory = useCallback((direction: "undo" | "redo") => {
    const history = historyRef.current;
    const from = direction === "undo" ? history.past : history.future;
    const to = direction === "undo" ? history.future : history.past;
    const step = from.pop();
    if (!step) return;
    to.push(step);
    const restored = direction === "undo" ? step.before : step.after;
    setValues((prev) => {
      const sheetValues = { ...(prev[step.sheet] ?? {}) };
      // 손대기 전 값이 없었으면 "고친 적 없음"으로 되돌린다 — 엑셀 원본 글자가 다시 보인다.
      if (restored === undefined) delete sheetValues[step.key];
      else sheetValues[step.key] = restored;
      return { ...prev, [step.sheet]: sheetValues };
    });
  }, []);

  /**
   * 지금 보고 있는 양식을 엑셀 파일로 내려받는다.
   *
   * 원본 바이트는 저장소에 그대로 들고 있다. "채운 내용 포함"은 그 원본에 적은 글자만
   * 얹어서 주고, "원본 그대로"는 올릴 때의 파일을 그대로 준다.
   */
  async function handleDownload(filled: boolean) {
    if (state.status !== "ready") return;
    setDownloadOpen(false);
    try {
      const form = await getForm(state.id);
      if (!form?.bytes) {
        setStorageWarning("내려받을 원본 파일을 찾지 못했습니다. 이 양식을 다시 올려 주세요.");
        return;
      }
      if (!filled) {
        downloadBytes(form.bytes, form.fileName);
        setStorageWarning(null);
        return;
      }
      const { bytes, skippedSheets } = await buildFilledWorkbook(form.bytes, values);
      downloadBytes(bytes, filledFileName(form.fileName));
      setStorageWarning(
        skippedSheets.length > 0
          ? `내려받았습니다. 다만 앱에서 더한 시트(${skippedSheets.join(", ")})는 엑셀 원본에 없는 장이라 담지 못했습니다.`
          : null,
      );
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `내려받지 못했습니다: ${error.message}` : "내려받지 못했습니다.",
      );
    }
  }

  /**
   * 시트 아래에 빈 줄을 더하거나 줄인다.
   *
   * 현장마다 특이사항 줄 수가 달라 원본 줄 수로는 모자란다. 줄 수만 저장하고 격자는
   * 그릴 때 다시 만든다. 줄을 줄여도 그 줄에 적은 글자는 남아 있어, 다시 늘리면 돌아온다.
   */
  async function changeExtraRows(delta: number) {
    if (state.status !== "ready" || !baseSheet) return;
    const next = Math.max(0, extraRowCount + delta);
    if (next === extraRowCount) return;
    setExtraRowsState((prev) => ({ ...prev, [baseSheet.name]: next }));
    try {
      await setExtraRows(state.id, baseSheet.name, next);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `줄 수를 저장하지 못했습니다: ${error.message}` : "줄 수를 저장하지 못했습니다.",
      );
    }
  }

  /** 빈 칸을 눌러 그 코드표의 그 코드로 양식을 올린다. */
  function handleUploadFor(taxonomyId: string, item: TaxonomyItem) {
    pendingPlaceRef.current = { taxonomyId, code: item.code };
    preferredTaxonomyRef.current = undefined;
    fileInputRef.current?.click();
  }

  /** 그냥 올리기. 보고 있던 1차 분류를 기억해 둔다. */
  function handleUpload(preferredTaxonomyId?: string) {
    // 빈 칸을 눌렀다가 파일 고르기를 취소하면 그 칸이 남아 다음 올리기에 엉뚱하게 붙는다.
    pendingPlaceRef.current = undefined;
    preferredTaxonomyRef.current = preferredTaxonomyId;
    fileInputRef.current?.click();
  }

  /** 1차 분류 이름을 바꾼다. 서류는 코드표 id 로 묶여 있어 이름을 바꿔도 떨어지지 않는다. */
  async function handleRenameDivision(taxonomyId: string) {
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    if (!target) return;
    const name = window
      .prompt("1차 분류 이름을 적어 주세요. (예: 공무관련, 품질관련)", target.division)
      ?.trim();
    if (name === undefined || name === target.division) return;
    // 같은 이름이 둘이면 코드표를 다시 올릴 때 어느 쪽을 바꿀지 알 수 없다.
    if (name && taxonomies.some((taxonomy) => taxonomy.id !== taxonomyId && taxonomy.division === name)) {
      setStorageWarning(`“${name}” 1차 분류가 이미 있습니다. 다른 이름을 적어 주세요.`);
      return;
    }
    const next = taxonomies.map((taxonomy) =>
      taxonomy.id === taxonomyId ? { ...taxonomy, division: name } : taxonomy,
    );
    try {
      await saveTaxonomies(next);
      setTaxonomies(next);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `이름을 바꾸지 못했습니다: ${error.message}` : "이름을 바꾸지 못했습니다.",
      );
    }
  }

  /** 코드표 하나를 지운다. 그 분류로 올린 양식은 남고 "코드 없는 서류"로 옮겨진다. */
  async function handleRemoveTaxonomy(taxonomyId: string) {
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    if (!target) return;
    const ok = window.confirm(
      `“${target.division || target.fileName}” 코드표를 지웁니다.\n이 분류로 올린 양식은 지워지지 않고 "코드 없는 서류"로 옮겨집니다. 계속할까요?`,
    );
    if (!ok) return;
    const next = taxonomies.filter((taxonomy) => taxonomy.id !== taxonomyId);
    try {
      await saveTaxonomies(next);
      setTaxonomies(next);
      setStorageWarning(null);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `코드표를 지우지 못했습니다: ${error.message}` : "코드표를 지우지 못했습니다.",
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

  const baseSheet = state.status === "ready" ? state.sheets[activeSheet] : null;
  // 시트 아래에 더한 빈 줄. 원본 격자는 그대로 두고 그릴 때만 이어 붙인다.
  const extraRowCount = baseSheet ? (extraRows[baseSheet.name] ?? 0) : 0;
  const sheet = baseSheet ? withExtraRows(baseSheet, extraRowCount) : null;
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

  // 되돌리기 기록에 "어느 시트의 칸인지" 적으려면 지금 보는 시트 이름이 필요하다.
  useEffect(() => {
    sheetNameRef.current = sheet?.name ?? "";
  }, [sheet]);

  // Ctrl+Z 되돌리기 / Ctrl+Y·Ctrl+Shift+Z 다시하기.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      // 칸을 고치는 중이면 그 입력 상자의 자체 되돌리기(한 자씩)를 먼저 쓰게 둔다.
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      stepHistory(key === "y" || event.shiftKey ? "redo" : "undo");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepHistory]);


  return (
    <SmartBackground>
      <SmartHeader
        brand={
          <Link href="/" title="스마트덱 도구 목록으로">
            <BrandWordmark letters="SF" name="FORMS" caption="Company Form Library" />
          </Link>
        }
      />

      <SmartHero
        eyebrow="Smart Forms · Form Library"
        chips={
          <>
            <HeroChip>서류 {forms.length}</HeroChip>
            {taxonomies.length > 0 && <HeroChip dot>코드표 {taxonomies.length}</HeroChip>}
          </>
        }
        title="스마트폼(Smart Forms)"
        description="우미건설 사내 서식을 한곳에. 필요한 양식을 찾고, 그 자리에서 채우세요."
        actions={
          <Link
            href="/"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white px-5 text-[14px] font-bold text-[#0a5aa8] shadow-[0_14px_30px_-14px_rgba(0,20,45,0.9)] transition-all hover:-translate-y-0.5 hover:bg-[#f2f8ff]"
          >
            <ArrowLeft className="h-4 w-4" />
            도구 목록
          </Link>
        }
      />

      {/* 넓은 양식(21열짜리 대장 등)이 있어 폭을 넉넉히 잡는다. 좁으면 "가로 맞춤"
          배율이 그만큼 더 줄여 버려 글자가 작아진다. */}
      <main className="relative mx-auto w-full max-w-[2100px] px-8 pb-14 pt-9">
        {/* 파일 고르기 상자는 보이지 않는다. 목록의 "양식 올리기"가 이걸 누른다. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          // 여러 개를 한 번에 고를 수 있다(파일 이름 앞 번호로 각자 제자리에 들어간다).
          multiple
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
          {taxonomies.length > 0 ? (
            <FormTree
              taxonomies={taxonomies}
              editing={editingTaxonomy}
              onToggleEditing={() => setEditingTaxonomy((on) => !on)}
              onAddDivision={() => void handleAddDivision()}
              onAddGroup={(taxonomyId) => void handleAddGroup(taxonomyId)}
              onEditGroup={(taxonomyId, groupCode) => void handleEditGroup(taxonomyId, groupCode)}
              onRemoveGroup={(taxonomyId, groupCode) => void handleRemoveGroup(taxonomyId, groupCode)}
              onAddItem={(taxonomyId, groupCode) => void handleAddItem(taxonomyId, groupCode)}
              onEditItem={(taxonomyId, item) => void handleEditItem(taxonomyId, item)}
              onRemoveItem={(taxonomyId, item) => void handleRemoveItem(taxonomyId, item)}
              onPasteInto={(taxonomyId) => setPasteTarget(taxonomyId)}
              onMoveItem={(taxonomyId, code, toGroupCode, before) =>
                void handleMoveItem(taxonomyId, code, toGroupCode, before)
              }
              onMoveGroup={(taxonomyId, code, before) => void handleMoveGroup(taxonomyId, code, before)}
              onRenumberGroup={(taxonomyId, groupCode) => void handleRenumberGroup(taxonomyId, groupCode)}
              forms={forms}
              activeId={state.status === "ready" ? state.id : null}
              busy={state.status === "loading"}
              onOpen={(id) => void handleOpen(id)}
              onToggleFavorite={(form) => void patchMeta(form.id, { favorite: !form.favorite })}
              onDelete={(form) => void handleDelete(form)}
              onUploadFor={handleUploadFor}
              onUpload={handleUpload}
              onUploadTaxonomy={() => taxonomyInputRef.current?.click()}
              onRenameDivision={(id) => void handleRenameDivision(id)}
              onRemoveTaxonomy={(id) => void handleRemoveTaxonomy(id)}
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
              onUpload={() => handleUpload()}
              // 카드 목록 아래 작은 글씨로 두었더니 찾지 못했다. 도구 줄 버튼으로 둔다.
              onUploadTaxonomy={() => taxonomyInputRef.current?.click()}
              onCreateTaxonomy={() => {
                setEditingTaxonomy(true);
                void handleAddDivision();
              }}
            />
          )}
        </div>

        {pasteTarget && (
          <PasteTaxonomyDialog
            division={taxonomies.find((taxonomy) => taxonomy.id === pasteTarget)?.division ?? ""}
            onCancel={() => setPasteTarget(null)}
            onApply={(lines) => void handlePasteApply(pasteTarget, lines)}
          />
        )}

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

                {sheet.locked && editable && (
                  <button
                    type="button"
                    onClick={() => setShowEditableTint((on) => !on)}
                    aria-pressed={showEditableTint}
                    title="고칠 수 있는 칸을 연한 하늘색으로 칠해 줍니다. 원본 모양 그대로 보려면 끄세요."
                    className={
                      showEditableTint
                        ? "inline-flex items-center gap-1.5 rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-800 ring-1 ring-sky-300"
                        : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
                    }
                  >
                    입력칸 표시 {showEditableTint ? "켬" : "끔"}
                  </button>
                )}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setDownloadOpen((open) => !open)}
                    aria-expanded={downloadOpen}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
                  >
                    <Download size={13} /> 엑셀 내려받기
                  </button>
                  {downloadOpen && (
                    <>
                      {/* 바깥을 누르면 닫는다 */}
                      <button
                        type="button"
                        aria-label="메뉴 닫기"
                        tabIndex={-1}
                        onClick={() => setDownloadOpen(false)}
                        className="fixed inset-0 z-10 cursor-default"
                      />
                      <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200">
                        <button
                          type="button"
                          onClick={() => void handleDownload(true)}
                          className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <span className="font-medium">채운 내용 포함</span>
                          <span className="block text-[11px] text-slate-400">화면에서 적은 글자가 들어간 엑셀</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDownload(false)}
                          className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <span className="font-medium">올린 원본 그대로</span>
                          <span className="block text-[11px] text-slate-400">빈 양식 파일</span>
                        </button>
                      </div>
                    </>
                  )}
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
              {!sheet.locked && editable && (
                <span title="이 시트에는 엑셀 잠금이 걸려 있지 않아, 어느 칸이든 눌러 고칠 수 있습니다.">
                  잠금 없음 · 모든 칸 편집 가능
                </span>
              )}
              {sheet.locked && (
                <span
                  className="text-amber-600"
                  title="엑셀에서 시트 보호가 걸려 있습니다. 잠긴 칸은 엑셀과 마찬가지로 고칠 수 없고, 풀어 둔 칸만 고칠 수 있습니다."
                >
                  🔒 잠긴 시트 · 고칠 수 있는 칸 {sheet.cells.filter((c) => !c.locked).length}개
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
              onCommitValue={handleCommitValue}
              tint={showEditableTint}
              onChangeValue={(cellKey, value) =>
                setValues((prev) => ({
                  ...prev,
                  [sheet.name]: { ...(prev[sheet.name] ?? {}), [cellKey]: value },
                }))
              }
              scale={scale}
            />

            {/* 줄 늘리기 — 편집 중에만, 표 **아래 한 곳**에만 둔다. 줄마다 버튼을 붙이면
                표가 버튼으로 뒤덮여 양식처럼 보이지 않는다. */}
            {editable && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => void changeExtraRows(1)}
                  title="바로 위 줄의 테두리·글꼴을 복사해 빈 줄을 한 줄 더합니다."
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
                >
                  <Plus size={13} /> 줄 추가
                </button>
                {extraRowCount > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => void changeExtraRows(-1)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50"
                    >
                      <Minus size={13} /> 마지막 줄 빼기
                    </button>
                    <span className="text-xs text-slate-400">
                      더한 줄 {extraRowCount}개 · 내려받을 때 인쇄 영역도 함께 늘어납니다
                    </span>
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </SmartBackground>
  );
}

/**
 * 폴더 이름 목록을 붙여넣어 코드표를 한 번에 채우는 상자.
 *
 * 탐색기에서 폴더를 복사해 그대로 붙이면 된다. **넣기 전에 어떻게 들어갈지 먼저 보여 준다** —
 * 번호를 잘못 읽은 줄이 있으면 넣기 전에 알아챌 수 있어야 하기 때문이다.
 */
function PasteTaxonomyDialog({
  division,
  onCancel,
  onApply,
}: {
  division: string;
  onCancel: () => void;
  onApply: (lines: PastedLine[]) => void;
}) {
  const [text, setText] = useState("");
  const lines = parsePastedTaxonomy(text);
  const skipped = text.trim() === "" ? 0 : text.split(/\r?\n/).filter((line) => line.trim() !== "").length - lines.length;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-6">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">
          여러 줄 한 번에 넣기{division && <span className="text-slate-400"> · {division}</span>}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          탐색기에서 폴더를 복사(Ctrl+C)해 아래에 붙여넣으세요(Ctrl+V). 번호가 100·200처럼 백 단위면 중분류,
          그 밖의 번호(101, 802-1)는 바로 위 중분류의 서류 칸이 됩니다.
        </p>

        <div className="mt-4 grid flex-1 gap-4 overflow-hidden md:grid-cols-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"100. 공통일반\n101. 이해관계자 니즈와 기대\n102. 리스크와 기회관리"}
            className="h-64 w-full resize-none rounded-xl border border-slate-300 p-3 font-mono text-xs outline-none focus:border-blue-500"
            autoFocus
          />
          <div className="h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-xs ring-1 ring-slate-200">
            {lines.length === 0 ? (
              <p className="text-slate-400">붙여넣으면 여기에 “이렇게 들어갑니다”가 보입니다.</p>
            ) : (
              <ul className="space-y-1">
                {lines.map((line) => (
                  <li
                    key={line.code}
                    className={line.isGroup ? "font-semibold text-slate-800" : "pl-4 text-slate-600"}
                  >
                    {line.code} {line.name}
                    {line.isGroup && <span className="ml-1 text-[11px] font-normal text-slate-400">중분류</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-slate-200 pt-4">
          <span className="text-xs text-slate-500">
            {lines.length}줄을 읽었습니다
            {skipped > 0 && ` · 번호가 없어 건너뛴 줄 ${skipped}개`}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              취소
            </button>
            <button
              type="button"
              disabled={lines.length === 0}
              onClick={() => onApply(lines)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
            >
              이대로 넣기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
