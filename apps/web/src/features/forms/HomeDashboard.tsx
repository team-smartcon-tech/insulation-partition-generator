/**
 * 홈 — 오늘 내가 할 일을 한 화면에.
 *
 *  - 왼쪽: 내 정보 + 결재 진행현황(내 차례·올린 결재·완료) + 사람별 대기 건수
 *  - 가운데: 내 결재함(누르면 그 서류·시트가 열린다) + 서류 진척도
 *  - 오른쪽: 알림(새 판·결재선 미지정·멈춘 결재·내 서명 미등록)
 *
 * 이 앱에 **실제로 있는 데이터만** 보여 준다(사용자와 합의). 공정률·현장 사진 같은 카드는 데이터가
 * 없어 넣지 않았다 — 빈 카드나 가짜 숫자는 홈 전체를 믿지 못하게 만든다.
 *
 * 모든 현장 보기에서는 {@link SitesAudit}(현장별 점검표)가 대신 뜬다 — 오프라인 서류 점검용.
 */
import { useEffect, useState } from "react";
import { AlarmClock, ArrowRight, Check, CopyPlus, FilePlus2, PenLine, Sparkles, TriangleAlert, UserX } from "lucide-react";
import {
  daysSince,
  percent,
  type ApprovalItem,
  type ApprovalOverview,
  type DocumentProgress,
  type SiteAuditRow,
} from "./homeStats";

type InboxTab = "mine" | "requested" | "completed";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** 이름 뒤 두 글자 */
const initials = (name: string) => (name.length > 2 ? name.slice(-2) : name);

