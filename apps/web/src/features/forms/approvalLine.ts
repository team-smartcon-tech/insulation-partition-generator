/**
 * 현장 조직과 결재선 — 결재칸(작성·검토·승인)마다 누가 서명할지 정한다.
 *
 * 결재자는 **현장 조직**(현장에 등록해 둔 사람 명단)에서 고른다. 서류마다 이름을 다시 치면
 * 오타가 나고(김성훈/김성환) 같은 사람이 여러 이름으로 쌓인다.
 *
 * 한 번 정한 결재선은 **현장 기본값**으로 기억해, 다음 서류의 같은 칸(작성·검토·승인)에 미리
 * 채운다. 현장의 결재자는 서류가 달라도 대개 같다.
 */

/** 현장 조직 한 사람 */
export interface SiteMember {
  id: string;
  name: string;
  /** 직급(예: 대리, 과장(CL3)) */
  position: string;
  /** 역할·공종(예: 현장소장, 공사, 공무) */
  role: string;
}

/** 결재칸 한 칸에 지정된 사람 */
export interface Assignee {
  name: string;
  position: string;
  role: string;
  /** 현장 조직에서 골랐으면 그 사람 id(직접 입력이면 없다) */
  memberId?: string;
  /** 이 칸에 이 사람을 정한 시각(ms) — "며칠째 멈춘 결재"를 세는 기준 */
  assignedAt?: number;
}

/** 결재칸 한 칸 — `approval.ts` 의 ApprovalSlot 중 여기서 쓰는 것만 */
export interface LineSlot {
  label: string;
  signKey: string;
}

/** 칸 이름(작성·검토·승인) → 그 이름의 칸들에 차례로 들어갈 사람. 검토가 둘이면 둘. */
export type LineDefaults = Record<string, Assignee[]>;

const trim = (text: string) => text.trim();

/** 이름 검색 — 이름·직급·역할 어디에 걸려도 찾는다. 공백은 무시한다. */
export function searchMembers(members: SiteMember[], query: string): SiteMember[] {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  if (!needle) return members;
  return members.filter((member) =>
    `${member.name}${member.position}${member.role}`.replace(/\s+/g, "").toLowerCase().includes(needle),
  );
}

/**
 * 조직에 사람을 더한다. 이름·직급이 같은 사람이 이미 있으면 그 사람을 돌려준다(두 번 쌓지 않는다).
 * 이름이 비면 아무것도 하지 않는다.
 */
export function addMember(
  members: SiteMember[],
  input: { name: string; position?: string; role?: string },
  makeId: () => string,
): { members: SiteMember[]; member?: SiteMember } {
  const name = trim(input.name);
  if (!name) return { members };
  const position = trim(input.position ?? "");
  const existing = members.find((member) => member.name === name && member.position === position);
  if (existing) return { members, member: existing };
  const member: SiteMember = { id: makeId(), name, position, role: trim(input.role ?? "") };
  return { members: [...members, member], member };
}

export function removeMember(members: SiteMember[], id: string): SiteMember[] {
  return members.filter((member) => member.id !== id);
}

export const assigneeOf = (member: SiteMember): Assignee => ({
  name: member.name,
  position: member.position,
  role: member.role,
  memberId: member.id,
});

/**
 * 창을 열 때 칸마다 들어가 있을 사람.
 *
 * 1. 이 서류에 이미 정한 결재선이 있으면 그대로.
 * 2. 없으면 현장 기본값 — 같은 이름의 칸(작성·검토·승인)에 **나온 순서대로** 채운다
 *    (검토가 두 칸이면 기본값의 첫째·둘째 검토자).
 * 3. 그것도 없으면 빈칸.
 *
 * 조직에서 빠진 사람도 이미 지정된 결재선에서는 지우지 않는다 — 결재선은 그 서류의 기록이다.
 */
export function initialLine(
  slots: LineSlot[],
  saved: Record<string, Assignee> | undefined,
  defaults: LineDefaults | undefined,
): (Assignee | undefined)[] {
  if (saved && slots.some((slot) => saved[slot.signKey])) {
    return slots.map((slot) => saved[slot.signKey]);
  }
  const used = new Map<string, number>();
  return slots.map((slot) => {
    const index = used.get(slot.label) ?? 0;
    used.set(slot.label, index + 1);
    return defaults?.[slot.label]?.[index];
  });
}

