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
import { patchDoc, uploadDoc, deleteDoc, fetchDoc, pushSite, pushTaxonomy, type NewDoc } from "./formServer.ts";
import type { FormSite } from "./sites.ts";
import type { Taxonomy } from "./taxonomy.ts";
import { adoptSiteId, adoptTaxonomyId } from "./formStore.ts";

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

/** 코드표를 서버에도 올린다(본사 관리자가 아니면 서버가 거절하고, 화면은 그대로 돌아간다). */
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
export async function syncPatch(
  id: string,
  patch: Parameters<typeof patchDoc>[1],
): Promise<void> {
  await enqueue(async () => {
    try {
      await patchDoc(id, patch);
    } catch (error) {
      quiet("수정 내용을", error);
    }
  });
}

/** 서류를 지울 때 서버에서도 지운다. */
export async function syncDelete(id: string): Promise<void> {
  await enqueue(async () => {
    try {
      await deleteDoc(id);
    } catch (error) {
      quiet("삭제를", error);
    }
  });
}
