/**
 * 브라우저에 쌓아 둔 자료를 **서버로 옮긴다**(한 번만 하면 되는 일).
 *
 * 지금까지 현장·코드표·서류는 각자 브라우저(IndexedDB) 안에만 있었다. 서버로 옮겨야
 * 다른 PC 에서도 같은 자료가 보이고, 본사가 현장 서류를 점검할 수 있다.
 *
 * **옮겨도 브라우저 쪽은 지우지 않는다.** 잘못돼도 원래 자리에 그대로 있어야 한다.
 * 지우는 것은 사용자가 결과를 확인한 뒤에 따로 한다.
 *
 * id 는 **그대로 가져간다.** 화면이 처음부터 표준 UUID 를 쓰고 서버도 그 id 를 받아 주므로,
 * "이 서류는 어느 현장·어느 칸" 같은 연결이 끊기지 않는다. 이게 이관에서 가장 위험한 부분이었다.
 */
import { adoptSiteId, adoptTaxonomyId, listForms, getForm, loadSites, loadTaxonomies } from "./formStore.ts";
import {
  fetchDocs,
  fetchSites,
  patchDoc,
  pushSite,
  pushTaxonomy,
  uploadDoc,
  ServerUnavailable,
} from "./formServer.ts";

export interface MigrateProgress {
  /** 지금 무엇을 옮기는 중인지(화면에 그대로 보여 준다) */
  step: string;
  done: number;
  total: number;
}

export interface MigrateResult {
  sites: number;
  taxonomies: number;
  docs: number;
  /** 이미 서버에 있어 건너뛴 서류 */
  skipped: number;
  /** 옮기지 못한 것들 — 무엇이 왜 안 됐는지 그대로 남긴다 */
  failed: string[];
}

/**
 * 지워진 현장의 서류인가 — 현장 목록에 없는 현장을 가리킨다. 올려도 서버가 받지 않고(현장이 없다)
 * 화면에서도 어느 현장에도 안 보인다. 다시 올리려 하면 열 때마다 "올리지 못한 것"이 떴다(사용자 신고).
 */
const orphan = (form: { kind?: string; siteId?: string }, siteIds: Set<string>) =>
  form.kind === "site" && !!form.siteId && !siteIds.has(form.siteId);

/**
 * 아직 서버에 없는 서류가 몇 건인가.
 *
 * **건수가 아니라 id 를 견준다.** 건수로 보면 "서버에 다른 PC 가 올린 5건, 내 브라우저에 다른 3건"
 * 같은 경우를 놓친다(3 > 5 가 아니니 없는 것으로 친다). 실제로 쓰다 보면 늘 이런 모양이 된다.
 */
export async function pendingUploads(): Promise<string[]> {
  const [local, onServer, sites] = await Promise.all([listForms(), fetchDocs(), loadSites()]);
  const have = new Set(onServer.map((doc) => doc.id));
  const siteIds = new Set(sites.map((site) => site.id));
  // 서버에 있던 서류가 서버에서 사라졌으면 다른 곳에서 지운 것이다 — 다시 올리면 지운 서류가 되살아난다.
  return local.filter((form) => !have.has(form.id) && !form.fromServer && !orphan(form, siteIds)).map((form) => form.id);
}

/**
 * 브라우저 → 서버. 이미 서버에 있는 것은 건너뛴다(여러 번 돌려도 안전하다).
 *
 * 순서가 중요하다: **현장 → 코드표 → 서류**. 서류가 현장과 코드표를 가리키기 때문이다.
 */