/** 칸 순서의 결재선을 저장 모양(서명 자리 키 → 사람)으로 바꾼다. 빈칸은 뺀다. */
export function lineRecord(slots: LineSlot[], line: (Assignee | undefined)[]): Record<string, Assignee> {
  const record: Record<string, Assignee> = {};
  slots.forEach((slot, index) => {
    const person = line[index];
    if (person) record[slot.signKey] = person;
  });
  return record;
}

/**
 * 이번 결재선을 현장 기본값에 덮어쓴다. 이번 서류에 **있는 칸 이름만** 바꾼다 —
 * `작성·승인`만 있는 서류로 정했다고 기본값의 `검토`가 사라지면 안 된다.
 */
export function rememberDefaults(
  defaults: LineDefaults | undefined,
  slots: LineSlot[],
  line: (Assignee | undefined)[],
): LineDefaults {
  const next: LineDefaults = { ...(defaults ?? {}) };
  const labels = [...new Set(slots.map((slot) => slot.label))];
  for (const label of labels) {
    const people = slots
      .map((slot, index) => (slot.label === label ? line[index] : undefined))
      .filter((person): person is Assignee => person !== undefined);
    if (people.length > 0) next[label] = people;
    else delete next[label];
  }
  return next;
}

/** 다음에 채울 빈칸. `from` 뒤에서 먼저 찾고, 없으면 앞에서 찾는다. 다 찼으면 -1. */
export function nextEmptyIndex(line: (Assignee | undefined)[], from: number): number {
  for (let offset = 1; offset <= line.length; offset += 1) {
    const index = (from + offset) % line.length;
    if (!line[index]) return index;
  }
  return -1;
}

/** 칸에 짧게 보일 글자: `김성훈 대리` */
export const assigneeCaption = (person: Assignee) => [person.name, person.position].filter(Boolean).join(" ");

// ─── 결재 ──────────────────────────────────────────────────

/** 한 칸의 결재 기록. 서명 그림을 **복사해** 담는다 — 나중에 서명을 바꿔도 이미 한 결재는 그대로. */
export interface Approval {
  name: string;
  position: string;
  userId: string;
  /** 결재할 때의 서명 PNG(data URL) */
  signature: string;
  /** 결재한 시각(ms) */
  approvedAt: number;
  /**
   * 결재할 때 그 시트의 내용 지문. 나중 내용과 견줘 **결재 뒤에 고쳤는지**를 안다.
   * 이 칸이 없는 옛 결재는 "고쳤는지 모른다"로 두고 경고하지 않는다.
   */
  contentHash?: string;
}

/** 칸 하나의 결재 상태 */
export type SlotState =
  | { status: "done"; approval: Approval }
  /** 로그인한 사람이 지금 결재할 수 있다 */
  | { status: "ready" }
  /** 앞 칸이 아직 — `before` 는 기다리는 칸 이름 */
  | { status: "waiting"; before: string }
  /** 다른 사람 차례(또는 앞 칸이 끝나면 다른 사람이 할 칸) */
  | { status: "other" }
  /** 결재선이 비어 있다 */
  | { status: "unassigned" };

const compactName = (text: string) => text.replace(/\s+/g, "");

/**
 * 결재선의 사람이 로그인한 사람인가 — 이름으로 본다(현장 조직은 계정과 아직 이어져 있지 않다).
 * 계정 이름이 `이상영 대리`처럼 직급까지 붙어 있어도 맞게, 공백을 빼고 같거나 첫 낱말이 같으면 같은 사람.
 */
export function isSamePerson(assignee: Assignee, userName: string | undefined): boolean {
  if (!userName) return false;
  const name = compactName(assignee.name);
  return name !== "" && (name === compactName(userName) || name === userName.trim().split(/\s+/)[0]);
}

/**
 * 칸마다 결재 상태. **앞 칸부터 차례로** 한다(작성 → 검토 → 승인) — 검토자가 작성보다 먼저 서명하면
 * 결재의 뜻이 없다. 앞 칸에 결재선이 비어 있어도 막는다(누가 할지 정해야 넘어간다).
 */
export function slotStates(
  slots: LineSlot[],
  line: Record<string, Assignee>,
  approvals: Record<string, Approval>,
  userName: string | undefined,
): SlotState[] {
  let blockedBy: string | undefined;
  return slots.map((slot) => {
    const approval = approvals[slot.signKey];
    if (approval) return { status: "done", approval };
    const assignee = line[slot.signKey];
    const state: SlotState = !assignee
      ? { status: "unassigned" }
      : blockedBy !== undefined
        ? isSamePerson(assignee, userName)
          ? { status: "waiting", before: blockedBy }
          : { status: "other" }
        : isSamePerson(assignee, userName)
          ? { status: "ready" }
          : { status: "other" };
    blockedBy ??= slot.label;
    return state;
  });
}

