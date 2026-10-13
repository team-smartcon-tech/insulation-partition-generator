/**
 * 왼쪽 메뉴 — 사내 Smart Works 와 같은 자리·같은 모양(사용자 요청, 사진으로 받음).
 *
 * 왜 위 탭에서 옮겼나: 직원들이 매일 보는 Smart Works 가 왼쪽 메뉴다. 같은 자리에 있으면
 * 설명하지 않아도 찾는다. 메뉴가 늘어나도 위 탭처럼 비좁아지지 않는다.
 *
 * **접을 수 있다.** 이 앱은 21열짜리 넓은 양식을 그리는 일이 많아 가로 공간이 귀하다.
 * 접으면 아이콘만 남고(56px), 편 상태는 브라우저에 기억해 둔다.
 *
 * 좁은 화면(휴대폰·태블릿)에서는 왼쪽 메뉴를 숨기고 **위 탭**으로 보여 준다 — 좁은 화면에서
 * 왼쪽을 220px 떼어 가면 표가 들어갈 자리가 없다.
 */
import { BookOpen, ChevronsLeft, ChevronsRight, ClipboardCheck, FolderOpen, House, ListChecks, MessageSquare } from "lucide-react";
import type { ComponentType } from "react";

export type Space = "home" | "library" | "site" | "qmp" | "review" | "feedback";

/** 본사 관리자만 들어갈 수 있는 곳 */
export const HQ_ONLY: ReadonlySet<Space> = new Set<Space>(["library", "review"]);

interface Item {
  value: Space;
  label: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  /** 본사 관리자만 보이나 */
  hq?: boolean;
}

/** 묶음 이름 → 그 묶음의 메뉴들. Smart Works 처럼 작은 제목으로 갈라 둔다. */
const GROUPS: { name: string | null; items: Item[] }[] = [
  {
    name: null,
    items: [{ value: "home", label: "홈", icon: House, title: "내 결재함·서류 진척도·알림" }],
  },
  {
    name: "서류 관리",
    items: [
      {
        value: "library",
        label: "배포 양식함",
        icon: BookOpen,
        title: "회사가 배포한 원본 양식 — 본사 관리자만 보입니다",
        hq: true,
      },
      { value: "site", label: "현장 서류함", icon: FolderOpen, title: "현장별로 작성하는 서류" },
      {
        value: "qmp",
        label: "계획서 서류 현황",
        icon: ListChecks,
        title: "품질관리계획서 서식마다 주관 부서가 작성했는지 — 부서별 신호등",
      },
    ],
  },
  {
    name: "점검 관리",
    items: [
      {
        value: "review",
        label: "본사 점검",
        icon: ClipboardCheck,
        title: "현장이 올린 서류를 보고 확인·보완 요청 — 본사 관리자만 보입니다",
        hq: true,
      },
    ],
  },
  {
    name: "소통",
    items: [
      {
        value: "feedback",
        label: "오류·개선 의견",
        icon: MessageSquare,
        title: "쓰다가 이상한 것·이랬으면 하는 것 — 모든 직원이 함께 봅니다",
      },
    ],
  },
];

const visible = (items: Item[], isHq: boolean) => items.filter((item) => !item.hq || isHq);

interface NavProps {
  space: Space;
  onChange: (space: Space) => void;
  isHq: boolean;
}

/** 왼쪽 세로 메뉴(넓은 화면) */
export function SpaceSidebar({
  space,
  onChange,
  isHq,
  collapsed,
  onToggleCollapsed,
}: NavProps & { collapsed: boolean; onToggleCollapsed: () => void }) {
  return (
    <nav
      aria-label="메뉴"
      className={
        "sticky top-[68px] hidden h-[calc(100vh-68px)] shrink-0 flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur-xl transition-[width] duration-200 lg:flex " +
        (collapsed ? "w-[60px]" : "w-[216px]")
      }
    >
      <div className="flex-1 overflow-y-auto px-2.5 py-4">
        {GROUPS.map((group, index) => {
          const items = visible(group.items, isHq);
          if (items.length === 0) return null;
          return (
            <div key={group.name ?? `g${index}`} className={index === 0 ? "" : "mt-5"}>
              {group.name && !collapsed && (
                <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-tight text-slate-400">{group.name}</p>
              )}
              {group.name && collapsed && <div className="mx-2 mb-2 h-px bg-slate-200" />}
              <ul className="space-y-0.5">
                {items.map(({ value, label, icon: Icon, title }) => {
                  const active = space === value;
                  return (
                    <li key={value}>
                      <button
                        type="button"
                        onClick={() => onChange(value)}
                        title={collapsed ? label : title}
                        aria-current={active ? "page" : undefined}
                        className={
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] font-medium transition " +
                          (active
                            ? "bg-[#eaf2fd] text-[#0a63b8] ring-1 ring-[#cfe2fa]"
                            : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900") +
                          (collapsed ? " justify-center px-0" : "")
                        }
                      >
                        <Icon size={17} className="shrink-0" />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onToggleCollapsed}
        title={collapsed ? "메뉴 펴기" : "메뉴 접기"}
        aria-label={collapsed ? "메뉴 펴기" : "메뉴 접기"}
        className="m-2.5 flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        {!collapsed && "접기"}
      </button>
    </nav>
  );
}

/** 좁은 화면용 위 탭 — 왼쪽 메뉴를 숨겼을 때만 보인다. */
export function SpaceTabs({ space, onChange, isHq }: NavProps) {
  const items = GROUPS.flatMap((group) => visible(group.items, isHq));
  return (
    <nav className="flex h-11 items-stretch gap-6 overflow-x-auto lg:hidden" aria-label="메뉴(좁은 화면)">
      {items.map(({ value, label, icon: Icon, title }) => {
        const active = space === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-current={active ? "page" : undefined}
            title={title}
            className={
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 text-sm font-semibold transition " +
              (active
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
            }
          >
            <Icon size={15} /> {label}
          </button>
        );
      })}
    </nav>
  );
}
