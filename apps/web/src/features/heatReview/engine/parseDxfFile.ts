/**
 * DXF 파일 → LiteDxf. 워커에서 파싱하고, 워커를 못 띄우는 환경이면 화면 스레드에서 한다.
 */
import { parseDxfLite, type LiteDxf } from "./dxfLite";

export function parseDxfBuffer(buffer: ArrayBuffer): Promise<LiteDxf> {
  return new Promise<LiteDxf>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./dxfLite.worker.ts", import.meta.url), { type: "module" });
    } catch {
      try {
        resolve(parseDxfLite(new Uint8Array(buffer)));
      } catch (err) {
        reject(err);
      }
      return;
    }
    worker.onmessage = (e: MessageEvent<{ ok: true; result: LiteDxf } | { ok: false; error: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "도면 파싱 워커 오류"));
    };
    // 바이트는 워커로 넘겨 버린다(복사하지 않는다) — 화면 쪽에는 결과만 남는다
    worker.postMessage(buffer, [buffer]);
  });
}
