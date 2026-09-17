/**
 * 홈 화면 숫자 — 결재 진행현황, 내 결재함, 서류 진척도, 알림, 전 현장 점검표.
 *
 * 화면 부품이 아니라 계산만 여기 둔다. 홈의 숫자는 "사실과 다르게 보이면" 믿지 않게 되는 숫자라
 * 규칙을 테스트로 묶어 둔다(예: 배포 양식이 없는 서류는 현장이 만들 수 없으니 진척도 분모에서 뺀다).
 */
import {
  isSamePerson,
  slotStates,
  type Approval,
  type Assignee,
  type LineSlot,
} from "./approvalLine.ts";
import { isSiteDoc, isTemplate, type FormKind } from "./library.ts";
import { taxonomyIdOf, type Taxonomy } from "./taxonomy.ts";

const DAY = 24 * 60 * 60 * 1000;

/** 목록에 실어 나르는 결재 요약 — 서명 그림은 빼고 가볍게 */
export type ApprovalLite = Omit<Approval, "signature">;

/** 결재칸이 있는 시트 하나의 결재 상태 */
export interface ApprovalSheetSummary {
  sheetName: string;
  slots: LineSlot[];
  line: Record<string, Assignee>;
  approvals: Record<string, ApprovalLite>;
}

/** 홈이 보는 서류 한 건 */
export interface HomeDoc {
  id: string;
  title: string;
  kind?: FormKind;
  siteId?: string;
  code?: string;
  taxonomyId?: string;
  approvalSheets?: ApprovalSheetSummary[];
}

export interface HomeUser {
  id?: string;
  name?: string;
}

/** 결재 한 건(시트 하나)의 단계 표시 */
export interface ApprovalItem {
  formId: string;
  title: string;
  siteId?: string;
  sheetName: string;
  /** 칸마다: 끝남 / 지금 차례 / 기다림 */
  steps: { label: string; status: "done" | "now" | "wait"; name?: string }[];
  /** 지금 차례 칸 이름(끝났으면 없음) */
  currentLabel?: string;
  /** 지금 차례인 사람 */
  current?: Assignee;
  /** 지금 차례가 시작된 시각(ms). 모르면 없음 */
  since?: number;
  /** 마지막 결재 시각(완료 목록 정렬용) */
  lastApprovedAt?: number;
}

const toApproval = (lite: ApprovalLite): Approval => ({ ...lite, signature: "" });
const approvalsOf = (sheet: ApprovalSheetSummary) =>
  Object.fromEntries(Object.entries(sheet.approvals).map(([key, value]) => [key, toApproval(value)]));

/**
 * 지금 차례가 시작된 시각 — 앞 칸이 결재한 때, 첫 칸이면 결재선을 정한 때.
 * 결재선을 나중에 바꿔 사람이 새로 들어왔으면 그 뒤부터 센다(더 늦은 쪽).
 */
export function turnStartedAt(sheet: ApprovalSheetSummary, index: number): number | undefined {
  const slot = sheet.slots[index];
  if (!slot) return undefined;
  const assignedAt = sheet.line[slot.signKey]?.assignedAt ?? 0;
  const previous = index > 0 ? (sheet.approvals[sheet.slots[index - 1].signKey]?.approvedAt ?? 0) : 0;
  const started = Math.max(assignedAt, previous);
  return started > 0 ? started : undefined;
}

function itemOf(doc: HomeDoc, sheet: ApprovalSheetSummary): ApprovalItem {
  const currentIndex = sheet.slots.findIndex((slot) => !sheet.approvals[slot.signKey]);
  const approvedTimes = Object.values(sheet.approvals).map((approval) => approval.approvedAt);
  return {
    formId: doc.id,
    title: doc.title,
    siteId: doc.siteId,
    sheetName: sheet.sheetName,
    steps: sheet.slots.map((slot, index) => ({
      label: slot.label,
      status: sheet.approvals[slot.signKey] ? "done" : index === currentIndex ? "now" : "wait",
      name: sheet.approvals[slot.signKey]?.name ?? sheet.line[slot.signKey]?.name,
    })),
    ...(currentIndex >= 0
      ? {
          currentLabel: sheet.slots[currentIndex].label,
          current: sheet.line[sheet.slots[currentIndex].signKey],
          since: turnStartedAt(sheet, currentIndex),
        }
      : {}),
    ...(approvedTimes.length > 0 ? { lastApprovedAt: Math.max(...approvedTimes) } : {}),
  };
}

