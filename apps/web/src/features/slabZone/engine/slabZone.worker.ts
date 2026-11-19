/**
 * 슬래브 구분도 워커 — 도면(수십 MB)과 펼친 선 배열을 워커 안에만 두고,
 * 화면에는 목록(도면·기호·도면층)과 계산 결과 그림만 보낸다.
 */
import { parseDxfLite, type LiteDxf } from "../../heatReview/engine/dxfLite.ts";
import {
  analyzeSheet,
  collectBeamMarks,
  collectMarks,
  findSheets,
  summarizeLayers,
  summarizeMarks,
  type AnalyzeOptions,
  type AnalyzeResult,
  type BeamMark,
  type LayerInfo,
  type Mark,
  type MarkSummary,
  type SheetInfo,
} from "./analyze.ts";
import type { MarkRule } from "./marks.ts";

export interface SheetDetail {
  sheet: SheetInfo;
  layers: LayerInfo[];
  marks: MarkSummary[];
}

export type Request =
  | { id: number; type: "load"; buffer: ArrayBuffer; rule: MarkRule }
  | { id: number; type: "rule"; rule: MarkRule }
  | { id: number; type: "analyze"; sheetId: number; options: AnalyzeOptions };

export type Response =
  | { id: number; ok: true; type: "sheets"; sheets: SheetDetail[]; warnings: string[] }
  | { id: number; ok: true; type: "result"; result: AnalyzeResult }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage: (msg: Response, transfer?: Transferable[]) => void;
};

let dxf: LiteDxf | null = null;
let marks: Mark[] = [];
let beams: BeamMark[] = [];
let sheets: SheetInfo[] = [];
let sheetOf = new Int32Array(0);

const marksOf = (sheetId: number) => marks.filter((_, i) => sheetOf[i] === sheetId);

function index(rule: MarkRule): SheetDetail[] {
  if (!dxf) return [];
  marks = collectMarks(dxf, rule);
  const found = findSheets(dxf, marks);
  sheets = found.sheets;
  sheetOf = found.sheetOf;
  return sheets.map((sheet) => {
    const ms = marksOf(sheet.id);
    return { sheet, layers: summarizeLayers(dxf!, sheet.box, ms), marks: summarizeMarks(ms) };
  });
}

ctx.onmessage = (e) => {
  const req = e.data;
  try {
    if (req.type === "load") {
      dxf = parseDxfLite(new Uint8Array(req.buffer), { layerIndex: true });
      beams = collectBeamMarks(dxf);
      ctx.postMessage({ id: req.id, ok: true, type: "sheets", sheets: index(req.rule), warnings: dxf.warnings });
    } else if (req.type === "rule") {
      ctx.postMessage({ id: req.id, ok: true, type: "sheets", sheets: index(req.rule), warnings: [] });
    } else {
      const sheet = sheets.find((s) => s.id === req.sheetId);
      if (!dxf || !sheet) throw new Error("도면을 먼저 불러와 주세요.");
      const [x0, y0, x1, y1] = sheet.box;
      const sheetBeams = beams.filter((b) => b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1);
      const result = analyzeSheet(dxf, sheet, marksOf(sheet.id), sheetBeams, req.options);
      ctx.postMessage({ id: req.id, ok: true, type: "result", result }, [result.rgba.buffer as ArrayBuffer]);
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
