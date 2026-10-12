/**
 * 서류 담당자 — 서류를 쓰다 막히면 누구에게 물어야 하는지.
 *
 * 담당은 **중분류에 한 번** 적으면 그 아래 칸이 모두 물려받고, 담당이 다른 칸만 따로 적는다.
 * 칸마다 적게 하면 65칸을 65번 입력해야 하고, 중분류만 두면 칸마다 다른 담당을 못 적는다.
 *
 * 코드표에 붙어 회사 공통으로 관리된다(배포 양식함의 코드표 편집). 현장에서는 보기만 한다.
 */
import type { Taxonomy, TaxonomyGroup, TaxonomyItem } from "./taxonomy.ts";

export interface Contact {
  /** 담당 부서(예: 품질팀) */
  department: string;
  /** 담당자(예: 홍길동 대리) */
  name: string;
  /** 연락처(예: 내선 1234, 010-…) */
  phone: string;
}

/** 한 칸에서 실제로 보여 줄 담당. `inherited` 면 중분류에서 물려받은 것이다. */
export interface ResolvedContact {
  contact: Contact;
  inherited: boolean;
}

export const isEmptyContact = (contact: Contact | undefined): boolean =>
  !contact || (!contact.department.trim() && !contact.name.trim() && !contact.phone.trim());

/** `품질팀 · 홍길동 대리 · 내선 1234` — 빈 칸은 건너뛴다. */
export function formatContact(contact: Contact): string {
  return [contact.department, contact.name, contact.phone]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

/**
 * 한 줄 입력을 담당 정보로 나눈다. `부서 / 이름 / 연락처` 순서, 빈 줄이면 지우기(undefined).
 *
 * 칸 세 개짜리 입력 상자 대신 한 줄로 받는다 — 코드표 편집의 다른 입력(번호와 이름)도 한 줄이라
 * 같은 손버릇으로 적을 수 있다. 구분자는 `/` 외에 `,`·`·` 도 받는다.
 */
export function parseContactInput(text: string): Contact | undefined {
  const parts = text.split(/\s*[/,·|]\s*/).map((part) => part.trim());
  const contact = { department: parts[0] ?? "", name: parts[1] ?? "", phone: parts.slice(2).join(" ") };
  return isEmptyContact(contact) ? undefined : contact;
}

/** 입력 상자에 미리 채울 글자(parseContactInput 의 반대). */
export function contactInputText(contact: Contact | undefined): string {
  if (isEmptyContact(contact)) return "";
  return [contact!.department, contact!.name, contact!.phone].join(" / ");
}

/** 칸의 담당: 칸에 적은 것이 있으면 그것, 없으면 중분류 것. 둘 다 없으면 undefined. */
export function contactFor(taxonomy: Taxonomy, itemCode: string): ResolvedContact | undefined {
  for (const group of taxonomy.groups) {
    const item = group.items.find((entry) => entry.code === itemCode);
    if (!item) continue;
    if (!isEmptyContact(item.contact)) return { contact: item.contact!, inherited: false };
    if (!isEmptyContact(group.contact)) return { contact: group.contact!, inherited: true };
    return undefined;
  }
  return undefined;
}

function withGroups(taxonomy: Taxonomy, groups: TaxonomyGroup[]): Taxonomy {
  return { ...taxonomy, groups, updatedAt: Date.now() };
}

/** 중분류 담당을 적거나 지운다(undefined). */
export function setGroupContact(taxonomy: Taxonomy, groupCode: string, contact: Contact | undefined): Taxonomy {
  return withGroups(
    taxonomy,
    taxonomy.groups.map((group) => {
      if (group.code !== groupCode) return group;
      const { contact: _old, ...rest } = group;
      return contact ? { ...rest, contact } : rest;
    }),
  );
}

/** 칸 담당을 적거나 지운다(undefined 면 다시 중분류 담당을 물려받는다). */
export function setItemContact(taxonomy: Taxonomy, itemCode: string, contact: Contact | undefined): Taxonomy {
  return withGroups(
    taxonomy,
    taxonomy.groups.map((group) => ({
      ...group,
      items: group.items.map((item): TaxonomyItem => {
        if (item.code !== itemCode) return item;
        const { contact: _old, ...rest } = item;
        return contact ? { ...rest, contact } : rest;
      }),
    })),
  );
}

/**
 * 코드표 엑셀을 다시 올려 표가 통째로 바뀌어도, 화면에서 적어 둔 담당은 **같은 번호**에 옮겨 붙인다.
 * 엑셀에는 담당 열이 없어서, 안 옮기면 코드표를 고칠 때마다 담당을 처음부터 다시 적어야 한다.
 */
export function carryContacts(previous: Taxonomy, next: Taxonomy): Taxonomy {
  const groupContacts = new Map(previous.groups.map((group) => [group.code, group.contact]));
  const itemContacts = new Map(
    previous.groups.flatMap((group) => group.items.map((item) => [item.code, item.contact] as const)),
  );
  return {
    ...next,
    groups: next.groups.map((group) => {
      const groupContact = group.contact ?? groupContacts.get(group.code);
      return {
        ...group,
        ...(groupContact ? { contact: groupContact } : {}),
        items: group.items.map((item) => {
          const itemContact = item.contact ?? itemContacts.get(item.code);
          return itemContact ? { ...item, contact: itemContact } : item;
        }),
      };
    }),
  };
}
