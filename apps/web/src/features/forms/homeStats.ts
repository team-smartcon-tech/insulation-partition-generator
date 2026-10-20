/**
 * 홈 화면 숫자 — 결재 진행현황, 내 결재함, 서류 진척도, 알림, 전 현장 점검표.
 *
 * 화면 부품이 아니라 계산만 여기 둔다. 홈의 숫자는 "사실과 다르게 보이면" 믿지 않게 되는 숫자라
 * 규칙을 테스트로 묶어 둔다(예: 서류 진척도는 현장 서류함의 신호등과 같은 수여야 한다).
 */
import {
  isSamePerson,
  slotStates,
  type Approval,
  type Assignee,
  type LineSlot,
} from "./approvalLine.ts";
import { isSiteDoc, isTemplate, type FormKind } from "./library.ts";
import { QMP_DEPTS, QMP_SECTIONS, qmpSectionTally, qmpTally, type QmpDept, type QmpFormState } from "./qmpPlan.ts";

const DAY = 24 * 60 * 60 * 1000;

/** 목록에 실어 나르는 결재 요약 — 서명 그림은 빼고 가볍게 */
export type ApprovalLite = Omit<Approval, "signature">;

/** 결재칸이 있는 시트 하나의 결재 상태 */
export interface ApprovalSheetSummary {
  sheetName: string;
  slots: LineSlot[];
  line: Record<string, Assignee>;
  approvals: Record<string, ApprovalLite>;
  /** 결재한 뒤 내용이 바뀌었나(목록에서 값을 다 싣지 않으려고 저장소에서 미리 판단한다) */
  changed?: boolean;
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
  /** 결재한 뒤 내용이 바뀐 시트 — 결재를 다시 받아야 한다 */
  changed: ApprovalItem[];
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
    changed: [],
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
      if (sheet.changed) result.changed.push(item);
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
  result.changed.sort((a, b) => (b.lastApprovedAt ?? 0) - (a.lastApprovedAt ?? 0));
  result.completed.sort((a, b) => (b.lastApprovedAt ?? 0) - (a.lastApprovedAt ?? 0));
  result.waitingByPerson = [...waiting.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  return result;
}

/** 며칠째인지(0 = 오늘) */
export const daysSince = (since: number | undefined, now: number) =>
  since === undefined ? undefined : Math.max(0, Math.floor((now - since) / DAY));

// ─── 서류 진척도 ───────────────────────────────────────────

export interface DeptProgress {
  dept: QmpDept;
  done: number;
  doing: number;
  total: number;
}

export interface SectionProgress {
  no: string;
  title: string;
  lead: QmpDept;
  done: number;
  doing: number;
  total: number;
}

export interface DocumentProgress {
  /** 결재까지 끝난 서식 수 */
  done: number;
  /** 쓰기 시작했거나 결재 중인 서식 수 */
  doing: number;
  /** 세는 서식 수(기준 문서·적용 제외·아직 때가 아닌 준공 서식·주기 외부 작성은 뺀다) */
  total: number;
  /** 주관 부서별 — 현장 서류함의 부서 탭과 같은 수 */
  depts: DeptProgress[];
  /** 진척이 낮은 절(다 끝난 절은 빼고, 낮은 순) */
  lowSections: SectionProgress[];
}

/**
 * 한 현장의 서류 진척도 — **현장 서류함(품질관리계획서 서식표)과 같은 기준**으로 센다(2026-10-20 사용자 요청).
 *
 * 예전에는 코드표 칸 중 배포 양식이 있는 칸을 분모로, 서류를 하나라도 만든 칸을 분자로 셌다. 그래서 홈의
 * %와 서류함의 %가 달랐다. 이제 서식마다 신호등(qmpStates)을 매긴 것을 그대로 모은다 — 끝난 것만 %에 든다.
 */
export function documentProgress(states: Map<string, QmpFormState>, lowCount = 5): DocumentProgress {
  const all = qmpTally(states, null);
  const sections = QMP_SECTIONS.map((sec) => ({ no: sec.no, title: sec.title, lead: sec.lead, ...qmpSectionTally(states, sec) }));
  const ratio = (entry: { done: number; total: number }) => entry.done / entry.total;
  return {
    done: all.done,
    doing: all.doing,
    total: all.total,
    depts: QMP_DEPTS.map((dept) => {
      const tally = qmpTally(states, dept);
      return { dept, done: tally.done, doing: tally.doing, total: tally.total };
    }),
    lowSections: sections
      .filter((entry) => entry.total > 0 && entry.done < entry.total)
      .sort((a, b) => ratio(a) - ratio(b) || b.total - a.total)
      .slice(0, lowCount)
      .map(({ none: _none, ...entry }) => entry),
  };
}

export const percent = (made: number, total: number) => (total > 0 ? Math.round((made / total) * 100) : 0);

// ─── 전 현장 점검표 ───────────────────────────────────────

export interface SiteAuditRow {
  siteId: string;
  siteName: string;
  /** 서류 진척도 — 그 현장 서류함과 같은 수 */
  done: number;
  doing: number;
  total: number;
  /** 결재가 진행중인 시트 수 */
  inProgress: number;
  stalled: number;
  unassigned: number;
}

/**
 * 모든 현장 보기의 홈 — 오프라인 서류 점검용. 진척도가 낮은 현장이 위로 온다(먼저 볼 곳).
 */
export function sitesAudit<S extends { id: string; name: string }>(
  sites: S[],
  docs: HomeDoc[],
  /** 현장의 서식별 신호등 — 현장 서류함과 같은 것(작성 일정까지 넣어 센 것) */
  statesOf: (site: S) => Map<string, QmpFormState>,
  now: number,
  staleDays = 3,
): SiteAuditRow[] {
  return sites
    .map((site) => {
      const progress = documentProgress(statesOf(site), 0);
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
        done: progress.done,
        doing: progress.doing,
        total: progress.total,
        inProgress,
        stalled: overview.stalled.length,
        unassigned: overview.unassigned.length,
      };
    })
    .sort((a, b) => percent(a.done, a.total) - percent(b.done, b.total) || a.siteName.localeCompare(b.siteName, "ko"));
}
