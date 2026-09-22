/**
 * 올린 양식을 브라우저에 보관한다 — 새로고침하거나 창을 닫아도 남는다.
 *
 * 보관 위치는 IndexedDB다. localStorage 는 문자열만 담고 용량이 5MB 정도라 엑셀
 * 원본까지 넣을 수 없다. IndexedDB 는 ArrayBuffer 를 그대로 담고 용량도 훨씬 크다.
 *
 * 원본 엑셀 바이트와 파싱 결과를 **함께** 담는다.
 *  - 파싱 결과가 있어 다시 열 때 exceljs(약 1MB) 를 내려받지 않아도 바로 그린다.
 *  - 원본 바이트가 있어 파서가 좋아지면({@link PARSER_VERSION}) 다시 읽어 반영하고,
 *    나중에 서버 저장이 붙으면 이 바이트를 그대로 올릴 수 있다.
 *
 * 이 저장소는 이 PC의 이 브라우저 안에만 있다. 다른 기기와 공유하려면 서버 저장이
 * 필요하고, 그건 이 파일 위에 얹는다 — 화면은 아래 함수들만 보므로 바뀌지 않는다.
 */
// Node 테스트가 이 파일을 직접 부르므로 확장자를 적는다(Node ESM 은 생략을 허용하지 않는다).
import { PARSER_VERSION, parseFormWorkbook } from "./formParser.ts";
import { isRemovedOnCopy } from "./formShapes.ts";
import { planLegacyForm, siteCopyFields, type FormKind } from "./library.ts";
import { findApprovalBoxes } from "./approval.ts";
import { changedAfterApproval, type Approval, type Assignee } from "./approvalLine.ts";
import type { ApprovalSheetSummary } from "./homeStats.ts";
import type { FormSite } from "./sites.ts";
import { LEGACY_TAXONOMY_ID, type Taxonomy } from "./taxonomy.ts";
import type { FormSheet, FormValues } from "./types";

/**
 * 사용자가 더한 시트. 격자를 복사해 담지 않고 **"어느 시트의 복사본인가"만** 적는다.
 *
 * 격자를 통째로 담으면 파서가 좋아져도 더한 시트만 옛 모양으로 굳는다. 원본 시트
 * 이름만 들고 있으면 다시 읽을 때마다 최신 격자로 다시 만들어진다.
 */
export interface CustomSheet {
  /** 새 시트 이름(탭에 보이는 이름) */
  name: string;
  /** 복사해 온 원본 시트 이름 */
  source: string;
}

const DB_NAME = "ipg-forms";
/** 2: 코드표를 담을 `meta` 칸을 더했다. */
const DB_VERSION = 2;
const STORE = "forms";
/** 양식이 아닌 것(코드표 등)을 담는 자리. 건수가 적어 키-값으로 충분하다. */
const META_STORE = "meta";
/** 1차 분류가 생기기 전 코드표를 한 벌만 담던 자리. 발견하면 목록 자리로 옮긴다. */
const LEGACY_TAXONOMY_KEY = "taxonomy";
/** 코드표 목록(1차 분류마다 한 벌) */
const TAXONOMIES_KEY = "taxonomies";
/** 현장(프로젝트) 목록 — 서류는 현장별로 나뉜다 */
const SITES_KEY = "sites";
/** 마지막으로 열어 본 양식. 새로고침하면 이걸 다시 연다. */
const LAST_OPENED_KEY = "ipg-forms:last-opened";

/** 분류를 아직 정하지 않은 양식이 들어가는 자리. 빈 문자열 대신 이름을 준다. */
export const UNCATEGORIZED = "미분류";

/** 저장소에 들어가는 한 건. */
export interface StoredForm {
  id: string;
  fileName: string;
  /** 화면에 보일 이름. 비어 있으면 파일 이름을 쓴다. */
  title: string;
  /** 서류 분류(탭). 사용자가 직접 만든다. 코드표를 쓰면 코드가 대신한다. */
  category: string;
  /** 코드표의 3차 분류 코드(예: "101"). 코드표를 안 쓰면 비어 있다. */
  code?: string;
  /**
   * 어느 코드표 소속인지(코드표 id). 공무관련·품질관련이 둘 다 101 을 써서 코드만으로는
   * 모른다. 비어 있으면 1차 분류가 생기기 전에 올린 서류라 옛 코드표 소속으로 본다.
   */
  taxonomyId?: string;
  /**
   * 어느 현장의 서류인지. 현장 구분이 생기기 전에 올린 서류는 비어 있고, 첫 현장 것으로 본다
   * (`sites.ts`). 안 그러면 현장을 만든 순간 이미 올려 둔 서류가 어느 목록에도 안 보인다.
   */
  siteId?: string;
  /**
   * 배포 양식(원본, 읽기 전용)인지 현장 서류(사본, 작성용)인지. 구분이 생기기 전에 올린 것은
   * 비어 있고, 화면에 들어올 때 {@link migrateLegacyForms} 가 나눈다.
   */
  kind?: FormKind;
  /**
   * 배포 양식: **한 번의 배포로 함께 올라간 묶음 번호.**
   *
   * 같은 서류가 공무관련·품질관련에 함께 들어 있어 한 번 올릴 때 여러 칸에 배포한다. 저장은
   * 칸마다 따로라 시각이 몇 ms 씩 다른데, 그 차이를 "새 판"으로 오해하지 않으려면 **함께 올라간
   * 것인지**를 알아야 한다. 이 번호가 생기기 전에 올린 양식은 비어 있다.
   */
  batchId?: string;
  /** 현장 서류: 어느 배포 양식에서 만들었나 */
  templateId?: string;
  /** 현장 서류: 만들 때 그 배포 양식이 올라온 시각("새 판 있음" 판단용) */
  templateUploadedAt?: number;
  /** 즐겨찾기(카드 모서리의 별) */
  favorite: boolean;
  /** 처음 올린 시각(ms) */
  uploadedAt: number;
  /** 마지막으로 고친 시각(ms) */
  updatedAt: number;
  /** 마지막으로 연 시각(ms). "최근 사용" 정렬에 쓴다 — 열어만 봐도 갱신된다. */
  openedAt: number;
  /** 엑셀 원본 바이트. 다시 파싱하거나 나중에 서버로 올릴 때 쓴다. */
  bytes: ArrayBuffer;
  /** 저장 당시 파서로 읽은 결과 */
  sheets: FormSheet[];
  /** sheets 를 만든 파서 판 번호 */
  parserVersion: number;
  /** 사용자가 고친 글자. 시트 이름 → 셀 키 → 값 */
  values: FormValues;
  /** 사용자가 더한 시트(원본 엑셀에는 없다) */
  customSheets: CustomSheet[];
  /**
   * 시트 이름 → 아래에 더한 빈 줄 수.
   *
   * 현장마다 특이사항 줄 수가 달라 원본 줄 수로는 모자란다. 격자를 통째로 저장하지 않고
   * **줄 수만** 적어 둔다 — 화면을 그릴 때마다 원본에서 다시 만들어, 파서가 좋아지면
   * 더한 줄도 같이 새 모양이 된다.
   */
  extraRows: Record<string, number>;
  /**
   * 시트 이름 → (결재 서명 자리 키 → 지정된 사람). 결재칸은 시트마다 따로 있다.
   * 칸 순서가 아니라 서명 자리 키로 담아, 양식을 다시 읽어도 같은 칸에 붙어 있다.
   */
  approvalLines: Record<string, Record<string, Assignee>>;
  /** 시트 이름 → (서명 자리 키 → 결재 기록). 결재한 서명 그림을 함께 담는다. */
  approvals: Record<string, Record<string, Approval>>;
}

