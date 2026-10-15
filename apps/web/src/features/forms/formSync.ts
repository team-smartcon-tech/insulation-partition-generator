/**
 * 저장하면 **서버에도 같이 올린다**(덧씌우기가 아니라 따라 올리기).
 *
 * 화면은 지금까지처럼 브라우저(IndexedDB)에 저장해 빠르게 돌아가고, 그 뒤에 조용히 서버로
 * 같은 내용을 보낸다. 그래야 현장이 올린 서류를 **본사가 바로** 볼 수 있다.
 *
 * 왜 한 번에 서버로 갈아엎지 않았나: 화면이 저장소 함수를 25개 쓰고 있어, 한꺼번에 바꾸면
 * 어디가 어떻게 깨졌는지 알기 어렵다. 따라 올리기는 **더하기만** 하는 변경이라 기존 동작을
 * 건드리지 않고, 서버가 죽어 있어도 화면은 그대로 돌아간다.
 *
 * 규칙:
 * - **실패해도 화면을 막지 않는다.** 서버에 못 보내면 브라우저에는 남아 있고, 띠의
 *   [서버로 옮기기]로 나중에 올리면 된다.
 * - id 는 브라우저가 만든 것을 그대로 쓴다 — 연결이 끊기지 않게.
 */
import {
  patchDoc,
  uploadDoc,
  deleteDoc,
  deleteTaxonomy,
  fetchDoc,
  fetchSites,
  fetchTaxonomies,
  pushSite,
  pushTaxonomy,
  type NewDoc,
} from "./formServer.ts";
import { mergeServerSites, type FormSite } from "./sites.ts";
import { mergeServerTaxonomies, type Taxonomy } from "./taxonomy.ts";
import { adoptSiteId, adoptTaxonomyId, loadSites, loadTaxonomies, storeSites, storeTaxonomies } from "./formStore.ts";
import {
  addPending,
  readPendingDeletes,
  removePending,
  shouldRetry,
  writePendingDeletes,
} from "./pendingDeletes.ts";

/** 서버에 못 보낸 것을 조용히 적어 둔다(개발 중 확인용 — 사용자 화면은 막지 않는다). */
function quiet(what: string, error: unknown) {
  console.warn(`[스마트폼] 서버에 ${what} 보내지 못했습니다:`, error);
}

/**
 * 따라 올리기는 **차례대로** 보낸다.
 *
 * 화면은 기다리지 않고 보내므로(`void`) 여러 개가 동시에 날아간다. 그런데 서버에는 순서가
 * 있다 — 현장이 먼저 있어야 그 현장 서류를 받아 준다. 실제로 현장 사본이
 * `site_id ... is not present in table form_sites` 로 거절당했다(현장 올리기가 아직 안 끝난 사이에
 * 서류가 먼저 도착했다). 줄을 세워 앞의 것이 끝난 뒤에 보낸다.
 */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T | undefined> {
  const next = queue.then(task, task);
  // 하나가 실패해도 줄이 멈추면 안 된다.
  queue = next.catch(() => undefined);
  return next.catch(() => undefined);
}

/**
 * 현장 목록을 서버에도 올린다.
 *
 * **현장 서류보다 먼저 있어야 한다.** 서버는 "이 서류가 어느 현장 것인지"를 현장 표와 이어 두는데,
 * 현장이 없으면 서류를 받아 주지 않는다(실제로 현장 사본이 서버에 안 올라갔다).
 */
export async function syncSites(sites: FormSite[]): Promise<void> {
  await enqueue(async () => {
    for (const site of sites) {
      try {
        const saved = await pushSite(site);
        // 같은 이름의 현장이 서버에 다른 번호로 있으면 서버 번호를 쓴다 — 서류가 그 번호를 가리킨다.
        if (saved.id !== site.id) await adoptSiteId(site.id, saved.id);
      } catch (error) {
        quiet(`현장 “${site.name}”을(를)`, error);
      }
    }
  });
}

