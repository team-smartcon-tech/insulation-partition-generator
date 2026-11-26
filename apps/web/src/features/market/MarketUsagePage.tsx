/**
 * 이용 현황 (관리자) — 도구별 연간 이용 횟수·이용자 수·월별 추이.
 * 원천은 이용 기록(tool_usage_events, 2026-11-26 부터 쌓인다)이고, 계산은 usageReport.ts 가 한다.
 * 기록 이전의 이용은 카드의 누적 조회수에만 들어 있어 「누적 조회」 열로 함께 보여 준다.
 */
import { useMemo, useState } from "react";
import { Download, Eye, MousePointerClick, Users } from "lucide-react";
import MarketShell from "./MarketShell";
import { useMarketApps, useToolStats, useUsageSummary } from "./hooks";
import { TOOLS } from "@/features/home/tools";
import { buildUsageReport, usageReportCsv, USAGE_LOG_START_YEAR } from "./usageReport";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function MarketUsagePage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = thisYear; y >= USAGE_LOG_START_YEAR; y -= 1) out.push(y);
    return out.length > 0 ? out : [thisYear];
  }, [thisYear]);

  const { data, isLoading, isError, error } = useUsageSummary(year);
  const { data: market } = useMarketApps();
  const { data: toolStats } = useToolStats();

  const report = useMemo(
    () => buildUsageReport(TOOLS, market?.apps ?? [], toolStats?.stats ?? {}, data?.rows ?? []),
    [market, toolStats, data],
  );

  const downloadCsv = () => {
    // 엑셀이 한글을 깨뜨리지 않게 BOM 을 붙인다
    const blob = new Blob(["﻿" + usageReportCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `스마트툴박스_이용현황_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MarketShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-slate-900">이용 현황</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            도구별 이용 횟수와 이용자 수입니다. 이용 기록은 2026년 11월 26일 반영분부터 쌓이며, 그 전 이용은 「누적 조회」에만 들어 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="연도"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13.5px] font-semibold text-slate-700 outline-none focus:border-[#004791]"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={isLoading || isError}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[13.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            엑셀용 파일(CSV)
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-xl bg-slate-200/70" />
            ))}
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-200/60" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <div className="text-[15px] font-bold text-slate-800">이용 현황을 불러오지 못했습니다.</div>
          <p className="mt-2 text-[13px] text-slate-500">
            {error instanceof Error ? error.message : "잠시 뒤 다시 시도해 주세요."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <SummaryTile icon={MousePointerClick} label={`${year}년 이용 횟수`} value={report.totalUses} />
            <SummaryTile icon={Users} label="이용자 수 (조회만 한 사람 포함)" value={report.totalUsers} />
            <SummaryTile icon={Eye} label="게시 도구 상세 조회" value={report.totalDetailViews} />
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1180px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-bold text-slate-500">
                  <th className="px-4 py-2.5">도구</th>
                  <th className="px-3 py-2.5 text-right">이용 횟수</th>
                  <th className="px-3 py-2.5 text-right">비중</th>
                  <th className="px-3 py-2.5 text-right">이용자 수</th>
                  <th className="px-3 py-2.5 text-right">상세 조회</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="px-2 py-2.5 text-right font-semibold">
                      {m}월
                    </th>
                  ))}
                  <th className="border-l border-slate-200 px-3 py-2.5 text-right">누적 조회</th>
                  <th className="px-3 py-2.5 text-right">좋아요</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.key} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <div className="font-bold text-slate-900">{row.name}</div>
                      <div className="text-[11.5px] text-slate-400">
                        {row.kind} · {row.useLabel} 기준
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">{row.uses.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {report.totalUses > 0 ? `${((row.uses / report.totalUses) * 100).toFixed(1)}%` : "–"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{row.users.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      {row.detailViews === null ? "–" : row.detailViews.toLocaleString()}
                    </td>
                    {row.monthly.map((n, i) => (
                      <td key={i} className={"px-2 py-2.5 text-right tabular-nums " + (n > 0 ? "text-slate-700" : "text-slate-300")}>
                        {n > 0 ? n.toLocaleString() : "·"}
                      </td>
                    ))}
                    <td className="border-l border-slate-100 px-3 py-2.5 text-right tabular-nums text-slate-500">{row.totalViews.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{row.totalLikes.toLocaleString()}</td>
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr>
                    <td colSpan={19} className="px-4 py-10 text-center text-slate-400">
                      등록된 도구가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
            이용 횟수 — 툴박스 안 도구는 화면에 들어간 횟수, 외부 웹앱은 「바로가기」를 누른 횟수, 설치형은 내려받은 횟수입니다.
            외부 웹앱·설치 프로그램을 툴박스를 거치지 않고 직접 연 것은 잡히지 않습니다. 이용자 수는 같은 사람을 한 번만 셉니다.
            누적 조회·좋아요는 연도와 무관한 전체 합계입니다.
          </p>
        </>
      )}
    </MarketShell>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eaf2fb] text-[#004791]">
        <Icon className="h-5 w-5" />
      </span>
      <div className="leading-tight">
        <div className="text-[24px] font-extrabold tabular-nums text-slate-900">{value.toLocaleString()}</div>
        <div className="mt-0.5 text-[12px] font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
}
