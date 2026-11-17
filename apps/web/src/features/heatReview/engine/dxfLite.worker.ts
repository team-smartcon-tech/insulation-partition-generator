/**
 * DXF 파싱 워커 — 큰 도면을 읽는 동안 화면이 멈추지 않게 하고,
 * 파일 바이트(수십~수백 MB)를 화면 스레드의 메모리와 분리한다.
 */
import { parseDxfLite } from "./dxfLite.ts";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ArrayBuffer>) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

ctx.onmessage = (e) => {
  try {
    const r = parseDxfLite(new Uint8Array(e.data));
    ctx.postMessage({ ok: true, result: r }, [
      r.segs.buffer,
      r.colors.buffer,
      r.loopOff.buffer,
      r.loopPts.buffer,
      r.loopBox.buffer,
      r.textPos.buffer,
    ] as Transferable[]);
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