/**
 * 서버의 현장 목록을 받아 브라우저 목록에 합친다. 서버에 못 닿으면 null(브라우저 것을 쓴다).
 * 다른 사람이 처음 열어도 부산장안(B1) 같은 실제 현장이 보이게 한다.
 */
export async function pullSites(): Promise<FormSite[] | null> {
  const result = await enqueue(async () => {
    let server: FormSite[];
    try {
      server = await fetchSites();
    } catch (error) {
      console.warn("[스마트폼] 서버 현장 목록을 받아 오지 못했습니다(브라우저에 있는 것을 씁니다):", error);
      return null;
    }
    const { list, adopted } = mergeServerSites(await loadSites(), server);
    await storeSites(list);
    for (const [oldId, newId] of adopted) await adoptSiteId(oldId, newId);
    return list;
  });
  return result ?? null;
}

/** 코드표를 서버에도 올린다(서버에 못 닿으면 화면은 그대로 돌아간다). */
export async function syncTaxonomies(taxonomies: Taxonomy[]): Promise<void> {
  await enqueue(async () => {
    for (const [index, taxonomy] of taxonomies.entries()) {
      try {
        const saved = await pushTaxonomy(taxonomy, index);
        // 같은 이름의 코드표가 서버에 다른 번호로 있으면 서버 번호를 돌려준다. 내 쪽을 맞춘다.
        if (saved.id !== taxonomy.id) await adoptTaxonomyId(taxonomy.id, saved.id);
      } catch (error) {
        quiet(`코드표 “${taxonomy.division || taxonomy.fileName}”을(를)`, error);
      }
    }
  });
}

/**
 * 서버 코드표를 받아 와 브라우저에 들인다. 받은 목록을 돌려준다(서버에 못 닿으면 null).
 *
 * 코드표는 회사 공용이라 서버 것이 원본이다. 본사가 한 번 올리거나 고치면 다른 사람은 사이트를
 * 다시 열기만 하면 된다 — 전에는 각자 엑셀을 올려야 했다. 규칙은 {@link mergeServerTaxonomies}.
 *
 * 따라 올리기와 **같은 줄**에 세운다. 막 고친 코드표가 서버로 가는 사이에 받아 오면 옛 판으로
 * 되돌아간다.
 */
export async function pullTaxonomies(): Promise<Taxonomy[] | null> {
  const result = await enqueue(async () => {
    let server: Taxonomy[];
    try {
      server = await fetchTaxonomies();
    } catch (error) {
      console.warn("[스마트폼] 서버 코드표를 받아 오지 못했습니다(브라우저에 있는 것을 씁니다):", error);
      return null;
    }
    const { list, adopted, newerLocal } = mergeServerTaxonomies(await loadTaxonomies(), server);
    // 목록을 먼저 서버 번호로 저장한 뒤 서류를 옮긴다 — 옮기기가 알리는 "다시 읽기"가 새 목록을 읽게.
    await storeTaxonomies(list);
    for (const [oldId, newId] of adopted) await adoptTaxonomyId(oldId, newId);
    for (const taxonomy of newerLocal) {
      try {
        await pushTaxonomy(taxonomy, list.indexOf(taxonomy));
      } catch (error) {
        quiet(`코드표 “${taxonomy.division || taxonomy.fileName}”을(를)`, error);
      }
    }
    return list;
  });
  return result ?? null;
}

/** 지운 코드표를 서버에서도 지운다(서버에 못 닿으면 다음에 열 때 되돌아온다). */
export async function syncTaxonomyDelete(id: string): Promise<void> {
  await enqueue(async () => {
    try {
      await deleteTaxonomy(id);
    } catch (error) {
      quiet("코드표 지우기를", error);
    }
  });
}