/**
 * 화면으로 넘어가는 한 건. 저장본과 같되, 이번에 열면서 생긴 문제를 함께 들고 간다.
 * `upgradeError` 는 저장되지 않는다 — 다음에 열 때 다시 판단할 값이다.
 */
export interface LoadedForm extends StoredForm {
  /** 새 파서로 다시 읽지 못했을 때의 사유. 화면이 이걸 사용자에게 알린다. */
  upgradeError?: string;
}

/** 목록에 뿌릴 요약. 원본 바이트·격자는 빼고 가볍게 넘긴다. */
export interface FormSummary {
  id: string;
  fileName: string;
  title: string;
  category: string;
  favorite: boolean;
  /** 코드표의 3차 분류 코드. 없으면 미분류 */
  code?: string;
  /** 어느 코드표 소속인지 */
  taxonomyId?: string;
  /** 어느 현장의 서류인지. 현장이 생기기 전에 올린 것은 비어 있다(첫 현장으로 본다). */
  siteId?: string;
  kind?: FormKind;
  /** 배포 양식: 한 번의 배포로 함께 올라간 묶음 번호 */
  batchId?: string;
  templateId?: string;
  templateUploadedAt?: number;
  uploadedAt: number;
  updatedAt: number;
  openedAt: number;
  sheetNames: string[];
  editedCount: number;
  /** 결재칸이 있는 시트들의 결재 상태(홈 화면용). 배포 원본·견본 시트는 없다. */
  approvalSheets: ApprovalSheetSummary[];
}

/**
 * 옛 저장본의 고친 글자를 시트별 구조로 옮긴다.
 *
 * 처음에는 시트 구분 없이 `셀 키 → 값` 한 덩어리로 담았는데, 그러면 3행 2열에 적은
 * 글자가 모든 시트의 3행 2열에 함께 나타난다. 이미 저장된 값을 버리지 않도록
 * **첫 시트의 것으로 본다** — 시트가 하나뿐인 양식이 대부분이라 그때는 정확하고,
 * 여러 장인 양식도 값이 사라지는 것보다는 낫다.
 */
export function normalizeValues(raw: unknown, sheets: FormSheet[]): FormValues {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const isFlat = Object.values(record).some((value) => typeof value === "string");
  if (!isFlat) return record as FormValues;

  const firstSheet = sheets[0]?.name;
  if (!firstSheet) return {};
  return { [firstSheet]: record as Record<string, string> };
}

/**
 * 저장소에서 읽은 값에 빠진 항목을 채운다.
 *
 * 분류·즐겨찾기·시트별 값처럼 나중에 생긴 항목은 그 전에 올린 양식에 없다. 읽는 쪽마다
 * `?? 기본값`을 흩뿌리는 대신 들어오는 길목 한 곳에서 모양을 맞춘다.
 */
function normalize(raw: StoredForm): StoredForm {
  return {
    ...raw,
    title: raw.title || raw.fileName,
    category: raw.category || UNCATEGORIZED,
    favorite: raw.favorite ?? false,
    openedAt: raw.openedAt ?? raw.updatedAt,
    customSheets: raw.customSheets ?? [],
    extraRows: raw.extraRows ?? {},
    approvalLines: raw.approvalLines ?? {},
    approvals: raw.approvals ?? {},
    values: restoreBlankedTitles(
      normalizeValues(raw.values, raw.sheets ?? []),
      raw.sheets ?? [],
      raw.customSheets ?? [],
    ),
  };
}

/**
 * 원본 시트 뒤에 사용자가 더한 시트를 붙인다.
 *
 * 더한 시트는 원본 시트의 격자를 그대로 쓰되 이름만 다르다. 격자를 통째로 저장하지
 * 않고 여기서 만들기 때문에, 파서가 좋아지면 더한 시트도 함께 새 모양이 된다.
 * 복사해 온 원본 시트가 사라졌으면(엑셀을 다시 올린 경우) 조용히 건너뛴다.
 */
