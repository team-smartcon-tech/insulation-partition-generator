/**
 * 이용 현황 계산 — 서버 집계(tool_usage_summary)를 화면 표의 행으로 바꾼다. 순수 함수.
 *
 * 도구마다 "이용"으로 치는 기록이 다르다:
 *   - 내장 도구(tools.ts)                    → 그 화면에 들어간 횟수   (tool:{id} · open)
 *   - 게시 도구 · 툴박스 안 경로(/tools/x)   → 위와 같다. 그 도구 화면 진입이 곧 이용 (tool:{x} · open)
 *   - 게시 도구 · 외부 웹앱                  → 「바로가기」를 누른 횟수 (market:{uuid} · launch)
 *   - 게시 도구 · 설치형                     → 내려받은 횟수           (market:{uuid} · download)
 * 한 행은 (카드 키, 종류) 한 쌍에서만 값을 가져온다 — 이용자 수는 중복 제거 값이라 여러 쌍을 더할 수 없다.
 */
import type { ToolCardStat, UsageSummaryRow } from "./api";

/** 이용 기록이 쌓이기 시작한 해 — 연도 선택은 여기부터 */
export const USAGE_LOG_START_YEAR = 2026;

/** 계산에 필요한 도구 정보만 (tools.ts ToolDef · types.ts MarketAppSummary 의 부분집합) */
export interface UsageTool {
  id: string;
  name: string;
  path: string;
  status: string;
}
export interface UsageApp {
  id: string;
  title: string;
  deploy_url: string | null;
  distribution: string;
  view_count: number;
  like_count: number;
}

export interface UsageReportRow {
  key: string;
  name: string;
  /** 내장 도구 / 게시 웹앱 / 게시 설치형 */
  kind: string;
  /** 이용 횟수를 무엇으로 셌는지 (화면 진입 / 바로가기 / 다운로드) */
  useLabel: string;
  uses: number;
  users: number;
  /** 1~12월 이용 횟수 */
  monthly: number[];
  /** 게시 도구 상세 화면 조회(그 해). 내장 도구는 상세 화면이 없어 null */
  detailViews: number | null;
  /** 카드에 보이는 누적 조회·좋아요 (연도 무관) */
  totalViews: number;
  totalLikes: number;
}

export interface UsageReport {
  rows: UsageReportRow[];
  totalUses: number;
  /** 그 해 한 번이라도 기록이 남은 사람 수 (조회만 한 사람 포함) */
  totalUsers: number;
  totalDetailViews: number;
}

const INTERNAL_PATH = /^\/tools\/([a-z0-9-]+)$/;

export function buildUsageReport(
  tools: UsageTool[],
  apps: UsageApp[],
  toolStats: Record<string, ToolCardStat>,
  summary: UsageSummaryRow[],
): UsageReport {
  // (카드 키 · 종류) → 연간 / 월별
  const yearly = new Map<string, { cnt: number; users: number }>();
  const monthly = new Map<string, number[]>();
  let totalUsers = 0;
  for (const r of summary) {
    if (r.card_key === null || r.event === null) {
      totalUsers = Number(r.users) || 0;
      continue;
    }
    const id = `${r.card_key}|${r.event}`;
    if (r.month === null) {
      yearly.set(id, { cnt: Number(r.cnt) || 0, users: Number(r.users) || 0 });
    } else if (r.month >= 1 && r.month <= 12) {
      const arr = monthly.get(id) ?? new Array<number>(12).fill(0);
      arr[r.month - 1] = Number(r.cnt) || 0;
      monthly.set(id, arr);
    }
  }
  const pick = (id: string) => ({
    ...(yearly.get(id) ?? { cnt: 0, users: 0 }),
    monthly: monthly.get(id) ?? new Array<number>(12).fill(0),
  });

  const rows: UsageReportRow[] = [];

  // 게시된 내장 도구는 게시 카드 한 줄로만 낸다(홈 카드와 같은 기준)
  const publishedPaths = new Set(apps.map((a) => a.deploy_url).filter((u): u is string => !!u?.startsWith("/")));
  for (const tool of tools) {
    if (tool.status !== "available" || publishedPaths.has(tool.path)) continue;
    const key = `tool:${tool.id}`;
    const use = pick(`${key}|open`);
    rows.push({
      key,
      name: tool.name,
      kind: "내장 도구",
      useLabel: "화면 진입",
      uses: use.cnt,
      users: use.users,
      monthly: use.monthly,
      detailViews: null,
      totalViews: toolStats[key]?.views ?? 0,
      totalLikes: toolStats[key]?.likes ?? 0,
    });
  }

  for (const app of apps) {
    const key = `market:${app.id}`;
    const internal = app.deploy_url ? INTERNAL_PATH.exec(app.deploy_url)?.[1] : undefined;
    const isDownload = app.distribution === "download";
    const use = isDownload
      ? pick(`${key}|download`)
      : internal
        ? pick(`tool:${internal}|open`)
        : pick(`${key}|launch`);
    rows.push({
      key,
      name: app.title,
      kind: isDownload ? "게시 설치형" : "게시 웹앱",
      useLabel: isDownload ? "다운로드" : internal ? "화면 진입" : "바로가기",
      uses: use.cnt,
      users: use.users,
      monthly: use.monthly,
      detailViews: yearly.get(`${key}|view`)?.cnt ?? 0,
      totalViews: app.view_count,
      totalLikes: app.like_count,
    });
  }

  // 많이 쓴 순 — 같으면 이름순으로 고정
  rows.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, "ko"));

  return {
    rows,
    totalUses: rows.reduce((sum, r) => sum + r.uses, 0),
    totalUsers,
    totalDetailViews: rows.reduce((sum, r) => sum + (r.detailViews ?? 0), 0),
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 표를 CSV 로 — 엑셀에서 열어 연말 보고에 쓴다 */
export function usageReportCsv(report: UsageReport): string {
  const header = [
    "도구",
    "구분",
    "이용 기준",
    "이용 횟수",
    "비중(%)",
    "이용자 수",
    "상세 조회",
    ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
    "누적 조회",
    "좋아요",
  ];
  const lines = report.rows.map((r) =>
    [
      r.name,
      r.kind,
      r.useLabel,
      r.uses,
      report.totalUses > 0 ? ((r.uses / report.totalUses) * 100).toFixed(1) : "",
      r.users,
      r.detailViews ?? "",
      ...r.monthly,
      r.totalViews,
      r.totalLikes,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}