function Card({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
          {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Steps({ item }: { item: ApprovalItem }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {item.steps.map((step, index) => (
        <span
          key={index}
          title={step.name ? `${step.label} · ${step.name}` : step.label}
          className={
            "flex h-5 min-w-[34px] items-center justify-center rounded px-1 text-[10px] font-bold " +
            (step.status === "done"
              ? "bg-emerald-100 text-emerald-700"
              : step.status === "now"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-400")
          }
        >
          {step.label}
        </span>
      ))}
    </span>
  );
}

export interface HomeDashboardProps {
  userName: string;
  roleLabel?: string;
  siteName: string;
  hasSignature: boolean;
  overview: ApprovalOverview;
  progress: DocumentProgress;
  /** 새 판이 올라온 현장 서류 */
  newer: { formId: string; title: string }[];
  /**
   * 다른 분류의 같은 칸에만 새 판이 올라와, 이 칸이 옛 판으로 남은 곳.
   * 현장이 아니라 **배포 양식함**의 문제라, 고치는 것도 여기서 한 번에 한다.
   */
  stale: { key: string; label: string; onOpen: () => void; onDeploy: () => void }[];
  onOpenDoc: (formId: string, sheetName?: string) => void;
  onGoSiteBox: () => void;
  onRegisterSignature: () => void;
}

export default function HomeDashboard({
  userName,
  roleLabel,
  siteName,
  hasSignature,
  overview,
  progress,
  newer,
  stale,
  onOpenDoc,
  onGoSiteBox,
  onRegisterSignature,
}: HomeDashboardProps) {
  const now = useNow();
  const [tab, setTab] = useState<InboxTab>("mine");
  const date = new Date(now);
  const dateText = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${WEEKDAYS[date.getDay()]}요일`;
  const timeText = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

  const lists: Record<InboxTab, ApprovalItem[]> = {
    mine: overview.myTurn,
    requested: overview.requested,
    completed: overview.completed,
  };
  const shown = lists[tab];
  const maxWaiting = Math.max(1, ...overview.waitingByPerson.map((person) => person.count));
  const noLineAtAll =
    overview.myTurn.length + overview.requested.length + overview.completed.length + overview.waitingByPerson.length === 0;
  const progressPercent = percent(progress.done, progress.total);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_320px]">
      {/* ── 왼쪽: 내 정보 + 결재 진행현황 ── */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-3 bg-[linear-gradient(120deg,#063a74,#0a5aa8_65%,#1478d6)] px-5 py-4 text-white">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2a8fe6] to-[#003a78] text-lg font-bold ring-2 ring-white/50">
            {userName.trim().charAt(0) || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{userName} 님</p>
            <p className="truncate text-xs text-white/80">
              {siteName}
              {roleLabel ? ` · ${roleLabel}` : ""}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[11px] text-white/80">{dateText}</p>
            <p className="text-xl font-bold tabular-nums tracking-wide">{timeText}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-xs text-slate-500">
          결재 서명
          {hasSignature ? (
            <span className="ml-auto inline-flex items-center gap-1 font-semibold text-emerald-600">
              <Check size={13} /> 등록됨
            </span>
          ) : (
            <button type="button" onClick={onRegisterSignature} className="ml-auto font-semibold text-blue-600 hover:underline">
              등록하기
            </button>
          )}
        </div>

        <div className="px-5 pb-1 pt-3.5">
          <h2 className="text-[15px] font-bold text-slate-900">결재 진행현황</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">{siteName} · 이 브라우저에 기록된 결재</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100">
          {(
            [
              { key: "mine", label: "내 차례", count: overview.myTurn.length, tone: "text-blue-700" },
              { key: "requested", label: "올린 결재 진행중", count: overview.requested.length, tone: "text-amber-600" },
              { key: "completed", label: "완료", count: overview.completed.length, tone: "text-emerald-600" },
            ] as const
          ).map((stat) => (
            <button
              key={stat.key}
              type="button"
              onClick={() => setTab(stat.key)}
              className="py-3 text-center transition hover:bg-slate-50"
            >
              <span className="block text-[11px] text-slate-500">{stat.label}</span>
              <span className={`mt-1 block text-2xl font-bold tabular-nums ${stat.tone}`}>
                {stat.count}
                <span className="text-xs">건</span>
              </span>
            </button>
          ))}
        </div>

        <div className="border-t border-slate-100 px-5 pb-4 pt-3">
          <p className="text-xs font-semibold text-slate-700">
            직원별 대기 건수 <span className="font-normal text-slate-400">(결재 차례가 와 있는 서류)</span>
          </p>
          {overview.waitingByPerson.length === 0 ? (
            <p className="mt-3 text-xs text-slate-400">차례를 기다리는 결재가 없습니다.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {overview.waitingByPerson.map((person) => (
                <li key={`${person.name}|${person.position}`} className="flex items-center gap-2 py-1 text-[13px]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-700">
                    {initials(person.name)}
                  </span>
                  <span className="w-24 shrink-0 truncate text-slate-700">
                    {person.name} {person.position}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-blue-600" style={{ width: `${(person.count / maxWaiting) * 100}%` }} />
                  </span>
                  <span className="w-5 text-right font-bold tabular-nums text-slate-800">{person.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── 가운데: 내 결재함 + 서류 진척도 ── */}
      <div className="grid gap-5">
        <Card title="내 결재함" sub="누르면 서류가 바로 열립니다">
          <div className="flex gap-1.5 px-5 pt-3">
            {(
              [
                { key: "mine", label: "내 차례", count: overview.myTurn.length },
                { key: "requested", label: "올린 결재", count: overview.requested.length },
                { key: "completed", label: "완료", count: overview.completed.length },
              ] as const
            ).map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTab(entry.key)}
                aria-pressed={tab === entry.key}
                className={
                  "rounded-full px-3 py-1 text-xs font-semibold transition " +
                  (tab === entry.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                }
              >
                {entry.label} <span className="tabular-nums">{entry.count}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              {tab === "mine" && "지금 결재할 차례인 서류가 없습니다."}
              {tab === "requested" && "진행중인 올린 결재가 없습니다."}
              {tab === "completed" && "끝난 결재가 없습니다."}
              {noLineAtAll && (
                <p className="mt-2 text-xs text-slate-400">
                  현장 서류함에서 결재칸이 있는 서류를 열고 <strong className="font-semibold text-slate-600">[결재선 지정]</strong>을 눌러 보세요.{" "}
                  <button type="button" onClick={onGoSiteBox} className="font-semibold text-blue-600 hover:underline">
                    현장 서류함으로 →
                  </button>
                </p>
              )}
            </div>
          ) : (
            <ul className="mt-2">
              {shown.map((item) => {
                const days = daysSince(item.since, now);
                return (
                  <li key={`${item.formId}|${item.sheetName}`}>
                    <button
                      type="button"
                      onClick={() => onOpenDoc(item.formId, item.sheetName)}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-5 py-3 text-left transition hover:bg-slate-50"
                    >
                      <Steps item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-slate-900">
                          {item.title} <span className="font-normal text-slate-400">· {item.sheetName}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-slate-500">
                          {item.current
                            ? `${item.currentLabel} 차례 · ${item.current.name} ${item.current.position}`.trim()
                            : "결재 완료"}
                          {days !== undefined && item.current && ` · ${days === 0 ? "오늘" : `${days}일째`}`}
                        </span>
                      </span>
                      {days !== undefined && days >= 3 && item.current && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-bold text-rose-600">{days}일 대기</span>
                      )}
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold " +
                          (tab === "mine" ? "bg-blue-600 text-white" : "text-slate-600 ring-1 ring-slate-300")
                        }
                      >
                        {tab === "mine" ? (
                          <>
                            <PenLine size={13} /> 열어서 결재
                          </>
                        ) : (
                          <>
                            열기 <ArrowRight size={13} />
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="서류 진척도"
          sub={`${siteName} · 품질관리계획서 서식 중 결재까지 끝난 것 — 서류함과 같은 수`}
          action={
            <button type="button" onClick={onGoSiteBox} className="text-xs font-semibold text-blue-600 hover:underline">
              서류함 ›
            </button>
          }
        >
          {progress.total === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              셀 서식이 없습니다. 서류함의 [작성 일정]에서 모든 절을 적용 제외했는지 확인해 주세요.
            </p>
          ) : (
            <div className="px-5 pb-5 pt-4">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-4xl font-bold tabular-nums text-[#063a74]">{progressPercent}%</span>
                <span className="text-xs text-slate-500">
                  서식 {progress.total}종 중 끝남 {progress.done}종
                  {progress.doing > 0 && ` · 작성 중 ${progress.doing}종`}
                </span>
              </p>
              <ul className="mt-4 space-y-2.5">
                {progress.depts
                  .filter((entry) => entry.total > 0)
                  .map((entry) => (
                    <li key={entry.dept} className="grid grid-cols-[90px_minmax(0,1fr)_80px] items-center gap-3 text-[13px]">
                      <span className="truncate text-slate-700">{entry.dept} 주관</span>
                      <ProgressBar done={entry.done} doing={entry.doing} total={entry.total} />
                      <span className="text-right tabular-nums text-slate-600">
                        {entry.done} / {entry.total}종
                      </span>
                    </li>
                  ))}
              </ul>
              {progress.lowSections.length > 0 && (
                <>
                  <p className="mt-5 text-xs font-semibold text-slate-600">진척이 가장 낮은 절</p>
                  <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 2xl:grid-cols-5">
                    {progress.lowSections.map((sec) => (
                      <li
                        key={sec.no}
                        className={
                          "rounded-lg px-2 py-1.5 text-[11px] ring-1 " +
                          (sec.done + sec.doing === 0 ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-slate-50 text-slate-600 ring-slate-200")
                        }
                      >
                        <span className="block truncate text-xs font-semibold" title={`${sec.no} ${sec.title} · ${sec.lead} 주관`}>
                          {sec.no} {sec.title}
                        </span>
                        <span className="tabular-nums">
                          {sec.done} / {sec.total}종 · {sec.lead}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── 오른쪽: 알림 ── */}
      <div className="lg:col-span-2 xl:col-span-1">
        <Card title="알림" sub="처리가 필요한 것">
          <ul>
            <AlertRow
              icon={<Sparkles size={15} />}
              tone="blue"
              title="새 판 있음"
              text="배포 양식이 새로 올라온 현장 서류"
              count={newer.length}
              items={newer.map((doc) => ({ key: doc.formId, label: doc.title, onClick: () => onOpenDoc(doc.formId) }))}
            />
            <AlertRow
              icon={<CopyPlus size={15} />}
              tone="amber"
              title="다른 분류에 새 판"
              text="옆 분류에만 새 양식이 올라온 칸"
              count={stale.length}
              items={stale.map((row) => ({
                key: row.key,
                label: row.label,
                onClick: row.onOpen,
                action: { label: "이 칸에도 배포", onClick: row.onDeploy },
              }))}
            />
            <AlertRow
              icon={<FilePlus2 size={15} />}
              tone="amber"
              title="결재선 미지정"
              text="결재칸은 있는데 결재선을 안 정한 서류"
              count={overview.unassigned.length}
              items={overview.unassigned.map((entry) => ({
                key: `${entry.formId}|${entry.sheetName}`,
                label: `${entry.title} · ${entry.sheetName}`,
                onClick: () => onOpenDoc(entry.formId, entry.sheetName),
              }))}
            />
            <AlertRow
              icon={<TriangleAlert size={15} />}
              tone="amber"
              title="결재 뒤 수정됨"
              text="결재한 뒤 내용이 바뀐 서류"
              count={overview.changed.length}
              items={overview.changed.map((item) => ({
                key: `${item.formId}|${item.sheetName}`,
                label: `${item.title} · ${item.sheetName}`,
                onClick: () => onOpenDoc(item.formId, item.sheetName),
              }))}
            />
            <AlertRow
              icon={<AlarmClock size={15} />}
              tone="rose"
              title="3일 넘게 멈춘 결재"
              text="차례가 온 뒤 3일 이상 지난 결재"
              count={overview.stalled.length}
              items={overview.stalled.map((item) => ({
                key: `${item.formId}|${item.sheetName}`,
                label: `${item.current?.name ?? ""} ${item.currentLabel ?? ""} · ${item.title}`.trim(),
                onClick: () => onOpenDoc(item.formId, item.sheetName),
              }))}
            />
            {overview.inAnyLine && !hasSignature && (
              <li className="flex items-start gap-3 border-t border-slate-100 px-5 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <UserX size={15} />
                </span>
                <span className="min-w-0 flex-1 text-[12.5px]">
                  <span className="block text-[13px] font-semibold text-slate-900">내 서명 미등록</span>
                  <span className="text-slate-500">결재선에 들어 있는데 서명이 없습니다.</span>
                </span>
                <button type="button" onClick={onRegisterSignature} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50">
                  등록하기
                </button>
              </li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}

const TONES = {
  blue: { icon: "bg-blue-50 text-blue-600", count: "text-blue-600" },
  amber: { icon: "bg-amber-50 text-amber-600", count: "text-amber-600" },
  rose: { icon: "bg-rose-50 text-rose-600", count: "text-rose-600" },
} as const;

/** 알림 한 줄 — 건수가 있으면 누르면 펼쳐서 해당 서류로 간다. 0건은 흐리게. */
function AlertRow({
  icon,
  tone,
  title,
  text,
  count,
  items,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONES;
  title: string;
  text: string;
  count: number;
  items: {
    key: string;
    label: string;
    onClick: () => void;
    /** 그 줄에서 바로 처리할 수 있는 일(예: 이 칸에도 배포) */
    action?: { label: string; onClick: () => void };
  }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t border-slate-100 first:border-t-0">
      <button
        type="button"
        onClick={() => count > 0 && setOpen((on) => !on)}
        aria-expanded={open}
        disabled={count === 0}
        className="flex w-full items-start gap-3 px-5 py-3 text-left transition enabled:hover:bg-slate-50 disabled:opacity-60"
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONES[tone].icon}`}>{icon}</span>
        <span className="min-w-0 flex-1 text-[12.5px]">
          <span className="block text-[13px] font-semibold text-slate-900">{title}</span>
          <span className="text-slate-500">{text}</span>
          {!open && count > 0 && (
            <span className="mt-0.5 block truncate text-[11.5px] text-slate-400">
              {items[0]?.label}
              {count > 1 ? ` 외 ${count - 1}` : ""}
            </span>
          )}
        </span>
        <span className={`text-lg font-bold tabular-nums ${count > 0 ? TONES[tone].count : "text-slate-300"}`}>{count}</span>
      </button>
      {open && (
        <ul className="pb-2">
          {items.map((item) => (
            // 단추 안에 단추를 넣을 수 없어, 줄을 나누고 각각 단추로 둔다.
            <li key={item.key} className="flex items-center gap-1 pr-3 hover:bg-slate-50">
              <button
                type="button"
                onClick={item.onClick}
                className="flex min-w-0 flex-1 items-center gap-1 py-1.5 pl-[3.75rem] pr-2 text-left text-xs text-slate-600 hover:text-blue-700"
              >
                <span className="truncate">{item.label}</span>
                <ArrowRight size={12} className="shrink-0" />
              </button>
              {item.action && (
                <button
                  type="button"
                  onClick={item.action.onClick}
                  className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50"
                >
                  {item.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** 진척 막대 — 끝난 것은 진하게, 작성 중인 것은 옅게 잇는다. %는 끝난 것만 센다. */
export function ProgressBar({ done, doing, total }: { done: number; doing: number; total: number }) {
  return (
    <span
      className="flex h-2.5 overflow-hidden rounded-full bg-slate-100"
      title={`끝남 ${done} · 작성 중 ${doing} · 안 씀 ${Math.max(0, total - done - doing)}`}
    >
      <span className="block h-full bg-[linear-gradient(90deg,#0a5aa8,#1478d6)]" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      <span className="block h-full bg-amber-300" style={{ width: `${total > 0 ? (doing / total) * 100 : 0}%` }} />
    </span>
  );
}

/** 모든 현장 보기의 홈 — 현장별 점검표. 진척도가 낮은 현장이 위(먼저 볼 곳). */
export function SitesAudit({ rows, onOpenSite }: { rows: SiteAuditRow[]; onOpenSite: (siteId: string) => void }) {
  return (
    <Card title="전 현장 서류 점검" sub="진척도가 낮은 현장부터 · 현장을 누르면 그 현장 홈으로 갑니다">
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">현장이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-semibold">현장</th>
                <th className="px-3 py-2.5 font-semibold">서류 진척도</th>
                <th className="px-3 py-2.5 text-right font-semibold">결재 진행중</th>
                <th className="px-3 py-2.5 text-right font-semibold">3일 넘게 멈춤</th>
                <th className="px-5 py-2.5 text-right font-semibold">결재선 미지정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const value = percent(row.done, row.total);
                return (
                  <tr
                    key={row.siteId}
                    onClick={() => onOpenSite(row.siteId)}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-blue-50/40"
                  >
                    <td className="px-5 py-3 font-semibold text-slate-900">{row.siteName}</td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-3">
                        <span className="w-40">
                          <ProgressBar done={row.done} doing={row.doing} total={row.total} />
                        </span>
                        <span className="w-10 text-right font-bold tabular-nums text-slate-800">{value}%</span>
                        <span className="text-xs tabular-nums text-slate-400">
                          {row.done} / {row.total}종
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.inProgress}</td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${row.stalled > 0 ? "text-rose-600" : "text-slate-300"}`}>
                      {row.stalled}
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums ${row.unassigned > 0 ? "text-amber-600" : "text-slate-300"}`}>
                      {row.unassigned}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
