/**
 * 작업일보 원문에서 그 동 번호가 나오는 줄만, 바로 위 구간 제목과 함께 (골조·마감 칸 팝업 공용, 2026-10-30).
 * 구간 제목: "* 전기(20)", "● 철근콘크리트공사 (124)", "▶ 내장공사(15명)", "1. 형틀 공사 (133)", "[…]"
 */
const HEADER = /^(?:[*•■▶●◆○◎▣]|\d+\s*\.\s)/;

/** 그 동을 가리키는 표기: "101" 과, 줄여 쓴 "1동"·"01동" (부산장안 골조 일보, 2026-11-05) */
const mentionSource = (buildingNo: number) =>
  buildingNo >= 100 ? `${buildingNo}(?!\\d)|0?${buildingNo % 100}(?=\\s*동)` : `${buildingNo}(?!\\d)`;

export function linesFor(rawText: string, buildingNo: number): { header: string | null; lines: string[] }[] {
  const mention = new RegExp(`(?:^|[^\\d])(?:${mentionSource(buildingNo)})`);
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
  // 앞 글자가 숫자인 곳(「2101」)은 표시만 하지 않게 앞 글자를 따로 잡는다
  const parts = text.split(new RegExp(`(^|[^\\d])((?:${mentionSource(buildingNo)})\\s*동?)`));
  return (
    <>
      {parts.map((p, i) =>
        i % 3 === 2 ? (
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

/** 골조 칸 팝업은 골조·전기·기계설비·소방 구간만 (마감 공종 줄은 헷갈려서 뺀다, 2026-11-05 사용자). 제목 없는 줄은 둔다 */
export const FRAME_SECTION = /골조|철근|형틀|콘크리트|거푸집|알폼|갱폼|전기|기계|설비|소방/;

export default function ReportMentionLines({
  rawText,
  buildingNo,
  label,
  section,
}: {
  rawText: string;
  buildingNo: number;
  label: string;
  /** 구간 제목이 이 식에 맞는 줄만 (없으면 전부) */
  section?: RegExp;
}) {
  const raw = linesFor(rawText, buildingNo).filter((g) => !section || g.header == null || section.test(g.header));
  if (!raw.length) return <p className="text-muted-foreground">원문{section ? "의 해당 공종 구간" : ""}에 {label}이(가) 나오지 않습니다.</p>;
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
