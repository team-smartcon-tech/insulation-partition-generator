/**
 * 우미 양식 모음집 — 엑셀 양식을 올려 내용을 채우는 화면.
 *
 * 양식(병합·테두리·칸 크기·글꼴)은 엑셀 원본 그대로 고정하고, 글자는 어느 칸이든
 * 고칠 수 있다. 올린 양식과 고친 글자는 브라우저에 저장돼 새로고침해도 남는다
 * ({@link ./formStore}). 목록은 분류 탭·즐겨찾기로 고르는 서식함 모양이다
 * ({@link ./FormGallery}). 서버 저장·공유는 다음 단계에서 이 위에 얹는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import BrandWordmark from "@/components/brand/BrandWordmark";
import { SmartBackground, SmartHeader } from "@/components/layout/SmartShell";
import { useAuth } from "@/features/auth/AuthContext";
import SignatureDialog, { useSignature } from "@/features/profile/SignatureDialog";
import { writeSignature } from "@/features/profile/signature";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  FolderOpen,
  Lock,
  ChevronDown,
  Search,
  Download,
  FileSpreadsheet,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
  PenLine,
  UserRound,
  Users,
} from "lucide-react";
import {
  contactFor,
  contactInputText,
  formatContact,
  parseContactInput,
  setGroupContact,
  setItemContact,
} from "./contacts";
import { buildFilledWorkbook, downloadBytes, filledFileName } from "./formExport";
import { parseFormWorkbook } from "./formParser";
import { withExtraRows } from "./sheetRows";
import FormGallery from "./FormGallery";
import FormTree from "./FormTree";
import { findApprovalBoxes } from "./approval";
import { dataUrlBytes, type ApprovalStamp } from "./approvalExport";
import ApprovalLineDialog, { type ApprovalLineResult } from "./ApprovalLineDialog";
import {
  approvalDateText,
  assigneeCaption,
  cancellableIndex,
  initialLine,
  lineRecord,
  pruneApprovals,
  rememberDefaults,
  slotStates,
  type Approval,
  type Assignee,
} from "./approvalLine";
import {
  isSiteDoc,
  isTemplate,
  latestTemplateIn,
  newerTemplateFor,
  type FormKind,
} from "./library";
import FormSheetView, { type CellMark, type FormScale } from "./FormSheetView";
import {
  FIRST_SITE_NAME,
  addSite,
  formsOfSite,
  renameSite,
  updateSite,
  summarizeSites,
  type FormSite,
  type SiteProgress,
} from "./sites";
import {
  addCustomSheet,
  copyTemplateToSite,
  deleteForm,
  findTemplateSheet,
  getForm,
  isTemplateSheet,
  removeCustomSheet,
  renameCustomSheet,
  isStorageAvailable,
  listForms,
  readLastOpenedId,
  loadSites,
  loadTaxonomies,
  migrateLegacyForms,
  reparseForm,
  saveForm,
  saveSites,
  saveTaxonomies,
  setSheetApproval,
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
  | {
      status: "ready";
      id: string;
      fileName: string;
      title: string;
      sheets: FormSheet[];
      /** 배포 양식(원본)이면 고칠 수 없다 */
      kind?: FormKind;
    };

