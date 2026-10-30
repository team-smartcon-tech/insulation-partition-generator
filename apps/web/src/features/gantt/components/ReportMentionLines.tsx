/**
 * 작업일보 원문에서 그 동 번호가 나오는 줄만, 바로 위 구간 제목과 함께 (골조·마감 칸 팝업 공용, 2026-10-30).
 * 구간 제목: "* 전기(20)", "● 철근콘크리트공사 (124)", "▶ 내장공사(15명)", "1. 형틀 공사 (133)", "[…]"
 */
const HEADER = /^(?:[*•■▶●◆○◎▣]|\d+\s*\.\s)/;

export function linesFor(rawText: string, buildingNo: number): { header: string | null; lines: string[] }[] {
  const mention = new RegExp(`(^|[^\d])${buildingNo}(?!\d)`);
  const out: { header: string | null; lines: string[] }[] = [];
  let header: string | null = null;
  for (const line of rawText.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (HEADER.test(t) || /^\[.*\]$/.test(t)) {
      header = t.replace(/^[*•■▶●◆○◎▣]\s*/, "");
      continue;
    }
    if (!mention.test(t)) continue;
    const last = out.at(-1);
    if (last && last.header === header) last.lines.push(t);
    else out.push({ header, lines: [t] });
  }
  return out;
}

function MentionHighlight({ text, buildingNo }: { text: string; buildingNo: number }) {
  const parts = text.split(new RegExp(`(${buildingNo}\s*동?)`));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function ReportMentionLines({ rawText, buildingNo, label }: { rawText: string; buildingNo: number; label: string }) {
  const raw = linesFor(rawText, buildingNo);
  if (!raw.length) return <p className="text-muted-foreground">원문에 {label}이(가) 나오지 않습니다.</p>;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 leading-6">
      {raw.map((g, i) => (
        <div key={i}>
          {g.header ? <p className="text-xs font-semibold text-muted-foreground">{g.header}</p> : null}
          {g.lines.map((l, j) => (
            <p key={j} className="break-keep">
              <MentionHighlight text={l} buildingNo={buildingNo} />
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