/**
 * 결재를 취소할 수 있는 칸 — 내가 한 결재 중 **다음 칸이 아직 결재하지 않은** 것.
 * 뒤 사람이 이미 서명했으면 앞 결재를 빼면 순서가 깨진다.
 */
export function cancellableIndex(
  slots: LineSlot[],
  approvals: Record<string, Approval>,
  userId: string | undefined,
): number {
  if (!userId) return -1;
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const approval = approvals[slots[index].signKey];
    if (!approval) continue;
    return approval.userId === userId ? index : -1;
  }
  return -1;
}

/**
 * 결재선이 바뀌면, 사람이 바뀌었거나 빠진 칸의 결재는 지운다 — 다른 사람 칸에 남은 서명은 거짓이다.
 * 그 뒤 칸들도 지운다(앞 칸이 다시 결재해야 순서가 맞다). 남은 결재와 지운 칸 수를 돌려준다.
 */
export function pruneApprovals(
  slots: LineSlot[],
  line: Record<string, Assignee>,
  approvals: Record<string, Approval>,
): { approvals: Record<string, Approval>; removed: number } {
  const kept: Record<string, Approval> = {};
  let broken = false;
  let removed = 0;
  for (const slot of slots) {
    const approval = approvals[slot.signKey];
    if (!approval) {
      broken = true;
      continue;
    }
    const assignee = line[slot.signKey];
    if (broken || !assignee || compactName(assignee.name) !== compactName(approval.name)) {
      broken = true;
      removed += 1;
      continue;
    }
    kept[slot.signKey] = approval;
  }
  return { approvals: kept, removed };
}

/**
 * 시트 하나의 내용 지문 — 적어 둔 글자(칸 → 값)를 순서 없이 한 줄로 만들어 짧게 줄인다.
 *
 * 무엇이 어떻게 바뀌었는지는 알 필요가 없다. "결재할 때와 지금이 같은가"만 보면 된다.
 * 칸 순서가 달라도 같은 지문이 나오도록 키를 정렬한다.
 */
export function contentHash(cells: Record<string, string> | undefined): string {
  const text = Object.entries(cells ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0001");
  // djb2 — 길이와 상관없이 짧게, 흔한 수정은 반드시 다른 값이 나오게.
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = (((hash << 5) + hash) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

/** 결재칸이 모두 결재되었나(= 결재 완료). 칸이 없으면 완료가 아니다. */
export function isFullyApproved(
  slots: LineSlot[],
  approvals: Record<string, { approvedAt: number }>,
): boolean {
  return slots.length > 0 && slots.every((slot) => approvals[slot.signKey]);
}

/**
 * 결재한 뒤 내용이 바뀌었나 — 마지막 결재의 지문과 지금 지문을 견준다.
 * 지문이 없는 옛 결재는 모르니 경고하지 않는다(거짓 경고보다 낫다).
 */
export function changedAfterApproval(
  approvals: Record<string, { approvedAt: number; contentHash?: string }>,
  cells: Record<string, string> | undefined,
): boolean {
  const latest = Object.values(approvals).sort((a, b) => b.approvedAt - a.approvedAt)[0];
  if (!latest?.contentHash) return false;
  return latest.contentHash !== contentHash(cells);
}

/** 결재칸 날짜 자리에 넣을 글자: `09/17` */
export function approvalDateText(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 결재선을 저장할 때 칸마다 "정한 시각"을 붙인다. **같은 사람이 그대로면 처음 정한 시각을 지킨다** —
 * 결재선 창을 열었다 닫을 때마다 시각이 새로 찍히면 멈춘 결재가 영영 안 잡힌다.
 */
export function stampAssignedAt(
  previous: Record<string, Assignee> | undefined,
  next: Record<string, Assignee>,
  now: number,
): Record<string, Assignee> {
  const stamped: Record<string, Assignee> = {};
  for (const [key, person] of Object.entries(next)) {
    const before = previous?.[key];
    const same =
      before !== undefined &&
      compactName(before.name) === compactName(person.name) &&
      before.position === person.position;
    stamped[key] = { ...person, assignedAt: same ? (before.assignedAt ?? now) : now };
  }
  return stamped;
}
