/**
 * 한중 기간 (2026-11-02) — 동절기 양생을 11~3월 대신 「일평균기온 4℃ 이하 예상 기간」 으로.
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
    <label className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
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
  const near = site?.latitude != null && site.longitude != null ? nearestColdStations(site.latitude, site.longitude) : [];
  const cw: ColdWeather = value ?? { enabled: false };
  const station = coldStation(cw.stationId);
  const range = coldRangeOf(cw);
  const hasData = COLD_STATIONS.length > 0;

  const toggle = (enabled: boolean) =>
    onChange({ ...cw, enabled, stationId: cw.stationId ?? near[0]?.id ?? null });

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" checked={cw.enabled} onChange={(e) => toggle(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary" />
        <span>
          <span className="block">한중 기간으로 판정 (일평균 4℃ 이하)</span>
          <span className="block text-xs text-muted-foreground">
            {cw.enabled ? (range ? `동절기 양생 ${monthDayLabel(range.start)} ~ ${monthDayLabel(range.end)}` : "기간을 정할 수 없어 11~3월로 계산") : "끄면 11~3월"}
          </span>
        </span>
      </label>
      {cw.enabled ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
          {hasData ? (
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>기준 지점</span>
              <select
                value={cw.stationId ?? ""}
                onChange={(e) => onChange({ ...cw, stationId: e.target.value ? Number(e.target.value) : null })}
                className="h-8 w-44 rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="">고르세요</option>
                {near.length ? (
                  <optgroup label="현장 가까운 곳">
                    {near.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.km}km
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="전체">
                  {[...COLD_STATIONS]
                    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
          ) : (
            <p className="text-xs text-amber-700">10년 평균 자료가 아직 없습니다. 기간을 직접 넣으세요.</p>
          )}
          {hasData && !near.length ? <p className="text-xs text-muted-foreground">스마트웍스에 현장 좌표가 없어 가까운 지점을 추천하지 못했습니다.</p> : null}
          {station ? (
            <>
              <p className="text-xs">
                <b>{station.name}</b> {station.winters} 10겨울 평균 4℃ 이하:{" "}
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">현장 지정</span>
            <MonthDayInput label="시작" value={cw.range?.start ?? station?.start ?? ""} onValue={(v) => onChange({ ...cw, range: { start: v, end: cw.range?.end ?? station?.end ?? v } })} />
            <MonthDayInput label="끝" value={cw.range?.end ?? station?.end ?? ""} onValue={(v) => onChange({ ...cw, range: { start: cw.range?.start ?? station?.start ?? v, end: v } })} />
            {cw.range && station?.start ? (
              <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => onChange({ ...cw, range: null })}>
                10년 평균으로
              </button>
            ) : null}
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
