/**
 * 결재선 지정 창 — 왼쪽 현장 조직에서 사람을 골라 오른쪽 결재칸(01 작성 · 02 검토 …)에 넣는다.
 *
 * 사내 앱의 "결재선 지정" 창과 같은 모양이다(사용자가 보내 준 화면). 이미 손에 익은 모양이라
 * 따로 설명하지 않아도 쓴다.
 *
 * - 오른쪽에서 칸을 누르면 그 칸이 "지금 채울 칸"이 되고, 왼쪽에서 사람을 누르면 그 칸에 들어간
 *   뒤 **다음 빈칸으로 넘어간다** — 위에서부터 차례로 누르기만 하면 결재선이 완성된다.
 * - 조직에 없는 사람은 아래 "직접 입력"으로 넣는다. 넣은 사람은 현장 조직에도 더해져 다음부터
 *   왼쪽 명단에서 고를 수 있다.
 * - 창에서 바꾼 것(조직 추가·삭제 포함)은 [확인]을 눌러야 저장된다. [취소]는 모두 버린다.
 */
import { useMemo, useState } from "react";
import { Check, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import {
  addMember,
  assigneeOf,
  nextEmptyIndex,
  removeMember,
  searchMembers,
  type Assignee,
  type LineSlot,
  type SiteMember,
} from "./approvalLine";

export interface ApprovalLineResult {
  line: (Assignee | undefined)[];
  members: SiteMember[];
  /** 이 결재선을 현장 기본값으로 기억할지 */
  remember: boolean;
}

/** 이름 뒤 두 글자(조형규 → 형규) — 동그라미 안에 넣는다. */
const initials = (name: string) => (name.length > 2 ? name.slice(-2) : name);

export default function ApprovalLineDialog({
  siteName,
  slots,
  members: initialMembers,
  initialLine,
  onCancel,
  onConfirm,
}: {
  siteName: string;
  slots: LineSlot[];
  members: SiteMember[];
  initialLine: (Assignee | undefined)[];
  onCancel: () => void;
  onConfirm: (result: ApprovalLineResult) => void;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [line, setLine] = useState(initialLine);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(() => {
    const empty = line.findIndex((person) => !person);
    return empty >= 0 ? empty : 0;
  });
  const [draft, setDraft] = useState({ name: "", position: "", role: "" });
  const [remember, setRemember] = useState(true);

  const shown = useMemo(() => searchMembers(members, query), [members, query]);
  const filled = line.filter(Boolean).length;
  const activeSlot = slots[active];

  function place(person: Assignee) {
    const next = [...line];
    next[active] = person;
    setLine(next);
    const following = nextEmptyIndex(next, active);
    if (following >= 0) setActive(following);
  }

  function handleDirect() {
    const result = addMember(members, draft, () => crypto.randomUUID());
    if (!result.member) return;
    setMembers(result.members);
    place(assigneeOf(result.member));
    setDraft({ name: "", position: "", role: "" });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-line-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* 머리 */}
        <div className="flex items-start gap-3 border-b border-slate-200 px-6 py-4">
          <Users size={20} className="mt-0.5 text-blue-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="approval-line-title" className="text-lg font-bold text-slate-900">
              결재선 지정
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              왼쪽 {siteName} 조직에서 사람을 누르거나 직접 입력하면, 오른쪽에서 고른 결재칸에 들어갑니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="닫기"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          {/* ── 왼쪽: 현장 조직 ── */}
          <div className="flex min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r">
            <div className="p-3">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="이름, 직급, 역할 검색..."
                  aria-label="조직 인원 검색"
                  autoFocus
                  className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <ul className="min-h-[8rem] flex-1 overflow-y-auto px-2 md:max-h-[22rem]">
              {members.length === 0 && (
                <li className="px-3 py-6 text-center text-xs leading-relaxed text-slate-400">
                  아직 {siteName} 조직에 등록된 사람이 없습니다.
                  <br />
                  아래 <strong className="font-semibold text-slate-500">직접 입력</strong>으로 넣으면 조직에도 더해집니다.
                </li>
              )}
              {members.length > 0 && shown.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-slate-400">찾는 사람이 없습니다.</li>
              )}
              {shown.map((member) => (
                <li key={member.id} className="group flex items-center rounded-lg hover:bg-slate-50">
                  <button
                    type="button"
                    onClick={() => place(assigneeOf(member))}
                    disabled={!activeSlot}
                    title={activeSlot ? `${activeSlot.label} 칸에 넣기` : undefined}
                    className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      {initials(member.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-slate-900">{member.name}</span>{" "}
                      <span className="text-xs text-slate-500">
                        {[member.position, member.role].filter(Boolean).join(", ")}
                      </span>
                    </span>
                    <UserPlus size={15} className="shrink-0 text-slate-300 group-hover:text-blue-600" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMembers((prev) => removeMember(prev, member.id))}
                    title="현장 조직에서 빼기(이미 지정된 결재선은 그대로)"
                    aria-label={`${member.name} 조직에서 빼기`}
                    className="mr-1 shrink-0 rounded p-1 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>

            <form
              className="border-t border-slate-200 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                handleDirect();
              }}
            >
              <p className="mb-1.5 text-xs font-medium text-slate-500">직접 입력</p>
              <div className="flex gap-2">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="이름 *"
                  aria-label="이름"
                  className="min-w-0 flex-[1.4] rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
                />
                <input
                  value={draft.position}
                  onChange={(event) => setDraft({ ...draft, position: event.target.value })}
                  placeholder="직급"
                  aria-label="직급"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
                />
                <input
                  value={draft.role}
                  onChange={(event) => setDraft({ ...draft, role: event.target.value })}
                  placeholder="역할"
                  aria-label="역할"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={!draft.name.trim() || !activeSlot}
                  className="shrink-0 rounded-lg bg-slate-800 px-3 text-xs font-medium text-white disabled:bg-slate-300"
                >
                  넣기
                </button>
              </div>
              {activeSlot && (
                <p className="mt-1.5 text-[11px] text-slate-400">
                  › <strong className="font-semibold text-slate-600">{activeSlot.label}</strong> 칸에 들어가고 현장 조직에도 더해집니다
                </p>
              )}
            </form>
          </div>

          {/* ── 오른쪽: 결재선 ── */}
          <div className="flex min-h-0 flex-col bg-slate-50/60">
            <p className="px-4 pb-2 pt-4 text-sm font-semibold text-slate-700">
              결재선 <span className="tabular-nums text-slate-400">({filled}/{slots.length})</span>
            </p>
            <ol className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
              {slots.map((slot, index) => {
                const person = line[index];
                const selected = index === active;
                return (
                  <li key={slot.signKey}>
                    <div
                      className={
                        "flex items-start gap-3 rounded-xl bg-white p-3 transition " +
                        (selected ? "ring-2 ring-blue-500" : "ring-1 ring-slate-200 hover:ring-slate-300")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setActive(index)}
                        aria-pressed={selected}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] tabular-nums text-slate-500">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-800">{slot.label}</span>
                          {person ? (
                            <span className="mt-1.5 flex items-center gap-2">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700">
                                {initials(person.name)}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold text-slate-900">{person.name}</span>
                                <span className="block truncate text-[11px] text-slate-500">
                                  {[person.position, person.role].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </span>
                          ) : (
                            <span className="mt-1 block text-xs text-slate-400">
                              {selected ? "← 왼쪽에서 사람을 고르세요" : "눌러서 이 칸 채우기"}
                            </span>
                          )}
                        </span>
                      </button>
                      {person && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...line];
                            next[index] = undefined;
                            setLine(next);
                            setActive(index);
                          }}
                          aria-label={`${slot.label} 칸 비우기`}
                          className="shrink-0 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* 발 */}
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-6 py-3">
          <button
            type="button"
            onClick={() => {
              setLine(slots.map(() => undefined));
              setActive(0);
            }}
            className="rounded-lg px-3 py-2 text-sm text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
          >
            전체 초기화
          </button>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            {siteName} 기본 결재선으로 기억
          </label>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
              취소
            </button>
            <button
              type="button"
              onClick={() => onConfirm({ line, members, remember })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              <Check size={15} /> 확인
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
