/**
 * 한중 기간 (2026-11-02) — 「일평균기온 4℃ 이하 예상 기간」. 이 기간 타설은 보온양생 2일(갱폼 타설일+3일), 그 밖 11~3월은 양생일 +1 그대로 (2026-11-05).
 * 기간은 기준 지점(스마트웍스 날씨 API 의 기상청 5km 격자) 최근 10겨울 평균(엔진 kma-cold-normals, 자동 생성)에서 오고,
 * 현장마다 직접 고칠 수 있다(품질관리계획 「현장별 지정」). 지점 추천은 스마트웍스 현장 좌표 기준 가까운 순.
 */
import { useEffect, useState } from "react";
import {
  COLD_STATIONS,
  coldRangeOf,
  coldStation,
  monthDayLabel,
  nearestColdStations,
  type ColdStation,
  type SiteSettings,
} from "@ipg/gantt-engine";
import { useSites } from "../hooks";

type ColdWeather = NonNullable<SiteSettings["coldWeather"]>;

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 스마트웍스 현장 주소 → 지역명 ("강원특별자치도 원주시 무실동 2002" → "원주시 무실동", "부산광역시 기장군 장안읍 …" → "부산 기장군 장안읍") */
function regionOf(location: string | null | undefined): string | null {
  const words = (location ?? "").split(/\s+/).filter((w) => w && !/\d/.test(w));
  if (!words.length) return null;
  const [head, ...rest] = words;
  const city = head.match(/^(.+?)(광역시|특별시|특별자치시)$/);
  if (city) return [city[1], ...rest.slice(0, 2)].join(" ");
  if (/도$/.test(head) && rest.length) return rest.slice(0, 2).join(" ");
  return words.slice(0, 2).join(" ");
}

/** 7월 상순부터 — 겨울이 가운데 오게 */
const DEKAD_ORDER = Array.from({ length: 36 }, (_, i) => (i + 18) % 36);

function DekadStrip({ station }: { station: ColdStation }) {
  return (
    <div>
      <div className="flex h-5 gap-px" aria-label="순별 평균기온 (7월 → 6월, 10월 중순~4월 중순만)">
        {DEKAD_ORDER.map((d) => {
          const t = station.dekads[d];
          const m = Math.floor(d / 3) + 1;
          const part = ["상", "중", "하"][d % 3];
          const cls = t == null ? "bg-transparent" : t <= 0 ? "bg-blue-600" : t <= 4 ? "bg-blue-400" : t <= 10 ? "bg-slate-300" : "bg-slate-100";
          return <span key={d} title={t == null ? `${m}월 ${part}순 자료 없음` : `${m}월 ${part}순 ${t}℃`} className={`flex-1 rounded-[1px] ${cls}`} />;
        })}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>7월</span>
        <span>10월</span>
        <span>1월</span>
        <span>4월</span>
        <span>6월</span>
      </div>
    </div>
  );
}

