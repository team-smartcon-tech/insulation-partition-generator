/**
 * 산정 파라미터 서랍.
 *
 * 각 기본값 옆에 출처를 적어 둔다 — 숫자의 근거가 보이지 않으면 현장에서 쓰지 않는다.
 */
import { X, RotateCcw } from "lucide-react";
import type { RentalParams } from "../types";
import { DEFAULT_PARAMS } from "../engine/constants";

export default function ParamsDrawer({
  open,
  params,
  onChange,
  onClose,
}: {
  open: boolean;
  params: RentalParams;
  onChange: (next: RentalParams) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const setTc = (k: keyof RentalParams["tc"], v: number) =>
    onChange({ ...params, tc: { ...params.tc, [k]: v } });
  const setHc = (k: keyof RentalParams["hc"], v: number) =>
    onChange({ ...params, hc: { ...params.hc, [k]: v } });
  const setHeight = (k: keyof RentalParams["hc"]["floorHeight"], v: number) =>
    onChange({
      ...params,
      hc: { ...params.hc, floorHeight: { ...params.hc.floorHeight, [k]: v } },
    });

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-[380px] max-w-[90vw] flex-col border-l border-slate-200 bg-white shadow-[-20px_0_50px_-30px_rgba(8,22,52,0.5)]">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h2 className="text-[14.5px] font-bold text-slate-800">산정 파라미터</h2>
            <p className="mt-0.5 text-[13px] text-slate-400">
              바꾸면 임대 구간이 즉시 다시 계산됩니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <Group title="공통">
            <Row label="토요휴무 형식" hint="4층 이상 층당 사이클을 결정합니다">
              <select
                value={params.saturdayOff}
                onChange={(e) =>
                  onChange({ ...params, saturdayOff: e.target.value as RentalParams["saturdayOff"] })
                }
                className="h-8 w-[130px] rounded-lg border border-slate-200 bg-white px-2 text-[14px] text-slate-700 outline-none focus:border-[#0a63b8]"
              >
                <option value="weekly">매주 휴무 (11일/층)</option>
                <option value="biweekly">격주 휴무 (10일/층)</option>
                <option value="none">휴무 없음 (12일/층)</option>
              </select>
            </Row>
            <Row label="유휴 경고 기준" hint="이 일수 이상 비면 경고합니다" unit="일">
              <Num
                value={params.idleWarnDays}
                onChange={(v) => onChange({ ...params, idleWarnDays: v })}
              />
            </Row>
            <Row label="동절기 구간" hint="보양 횟수 산출과 공정표 음영에 쓰입니다">
              <div className="flex items-center gap-1">
                <MonthDay
                  value={params.winter.from}
                  onChange={(v) => onChange({ ...params, winter: { ...params.winter, from: v } })}
                />
                <span className="text-[12.5px] text-slate-400">~</span>
                <MonthDay
                  value={params.winter.to}
                  onChange={(v) => onChange({ ...params, winter: { ...params.winter, to: v } })}
                />
              </div>
            </Row>
          </Group>

          <Group title="타워크레인">
            <Row label="설치 소요" hint="네트워크공정표 표준 40일" unit="일">
              <Num value={params.tc.installDays} onChange={(v) => setTc("installDays", v)} />
            </Row>
            <Row label="골조 착수 전 여유" hint="기초앵커·양생 뒤 가동 대기" unit="일">
              <Num value={params.tc.leadDays} onChange={(v) => setTc("leadDays", v)} />
            </Row>
            <Row
              label="골조 완료 후 가동"
              hint="회사 산정표 — 골조완료 + 1개월(전 동 동일 적용)"
              unit="개월"
            >
              <Num value={params.tc.postFrameMonths} onChange={(v) => setTc("postFrameMonths", v)} />
            </Row>
            <Row label="해체 소요" hint="네트워크공정표 표준 30일" unit="일">
              <Num value={params.tc.dismantleDays} onChange={(v) => setTc("dismantleDays", v)} />
            </Row>
          </Group>

          <Group title="호이스트">
            <Row label="설치 기준층" hint="이 층 골조 완료 후 설치 착수. 동별로 따로 정할 수 있습니다" unit="층">
              <Num value={params.hc.anchorFloor} onChange={(v) => setHc("anchorFloor", v)} />
            </Row>
            <Row label="설치 소요" hint="네트워크공정표 표준 20일" unit="일">
              <Num value={params.hc.installDays} onChange={(v) => setHc("installDays", v)} />
            </Row>
            <Row
              label="골조 완료 후 사용"
              hint="회사 산정표 — 동별 골조완료 + 4개월. 동별로 따로 정할 수 있습니다"
              unit="개월"
            >
              <Num value={params.hc.postFrameMonths} onChange={(v) => setHc("postFrameMonths", v)} />
            </Row>
            <Row label="해체 소요" hint="네트워크공정표 표준 20일" unit="일">
              <Num value={params.hc.dismantleDays} onChange={(v) => setHc("dismantleDays", v)} />
            </Row>
          </Group>

          <Group title="호이스트 층고 기본값">
            <Row
              label="1층"
              hint="② 호기 배정에서 동별로 비워 둔 칸에 쓰입니다"
              unit="m"
            >
              <Dec value={params.hc.floorHeight.first} onChange={(v) => setHeight("first", v)} />
            </Row>
            <Row label="기준층" hint="지상층수 − 2 개층에 곱합니다" unit="m">
              <Dec value={params.hc.floorHeight.typical} onChange={(v) => setHeight("typical", v)} />
            </Row>
            <Row label="최상층" hint="" unit="m">
              <Dec value={params.hc.floorHeight.top} onChange={(v) => setHeight("top", v)} />
            </Row>
            <Row label="연장" hint="최상층 위 여유 — 동과 무관한 표준값" unit="m">
              <Dec
                value={params.hc.extendHeight}
                onChange={(v) => onChange({ ...params, hc: { ...params.hc, extendHeight: v } })}
              />
            </Row>
            <p className="pt-0.5 text-[12px] leading-snug text-slate-400">
              지층은 동마다 기초 레벨이 달라 기본값을 두지 않습니다 — ② 호기 배정에서 동별로
              넣어야 설치높이가 완성됩니다.
            </p>
          </Group>
        </div>

        <footer className="border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_PARAMS)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[14px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            표준값으로 되돌리기
          </button>
        </footer>
      </aside>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[12.5px] font-bold uppercase tracking-wider text-slate-400">{title}</h3>
      <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  unit,
  children,
}: {
  label: string;
  hint?: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 pt-1">
        <div className="text-[14px] font-semibold text-slate-700">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-snug text-slate-400">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {children}
        {unit && <span className="text-[12.5px] text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={0}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="h-8 w-[64px] rounded-lg border border-slate-200 bg-white px-2 text-right text-[14px] tabular-nums text-slate-700 outline-none focus:border-[#0a63b8]"
    />
  );
}

/** 소수 한두 자리까지 받는 입력 — 층고(m) 처럼 정수가 아닌 값 */
function Dec({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={0}
      step={0.01}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="h-8 w-[64px] rounded-lg border border-slate-200 bg-white px-2 text-right text-[14px] tabular-nums text-slate-700 outline-none focus:border-[#0a63b8]"
    />
  );
}

/** "MM-DD" 전용 입력 — 연도 없는 구간이라 date 입력을 쓰지 않는다 */
function MonthDay({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="MM-DD"
      className="h-8 w-[66px] rounded-lg border border-slate-200 bg-white px-2 text-center text-[13.5px] tabular-nums text-slate-700 outline-none focus:border-[#0a63b8]"
    />
  );
}