export async function migrateLocalToServer(
  onProgress?: (progress: MigrateProgress) => void,
): Promise<MigrateResult> {
  const result: MigrateResult = { sites: 0, taxonomies: 0, docs: 0, skipped: 0, failed: [] };
  const report = (step: string, done: number, total: number) => onProgress?.({ step, done, total });

  // 서버에 이미 무엇이 있는지 먼저 본다. 여기서 못 닿으면 아예 시작하지 않는다.
  let existing: Set<string>;
  try {
    const [serverDocs] = await Promise.all([fetchDocs(), fetchSites()]);
    existing = new Set(serverDocs.map((doc) => doc.id));
  } catch (error) {
    if (error instanceof ServerUnavailable) throw error;
    throw new Error(`서버 상태를 읽지 못해 옮기지 않았습니다: ${(error as Error).message}`);
  }

  // ① 현장 — 서류가 현장을 가리키므로 먼저.
  const sites = await loadSites();
  report("현장", 0, sites.length);
  for (const [index, site] of sites.entries()) {
    try {
      const saved = await pushSite(site);
      // 같은 이름의 현장이 서버에 다른 번호로 있으면 서버 번호를 쓴다(서류가 그 번호를 가리킨다).
      if (saved.id !== site.id) await adoptSiteId(site.id, saved.id);
      result.sites += 1;
    } catch (error) {
      result.failed.push(`현장 “${site.name}”: ${(error as Error).message}`);
    }
    report("현장", index + 1, sites.length);
  }

  // ② 코드표 — 서류가 "어느 칸"을 코드표 id 로 가리킨다.
  const taxonomies = await loadTaxonomies();
  report("분류 코드표", 0, taxonomies.length);
  for (const [index, taxonomy] of taxonomies.entries()) {
    try {
      const saved = await pushTaxonomy(taxonomy, index);
      // 같은 이름의 코드표가 서버에 다른 번호로 있으면 서버 번호를 쓴다 — 서류가 그 번호를 가리킨다.
      if (saved.id !== taxonomy.id) await adoptTaxonomyId(taxonomy.id, saved.id);
      result.taxonomies += 1;
    } catch (error) {
      result.failed.push(`코드표 “${taxonomy.division || taxonomy.fileName}”: ${(error as Error).message}`);
    }
    report("분류 코드표", index + 1, taxonomies.length);
  }

  /*
   * ③ 서류 — 파일이 있어 가장 오래 걸린다. 하나가 실패해도 나머지는 계속 옮긴다.
   *
   * **배포 양식을 먼저, 현장 서류를 나중에** 올린다. 현장 서류는 "어느 배포 양식에서 왔는지"를
   * 가리키는데, 그 배포 양식이 아직 서버에 없으면 서버가 거절한다(실제로 그랬다 — 첫 번에 실패하고
   * 두 번째에 성공했다).
   */
  // 현장 번호가 서버 것으로 바뀌었을 수 있어(①) 현장 목록을 다시 읽는다.
  const liveSites = new Set((await loadSites()).map((site) => site.id));
  const forms = (await listForms()).sort(
    (a, b) => (a.kind === "template" ? 0 : 1) - (b.kind === "template" ? 0 : 1),
  );
  report("서류", 0, forms.length);
  for (const [index, summary] of forms.entries()) {
    if (existing.has(summary.id) || summary.fromServer || orphan(summary, liveSites)) {
      result.skipped += 1;
      report("서류", index + 1, forms.length);
      continue;
    }
    try {
      const full = await getForm(summary.id);
      if (!full) throw new Error("브라우저에서 읽지 못했습니다.");
      if (!full.bytes || full.bytes.byteLength === 0) throw new Error("원본 파일이 비어 있습니다.");

      await uploadDoc(
        {
          id: full.id,
          kind: full.kind === "site" ? "site" : "template",
          siteId: full.kind === "site" ? (full.siteId ?? null) : null,
          taxonomyId: full.taxonomyId ?? null,
          code: full.code ?? null,
          title: full.title,
          fileName: full.fileName,
          attachment: full.attachment === true,
          contentType: null,
          // 첨부는 격자가 없다. 엑셀은 이미 읽어 둔 격자를 그대로 가져가 서버에서 다시 읽지 않는다.
          sheets: full.attachment ? null : full.sheets,
          parserVersion: full.parserVersion,
          templateId: full.templateId ?? null,
          templateUploadedAt: full.templateUploadedAt
            ? new Date(full.templateUploadedAt).toISOString()
            : null,
          batchId: full.batchId ?? null,
        },
        full.bytes,
      );

      /*
       * 적어 둔 내용은 파일과 **따로** 올린다. 올리기 길(`POST /docs`)은 꼬리표와 파일만
       * 받기 때문이다. 빈 것은 보내지 않는다 — 현장 서류 수백 건을 옮길 때 헛일이 된다.
       */
      const written: Parameters<typeof patchDoc>[1] = {};
      if (Object.keys(full.values ?? {}).length > 0) written.cellValues = full.values;
      if ((full.customSheets ?? []).length > 0) written.customSheets = full.customSheets;
      if (Object.keys(full.extraRows ?? {}).length > 0) written.extraRows = full.extraRows;
      if (Object.keys(full.approvalLines ?? {}).length > 0) written.approvalLines = full.approvalLines;
      if (Object.keys(full.approvals ?? {}).length > 0) written.approvals = full.approvals;
      if (Object.keys(full.sheetDepts ?? {}).length > 0) written.sheetDepts = full.sheetDepts;
      if (Object.keys(full.sheetEditedAt ?? {}).length > 0) written.sheetEditedAt = full.sheetEditedAt;
      if (Object.keys(written).length > 0) await patchDoc(full.id, written);

      result.docs += 1;
    } catch (error) {
      result.failed.push(`서류 “${summary.title}”: ${(error as Error).message}`);
    }
    report("서류", index + 1, forms.length);
  }

  return result;
}
