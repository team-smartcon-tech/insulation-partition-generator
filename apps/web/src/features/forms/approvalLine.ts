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