/** 서류 1건을 서버에도 올린다. 이미 있으면 내용만 갱신한다. */
export async function syncUpload(doc: NewDoc & { id: string }, bytes: ArrayBuffer): Promise<void> {
  await enqueue(async () => {
  try {
    // 이미 서버에 있으면 파일을 다시 올리지 않는다(같은 파일을 두 번 밀어 넣지 않게).
    const existing = await fetchDoc(doc.id).catch(() => null);
    if (existing) {
      await patchDoc(doc.id, { title: doc.title, taxonomyId: doc.taxonomyId, code: doc.code });
      return;
    }
    await uploadDoc(doc, bytes);
  } catch (error) {
    quiet("서류를", error);
  }
  });
}

/** 적어 둔 글자·결재·시트 변경을 서버에도 반영한다. */
/** 서버가 "그런 서류 없다"고 답한 것인가 */
export const isMissing = (error: unknown) =>
  /찾지 못했|\b404\b/.test(error instanceof Error ? error.message : String(error ?? ""));

/**
 * 서버에 그 줄이 없으면 **다시 올린다.**
 *
 * 고친 내용을 보냈는데 서버가 "그런 서류 없다"고 하면, 지금까지는 조용히 포기했다. 그러면
 * 브라우저에서 아무리 고쳐도 본사 점검에는 **영영 옛 모양**이 보인다(실제로 그렇게 됐다 —
 * 서버 줄이 지워진 서류를 계속 고치고 있었다).
 *
 * 다시 올리는 일은 이관(`formMigrate`)이 이미 한다 — 서버에 없는 서류를 찾아 통째로 올린다.
 * 그것을 빌려 쓴다. **늦게 불러온다**(`import()`) — 서로 부르는 관계가 되면 모듈이 꼬인다.
 */
let healing = false;
async function healMissingDocs(): Promise<void> {
  if (healing) return;
  healing = true;
  try {
    const { migrateLocalToServer } = await import("./formMigrate.ts");
    await migrateLocalToServer();
  } catch (error) {
    quiet("빠진 서류를 다시", error);
  } finally {
    healing = false;
  }
}

export async function syncPatch(
  id: string,
  patch: Parameters<typeof patchDoc>[1],
): Promise<void> {
  await enqueue(async () => {
    try {
      await patchDoc(id, patch);
    } catch (error) {
      quiet("수정 내용을", error);
      if (isMissing(error)) void healMissingDocs();
    }
  });
}

/** 서류를 지울 때 서버에서도 지운다. */
export async function syncDelete(id: string): Promise<void> {
  await enqueue(async () => {
    try {
      await deleteDoc(id);
      // 예전에 못 보낸 것으로 적혀 있었다면 지운다.
      writePendingDeletes(removePending(readPendingDeletes(), id));
    } catch (error) {
      quiet("삭제를", error);
      /*
       * **서버에 못 닿아서** 실패한 것이면 적어 둔다. 안 적어 두면 브라우저에서만 사라지고
       * 서버에는 영영 남아, 본사 점검에 유령 서류가 보인다(실제로 그렇게 됐다).
       */
      if (shouldRetry(error)) writePendingDeletes(addPending(readPendingDeletes(), id));
    }
  });
}

/**
 * 적어 둔 "못 지운 것"을 다시 보낸다. 서버가 돌아왔을 때 부른다.
 * 또 실패하면 그대로 남겨 두고 다음 기회에 다시 보낸다.
 */
export async function flushPendingDeletes(): Promise<{ sent: number; left: number }> {
  const ids = readPendingDeletes();
  if (ids.length === 0) return { sent: 0, left: 0 };

  let sent = 0;
  for (const id of ids) {
    try {
      await deleteDoc(id);
      sent += 1;
      writePendingDeletes(removePending(readPendingDeletes(), id));
    } catch (error) {
      quiet("밀린 삭제를", error);
      // 서버에 닿았는데 거절당한 것(이미 없음·권한 없음)이면 더 보내 봐야 소용없다.
      if (!shouldRetry(error)) writePendingDeletes(removePending(readPendingDeletes(), id));
    }
  }
  return { sent, left: readPendingDeletes().length };
}
