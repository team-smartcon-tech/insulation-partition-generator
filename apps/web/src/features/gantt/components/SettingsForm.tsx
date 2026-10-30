/**
 * 현장 설정 폼 (설계 §5): 자원 용량 · 반일 투입(같은 날 오전→오후 연계) · 팀 운영 제약.
 * 값은 부모가 들고(controlled) 저장은 부모가 한다 — 공정표 탭에서는 "저장 없이 바꿔 보기", 설정 탭에서는 저장.
 */
import { DEFAULT_UNDERGROUND_SETTINGS, type SiteSettings, type UndergroundSettings } from "@ipg/gantt-engine";
import { NumInput } from "./StepInput";

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 rounded border-input accent-primary" />
      <span>
        <span className="block">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function Num({ label, value, options, onChange }: { label: string; value: number | string; options: { value: number | string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} className="h-8 w-36 rounded-md border border-input bg-card px-2 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 작업일 수 입력 — 동 목록 카드와 같은 화살표 칸 (NumInput) */
function Days({ label, hint, value, min = 0, onChange }: { label: string; hint?: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>
        <span className="block">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="flex items-center gap-1">
        <NumInput className="w-16" min={min} max={60} value={value} aria-label={label} onValue={(v) => v != null && onChange(v)} />
        <span className="w-4 text-xs text-muted-foreground">일</span>
      </span>
    </div>
  );
}

const counts = (max: number, unit: string) => Array.from({ length: max }, (_, i) => ({ value: i + 1, label: `${i + 1}${unit}` }));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function SettingsForm({ value, onChange }: { value: SiteSettings; onChange: (next: SiteSettings) => void }) {
  const s = value;
  const set = (patch: Partial<SiteSettings>) => onChange({ ...s, ...patch });
  return (
    <div className="space-y-3">
      <Section title="자원 용량">
        <Num label="철근팀" value={s.rebarTeams} options={counts(3, "팀")} onChange={(v) => set({ rebarTeams: Number(v) })} />
        <Num label="알폼팀" value={s.alformTeams} options={counts(3, "팀")} onChange={(v) => set({ alformTeams: Number(v) })} />
        <Num
          label="갱폼인양 단위"
          value={s.gangform.per}
          options={[
            { value: "day", label: "하루 N동" },
            { value: "slot", label: "반일 N동" },
          ]}
          onChange={(v) => set({ gangform: { ...s.gangform, per: v === "day" ? "day" : "slot" } })}
        />
        <Num label="갱폼인양 N" value={s.gangform.count} options={counts(3, "동")} onChange={(v) => set({ gangform: { ...s.gangform, count: Number(v) } })} />
        <Num label="1일 타설" value={s.pourPerDay} options={counts(3, "동")} onChange={(v) => set({ pourPerDay: Number(v) })} />
        <Toggle label="철근팀 벽 오전 + 슬래브 오후 병행" hint="끄면 벽·슬래브가 각 하루" checked={s.rebarWallAndSlabSameDay} onChange={(v) => set({ rebarWallAndSlabSameDay: v })} />
      </Section>
      <Section title="반일 투입 (같은 날 오전→오후 연계)">
        <Toggle label="먹매김 오전 완료 시 오후 갱폼인양" checked={s.halfDay.gangformPMAfterMarking} onChange={(v) => set({ halfDay: { ...s.halfDay, gangformPMAfterMarking: v } })} />
        <Toggle label="갱폼 오전 완료 시 오후 벽철근" checked={s.halfDay.wallRebarPM} onChange={(v) => set({ halfDay: { ...s.halfDay, wallRebarPM: v } })} />
        <Toggle label="알폼 오후 투입 (오후 + 다음날 오전)" checked={s.halfDay.alformPMStart} onChange={(v) => set({ halfDay: { ...s.halfDay, alformPMStart: v } })} />
        <Toggle label="슬래브철근 오후 가능" hint="기전·검측이 다음날 오전으로 밀림" checked={s.halfDay.slabRebarPM} onChange={(v) => set({ halfDay: { ...s.halfDay, slabRebarPM: v } })} />
      </Section>
      <UndergroundSection value={s.underground ?? DEFAULT_UNDERGROUND_SETTINGS} onChange={(underground) => set({ underground })} />
      <Section title="팀 운영 제약">
        <Toggle label="철근팀 오후 단독 투입 불가" checked={s.noPMOnlyStart.rebar} onChange={(v) => set({ noPMOnlyStart: { ...s.noPMOnlyStart, rebar: v } })} />
        <Toggle label="알폼팀 오후 단독 투입 불가" checked={s.noPMOnlyStart.alform} onChange={(v) => set({ noPMOnlyStart: { ...s.noPMOnlyStart, alform: v } })} />
      </Section>
    </div>
  );
}

/**
 * 지하층 · 저층(1층~기준층 시작 전) 공정 — 재래식 한 층 순서표의 공종별 작업일 (설계 §8-2 2안).
 * 지하와 저층은 따로 둔다(2026-10-30 사용자 요청). 지하 기본값 = 남원주 2차 실적 중앙값, 저층 기본값은 아직 근거가 없어 지하와 같다.
 */
type UgDurations = UndergroundSettings["durations"];

function SequenceFields({
  d,
  separateWallPour,
  onDurations,
  onSeparate,
}: {
  d: UgDurations;
  separateWallPour: boolean;
  onDurations: (patch: Partial<UgDurations>) => void;
  onSeparate: (v: boolean) => void;
}) {
  return (
    <>
      <Days label="W철근" min={1} value={d.wallRebar} onChange={(v) => onDurations({ wallRebar: v })} />
      <Days label="W기전" hint="W철근과 병행" value={d.wallMep} onChange={(v) => onDurations({ wallMep: v })} />
      <Days label="W거푸집" min={1} value={d.formWall} onChange={(v) => onDurations({ formWall: v })} />
      <Days label="시스템" hint="시스템 동바리" value={d.shoring} onChange={(v) => onDurations({ shoring: v })} />
      <Days label="S거푸집" min={1} value={d.formSlab} onChange={(v) => onDurations({ formSlab: v })} />
      <Days label="S철근" min={1} value={d.slabRebar} onChange={(v) => onDurations({ slabRebar: v })} />
      <Days label="S기전" hint="S철근과 병행" value={d.slabMep} onChange={(v) => onDurations({ slabMep: v })} />
      <Toggle label="벽·기둥 분리 타설 (W타설 1일)" hint="끄면 S타설 때 함께" checked={separateWallPour} onChange={onSeparate} />
    </>
  );
}

function UndergroundSection({ value, onChange }: { value: UndergroundSettings; onChange: (v: UndergroundSettings) => void }) {
  // 저장된 설정에 저층 값이 없으면 엔진은 지하 값을 쓴다 — 화면도 같은 값을 보여 준다
  const low = value.lowRise ?? { durations: value.durations, separateWallPour: value.separateWallPour };
  return (
    <>
      <Section title="지하층 공정 (재래식, 한 층당 작업일)">
        <p className="-mt-1 text-xs text-muted-foreground">
          순서: W철근∥W기전 → W거푸집 → 시스템 → S거푸집 → S철근∥S기전 → S타설. ∥ 는 같은 날 시작해 병행. 기본값은 남원주 2차 일보 실적 중앙값.
        </p>
        <SequenceFields
          d={value.durations}
          separateWallPour={value.separateWallPour}
          onDurations={(patch) => onChange({ ...value, durations: { ...value.durations, ...patch } })}
          onSeparate={(v) => onChange({ ...value, separateWallPour: v })}
        />
      </Section>
      <Section title="저층 공정 (1층 ~ 기준층 시작 전, 한 층당 작업일)">
        <p className="-mt-1 text-xs text-muted-foreground">필로티·상가 등. 순서는 지하와 같고 일수만 따로. 따로 넣기 전에는 지하 값과 같다.</p>
        <SequenceFields
          d={low.durations}
          separateWallPour={low.separateWallPour}
          onDurations={(patch) => onChange({ ...value, lowRise: { ...low, durations: { ...low.durations, ...patch } } })}
          onSeparate={(v) => onChange({ ...value, lowRise: { ...low, separateWallPour: v } })}
        />
        <Days label="기준층 전환" hint="저층 끝 → 갱폼 설치 등 (가정값)" value={value.transitionDays} onChange={(v) => onChange({ ...value, transitionDays: v })} />
      </Section>
    </>
  );
}
