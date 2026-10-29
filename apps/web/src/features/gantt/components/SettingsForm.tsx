/**
 * 현장 설정 폼 (설계 §5): 자원 용량 · 반일 투입(같은 날 오전→오후 연계) · 팀 운영 제약.
 * 값은 부모가 들고(controlled) 저장은 부모가 한다 — 공정표 탭에서는 "저장 없이 바꿔 보기", 설정 탭에서는 저장.
 */
import type { SiteSettings } from "@ipg/gantt-engine";

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
      <Section title="팀 운영 제약">
        <Toggle label="철근팀 오후 단독 투입 불가" checked={s.noPMOnlyStart.rebar} onChange={(v) => set({ noPMOnlyStart: { ...s.noPMOnlyStart, rebar: v } })} />
        <Toggle label="알폼팀 오후 단독 투입 불가" checked={s.noPMOnlyStart.alform} onChange={(v) => set({ noPMOnlyStart: { ...s.noPMOnlyStart, alform: v } })} />
      </Section>
    </div>
  );
}