export interface ApprovalOverview {
  /** 내가 지금 결재할 차례 */
  myTurn: ApprovalItem[];
  /** 내가 작성(첫 칸)으로 올렸고 아직 진행중 */
  requested: ApprovalItem[];
  /** 내가 결재선에 있었고 모두 끝남 */
  completed: ApprovalItem[];
  /** 사람별로 차례가 와 있는 건수(많은 순) */
  waitingByPerson: { name: string; position: string; count: number }[];
  /** 차례가 온 뒤 `staleDays` 일 넘게 멈춘 결재 */
  stalled: ApprovalItem[];
  /** 결재칸은 있는데 결재선을 하나도 안 정한 시트 */
  unassigned: { formId: string; title: string; siteId?: string; sheetName: string }[];
  /** 내가 어느 결재선에라도 들어 있나(서명 미등록 알림에 쓴다) */
  inAnyLine: boolean;
}

/** 현장 서류들의 결재를 모아 센다. 배포 원본은 결재할 문서가 아니라 뺀다. */
export function approvalOverview(docs: HomeDoc[], user: HomeUser, now: number, staleDays = 3): ApprovalOverview {
  const result: ApprovalOverview = {
    myTurn: [],
    requested: [],
    completed: [],
    waitingByPerson: [],
    stalled: [],
    unassigned: [],
    inAnyLine: false,
  };
  const waiting = new Map<string, { name: string; position: string; count: number }>();

  for (const doc of docs) {
    if (isTemplate(doc)) continue;
    for (const sheet of doc.approvalSheets ?? []) {
      if (sheet.slots.length === 0) continue;
      const assigned = sheet.slots.filter((slot) => sheet.line[slot.signKey]);
      if (assigned.length === 0) {
        result.unassigned.push({ formId: doc.id, title: doc.title, siteId: doc.siteId, sheetName: sheet.sheetName });
        continue;
      }
      const item = itemOf(doc, sheet);
      const complete = sheet.slots.every((slot) => sheet.approvals[slot.signKey]);
      const mine = Object.values(sheet.line).some((person) => isSamePerson(person, user.name));
      if (mine) result.inAnyLine = true;

      if (complete) {
        if (mine || Object.values(sheet.approvals).some((approval) => approval.userId === user.id)) {
          result.completed.push(item);
        }
        continue;
      }

      const states = slotStates(sheet.slots, sheet.line, approvalsOf(sheet), user.name);
      if (states.some((state) => state.status === "ready")) result.myTurn.push(item);
      const first = sheet.approvals[sheet.slots[0].signKey];
      if (first && user.id && first.userId === user.id) result.requested.push(item);

      if (item.current) {
        const key = `${item.current.name}|${item.current.position}`;
        const entry = waiting.get(key) ?? { name: item.current.name, position: item.current.position, count: 0 };
        entry.count += 1;
        waiting.set(key, entry);
        if (item.since !== undefined && now - item.since > staleDays * DAY) result.stalled.push(item);
      }
    }
  }

  const bySince = (a: ApprovalItem, b: ApprovalItem) => (a.since ?? now) - (b.since ?? now);
  result.myTurn.sort(bySince);
  result.requested.sort(bySince);
  result.stalled.sort(bySince);
  result.completed.sort((a, b) => (b.lastApprovedAt ?? 0) - (a.lastApprovedAt ?? 0));
  result.waitingByPerson = [...waiting.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  return result;
}

/** 며칠째인지(0 = 오늘) */
export const daysSince = (since: number | undefined, now: number) =>
  since === undefined ? undefined : Math.max(0, Math.floor((now - since) / DAY));

// ─── 서류 진척도 ───────────────────────────────────────────

export interface DivisionProgress {
  taxonomyId: string;
  name: string;
  /** 배포 양식이 있는 서류 종류 수(= 현장이 만들 수 있는 것) */
  deployed: number;
  /** 그중 이 현장에서 만든 것 */
  made: number;
  /** 코드표에는 있지만 배포 양식이 아직 없는 종류 수 */
  undeployed: number;
}

export interface GroupProgress {
  taxonomyId: string;
  code: string;
  name: string;
  deployed: number;
  made: number;
}

export interface DocumentProgress {
  deployed: number;
  made: number;
  undeployed: number;
  divisions: DivisionProgress[];
  /** 진척이 낮은 중분류(배포된 것이 있는 중분류만, 낮은 순) */
  lowGroups: GroupProgress[];
}

/**
 * 한 현장의 서류 진척도.
 *
 * 분모는 **배포 양식이 있는 서류 종류**다. 배포 양식이 없는 칸은 현장이 만들 방법이 없어, 분모에
 * 넣으면 현장 잘못이 아닌데 진척도가 낮게 나온다. 그런 칸 수는 따로(`undeployed`) 알려 준다.
 * 한 종류에 여러 부(월별)를 만들어도 한 종으로 센다.
 */
export function documentProgress(
  taxonomies: Taxonomy[],
  docs: HomeDoc[],
  siteId: string,
  lowCount = 5,
): DocumentProgress {
  const slotKey = (doc: HomeDoc) => {
    const taxonomyId = taxonomyIdOf(doc, taxonomies);
    return taxonomyId && doc.code ? `${taxonomyId}:${doc.code}` : undefined;
  };
  const deployedSlots = new Set(docs.filter(isTemplate).map(slotKey).filter(Boolean));
  const madeSlots = new Set(docs.filter((doc) => isSiteDoc(doc) && doc.siteId === siteId).map(slotKey).filter(Boolean));

  const divisions: DivisionProgress[] = [];
  const groups: GroupProgress[] = [];
  for (const taxonomy of taxonomies) {
    const division: DivisionProgress = { taxonomyId: taxonomy.id, name: taxonomy.division || "이름 없음", deployed: 0, made: 0, undeployed: 0 };
    for (const group of taxonomy.groups) {
      const entry: GroupProgress = { taxonomyId: taxonomy.id, code: group.code, name: group.name, deployed: 0, made: 0 };
      for (const item of group.items) {
        const key = `${taxonomy.id}:${item.code}`;
        if (!deployedSlots.has(key)) {
          division.undeployed += 1;
          continue;
        }
        entry.deployed += 1;
        if (madeSlots.has(key)) entry.made += 1;
      }
      division.deployed += entry.deployed;
      division.made += entry.made;
      if (entry.deployed > 0) groups.push(entry);
    }
    divisions.push(division);
  }

  const ratio = (entry: { deployed: number; made: number }) => entry.made / entry.deployed;
  return {
    deployed: divisions.reduce((sum, entry) => sum + entry.deployed, 0),
    made: divisions.reduce((sum, entry) => sum + entry.made, 0),
    undeployed: divisions.reduce((sum, entry) => sum + entry.undeployed, 0),
    divisions,
    lowGroups: groups
      .filter((entry) => entry.made < entry.deployed)
      .sort((a, b) => ratio(a) - ratio(b) || b.deployed - a.deployed)
      .slice(0, lowCount),
  };
}

export const percent = (made: number, total: number) => (total > 0 ? Math.round((made / total) * 100) : 0);

// ─── 전 현장 점검표 ───────────────────────────────────────

export interface SiteAuditRow {
  siteId: string;
  siteName: string;
  deployed: number;
  made: number;
  /** 결재가 진행중인 시트 수 */
  inProgress: number;
  stalled: number;
  unassigned: number;
}

/**
 * 모든 현장 보기의 홈 — 오프라인 서류 점검용. 진척도가 낮은 현장이 위로 온다(먼저 볼 곳).
 */
export function sitesAudit(
  sites: { id: string; name: string }[],
  taxonomies: Taxonomy[],
  docs: HomeDoc[],
  now: number,
  staleDays = 3,
): SiteAuditRow[] {
  return sites
    .map((site) => {
      const progress = documentProgress(taxonomies, docs, site.id, 0);
      const siteDocs = docs.filter((doc) => isSiteDoc(doc) && doc.siteId === site.id);
      // 사람과 무관하게 세려고 아무도 아닌 사용자로 센다.
      const overview = approvalOverview(siteDocs, {}, now, staleDays);
      const inProgress = siteDocs
        .flatMap((doc) => doc.approvalSheets ?? [])
        .filter(
          (sheet) =>
            sheet.slots.length > 0 &&
            sheet.slots.some((slot) => sheet.line[slot.signKey]) &&
            !sheet.slots.every((slot) => sheet.approvals[slot.signKey]),
        ).length;
      return {
        siteId: site.id,
        siteName: site.name,
        deployed: progress.deployed,
        made: progress.made,
        inProgress,
        stalled: overview.stalled.length,
        unassigned: overview.unassigned.length,
      };
    })
    .sort((a, b) => percent(a.made, a.deployed) - percent(b.made, b.deployed) || a.siteName.localeCompare(b.siteName, "ko"));
}