/** 배포 양식함(원본) · 현장 서류함(작성본) */
type Space = "library" | "site";

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
/** 마지막으로 보던 현장(브라우저에만 기억한다) */
const LAST_SITE_KEY = "ipg-forms:last-site";
/** 마지막으로 보던 곳(배포 양식함 / 현장 서류함) */
const SPACE_KEY = "ipg-forms:space";
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
  /** 현장 목록과 지금 보고 있는 현장 */
  const [sites, setSites] = useState<FormSite[]>([]);
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  /** 지금 보는 곳. 원본(배포 양식함)과 작성본(현장 서류함)을 섞어 보여 주지 않는다. */
  const [space, setSpaceState] = useState<Space>(() => {
    try {
      return localStorage.getItem(SPACE_KEY) === "library" ? "library" : "site";
    } catch {
      return "site";
    }
  });
  /** 시트 이름 → 아래에 더한 빈 줄 수 */
  const [extraRows, setExtraRowsState] = useState<Record<string, number>>({});
  /** 시트 이름 → (서명 자리 키 → 결재자) */
  const [approvalLines, setApprovalLinesState] = useState<Record<string, Record<string, Assignee>>>({});
  /** 시트 이름 → (서명 자리 키 → 결재 기록) */
  const [approvals, setApprovalsState] = useState<Record<string, Record<string, Approval>>>({});
  /** 서명이 없어 등록 창을 띄웠을 때, 등록하면 이어서 결재할 칸 */
  const [signFor, setSignFor] = useState<number | null>(null);
  const { user } = useAuth();
  const mySignature = useSignature(user?.id);
  /** 결재선 지정 창이 열려 있나 */
  const [lineDialogOpen, setLineDialogOpen] = useState(false);
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

  /** 마지막으로 보던 현장을 기억해 둔다(다음에 열 때 그 현장으로 시작). */
  function selectSite(id: string) {
    // 빈 문자열은 "모든 현장 보기"다(한 현장을 고르지 않은 상태).
    setSiteId(id || undefined);
    try {
      localStorage.setItem(LAST_SITE_KEY, id);
    } catch {
      // 저장이 막힌 브라우저 — 이번 화면에서만 유지된다.
    }
  }

  function setSpace(next: Space) {
    setSpaceState(next);
    // 다른 곳으로 옮기면 코드표 편집은 끈다 — 편집 도구는 배포 양식함에만 있다.
    if (next === "site") setEditingTaxonomy(false);
    try {
      localStorage.setItem(SPACE_KEY, next);
    } catch {
      // 저장이 막힌 브라우저 — 이번 화면에서만 유지된다.
    }
  }

  async function handleAddSite() {
    const name = window.prompt("새 현장 이름을 적어 주세요. (예: 부산장안(B1))", "")?.trim();
    if (!name) return;
    const next = addSite(sites, name, () => crypto.randomUUID());
    if (next === sites) {
      setStorageWarning(`“${name}” 현장이 이미 있습니다.`);
      return;
    }
    try {
      await saveSites(next);
      setSites(next);
      selectSite(next[next.length - 1].id);
      setStorageWarning(null);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `현장을 만들지 못했습니다: ${error.message}` : "현장을 만들지 못했습니다.",
      );
    }
  }

  async function handleRenameSite() {
    const target = sites.find((site) => site.id === siteId);
    if (!target) return;
    const name = window.prompt("현장 이름을 바꿉니다.", target.name)?.trim();
    if (!name || name === target.name) return;
    const next = renameSite(sites, target.id, name);
    if (next === sites) {
      setStorageWarning(`“${name}” 현장이 이미 있습니다.`);
      return;
    }
    try {
      await saveSites(next);
      setSites(next);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `이름을 바꾸지 못했습니다: ${error.message}` : "이름을 바꾸지 못했습니다.",
      );
    }
  }

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
    setApprovalLinesState(form.approvalLines ?? {});
    setApprovalsState(form.approvals ?? {});
    setActiveSheet(0);
    setState({
      status: "ready",
      id: form.id,
      fileName: form.fileName,
      title: form.title,
      sheets: form.sheets,
      kind: form.kind,
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

      // 현장 목록. 한 번도 만든 적이 없으면 첫 현장을 만들어 준다 — 빈 선택 상태를
      // 보여 주면 "어디에 올라가는지" 모른 채 올리게 된다.
      try {
        let list = await loadSites();
        if (list.length === 0) {
          list = addSite([], FIRST_SITE_NAME, () => crypto.randomUUID());
          await saveSites(list);
        }
        if (!cancelled) {
          setSites(list);
          const remembered = (() => {
            try {
              return localStorage.getItem(LAST_SITE_KEY) ?? undefined;
            } catch {
              return undefined;
            }
          })();
          setSiteId(list.some((site) => site.id === remembered) ? remembered : list[0].id);
        }

        // 구분이 생기기 전에 올린 서류를 배포 양식 / 현장 서류로 나눈다(처음 한 번만 할 일이 있다).
        // 적어 둔 내용이 있던 서류는 사본이 그 내용을 들고 현장 서류함으로 간다 — 지우는 것은 없다.
        const moved = await migrateLegacyForms(list[0]?.id);
        const last = readLastOpenedId();
        if (last && moved.has(last)) writeLastOpenedId(moved.get(last) ?? null);
      } catch {
        // 현장을 못 읽어도 서류는 보여야 한다.
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
    const uploadKind: FormKind = space === "library" ? "template" : "site";
    pendingPlaceRef.current = undefined;
    preferredTaxonomyRef.current = undefined;

    setState({ status: "loading" });
    setActiveSheet(0);
    setExtraRowsState({});
    setApprovalLinesState({});
    setApprovalsState({});
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
            // 배포 양식함에서 올리면 원본, 현장 서류함에서 올리면 그 현장 서류다.
            kind: uploadKind,
            siteId,
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
      kind: uploadKind,
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

  /**
   * 담당 적기. 부서 / 이름 / 연락처를 한 줄로 받는다(코드표 편집의 다른 입력과 같은 방식).
   * 중분류에 적으면 아래 칸이 물려받고, 칸에는 담당이 다를 때만 적는다.
   */
  async function handleEditGroupContact(taxonomyId: string, groupCode: string) {
    const group = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId)?.groups.find((g) => g.code === groupCode);
    if (!group) return;
    const answer = window.prompt(
      `“${group.code} ${group.name}” 담당을 적어 주세요. 아래 칸들이 모두 물려받습니다.\n부서 / 이름 / 연락처 순서로 한 줄 (예: 품질팀 / 홍길동 대리 / 내선 1234)\n비우면 담당을 지웁니다.`,
      contactInputText(group.contact),
    );
    if (answer === null) return;
    await applyTaxonomies(
      replaceTaxonomy(taxonomyId, (taxonomy) => setGroupContact(taxonomy, groupCode, parseContactInput(answer))),
      null,
    );
  }

  async function handleEditItemContact(taxonomyId: string, item: TaxonomyItem) {
    const target = taxonomies.find((taxonomy) => taxonomy.id === taxonomyId);
    if (!target) return;
    const resolved = contactFor(target, item.code);
    const groupNote =
      resolved?.inherited ? `비우면 중분류 담당(${formatContact(resolved.contact)})을 따릅니다.` : "비우면 중분류 담당을 따릅니다.";
    const answer = window.prompt(
      `“${item.code} ${item.name}” 칸만 담당이 다르면 적어 주세요.\n부서 / 이름 / 연락처 순서로 한 줄 (예: 안전팀 / 이영희 과장 / 010-0000-0000)\n${groupNote}`,
      contactInputText(item.contact),
    );
    if (answer === null) return;
    await applyTaxonomies(
      replaceTaxonomy(taxonomyId, (taxonomy) => setItemContact(taxonomy, item.code, parseContactInput(answer))),
      null,
    );
  }

  /** 붙여넣기 상자에서 [이대로 넣기] 를 누르면 여기로 온다. */
  async function handlePasteApply(taxonomyId: string, lines: PastedLine[]) {
    const next = replaceTaxonomy(taxonomyId, (taxonomy) => applyPastedLines(taxonomy, lines));
    const added = next.find((taxonomy) => taxonomy.id === taxonomyId);
    const count = added ? added.groups.reduce((sum, group) => sum + group.items.length, 0) : 0;
    setPasteTarget(null);
    await applyTaxonomies(next, `붙여넣기로 채웠습니다. 지금 서류 칸 ${count}개입니다.`);
  }

  /**
   * 결재선 지정 창에서 [확인] — 이 시트의 결재선을 저장하고, 조직 변경과 기본 결재선을 현장에 남긴다.
   * 저장에 실패하면 화면도 바꾸지 않는다(보이는 것과 저장된 것이 갈리지 않게).
   */
  async function handleConfirmLine(result: ApprovalLineResult) {
    if (state.status !== "ready" || !baseSheet || !docSite) return;
    const record = lineRecord(lineSlots, result.line);
    const nextSites = updateSite(sites, docSite.id, {
      members: result.members,
      ...(result.remember
        ? { lineDefaults: rememberDefaults(docSite.lineDefaults, lineSlots, result.line) }
        : {}),
    });
    // 사람이 바뀐 칸(과 그 뒤)의 결재는 지운다 — 다른 사람 칸에 남은 서명은 거짓이다.
    const pruned = pruneApprovals(lineSlots, record, sheetApprovals);
    try {
      await setSheetApproval(state.id, baseSheet.name, { line: record, approvals: pruned.approvals });
      await saveSites(nextSites);
      setSites(nextSites);
      setApprovalLinesState((prev) => ({ ...prev, [baseSheet.name]: record }));
      setApprovalsState((prev) => ({ ...prev, [baseSheet.name]: pruned.approvals }));
      setLineDialogOpen(false);
      setStorageWarning(
        pruned.removed > 0 ? `결재선이 바뀌어 이미 한 결재 ${pruned.removed}건을 지웠습니다. 바뀐 칸부터 다시 결재해야 합니다.` : null,
      );
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `결재선을 저장하지 못했습니다: ${error.message}` : "결재선을 저장하지 못했습니다.",
      );
    }
  }

  /** 결재 기록을 저장하고 화면에 반영한다. 실패하면 화면은 그대로 둔다. */
  async function saveApprovals(next: Record<string, Approval>) {
    if (state.status !== "ready" || !baseSheet) return false;
    try {
      await setSheetApproval(state.id, baseSheet.name, { approvals: next });
      setApprovalsState((prev) => ({ ...prev, [baseSheet.name]: next }));
      return true;
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `결재를 저장하지 못했습니다: ${error.message}` : "결재를 저장하지 못했습니다.",
      );
      return false;
    }
  }

  /**
   * 내 차례의 칸에 결재한다 — 등록해 둔 서명과 오늘 날짜가 찍힌다.
   * 서명이 없으면 서명 등록 창부터 띄우고, 등록하면 이어서 결재한다(카드까지 돌아가지 않게).
   */
  async function handleApprove(index: number, signature = mySignature) {
    const slot = lineSlots[index];
    const assignee = slot ? sheetLine?.[slot.signKey] : undefined;
    if (!slot || !assignee || !user) return;
    if (!signature) {
      setSignFor(index);
      return;
    }
    if (!window.confirm(`“${slot.label}” 칸에 결재합니다. 등록한 서명과 오늘 날짜가 찍힙니다.`)) return;
    const ok = await saveApprovals({
      ...sheetApprovals,
      [slot.signKey]: {
        name: assignee.name,
        position: assignee.position,
        userId: user.id,
        signature,
        approvedAt: Date.now(),
      },
    });
    if (ok) setStorageWarning(null);
  }

  async function handleCancelApproval(index: number) {
    const slot = lineSlots[index];
    if (!slot) return;
    if (!window.confirm(`“${slot.label}” 칸의 결재를 취소합니다. 서명과 날짜가 지워집니다.`)) return;
    const next = { ...sheetApprovals };
    delete next[slot.signKey];
    await saveApprovals(next);
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
      // 결재한 칸: 서명·구분선·이름은 떠 있는 그림으로, 날짜는 날짜 자리(`/`) 칸의 글자로 넣는다.
      const exportValues: FormValues = { ...values };
      const stamps: Record<string, ApprovalStamp[]> = {};
      for (const [sheetName, record] of Object.entries(approvals)) {
        const target = state.sheets.find((item) => item.name === sheetName);
        if (!target) continue;
        const slots = findApprovalBoxes(target).flatMap((box) => box.slots);
        for (const [signKey, approval] of Object.entries(record)) {
          const cell = target.cells.find((item) => item.key === signKey);
          if (!cell) continue;
          (stamps[sheetName] ??= []).push({
            row: cell.row,
            col: cell.col,
            rowSpan: cell.rowSpan,
            colSpan: cell.colSpan,
            png: dataUrlBytes(approval.signature),
            caption: [approval.name, approval.position].filter(Boolean).join(" "),
          });
          const dateKey = slots.find((slot) => slot.signKey === signKey)?.dateKey;
          if (dateKey) {
            exportValues[sheetName] = { ...(exportValues[sheetName] ?? {}), [dateKey]: approvalDateText(approval.approvedAt) };
          }
        }
      }
      const { bytes, skippedSheets } = await buildFilledWorkbook(form.bytes, exportValues, stamps);
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
    // 현장 서류함에서 그 칸의 배포 양식이 있으면 파일을 고르지 않고 원본으로 바로 작성한다.
    if (space === "site" && siteId) {
      const template = latestTemplateIn(taxonomyId, item.code, templates, taxonomies);
      if (template) {
        void handleWrite(template.id, siteId);
        return;
      }
      // 원본이 없는 칸 — 현장 서류함에서는 파일을 직접 올리지 않는다.
      return;
    }
    pendingPlaceRef.current = { taxonomyId, code: item.code };
    preferredTaxonomyRef.current = undefined;
    fileInputRef.current?.click();
  }

  /**
   * 배포 양식으로 현장 서류를 만든다 — 원본을 복사해 그 현장 서류함에 넣고 바로 연다.
   *
   * 같은 원본으로 이미 만든 서류가 있으면 한 번 묻는다. 월별로 여러 부 만드는 일이 흔해
   * 막지는 않지만, 모르고 두 번 누르면 같은 서류가 둘 생긴다.
   */
  async function handleWrite(templateId: string, targetSiteId: string | undefined) {
    const target = sites.find((site) => site.id === targetSiteId);
    if (!target) {
      setStorageWarning("작성할 현장을 먼저 골라 주세요.");
      return;
    }
    // 원본이 목록에 아직 없을 수 있다(올리자마자 누르면 목록 새로고침보다 빠르다). 원본이 정말
    // 있는지는 저장소가 복사하면서 확인하므로, 여기서는 목록에 없다고 막지 않는다.
    const existing = forms.filter(
      (form) => isSiteDoc(form) && form.siteId === target.id && form.templateId === templateId,
    ).length;
    if (
      existing > 0 &&
      !window.confirm(
        `“${target.name}” 서류함에 이 양식으로 만든 서류가 이미 ${existing}부 있습니다.\n한 부 더 만들까요?`,
      )
    ) {
      return;
    }
    try {
      const copy = await copyTemplateToSite(templateId, target.id);
      selectSite(target.id);
      setSpace("site");
      await refreshList();
      await openStored(copy.id);
      setSaveState("saved");
      setStorageWarning(`“${target.name}” 서류함에 “${copy.title}”을(를) 만들었습니다. 여기서 작성하세요.`);
    } catch (error) {
      setStorageWarning(
        error instanceof Error ? `작성할 서류를 만들지 못했습니다: ${error.message}` : "작성할 서류를 만들지 못했습니다.",
      );
    }
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
      isTemplate(summary)
        ? `배포 양식 “${summary.title}”을(를) 지웁니다.\n이 양식으로 이미 만든 현장 서류는 지워지지 않습니다. 되돌릴 수 없습니다. 계속할까요?`
        : `“${summary.title}”을(를) 지웁니다.\n적어 둔 내용도 함께 사라지고 되돌릴 수 없습니다. 계속할까요?`,
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

  // 원본과 작성본을 나눈다. 현장 서류함에는 지금 보고 있는 현장의 서류만 올린다.
  const templates = forms.filter(isTemplate);
  const siteDocs = forms.filter(isSiteDoc);
  const siteForms = formsOfSite(siteDocs, sites, siteId);
  const listForms_ = space === "library" ? templates : siteForms;
  // 배포 양식함에서 "작성하기"를 누를 때 사본이 들어갈 현장. 전 현장 보기였으면 첫 현장.
  const writeSite = sites.find((site) => site.id === siteId) ?? sites[0];
  /**
   * 열어 둔 서류를 아래에 펼칠지.
   *
   * 모든 현장 보기에서는 펼치지 않는다 — 현황을 훑는 화면인데 마지막에 열었던 서류 한 장이
   * 아래를 통째로 차지하면 "어느 현장 서류인지"도 헷갈린다. 현장을 골랐을 때도 **그 현장
   * 서류일 때만** 펼친다(다른 현장으로 옮기면 앞 현장 서류가 남아 보이지 않게).
   */
  const openFormInSite =
    state.status === "ready" &&
    (space === "library"
      ? state.kind === "template"
      : Boolean(siteId) &&
        // 저장에 실패한 양식(id 없음)은 목록에 없지만, 방금 올린 것이라 그대로 보여 줘야 한다.
        (state.id === "" ? state.kind === "site" : siteForms.some((form) => form.id === state.id)));
  /** 배포 원본을 보고 있나 — 그러면 아무것도 고칠 수 없다. */
  const readOnly = state.status === "ready" && state.kind === "template";
  const canEdit = editable && !readOnly;
  const openedSummary = state.status === "ready" ? forms.find((form) => form.id === state.id) : undefined;
  /** 현장 서류함의 서류는 여기서 시작한다 — 배포 양식함으로 가서 고르고 [작성하기]. */
  const importButton = (
    <button
      type="button"
      onClick={() => setSpace("library")}
      title="배포 양식함으로 가서 양식을 고르고 [작성하기]를 누르세요."
      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
    >
      <Plus size={13} /> 배포 양식에서 가져오기
    </button>
  );
  // 열어 둔 서류의 담당 — 쓰다 막히면 누구에게 물어야 하는지 서류 바로 위에 보여 준다.
  const openedTaxonomyId = openedSummary ? taxonomyIdOf(openedSummary, taxonomies) : undefined;
  const openedTaxonomy = taxonomies.find((taxonomy) => taxonomy.id === openedTaxonomyId);
  const openedContact =
    openedTaxonomy && openedSummary?.code ? contactFor(openedTaxonomy, openedSummary.code) : undefined;
  const newerTemplate = openedSummary ? newerTemplateFor(openedSummary, templates, taxonomies) : undefined;
  // 코드표의 칸 수(회사 공통) — 현장별 현황의 분모다.
  const totalSlots = taxonomies.reduce(
    (sum, taxonomy) => sum + taxonomy.groups.reduce((count, group) => count + group.items.length, 0),
    0,
  );
  const baseSheet = state.status === "ready" ? state.sheets[activeSheet] : null;
  // 시트 아래에 더한 빈 줄. 원본 격자는 그대로 두고 그릴 때만 이어 붙인다.
  const extraRowCount = baseSheet ? (extraRows[baseSheet.name] ?? 0) : 0;
  const sheet = baseSheet ? withExtraRows(baseSheet, extraRowCount) : null;
  // 결재칸(작성·검토·승인). 원본 시트 격자에서 찾는다 — 더한 줄과는 상관없다.
  // 견본 시트는 결재할 문서가 아니라 작성 예시라 찾지 않는다(사용자 판단). 견본을 복사해
  // 더한 장은 실제 문서라 찾는다.
  const approvalBoxes = useMemo(
    () => (baseSheet && !isTemplateSheet(baseSheet) ? findApprovalBoxes(baseSheet) : []),
    [baseSheet],
  );
  const signKeys = useMemo(
    () => new Set(approvalBoxes.flatMap((box) => box.slots.map((slot) => slot.signKey))),
    [approvalBoxes],
  );
  const lineSlots = useMemo(() => approvalBoxes.flatMap((box) => box.slots), [approvalBoxes]);
  const sheetLine = baseSheet ? approvalLines[baseSheet.name] : undefined;
  const sheetApprovals = useMemo(
    () => (baseSheet ? (approvals[baseSheet.name] ?? {}) : {}),
    [approvals, baseSheet],
  );
  const states = useMemo(
    () => slotStates(lineSlots, sheetLine ?? {}, sheetApprovals, user?.name),
    [lineSlots, sheetLine, sheetApprovals, user?.name],
  );
  const readyIndex = states.findIndex((item) => item.status === "ready");
  const waitingState = states.find((item) => item.status === "waiting");
  const cancelIndex = cancellableIndex(lineSlots, sheetApprovals, user?.id);
  const approvedCount = states.filter((item) => item.status === "done").length;
  // 점선은 아직 서명이 없는 자리에만 — 결재한 칸은 도장처럼 깔끔하게 보이게.
  const pendingSignKeys = useMemo(
    () => new Set([...signKeys].filter((key) => !sheetApprovals[key])),
    [signKeys, sheetApprovals],
  );
  /** 결재칸에 얹을 것: 결재했으면 서명·이름·날짜, 결재선만 정했으면 이름 */
  const cellMarks = useMemo(() => {
    const marks = new Map<string, CellMark>();
    lineSlots.forEach((slot, index) => {
      const item = states[index];
      if (item?.status === "done") {
        marks.set(slot.signKey, {
          image: item.approval.signature,
          caption: [item.approval.name, item.approval.position].filter(Boolean).join(" "),
        });
        const dateKey = approvalBoxes.flatMap((box) => box.slots).find((entry) => entry.signKey === slot.signKey)?.dateKey;
        if (dateKey) marks.set(dateKey, { text: approvalDateText(item.approval.approvedAt) });
        return;
      }
      const person = sheetLine?.[slot.signKey];
      if (person) marks.set(slot.signKey, { caption: assigneeCaption(person) });
    });
    return marks;
  }, [lineSlots, states, sheetLine, approvalBoxes]);
  /** 이 서류가 속한 현장 — 조직·기본 결재선을 여기서 꺼낸다(헤더에서 고른 현장과 같다). */
  const docSite = sites.find((site) => site.id === (openedSummary?.siteId ?? siteId));
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
        center={
          space === "site" ? (
            <SitePicker
              sites={sites}
              currentId={siteId}
              onSelect={(id) => selectSite(id)}
              onSelectAll={() => selectSite("")}
              onAdd={() => void handleAddSite()}
              onRename={() => void handleRenameSite()}
            />
          ) : (
            // 원본은 어느 현장 것도 아니라 현장을 고를 일이 없다. 자리는 남겨 흐리게 둔다.
            <div className="flex flex-col items-center px-4 py-1 opacity-40" title="현장은 현장 서류함에서 고릅니다.">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Project</span>
              <span className="text-[15px] font-bold text-slate-700">현장 서류함에서 고릅니다</span>
            </div>
          )
        }
        subbar={<SpaceTabs space={space} onChange={setSpace} />}
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
          {/* 현장을 고르지 않았으면 현장별 현황부터 — 서류 점검은 여기서 시작한다. */}
          {space === "site" && !siteId ? (
            <SiteOverview
              rows={summarizeSites(sites, siteDocs, totalSlots)}
              onOpen={(id) => selectSite(id)}
              onAdd={() => void handleAddSite()}
            />
          ) : taxonomies.length > 0 ? (
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
              onEditGroupContact={(taxonomyId, groupCode) => void handleEditGroupContact(taxonomyId, groupCode)}
              onEditItemContact={(taxonomyId, item) => void handleEditItemContact(taxonomyId, item)}
              forms={listForms_}
              activeId={state.status === "ready" ? state.id : null}
              busy={state.status === "loading"}
              onOpen={(id) => void handleOpen(id)}
              onToggleFavorite={(form) => void patchMeta(form.id, { favorite: !form.favorite })}
              onDelete={(form) => void handleDelete(form)}
              title={space === "library" ? "배포 양식함" : `${writeSite?.name ?? "현장"} 서류함`}
              subtitle={
                space === "library"
                  ? "회사가 배포한 원본입니다. 열어서 확인하고 [작성하기]를 누르면 현장 서류함에 사본이 생깁니다."
                  : "이 현장의 작성본입니다. 빈 칸의 [작성하기]는 배포 양식으로 바로 사본을 만듭니다."
              }
              manageTaxonomy={space === "library"}
              // 현장 서류함의 서류는 배포 양식에서 가져온다. 원본이 없는 칸만 그 칸의 [올리기]로 올린다.
              uploadLabel={space === "library" ? "배포 양식 올리기" : null}
              toolbarExtra={space === "site" ? importButton : undefined}
              extraBadges={(form) => {
                const newer = newerTemplateFor(form, templates, taxonomies);
                return newer
                  ? [
                      {
                        label: "새 판 있음",
                        title: `${new Date(newer.uploadedAt).toLocaleDateString("ko-KR")}에 올라온 새 배포 양식이 있습니다. 이 서류는 그대로 둡니다.`,
                        tone: "blue" as const,
                      },
                    ]
                  : [];
              }}
              slotAction={(taxonomyId, item) => {
                if (space === "site" && latestTemplateIn(taxonomyId, item.code, templates, taxonomies)) {
                  return {
                    label: "작성하기",
                    title: `배포 양식으로 ${item.code} ${item.name}을(를) 이 현장 서류함에 만듭니다`,
                    write: true,
                  };
                }
                // 현장 서류는 원본에서 시작한다 — 원본이 없는 칸에 올리기를 두면 원본을 거치지 않는
                // 길이 생기고, 원본이 하나도 없을 때는 목록이 온통 [올리기]로 덮여 예전 화면처럼 보인다.
                if (space === "site") {
                  return {
                    label: "배포 양식 없음",
                    title: "배포 양식함에 이 칸의 원본이 올라오면 여기서 [작성하기]로 만들 수 있습니다.",
                    write: false,
                    none: true,
                  };
                }
                return {
                  label: "올리기",
                  title: `${item.code} ${item.name} 칸에 배포 양식을 올립니다`,
                  write: false,
                };
              }}
              onUploadFor={handleUploadFor}
              onUpload={handleUpload}
              onUploadTaxonomy={() => taxonomyInputRef.current?.click()}
              onRenameDivision={(id) => void handleRenameDivision(id)}
              onRemoveTaxonomy={(id) => void handleRemoveTaxonomy(id)}
            />
          ) : (
            <FormGallery
              forms={listForms_}
              activeId={state.status === "ready" ? state.id : null}
              busy={state.status === "loading"}
              onOpen={(id) => void handleOpen(id)}
              onToggleFavorite={(form) => void patchMeta(form.id, { favorite: !form.favorite })}
              onChangeCategory={(form, category) => void patchMeta(form.id, { category })}
              onDelete={(form) => void handleDelete(form)}
              onUpload={space === "library" ? () => handleUpload() : undefined}
              // 카드 목록 아래 작은 글씨로 두었더니 찾지 못했다. 도구 줄 버튼으로 둔다.
              onUploadTaxonomy={space === "library" ? () => taxonomyInputRef.current?.click() : undefined}
              onCreateTaxonomy={
                space === "library"
                  ? () => {
                      setEditingTaxonomy(true);
                      void handleAddDivision();
                    }
                  : undefined
              }
              title={space === "library" ? "배포 양식함" : `${writeSite?.name ?? "현장"} 서류함`}
              emptyText={
                space === "library"
                  ? "아직 배포 양식이 없습니다. “양식 올리기”로 .xlsx 파일을 올려 주세요."
                  : "아직 이 현장 서류가 없습니다. “배포 양식에서 가져오기”로 양식을 골라 작성하세요."
              }
              toolbarExtra={space === "site" ? importButton : undefined}
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

        {state.status === "ready" && sheet && openFormInSite && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            {/* 배포 원본 — 고칠 수 없다는 것과, 작성은 어디서 하는지를 맨 위에 알린다. */}
            {readOnly && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                  <Lock size={14} /> 배포 원본
                </span>
                <span className="text-xs text-slate-500">
                  여기서는 고칠 수 없습니다. 작성하려면 현장 서류함에 사본을 만드세요.
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {sites.length > 1 && (
                    <select
                      value={writeSite?.id ?? ""}
                      onChange={(event) => selectSite(event.target.value)}
                      aria-label="작성할 현장"
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                    >
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    disabled={!writeSite || state.id === ""}
                    onClick={() => void handleWrite(state.id, writeSite?.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {writeSite ? `${writeSite.name}에 작성하기` : "작성하기"} <ArrowRight size={13} />
                  </button>
                </span>
              </div>
            )}

            {/* 현장 서류인데 원본이 새 판으로 바뀌었다 — 이 서류는 그대로 두고 알리기만 한다. */}
            {!readOnly && newerTemplate && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 text-xs text-blue-900 ring-1 ring-blue-200">
                <span className="font-semibold">새 판 있음</span>
                <span>
                  {new Date(newerTemplate.uploadedAt).toLocaleDateString("ko-KR")}에 새 배포 양식 “{newerTemplate.title}”이
                  올라왔습니다. 이 서류는 적어 둔 그대로 둡니다.
                </span>
                <button
                  type="button"
                  onClick={() => void handleWrite(newerTemplate.id, siteId)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-medium text-blue-700 ring-1 ring-blue-300 hover:bg-blue-100"
                >
                  새 판으로 한 부 만들기 <ArrowRight size={13} />
                </button>
              </div>
            )}

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
              {openedContact && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200"
                  title="이 서류를 쓰다 궁금한 점은 담당에게 물어보세요."
                >
                  <UserRound size={13} className="text-slate-400" />
                  담당 <span className="font-medium text-slate-800">{formatContact(openedContact.contact)}</span>
                </span>
              )}
              {saveState === "saving" && <span className="text-xs text-slate-400">저장 중...</span>}
              {saveState === "saved" && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                  <Check size={13} /> 저장됨
                </span>
              )}

              <div className="ml-auto flex flex-wrap items-center gap-3">
                {!readOnly && (
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
                )}

                {sheet.locked && canEdit && (
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

                {readOnly ? (
                  <button
                    type="button"
                    onClick={() => void handleDownload(false)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
                  >
                    <Download size={13} /> 원본 내려받기
                  </button>
                ) : (
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
                )}

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

                {!readOnly && (
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
                )}

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

              {!readOnly && (
              <button
                type="button"
                onClick={() => void handleAddSheet()}
                title={`“${(template ?? sheet).name}” 시트의 양식으로 새 장을 만듭니다. 표·머리글은 그대로, 채워 넣은 내용과 견본 표시는 비워집니다.`}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-dashed ring-slate-300 transition hover:bg-slate-50"
              >
                <Plus size={13} /> 시트 추가
              </button>
              )}

              {sheet.custom && !readOnly && (
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

              {/* 결재선 — 결재칸이 있는 현장 서류에만. 배포 원본은 결재할 문서가 아니다. */}
              {lineSlots.length > 0 && !readOnly && state.id !== "" && docSite && (
                <button
                  type="button"
                  onClick={() => setLineDialogOpen(true)}
                  title="이 시트의 결재칸마다 서명할 사람을 정합니다."
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-50"
                >
                  <Users size={14} /> 결재선 지정
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] tabular-nums text-white">
                    {Object.keys(sheetLine ?? {}).length}/{lineSlots.length}
                  </span>
                </button>
              )}

              {/* 결재 — 진행 상황, 내 차례면 [결재하기], 내가 마지막으로 했으면 [결재 취소] */}
              {lineSlots.length > 0 && !readOnly && state.id !== "" && Object.keys(sheetLine ?? {}).length > 0 && (
                <>
                  <span
                    className={
                      approvedCount === lineSlots.length
                        ? "inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"
                        : "inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 ring-1 ring-slate-200"
                    }
                  >
                    {approvedCount === lineSlots.length ? (
                      <>
                        <Check size={13} /> 결재 완료
                      </>
                    ) : (
                      <>
                        결재 <span className="tabular-nums">{approvedCount}/{lineSlots.length}</span>
                      </>
                    )}
                  </span>
                  {readyIndex >= 0 && (
                    <button
                      type="button"
                      onClick={() => void handleApprove(readyIndex)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                    >
                      <PenLine size={14} /> 결재하기 ({lineSlots[readyIndex].label})
                    </button>
                  )}
                  {readyIndex < 0 && waitingState?.status === "waiting" && (
                    <span className="text-xs text-slate-400">{waitingState.before} 결재 후 결재할 수 있습니다</span>
                  )}
                  {cancelIndex >= 0 && (
                    <button
                      type="button"
                      onClick={() => void handleCancelApproval(cancelIndex)}
                      className="rounded-lg px-2.5 py-1.5 text-xs text-slate-500 ring-1 ring-slate-300 transition hover:bg-slate-50"
                    >
                      결재 취소 ({lineSlots[cancelIndex].label})
                    </button>
                  )}
                </>
              )}
            </div>

            {/* 서명이 없을 때 결재하기 → 서명부터 등록하고 이어서 결재 */}
            {signFor !== null && user && (
              <SignatureDialog
                onCancel={() => setSignFor(null)}
                onSave={(dataUrl) => {
                  const index = signFor;
                  setSignFor(null);
                  if (!writeSignature(user.id, dataUrl)) {
                    setStorageWarning("이 브라우저에서는 서명을 저장할 수 없습니다(사이트 데이터 차단).");
                    return;
                  }
                  void handleApprove(index, dataUrl);
                }}
              />
            )}

            {lineDialogOpen && docSite && (
              <ApprovalLineDialog
                siteName={docSite.name}
                slots={lineSlots}
                members={docSite.members ?? []}
                initialLine={initialLine(lineSlots, sheetLine, docSite.lineDefaults)}
                onCancel={() => setLineDialogOpen(false)}
                onConfirm={(result) => void handleConfirmLine(result)}
              />
            )}

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
              {!sheet.locked && canEdit && (
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
              {approvalBoxes.length > 0 && (
                <span
                  className="text-blue-700"
                  title="서류 안의 결재칸을 찾아 서명 자리에 파란 점선을 그렸습니다. 결재선 지정은 다음 단계에서 붙습니다."
                >
                  결재칸 인식: {approvalBoxes.map((box) => box.slots.map((slot) => slot.label).join(" · ")).join(" / ")}
                </span>
              )}
              {editedCount > 0 && <span className="text-blue-600">고친 칸 {editedCount}개</span>}
              {totalEdited > editedCount && (
                <span className="text-slate-400">전체 {totalEdited}개</span>
              )}
              {canEdit && <span>칸을 눌러 바로 고칠 수 있습니다.</span>}
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
              editable={canEdit}
              values={sheetValues}
              onCommitValue={handleCommitValue}
              tint={showEditableTint}
              signKeys={pendingSignKeys}
              cellMarks={cellMarks}
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
            {canEdit && (
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
 * 헤더 아래 얇은 줄의 [배포 양식함 | 현장 서류함] 탭.
 *
 * 로고 옆에 끼우면 헤더가 좁아져 조잡해 보여서(사용자와 시안으로 비교) 아래 줄로 내렸다.
 * 밑줄 탭으로 둔 것은 목록 안의 1차 분류 탭(서류철 모양)과 겹쳐 보이지 않게 하려는 것이다.
 */
function SpaceTabs({ space, onChange }: { space: Space; onChange: (space: Space) => void }) {
  const tabs: { value: Space; label: string; icon: typeof BookOpen; title: string }[] = [
    { value: "library", label: "배포 양식함", icon: BookOpen, title: "회사가 배포한 원본 양식 — 고칠 수 없습니다" },
    { value: "site", label: "현장 서류함", icon: FolderOpen, title: "현장별로 작성하는 서류" },
  ];
  return (
    <nav className="flex h-11 items-stretch gap-6" aria-label="양식함 고르기">
      {tabs.map(({ value, label, icon: Icon, title }) => {
        const active = space === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-current={active ? "page" : undefined}
            title={title}
            className={
              "-mb-px inline-flex items-center gap-1.5 border-b-2 text-sm font-semibold transition " +
              (active
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
            }
          >
            <Icon size={15} aria-hidden /> {label}
          </button>
        );
      })}
    </nav>
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

/**
 * 헤더 가운데의 현장 고르개 — 사내 Smart Works 와 같은 모양으로 맞췄다.
 *
 * 서류는 현장별로 쌓이므로 "지금 어느 현장인지"가 늘 보여야 한다. 목록 위에 두면 스크롤에
 * 밀려 사라지고, 그 상태로 올리면 엉뚱한 현장에 들어간다.
 *
 * **모든 현장 보기**가 맨 위에 있다 — 서류 점검(어느 현장이 무엇을 안 올렸나)은 한 현장씩
 * 들어가서는 못 한다. 현장이 많아지면 검색으로 찾는다.
 */
function SitePicker({
  sites,
  currentId,
  onSelect,
  onSelectAll,
  onAdd,
  onRename,
}: {
  sites: FormSite[];
  currentId: string | undefined;
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onAdd: () => void;
  onRename: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = sites.find((site) => site.id === currentId);
  const needle = query.trim().toLowerCase();
  const shown = needle ? sites.filter((site) => site.name.toLowerCase().includes(needle)) : sites;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        aria-expanded={open}
        className="flex flex-col items-center rounded-xl px-4 py-1 transition hover:bg-slate-100"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Project</span>
        <span className="flex items-center gap-1.5">
          <span className="max-w-[16rem] truncate text-[15px] font-bold text-slate-800">
            {current ? current.name : "모든 현장"}
          </span>
          <ChevronDown
            size={15}
            className={open ? "shrink-0 rotate-180 text-slate-500 transition-transform" : "shrink-0 text-slate-500 transition-transform"}
          />
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="현장 목록 닫기"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-1/2 z-20 mt-1 w-72 -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
            <button
              type="button"
              onClick={() => {
                onSelectAll();
                setOpen(false);
              }}
              className={
                "flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left text-sm " +
                (current ? "text-slate-700 hover:bg-slate-50" : "bg-blue-50 font-semibold text-blue-800")
              }
            >
              모든 현장 보기
              {!current && <Check size={14} className="shrink-0" />}
            </button>

            <div className="p-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="현장 검색..."
                  aria-label="현장 검색"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2.5 text-[13px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:bg-white"
                />
              </div>
            </div>

            <div className="max-h-64 overflow-auto pb-1">
              {shown.length === 0 && (
                <p className="px-4 py-3 text-xs text-slate-400">찾는 현장이 없습니다.</p>
              )}
              {shown.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => {
                    onSelect(site.id);
                    setOpen(false);
                  }}
                  className={
                    "flex w-full items-center justify-between px-4 py-2 text-left text-sm " +
                    (site.id === currentId
                      ? "font-semibold text-blue-800"
                      : "text-slate-700 hover:bg-slate-50")
                  }
                >
                  <span className="truncate">{site.name}</span>
                  {site.id === currentId && <Check size={14} className="shrink-0 text-blue-700" />}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAdd();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Plus size={13} /> 새 현장
              </button>
              {current && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRename();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <Pencil size={13} /> 이름 바꾸기
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 전 현장 보기 — 현장마다 서류를 얼마나 채웠는지 한 화면에 늘어놓는다.
 *
 * 서류 점검(어느 현장이 무엇을 안 올렸나)은 한 현장씩 들어가서는 못 한다. 오프라인 점검
 * 때는 이 화면만 띄워 놓고 현장을 하나씩 열어 본다.
 */
function SiteOverview({
  rows,
  onOpen,
  onAdd,
}: {
  rows: SiteProgress[];
  onOpen: (siteId: string) => void;
  onAdd: () => void;
}) {
  const totalFilled = rows.reduce((sum, row) => sum + row.filled, 0);
  const totalSlots = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold text-slate-900">
            전 현장 서류 현황{" "}
            <span className="text-sm font-normal tabular-nums text-slate-500">현장 {rows.length}개</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            현장을 눌러 그 현장 서류함으로 들어갑니다. 점검할 때는 채운 칸 수로 빠진 서류를 찾습니다.
          </p>
        </div>
        {totalSlots > 0 && (
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
            전체 채움 <span className="tabular-nums">{totalFilled}</span> /{" "}
            <span className="tabular-nums">{totalSlots}</span>
          </span>
        )}
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-50"
        >
          <Plus size={13} /> 새 현장
        </button>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {rows.map((row) => {
          const percent = row.total > 0 ? Math.round((row.filled / row.total) * 100) : 0;
          return (
            <li key={row.site.id}>
              <button
                type="button"
                onClick={() => onOpen(row.site.id)}
                className="flex w-full flex-col gap-2 rounded-xl border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
              >
                <span className="flex items-center gap-2">
                  <Building2 size={15} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 truncate text-sm font-bold text-slate-900">{row.site.name}</span>
                </span>

                <span className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums text-slate-900">{percent}</span>
                  <span className="text-xs text-slate-400">%</span>
                  <span className="ml-auto text-xs tabular-nums text-slate-500">
                    {row.filled} / {row.total}칸
                  </span>
                </span>

                <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
                </span>

                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span>
                    마지막 수정{" "}
                    {row.updatedAt > 0 ? new Date(row.updatedAt).toLocaleDateString("ko-KR") : "없음"}
                  </span>
                  {row.unfiled > 0 && (
                    <span className="text-amber-700">코드 없는 서류 {row.unfiled}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