export function withCustomSheets(sheets: FormSheet[], custom: CustomSheet[]): FormSheet[] {
  const result = [...sheets];
  for (const item of custom) {
    const source = sheets.find((sheet) => sheet.name === item.source);
    if (!source) continue;
    result.push({
      ...source,
      name: item.name,
      custom: true,
      // 견본 시트의 "Sample" 워터마크와 "제출 시 삭제" 안내 상자는 실제 문서로 넘어오면
      // 안 된다 — 인쇄물에 찍힌다. 원본 견본 시트에는 그대로 남는다.
      shapes: source.shapes.filter((shape) => !isRemovedOnCopy(shape)),
    });
  }
  return result;
}

/**
 * 시트 제목 칸(들)의 키. 제목은 **그 시트에서 가장 큰 글씨**다.
 *
 * 같은 양식이라도 장마다 제목이 조금씩 다르다(견본 "현장 지식등록 대장" / 작성본 "현장 지식관리
 * 대장"). "장마다 다르면 내용"이라는 규칙만 쓰면 제목이 내용으로 몰려 지워졌다(사용자 신고).
 * 제목은 본문보다 확연히 크게 쓰므로, 가장 흔한 글씨 크기보다 1.4배 이상 큰 가장 큰 글씨만
 * 제목으로 본다 — 글씨가 모두 같은 크기인 양식에서는 아무것도 제목으로 잡지 않는다.
 */
