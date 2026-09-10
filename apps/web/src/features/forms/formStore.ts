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
import { PARSER_VERSION, parseFormWorkbook } from "./formParser";
import type { FormSheet, FormValues } from "./types";

const DB_NAME = "ipg-forms";
const DB_VERSION = 1;
const STORE = "forms";
/** 마지막으로 열어 본 양식. 새로고침하면 이걸 다시 연다. */
const LAST_OPENED_KEY = "ipg-forms:last-opened";

/** 저장소에 들어가는 한 건. */
export interface StoredForm {
  id: string;
  fileName: string;
  /** 처음 올린 시각(ms) */
  uploadedAt: number;
  /** 마지막으로 고친 시각(ms) */
  updatedAt: number;
  /** 엑셀 원본 바이트. 다시 파싱하거나 나중에 서버로 올릴 때 쓴다. */
  bytes: ArrayBuffer;
  /** 저장 당시 파서로 읽은 결과 */
  sheets: FormSheet[];
  /** sheets 를 만든 파서 판 번호 */
  parserVersion: number;
  /** 사용자가 고친 글자 */
  values: FormValues;
}

/** 목록에 뿌릴 요약. 원본 바이트·격자는 빼고 가볍게 넘긴다. */
export interface FormSummary {
  id: string;
  fileName: string;
  uploadedAt: number;
  updatedAt: number;
  sheetNames: string[];
  editedCount: number;
}

function summarize(form: StoredForm): FormSummary {
  return {
    id: form.id,
    fileName: form.fileName,
    uploadedAt: form.uploadedAt,
    updatedAt: form.updatedAt,
    sheetNames: form.sheets.map((sheet) => sheet.name),
    editedCount: Object.keys(form.values).length,
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
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
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

/** 저장된 양식 목록. 최근에 고친 것이 위로 온다. */
export async function listForms(): Promise<FormSummary[]> {
  const forms = await run<StoredForm[]>("readonly", (store) => store.getAll());
  return forms.map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 한 건을 꺼낸다.
 *
 * 저장할 때 쓰던 파서보다 지금 파서가 새 판이면 원본 바이트에서 다시 읽어 화면에
 * 반영하고, 그 결과를 저장소에도 덮어쓴다. 사용자가 고친 글자(values)는 셀 키에
 * 붙어 있어 그대로 살아남는다.
 */
export async function getForm(id: string): Promise<StoredForm | null> {
  const form = await run<StoredForm | undefined>("readonly", (store) => store.get(id));
  if (!form) return null;
  if (form.parserVersion === PARSER_VERSION) return form;

  try {
    const sheets = await parseFormWorkbook(form.bytes);
    const upgraded: StoredForm = { ...form, sheets, parserVersion: PARSER_VERSION };
    await run("readwrite", (store) => store.put(upgraded));
    return upgraded;
  } catch {
    // 다시 읽지 못해도 예전 결과로 열어 준다. 못 여는 것보다 낫다.
    return form;
  }
}

/** 새로 올린 엑셀을 저장한다. 저장한 내용을 그대로 돌려준다. */
export async function saveForm(input: {
  fileName: string;
  bytes: ArrayBuffer;
  sheets: FormSheet[];
}): Promise<StoredForm> {
  const now = Date.now();
  const form: StoredForm = {
    id: crypto.randomUUID(),
    fileName: input.fileName,
    uploadedAt: now,
    updatedAt: now,
    bytes: input.bytes,
    sheets: input.sheets,
    parserVersion: PARSER_VERSION,
    values: {},
  };
  await run("readwrite", (store) => store.put(form));
  return form;
}

/**
 * 고친 글자만 갱신한다.
 *
 * 읽기·쓰기를 한 트랜잭션 안에서 처리해, 저장 도중 다른 탭이 끼어들어도 원본 바이트나
 * 격자가 덮어써지지 않는다. 사이에 삭제된 양식이면 아무것도 하지 않는다.
 */
export async function updateFormValues(id: string, values: FormValues): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const form = request.result as StoredForm | undefined;
      if (!form) return; // 지워진 양식 — 되살리지 않는다.
      store.put({ ...form, values, updatedAt: Date.now() });
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("저장이 취소되었습니다."));
  });
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
