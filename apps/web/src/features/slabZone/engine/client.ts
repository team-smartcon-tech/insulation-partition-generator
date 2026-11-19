/**
 * 슬래브 구분도 워커 호출 — 요청마다 번호를 붙여 응답을 짝짓는다.
 * 도면은 워커가 쥐고 있으므로 화면을 떠날 때 dispose() 로 워커째 버린다.
 */
import type { AnalyzeOptions, AnalyzeResult } from "./analyze.ts";
import type { MarkRule } from "./marks.ts";
import type { Request, Response, SheetDetail } from "./slabZone.worker.ts";

export type { SheetDetail };

type Pending = { resolve: (r: Response & { ok: true }) => void; reject: (e: Error) => void };

export class SlabZoneClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./slabZone.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || "도면 계산 워커 오류");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private call(req: Record<string, unknown>, transfer: Transferable[] = []): Promise<Response & { ok: true }> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id } as Request, transfer);
    });
  }

  async load(buffer: ArrayBuffer, rule: MarkRule): Promise<{ sheets: SheetDetail[]; warnings: string[] }> {
    const r = await this.call({ type: "load", buffer, rule }, [buffer]);
    if (r.type !== "sheets") throw new Error("예상하지 못한 응답입니다.");
    return { sheets: r.sheets, warnings: r.warnings };
  }

  async setRule(rule: MarkRule): Promise<SheetDetail[]> {
    const r = await this.call({ type: "rule", rule });
    if (r.type !== "sheets") throw new Error("예상하지 못한 응답입니다.");
    return r.sheets;
  }

  async analyze(sheetId: number, options: AnalyzeOptions): Promise<AnalyzeResult> {
    const r = await this.call({ type: "analyze", sheetId, options });
    if (r.type !== "result") throw new Error("예상하지 못한 응답입니다.");
    return r.result;
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