export function titleKeys(sheet: FormSheet): Set<string> {
  const sized = sheet.cells.filter((cell) => cell.text.trim() !== "" && cell.style.fontSize);
  if (sized.length === 0) return new Set();
  const counts = new Map<number, number>();
  for (const cell of sized) counts.set(cell.style.fontSize!, (counts.get(cell.style.fontSize!) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const largest = Math.max(...counts.keys());
  if (largest < common * 1.4) return new Set();
  return new Set(sized.filter((cell) => cell.style.fontSize === largest).map((cell) => cell.key));
}

/**
 * 제목을 비워 만든 장을 고친다 — {@link titleKeys} 규칙이 생기기 전에 만든 장은 제목 칸에
 * 빈 글자("")가 저장돼 있다. 사용자가 일부러 제목을 지웠을 리 없으므로 그 빈 값만 걷어내
 * 견본의 제목이 다시 보이게 한다. 제목에 **글자를 적어 둔 것**은 건드리지 않는다.
 */
export function restoreBlankedTitles(values: FormValues, sheets: FormSheet[], custom: CustomSheet[]): FormValues {
  let changed = false;
  const next: FormValues = { ...values };
  for (const item of custom) {
    const cells = next[item.name];
    const source = sheets.find((sheet) => sheet.name === item.source);
    if (!cells || !source) continue;
    for (const key of titleKeys(source)) {
      if (cells[key] !== "") continue;
      const { [key]: _removed, ...rest } = next[item.name];
      next[item.name] = rest;
      changed = true;
    }
  }
  return changed ? next : values;
}

/** 비교용으로 글자를 다듬는다. 시트마다 `작성`/`작 성` 처럼 띄어쓰기가 달라 공백은 뺀다. */
const compactText = (text: string) => text.replace(/\s+/g, "");

/**
 * 새 장을 빈 칸으로 시작하게 할 값을 만든다.
 *
 * 어느 칸이 "양식 뼈대"이고 어느 칸이 "채워 넣은 내용"인지는 **같은 양식의 다른 장들과
 * 견주면 드러난다** — 제목·머리글은 모든 장에서 같은 글자이고, 내용은 장마다 다르다.
 * 칸 위치나 서식으로 추측하지 않는다(그렇게 하면 예외가 끝없이 늘어난다).
 *
 * 다른 장과 **한 군데라도 다르면** 비운다. 머리글은 모든 장에서 똑같아 걸리지 않고,
 * 값은 장마다 달라 걸린다. 띄어쓰기 차이(`작성`/`작 성`)로 머리글이 지워지지 않도록
 * 공백을 뺀 뒤 견준다 — 실제 파일에서 이 보정이 없으면 "작성"이 지워졌다.
 *
 * 견줄 장이 없으면(시트가 하나뿐인 양식) 아무것도 비우지 않는다. 그때는 무엇이
 * 머리글인지 알 방법이 없고, **머리글을 지우는 쪽이 내용을 남기는 쪽보다 나쁘다.**
 */
export function blankValuesFor(sheets: FormSheet[], source: FormSheet): Record<string, string> {
  // 같은 양식의 다른 장 = 열 수가 같은 원본 시트들. 사용자가 더한 장은 작성 중이라 뺀다.
  const siblings = sheets.filter(
    (sheet) => !sheet.custom && sheet.name !== source.name && sheet.colCount === source.colCount,
  );
  if (siblings.length === 0) return {};

  const lookups = siblings.map((sheet) => {
    const map = new Map<string, string>();
    for (const cell of sheet.cells) map.set(cell.key, compactText(cell.text));
    return map;
  });

  /** 이 칸이 다른 장에서 다른 글자인가. 견줄 데가 없으면 false(= 건드리지 않는다). */
  const varies = (key: string, text: string) => {
    const seen = lookups.map((map) => map.get(key)).filter((value) => value !== undefined);
    return seen.length > 0 && seen.some((value) => value !== text);
  };

  // 제목 칸 — 장마다 달라도 내용이 아니라 비우지도, 줄 세기에 넣지도 않는다.
  const titles = titleKeys(source);

  // 줄별로 "글자가 든 칸 수"와 "장마다 달라지는 칸 수"를 센다.
  // 글자 없이 기호만 있는 칸(결재칸 날짜 자리의 `/`, 구분선용 `-`)은 머리글 후보로 세지 않는다.
  const isWordCell = (text: string) => /[\p{L}\p{N}]/u.test(text);

  const rows = new Map<number, { filled: number; varying: number }>();
  for (const cell of source.cells) {
    const text = compactText(cell.text);
    if (text === "" || titles.has(cell.key) || !isWordCell(text)) continue;
    const row = rows.get(cell.row) ?? { filled: 0, varying: 0 };
    row.filled += 1;
    if (varies(cell.key, text)) row.varying += 1;
    rows.set(cell.row, row);
  }

  /**
   * 표의 머리글 줄(`구분 | 이해관계자 | 요구 사항 …`)을 찾는다.
   *
   * 대장류 양식은 머리글 줄 **아래가 전부 내용**이다. 칸 단위로만 보면, 모든 장에서
   * 우연히 같은 값(담당부서가 늘 "공무")이 머리글로 잘못 남는다.
   *
   * 머리글 줄의 조건: 글자 든 칸이 셋 이상이고, 그 칸들이 **장마다 거의 그대로이며**,
   * 그 아래에 달라지는 줄이 있다. 셋을 다 만족하는 가장 아래 줄을 고른다
   * (머리글이 두 줄인 표도 잡힌다).
   *
   * "하나도 안 바뀌며"가 아니라 **거의**인 이유: 같은 양식인데도 장마다 머리글이 조금씩 다르다
   * (`분석일자` / `발생일`). 하나도 안 바뀌어야 한다고 보면 머리글을 못 찾고, 대신 결재칸 날짜
   * 자리(`/ / /`)가 머리글로 잡혀 **표 머리글까지 통째로 비워졌다**(실제로 그랬다).
   * 기호만 있는 칸은 위에서 이미 셈에서 뺐다.
   */
  const sorted = [...rows.entries()].sort(([a], [b]) => a - b);
  const hasVaryingBelow = (row: number) =>
    sorted.some(([other, info]) => other > row && info.varying > 0);
  const headerRow = sorted
    .filter(
      ([row, info]) =>
        info.filled >= 3 && info.varying <= Math.floor(info.filled * 0.2) && hasVaryingBelow(row),
    )
    .map(([row]) => row)
    .pop();

  const blanks: Record<string, string> = {};
  for (const cell of source.cells) {
    const text = compactText(cell.text);
    if (text === "") continue;
    // 제목은 장마다 달라도 내용이 아니다.
    if (titles.has(cell.key)) continue;

    // 머리글 줄 자체는 남긴다 — 장마다 조금 다른 머리글(분석일자/발생일)도 머리글이다.
    if (cell.row === headerRow) continue;

    // 머리글 줄 아래는 전부 내용이다. 그 위는 칸 단위로 견준다(제목은 남고 현장명은 비운다).
    const isContent =
      headerRow !== undefined && cell.row > headerRow ? true : varies(cell.key, text);
    if (isContent) blanks[cell.key] = "";
  }
  return blanks;
}

/**
 * 새 장을 만들 때 복사해 올 "빈 양식" 시트를 고른다.
 *
 * 직전에 보던 시트를 복사하면 지난달 내용이 그대로 딸려 온다. 업무 양식에는 대개
 * 빈 서식용 시트가 따로 있으므로(견본·샘플·양식…) 그것을 먼저 찾는다.
 * 없으면 부르는 쪽이 지금 보는 시트로 대신한다.
 */
export function findTemplateSheet(sheets: FormSheet[]): FormSheet | undefined {
  return sheets.find(isTemplateSheet);
}

/**
 * 빈 양식(견본·샘플) 시트인가 — 이름으로 알아본다.
 * 사용자가 더한 장은 아니다 — 견본을 복사했어도 그건 이미 작성 중인 문서다.
 */
export function isTemplateSheet(sheet: FormSheet): boolean {
  if (sheet.custom) return false;
  const words = ["견본", "샘플", "서식", "양식", "sample", "template", "form"];
  const name = sheet.name.trim().toLowerCase();
  return words.some((word) => name.includes(word));
}

/**
 * 결재칸이 있는 시트마다 결재선·결재 기록을 요약한다(서명 그림은 뺀다 — 목록이 무거워진다).
 * 결재칸은 저장해 두지 않고 격자에서 다시 찾는다 — 양식을 다시 읽으면 결재칸도 새 격자를 따른다.
 */
export function approvalSheetsOf(form: StoredForm): ApprovalSheetSummary[] {
  if (form.kind !== "site") return [];
  const result: ApprovalSheetSummary[] = [];
  for (const sheet of withCustomSheets(form.sheets, form.customSheets)) {
    if (isTemplateSheet(sheet)) continue;
    /**
     * **작성 중인 장만** 센다(사용자 판단). 회사 양식에는 지난달 장이 그대로 들어 있어
     * (`QA-4.2-2(25.09)`…), 결재칸이 있다고 다 세면 이미 종이로 끝난 과거 기록이 "결재선 미지정"에
     * 쌓여 정작 처리할 것이 묻힌다. 앱에서 더한 장, 글자를 적은 장, 이미 결재선·결재가 있는 장만 본다.
     */
    const working =
      sheet.custom === true ||
      Object.keys(form.values[sheet.name] ?? {}).length > 0 ||
      Object.keys(form.approvalLines[sheet.name] ?? {}).length > 0 ||
      Object.keys(form.approvals[sheet.name] ?? {}).length > 0;
    if (!working) continue;
    const slots = findApprovalBoxes(sheet).flatMap((box) =>
      box.slots.map((slot) => ({ label: slot.label, signKey: slot.signKey })),
    );
    if (slots.length === 0) continue;
    const approvals = Object.fromEntries(
      Object.entries(form.approvals[sheet.name] ?? {}).map(([key, { signature: _signature, ...rest }]) => [key, rest]),
    );
    result.push({
      sheetName: sheet.name,
      slots,
      line: form.approvalLines[sheet.name] ?? {},
      approvals,
      changed: changedAfterApproval(form.approvals[sheet.name] ?? {}, form.values[sheet.name]),
    });
  }
  return result;
}

function summarize(form: StoredForm): FormSummary {
  return {
    id: form.id,
    fileName: form.fileName,
    title: form.title,
    category: form.category,
    favorite: form.favorite,
    code: form.code,
    taxonomyId: form.taxonomyId,
    siteId: form.siteId,
    kind: form.kind,
    batchId: form.batchId,
    templateId: form.templateId,
    templateUploadedAt: form.templateUploadedAt,
    uploadedAt: form.uploadedAt,
    updatedAt: form.updatedAt,
    openedAt: form.openedAt,
    sheetNames: withCustomSheets(form.sheets, form.customSheets).map((sheet) => sheet.name),
    // 시트마다 따로 담기므로 전부 더해야 "고친 칸 수"가 된다.
    editedCount: Object.values(form.values).reduce(
      (sum, cells) => sum + Object.keys(cells).length,
      0,
    ),
    approvalSheets: approvalSheetsOf(form),
  };
}

/**
 * 브라우저가 저장을 막아 둔 상황(시크릿 창, 쿠키·사이트 데이터 차단)이 있다.
 * 그때는 저장만 못 할 뿐 양식 작업 자체는 되어야 하므로 여기서 조용히 걸러낸다.
 */
export function isStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (!isStorageAvailable()) {
      reject(new Error("이 브라우저에서는 저장 기능을 쓸 수 없습니다."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // 이미 있는 칸은 건드리지 않는다 — 판을 올려도 저장해 둔 양식은 그대로 남는다.
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("저장소를 열지 못했습니다."));
    // 다른 탭이 옛 판을 붙들고 있으면 여기서 멈춘다. 기다리지 말고 알려 준다.
    request.onblocked = () =>
      reject(new Error("다른 탭에서 이 화면을 열어 두어 저장소를 갱신하지 못했습니다."));
  });

  // 실패한 연결을 캐시에 남기면 새로고침 전까지 계속 실패한다.
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  dbPromise = opening;
  return opening;
}

/** 요청 하나를 트랜잭션에 담아 Promise 로 바꾼다. */
async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    // 트랜잭션이 끝나야 디스크에 확실히 쓰인다. 요청 성공만 보고 끝내면 안 된다.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("저장이 취소되었습니다."));
  });
}

