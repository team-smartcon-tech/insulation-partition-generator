/**
 * 서명 등록 창 — 칸 안에 서명을 그리거나, 스캔한 이미지·PDF 를 불러온다.
 *
 * 불러온 그림도 같은 칸에 그려 보여 준다 — "이게 등록될 서명"을 눈으로 보고 누르게 하려는 것.
 * [등록]을 누를 때 흰 바탕을 투명하게 하고 여백을 잘라 저장한다(`signature.ts`).
 */
import { useEffect, useRef, useState } from "react";
import { Check, Eraser, PenLine, Upload, X } from "lucide-react";
import { SIGNATURE_EVENT, canvasToSignature, readSignature } from "./signature";

/** 그리기 칸의 실제 픽셀 크기. 화면 폭에 맞춰 늘어나도 이 해상도로 그린다(선이 뭉개지지 않게). */
const PAD = { width: 920, height: 320 };

/** 이 사용자의 등록된 서명. 다른 곳에서 등록·삭제하면 따라 바뀐다. */
export function useSignature(userId: string | undefined): string | null {
  const [signature, setSignature] = useState(() => readSignature(userId));
  useEffect(() => {
    setSignature(readSignature(userId));
    const refresh = () => setSignature(readSignature(userId));
    window.addEventListener(SIGNATURE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SIGNATURE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [userId]);
  return signature;
}

/** PDF 첫 쪽을 그림으로. PDF 읽기는 무거워 이때만 내려받는다. */
async function renderPdfFirstPage(file: File): Promise<HTMLCanvasElement> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  await pdf.destroy();
  return canvas;
}

export default function SignatureDialog({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  /** 다듬은 서명 PNG(data URL) */
  onSave: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  /**
   * 불러온 파일을 **원래 해상도로** 들고 있는다. 칸에는 줄여서 보여 주지만, 등록은 이것으로 한다 —
   * A4 한 장을 칸 크기로 줄인 뒤 서명만 잘라 내면 서명이 몇십 픽셀로 뭉개진다.
   * 불러온 뒤 칸에 더 그리면 둘을 합칠 수 없어 칸에 보이는 그림으로 등록한다.
   */
  const loaded = useRef<HTMLCanvasElement | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const context = () => canvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null;

  function clear() {
    const ctx = context();
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PAD.width, PAD.height);
    setHasInk(false);
    setMessage(null);
    loaded.current = null;
  }

  useEffect(clear, []);

  /** 화면 좌표 → 캔버스 픽셀 좌표(칸이 화면 폭에 맞춰 늘고 줄어도 맞게). */
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD.width,
      y: ((event.clientY - rect.top) / rect.height) * PAD.height,
    };
  }

  function drawTo(next: { x: number; y: number }) {
    const ctx = context();
    const from = drawing.current;
    if (!ctx || !from) return;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    drawing.current = next;
  }

  async function loadFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const source: CanvasImageSource =
        file.type === "application/pdf" || /\.pdf$/i.test(file.name)
          ? await renderPdfFirstPage(file)
          : await createImageBitmap(file);
      const width = "width" in source ? Number(source.width) : PAD.width;
      const height = "height" in source ? Number(source.height) : PAD.height;
      clear();
      const ctx = context();
      if (!ctx) return;
      // 칸에 맞게 줄여 가운데에 놓는다(키우지는 않는다 — 작은 스캔을 키우면 뭉개진다).
      const ratio = Math.min(1, PAD.width / width, PAD.height / height);
      const w = width * ratio;
      const h = height * ratio;
      ctx.drawImage(source, (PAD.width - w) / 2, (PAD.height - h) / 2, w, h);
      const original = document.createElement("canvas");
      original.width = width;
      original.height = height;
      const originalContext = original.getContext("2d", { willReadFrequently: true })!;
      originalContext.fillStyle = "#fff";
      originalContext.fillRect(0, 0, width, height);
      originalContext.drawImage(source, 0, 0);
      loaded.current = original;
      setHasInk(true);
    } catch (error) {
      setMessage(error instanceof Error ? `파일을 읽지 못했습니다: ${error.message}` : "파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvasToSignature(loaded.current ?? canvas);
    if (!dataUrl) {
      setMessage("서명이 보이지 않습니다. 칸 안에 서명을 그리거나 파일을 불러오세요.");
      return;
    }
    onSave(dataUrl);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-2">
          <PenLine size={18} className="mt-0.5 text-slate-700" aria-hidden />
          <h2 id="signature-title" className="flex-1 text-lg font-bold text-slate-900">
            서명 등록
          </h2>
          <button type="button" onClick={onCancel} aria-label="닫기" className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          아래 영역에 서명을 그리거나, 스캔한 이미지·PDF 를 불러오세요. 등록된 서명은 결재할 때 결재칸에 들어갑니다.
        </p>

        <canvas
          ref={canvasRef}
          width={PAD.width}
          height={PAD.height}
          aria-label="서명 그리는 칸"
          className="mt-4 aspect-[920/320] w-full cursor-crosshair touch-none rounded-xl border border-slate-200 bg-white"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drawing.current = point(event);
            loaded.current = null;
            // 점 하나만 찍어도 보이게
            drawTo({ ...drawing.current, x: drawing.current.x + 0.1 });
            setHasInk(true);
          }}
          onPointerMove={(event) => {
            if (drawing.current) drawTo(point(event));
          }}
          onPointerUp={() => {
            drawing.current = null;
          }}
          onPointerCancel={() => {
            drawing.current = null;
          }}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void loadFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-300"
          >
            <Upload size={14} /> {busy ? "읽는 중..." : "이미지·PDF 불러오기"}
          </button>
          <span className="ml-auto text-[11px] text-slate-400">흰 여백은 자동으로 잘립니다 · PDF 는 1쪽만</span>
        </div>

        {message && <p className="mt-2 text-xs text-rose-600">{message}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            <Eraser size={15} /> 지우기
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!hasInk || busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0b4a8b] py-2 text-sm font-semibold text-white hover:bg-[#083a6e] disabled:bg-slate-300"
          >
            <Check size={15} /> 등록
          </button>
        </div>
      </div>
    </div>
  );
}