function MonthDayInput({ label, value, onValue }: { label: string; value: string; onValue: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const bad = text !== "" && !MONTH_DAY.test(text);
  return (
    // 부모 grid 의 「라벨 | 입력」 두 칸에 그대로 놓이게 contents (시작·끝 열맞춤)
    <label className="contents text-xs">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        value={text}
        placeholder="MM-DD"
        aria-label={`한중 기간 ${label}`}
        onChange={(e) => {
          setText(e.target.value);
          if (MONTH_DAY.test(e.target.value)) onValue(e.target.value);
        }}
        className={`h-7 w-16 rounded-md border bg-card px-1.5 text-center text-sm ${bad ? "border-red-400" : "border-input"}`}
      />
    </label>
  );
}

export default function ColdWeatherFields({
  siteId,
  value,
  onChange,
}: {
  siteId?: string | null;
  value: SiteSettings["coldWeather"];
  onChange: (next: ColdWeather) => void;
}) {
  const sites = useSites();
  const site = sites.data?.sites.find((s) => s.id === siteId) ?? null;
  const near = site?.latitude != null && site.longitude != null ? nearestColdStations(site.latitude, site.longitude, 1) : [];
  const cw: ColdWeather = value ?? { enabled: false };
  const station = coldStation(cw.stationId);
  const range = coldRangeOf(cw);
  const hasData = COLD_STATIONS.length > 0;
  const nearest = near[0] ?? null;

  // 기준 지점은 고르지 않는다 (2026-11-05 사용자) — 현장 좌표에서 가장 가까운 지점으로 맞춘다
  useEffect(() => {
    if (cw.enabled && nearest && cw.stationId !== nearest.id) onChange({ ...cw, stationId: nearest.id });
  }, [cw, nearest, onChange]);

  const toggle = (enabled: boolean) =>
    onChange({ ...cw, enabled, stationId: nearest?.id ?? cw.stationId ?? null });

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" checked={cw.enabled} onChange={(e) => toggle(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary" />
        <span>
          <span className="block">한중 기간으로 판정 (일평균 4℃ 이하)</span>
          <span className="block text-xs text-muted-foreground">
            {cw.enabled
              ? range
                ? `${monthDayLabel(range.start)} ~ ${monthDayLabel(range.end)} 타설은 보온양생 2일(갱폼 타설일+3일). 그 밖 11~3월은 양생일 +1 그대로`
                : "기간을 정할 수 없어 보온양생 2일을 적용하지 않음"
              : "소요강도 도달 후 2일간 0℃ 이상 유지"}
          </span>
        </span>
      </label>
      {cw.enabled ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
          {!hasData ? <p className="text-xs text-amber-700">10년 평균 자료가 아직 없습니다. 기간을 직접 넣으세요.</p> : null}
          {hasData && !nearest && !station ? (
            <p className="text-xs text-muted-foreground">스마트웍스에 현장 좌표가 없어 기준 지역을 정하지 못했습니다. 기간을 직접 넣으세요.</p>
          ) : null}
          {station ? (
            <>
              <p className="text-sm">
                <span className="text-muted-foreground">기준 지역</span> <b>{regionOf(site?.location) ?? station.name}</b>
                {nearest && nearest.km >= 10 ? <span className="text-xs text-muted-foreground"> (가장 가까운 자료 {nearest.km}km)</span> : null}
              </p>
              <p className="text-xs">
                {station.winters} 10겨울 평균 4℃ 이하:{" "}
                {station.start && station.end ? (
                  <b>
                    {monthDayLabel(station.start)} ~ {monthDayLabel(station.end)}
                  </b>
                ) : (
                  "없음"
                )}{" "}
                <span className="text-muted-foreground">(7일 평균 최저 {station.minTemp}℃)</span>
              </p>
              <DekadStrip station={station} />
            </>
          ) : null}
          <div className="grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-2 gap-y-1">
            <span className="text-xs text-muted-foreground">현장 지정</span>
            <MonthDayInput label="시작" value={cw.range?.start ?? station?.start ?? ""} onValue={(v) => onChange({ ...cw, range: { start: v, end: cw.range?.end ?? station?.end ?? v } })} />
            <span />
            <span />
            <MonthDayInput label="종료" value={cw.range?.end ?? station?.end ?? ""} onValue={(v) => onChange({ ...cw, range: { start: cw.range?.start ?? station?.start ?? v, end: v } })} />
            {cw.range && station?.start ? (
              <button type="button" className="justify-self-start text-xs text-primary underline-offset-2 hover:underline" onClick={() => onChange({ ...cw, range: null })}>
                10년 평균으로
              </button>
            ) : (
              <span />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            스마트웍스 날씨(기상청 5km 격자)의 날짜별 (최저+최고)/2 를 10겨울 평균 내 7일 이동평균한 값입니다. 하루 24시간 평균보다 조금 높게 나와 기간이
            며칠 짧을 수 있습니다. 동절기 품질관리계획에서 기간을 정했으면 그 날짜를 넣으세요.
          </p>
        </div>
      ) : null}
    </div>
  );
}