/** 저장된 양식 목록. 정렬·분류·검색은 화면에서 한다(건수가 적어 서버 정렬이 필요 없다). */
export async function listForms(): Promise<FormSummary[]> {
  const forms = await run<StoredForm[]>("readonly", (store) => store.getAll());
  return forms.map((form) => summarize(normalize(form))).sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * 한 건을 꺼낸다.
 *
 * 저장할 때 쓰던 파서보다 지금 파서가 새 판이면 원본 바이트에서 다시 읽어 화면에
 * 반영하고, 그 결과를 저장소에도 덮어쓴다. 사용자가 고친 글자(values)는 셀 키에
 * 붙어 있어 그대로 살아남는다.
 */
export async function getForm(id: string): Promise<LoadedForm | null> {
  const raw = await run<StoredForm | undefined>("readonly", (store) => store.get(id));
  if (!raw) return null;
  const form = normalize(raw);
  // 화면에는 원본 시트 + 사용자가 더한 시트를 함께 넘긴다. 저장소에는 원본만 담긴다.
  const expand = (f: StoredForm): LoadedForm => ({
    ...f,
    sheets: withCustomSheets(f.sheets, f.customSheets),
  });

  if (form.parserVersion === PARSER_VERSION) return expand(form);

  // 원본 바이트가 비어 있으면 다시 읽을 방법이 없다. 여기서 걸러야 원인이 드러난다.
  if (!form.bytes || form.bytes.byteLength === 0) {
    return {
      ...expand(form),
      upgradeError:
        "저장된 엑셀 원본이 비어 있어 새 기능(그림 표시 등)을 반영하지 못했습니다. 이 양식을 다시 올려 주세요.",
    };
  }

  try {
    const sheets = await parseFormWorkbook(form.bytes);
    const upgraded: StoredForm = { ...form, sheets, parserVersion: PARSER_VERSION };
    await run("readwrite", (store) => store.put(upgraded));
    return expand(upgraded);
  } catch (error) {
    // 다시 읽지 못해도 예전 결과로 열어 준다. 못 여는 것보다 낫다.
    // 다만 **조용히** 넘기지 않는다 — 그러면 "기능이 안 되는" 것으로만 보인다.
    return {
      ...expand(form),
      upgradeError: `저장된 엑셀 원본을 다시 읽지 못해 예전 결과로 엽니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** 새로 올린 엑셀을 저장한다. 저장한 내용을 그대로 돌려준다. */
export async function saveForm(input: {
  fileName: string;
  bytes: ArrayBuffer;
  sheets: FormSheet[];
  category?: string;
  code?: string;
  taxonomyId?: string;
  siteId?: string;
  kind: FormKind;
  /** 여러 칸에 함께 배포할 때 같은 번호를 넘긴다(같은 배포임을 나중에 알아보려고). */
  batchId?: string;
}): Promise<StoredForm> {
  const now = Date.now();
  const form: StoredForm = {
    id: crypto.randomUUID(),
    fileName: input.fileName,
    // 원본은 **복사해서** 담는다. 파싱에 넘긴 버퍼를 그대로 저장하면, 라이브러리가
    // 그것을 소유·이관해 비워 버렸을 때 "원본이 빈" 양식이 저장된다.
    // 파일 이름에서 확장자만 뗀다. 보기 이름은 나중에 바꿀 수 있다.
    title: input.fileName.replace(/\.xlsx$/i, ""),
    category: input.category || UNCATEGORIZED,
    code: input.code,
    taxonomyId: input.taxonomyId,
    batchId: input.kind === "template" ? input.batchId : undefined,
    // 배포 양식은 어느 현장 것도 아니다.
    siteId: input.kind === "site" ? input.siteId : undefined,
    kind: input.kind,
    favorite: false,
    uploadedAt: now,
    updatedAt: now,
    openedAt: now,
    bytes: input.bytes.slice(0),
    sheets: input.sheets,
    parserVersion: PARSER_VERSION,
    values: {},
    customSheets: [],
    extraRows: {},
    approvalLines: {},
    approvals: {},
  };
  await run("readwrite", (store) => store.put(form));
  return form;
}

/**
 * 한 건을 읽어 일부만 바꿔 쓴다.
 *
 * 읽기·쓰기를 **한 트랜잭션 안에서** 처리해, 저장 도중 다른 탭이 끼어들어도 원본
 * 바이트나 격자가 덮어써지지 않는다. 사이에 삭제된 양식이면 아무것도 하지 않는다.
 */
async function patchForm(
  id: string,
  change: (form: StoredForm) => Partial<StoredForm>,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.get(id);
    // change() 가 "이미 있는 이름입니다" 같은 사유로 거절할 수 있다. IndexedDB 이벤트
    // 안에서 던진 오류는 밖으로 나오지 못하고 트랜잭션만 취소되므로, 사유를 따로 들고
    // 있다가 거절할 때 함께 넘긴다 — 안 그러면 사용자가 이유를 못 본다.
    let failure: unknown;
    request.onsuccess = () => {
      const raw = request.result as StoredForm | undefined;
      if (!raw) return; // 지워진 양식 — 되살리지 않는다.
      const form = normalize(raw);
      try {
        store.put({ ...form, ...change(form) });
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure ?? transaction.error);
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error("저장이 취소되었습니다."));
  });
}

/**
 * 배포 양식을 현장 서류함으로 복사한다. 새로 생긴 현장 서류를 돌려준다.
 *
 * 원본 바이트까지 **통째로** 복사한다 — 나중에 원본이 지워지거나 새 판으로 바뀌어도
 * 현장 서류는 만들 때 모양 그대로 열리고 내려받아져야 한다.
 */
export async function copyTemplateToSite(templateId: string, siteId: string): Promise<StoredForm> {
  const raw = await run<StoredForm | undefined>("readonly", (store) => store.get(templateId));
  if (!raw) throw new Error("그 배포 양식은 이미 지워졌습니다.");
  const template = normalize(raw);
  if (template.kind !== "template") throw new Error("배포 양식이 아니라 복사할 수 없습니다.");

  const now = Date.now();
  const copy: StoredForm = {
    ...template,
    ...siteCopyFields(template, siteId),
    id: crypto.randomUUID(),
    favorite: false,
    uploadedAt: now,
    updatedAt: now,
    openedAt: now,
    bytes: template.bytes.slice(0),
  };
  await run("readwrite", (store) => store.put(copy));
  return copy;
}

/**
 * 배포 양식을 **다른 분류의 같은 서류 칸에도** 배포한다(원본 파일을 다시 찾아 올리지 않아도 되게).
 *
 * 올릴 때 함께 배포하는 것과 같은 방식이다 — 파일을 나눠 쓰지 않고 **칸마다 따로 저장한다.**
 * 그래야 나중에 한쪽만 새 판으로 바꾸거나 지울 수 있다.
 */
export async function copyTemplateToSlot(
  templateId: string,
  slot: { taxonomyId: string; code: string },
): Promise<StoredForm> {
  const raw = await run<StoredForm | undefined>("readonly", (store) => store.get(templateId));
  if (!raw) throw new Error("그 배포 양식은 이미 지워졌습니다.");
  const template = normalize(raw);
  if (template.kind !== "template") throw new Error("배포 양식이 아니라 배포할 수 없습니다.");

  const now = Date.now();
  const copy: StoredForm = {
    ...template,
    id: crypto.randomUUID(),
    taxonomyId: slot.taxonomyId,
    code: slot.code,
    favorite: false,
    // 올라온 시각은 **원본 그대로** 둔다. 지금 시각으로 바꾸면 이 사본이 다시 "새 판"이 되어
    // 원래 칸이 옛 판으로 뒤집힌다(둘이 서로를 새 판이라 가리키게 된다).
    uploadedAt: template.uploadedAt,
    // 같은 배포로 본다 — 안 그러면 방금 맞춰 놓은 두 칸이 서로를 새 판이라 가리킨다.
    batchId: template.batchId ?? crypto.randomUUID(),
    updatedAt: now,
    openedAt: now,
    bytes: template.bytes.slice(0),
  };
  await run("readwrite", (store) => store.put(copy));
  return copy;
}

/**
 * 구분이 생기기 전에 올린 서류를 배포 양식 / 현장 서류로 나눈다(한 번만 돈다).
 *
 * 한 트랜잭션으로 처리한다 — 반쯤 옮기다 멈춰 원본과 사본이 어긋나지 않게.
 * **지우는 것은 없다.** 적어 둔 내용은 사본이 그대로 들고 간다.
 * 돌려주는 값: 옛 id → 사본 id (마지막으로 열었던 서류를 사본으로 이어 열 때 쓴다).
 */
export async function migrateLegacyForms(firstSiteId: string | undefined): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      for (const raw of request.result as StoredForm[]) {
        if (raw.kind) continue;
        const plan = planLegacyForm(normalize(raw), firstSiteId, () => crypto.randomUUID());
        store.put(plan.template);
        if (plan.copy) {
          store.put(plan.copy);
          moved.set(raw.id, plan.copy.id);
        }
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("옮겨 담기가 취소되었습니다."));
  });
  return moved;
}

/** 고친 글자만 갱신한다. */
export async function updateFormValues(id: string, values: FormValues): Promise<void> {
  await patchForm(id, () => ({ values, updatedAt: Date.now() }));
}

/** meta 칸에서 값 하나를 읽는다. */
async function readMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readonly");
    const request = transaction.objectStore(META_STORE).get(key);
    transaction.oncomplete = () => resolve(request.result as T | undefined);
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * meta 칸에 값을 쓰거나(값) 지운다(undefined).
 * 여러 개를 **한 트랜잭션으로** 처리한다 — 옮겨 담기가 반쯤 끝나 코드표가 두 벌이 되지 않게.
 */
async function writeMeta(entries: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readwrite");
    const store = transaction.objectStore(META_STORE);
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) store.delete(key);
      else store.put(value, key);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("저장이 취소되었습니다."));
  });
}

/** 저장해 둔 코드표에 나중에 생긴 칸(id·1차 분류·겹침 목록)을 채운다. */
function normalizeTaxonomy(raw: Taxonomy, fallbackId: string): Taxonomy {
  return {
    ...raw,
    id: raw.id || fallbackId,
    division: raw.division ?? "",
    conflicts: raw.conflicts ?? [],
  };
}

/**
 * 저장된 코드표 목록(1차 분류마다 한 벌). 없으면 빈 목록.
 *
 * 1차 분류가 생기기 전에는 코드표를 한 벌만 옛 자리에 담았다. 그걸 발견하면 목록 자리로
 * 옮기고 옛 id({@link LEGACY_TAXONOMY_ID})를 붙인다 — 그때 올린 서류들은 코드표 id 없이
 * 저장돼 있어서, 이 id 로 계속 제자리를 찾는다.
 */
export async function loadTaxonomies(): Promise<Taxonomy[]> {
  if (!isStorageAvailable()) return [];
  const list = await readMeta<Taxonomy[]>(TAXONOMIES_KEY);
  if (list) return list.map((taxonomy, index) => normalizeTaxonomy(taxonomy, `restored-${index}`));

  const legacy = await readMeta<Taxonomy>(LEGACY_TAXONOMY_KEY);
  if (!legacy) return [];
  const migrated = [normalizeTaxonomy({ ...legacy, id: LEGACY_TAXONOMY_ID }, LEGACY_TAXONOMY_ID)];
  await writeMeta({ [TAXONOMIES_KEY]: migrated, [LEGACY_TAXONOMY_KEY]: undefined });
  return migrated;
}

/** 현장 목록. 없으면 빈 배열 — 화면이 첫 현장을 만들어 준다. */
export async function loadSites(): Promise<FormSite[]> {
  if (!isStorageAvailable()) return [];
  return (await readMeta<FormSite[]>(SITES_KEY)) ?? [];
}

/** 현장 목록을 통째로 저장한다(추가·이름 바꾸기). */
export async function saveSites(list: FormSite[]): Promise<void> {
  await writeMeta({ [SITES_KEY]: list });
}

/** 서류를 다른 현장으로 옮긴다. */
export async function setFormSite(id: string, siteId: string): Promise<void> {
  await patchForm(id, () => ({ siteId, updatedAt: Date.now() }));
}

/** 코드표 목록을 통째로 저장한다. 올리기·이름 바꾸기·지우기 모두 이걸로 끝난다. */
export async function saveTaxonomies(list: Taxonomy[]): Promise<void> {
  await writeMeta({ [TAXONOMIES_KEY]: list });
}

/** 서류를 코드표의 한 칸에 붙이거나(코드·코드표 id) 떼어 낸다(undefined). */
export async function setFormCode(
  id: string,
  code: string | undefined,
  taxonomyId: string | undefined,
): Promise<void> {
  await patchForm(id, () => ({ code, taxonomyId }));
}

/**
 * 시트 아래에 더한 빈 줄 수를 정한다. 0 이면 표시를 지운다.
 * 줄을 줄여도 그 줄에 적은 글자는 값에 남아 있다 — 다시 늘리면 그대로 돌아온다.
 */
export async function setExtraRows(id: string, sheetName: string, count: number): Promise<void> {
  await patchForm(id, (form) => {
    const next = { ...form.extraRows };
    if (count > 0) next[sheetName] = count;
    else delete next[sheetName];
    return { extraRows: next, updatedAt: Date.now() };
  });
}

/**
 * 한 시트의 결재선과 결재 기록을 **함께** 저장한다. 비어 있으면 그 시트 표시를 지운다.
 * 따로 쓰면, 결재선을 바꾼 뒤 지워야 할 결재가 남은 채 저장이 끊길 수 있다.
 */
export async function setSheetApproval(
  id: string,
  sheetName: string,
  change: { line?: Record<string, Assignee>; approvals?: Record<string, Approval> },
): Promise<void> {
  const put = <T,>(record: Record<string, T>, value: T | undefined) => {
    const next = { ...record };
    if (value && Object.keys(value as object).length > 0) next[sheetName] = value;
    else delete next[sheetName];
    return next;
  };
  await patchForm(id, (form) => ({
    ...(change.line ? { approvalLines: put(form.approvalLines, change.line) } : {}),
    ...(change.approvals ? { approvals: put(form.approvals, change.approvals) } : {}),
    updatedAt: Date.now(),
  }));
}

/** 이 양식에서 이미 쓰이고 있는 시트 이름(원본 + 더한 것). */
function usedSheetNames(form: StoredForm): string[] {
  return withCustomSheets(form.sheets, form.customSheets).map((sheet) => sheet.name);
}

/**
 * 시트를 하나 더한다. `source` 시트의 양식을 그대로 쓰는 빈 장이 생긴다.
 *
 * 월별로 장을 늘려 쓰는 용도다(2025-06, 2025-09 …). 고친 글자는 시트별로 따로
 * 담기므로 새 장은 원본 시트의 엑셀 글자만 가진 채로 시작한다.
 */
export async function addCustomSheet(id: string, sheet: CustomSheet): Promise<void> {
  const name = sheet.name.trim();
  if (!name) throw new Error("시트 이름을 적어 주세요.");

  await patchForm(id, (form) => {
    if (usedSheetNames(form).includes(name)) {
      throw new Error(`“${name}” 시트가 이미 있습니다. 다른 이름을 적어 주세요.`);
    }
    if (!usedSheetNames(form).includes(sheet.source)) {
      throw new Error(`복사할 “${sheet.source}” 시트를 찾지 못했습니다.`);
    }
    // 새 장은 채워 넣은 내용 없이 시작한다. 무엇을 비울지는 같은 양식의 다른 장들과
    // 견주어 정한다 — 만들 때 한 번 정해 두면 이후에는 보통 칸처럼 고칠 수 있다.
    const expanded = withCustomSheets(form.sheets, form.customSheets);
    const source = expanded.find((item) => item.name === sheet.source);
    const blanks = source ? blankValuesFor(form.sheets, source) : {};

    return {
      customSheets: [...form.customSheets, { name, source: sheet.source }],
      values: Object.keys(blanks).length > 0 ? { ...form.values, [name]: blanks } : form.values,
      updatedAt: Date.now(),
    };
  });
}

/**
 * 더한 시트의 이름을 바꾼다. 적어 둔 글자도 새 이름으로 함께 옮긴다 —
 * 값이 시트 이름에 붙어 있어서, 이름만 바꾸면 그 장의 내용이 통째로 사라진다.
 */
export async function renameCustomSheet(
  id: string,
  from: string,
  to: string,
): Promise<void> {
  const name = to.trim();
  if (!name) throw new Error("시트 이름을 적어 주세요.");

  await patchForm(id, (form) => {
    if (name === from) return {};
    if (usedSheetNames(form).includes(name)) {
      throw new Error(`“${name}” 시트가 이미 있습니다. 다른 이름을 적어 주세요.`);
    }
    const target = form.customSheets.find((item) => item.name === from);
    if (!target) throw new Error("원본 엑셀에 있던 시트는 이름을 바꿀 수 없습니다.");

    const values = { ...form.values };
    if (values[from]) {
      values[name] = values[from];
      delete values[from];
    }
    // 결재선도 시트 이름에 붙어 있어 함께 옮긴다.
    const approvalLines = { ...form.approvalLines };
    if (approvalLines[from]) {
      approvalLines[name] = approvalLines[from];
      delete approvalLines[from];
    }
    const approvals = { ...form.approvals };
    if (approvals[from]) {
      approvals[name] = approvals[from];
      delete approvals[from];
    }
    return {
      approvalLines,
      approvals,
      customSheets: form.customSheets.map((item) =>
        item.name === from ? { ...item, name } : item,
      ),
      values,
      updatedAt: Date.now(),
    };
  });
}

/** 더한 시트를 지운다. 그 장에 적어 둔 글자도 함께 사라진다. */
export async function removeCustomSheet(id: string, name: string): Promise<void> {
  await patchForm(id, (form) => {
    if (!form.customSheets.some((item) => item.name === name)) {
      throw new Error("원본 엑셀에 있던 시트는 지울 수 없습니다.");
    }
    const values = { ...form.values };
    delete values[name];
    const approvalLines = { ...form.approvalLines };
    delete approvalLines[name];
    const approvals = { ...form.approvals };
    delete approvals[name];
    return {
      approvalLines,
      approvals,
      customSheets: form.customSheets.filter((item) => item.name !== name),
      values,
      updatedAt: Date.now(),
    };
  });
}

/**
 * 이름·분류·즐겨찾기를 바꾼다.
 *
 * `updatedAt`(마지막으로 고친 시각)은 건드리지 않는다 — 별을 누른 것은 서류 내용을
 * 고친 게 아니라서, 여기서 시각을 밀면 "최근 수정" 목록이 사실과 달라진다.
 */
export async function updateFormMeta(
  id: string,
  patch: { title?: string; category?: string; favorite?: boolean },
): Promise<void> {
  await patchForm(id, () => patch);
}

/**
 * 저장된 엑셀 원본에서 다시 읽어 화면용 격자를 갈아 끼운다.
 *
 * 판 번호가 같아도 강제로 다시 읽는다 — 저장된 결과가 어떤 이유로든 낡았을 때
 * 사용자가 직접 누를 수 있는 탈출구다. 적어 둔 글자(values)는 건드리지 않는다.
 */
export async function reparseForm(id: string): Promise<LoadedForm | null> {
  const raw = await run<StoredForm | undefined>("readonly", (store) => store.get(id));
  if (!raw) return null;
  const form = normalize(raw);

  if (!form.bytes || form.bytes.byteLength === 0) {
    return {
      ...form,
      upgradeError: "저장된 엑셀 원본이 비어 있습니다. 이 양식을 다시 올려 주세요.",
    };
  }

  const sheets = await parseFormWorkbook(form.bytes);
  const updated: StoredForm = { ...form, sheets, parserVersion: PARSER_VERSION };
  await run("readwrite", (store) => store.put(updated));
  return { ...updated, sheets: withCustomSheets(sheets, updated.customSheets) };
}

/** 양식을 열었다고 표시한다. "최근 사용" 정렬의 기준. */
export async function touchForm(id: string): Promise<void> {
  await patchForm(id, () => ({ openedAt: Date.now() }));
}

/** 한 건을 지운다. 되돌릴 수 없으므로 화면에서 먼저 확인을 받는다. */
export async function deleteForm(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
  if (readLastOpenedId() === id) writeLastOpenedId(null);
}

/**
 * 마지막으로 연 양식 기억하기.
 *
 * 이건 "무엇을 보고 있었는지"라는 화면 상태라 크기가 작아 localStorage 로 충분하다.
 * 저장이 막힌 브라우저에서도 나머지 기능이 죽지 않도록 실패를 삼킨다.
 */
export function readLastOpenedId(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED_KEY);
  } catch {
    return null;
  }
}

export function writeLastOpenedId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(LAST_OPENED_KEY);
    else localStorage.setItem(LAST_OPENED_KEY, id);
  } catch {
    // 저장이 막힌 브라우저 — 다음에 열 때 목록에서 고르면 된다.
  }
}
