/**
 * 결재 서명 — 한 번 등록해 두면 결재할 때 결재칸에 그대로 찍힌다.
 *
 * 그리거나 스캔한 그림을 **서명 모양만 남기고** 다듬는다:
 *  - 흰 바탕은 투명하게 — 결재칸의 테두리·배경 위에 찍혀도 흰 네모가 생기지 않는다.
 *  - 흰 여백은 잘라낸다 — 여백째 칸에 맞추면 서명이 콩알만 해진다.
 *
 * 지금은 이 브라우저에만 저장한다(사용자 id 별). 서버 결재 단계에서 계정에 붙인다.
 */

/** 이 밝기(0~255) 이상이면 바탕으로 본다. 스캔 종이의 누런 흰색도 걸리도록 조금 낮게 잡았다. */
export const PAPER_THRESHOLD = 225;

/**
 * 밝은 픽셀(종이)을 투명하게 만든다. RGBA 배열을 **그 자리에서** 바꾼다.
 * 경계의 옅은 회색은 밝을수록 더 투명하게 — 딱 잘라 버리면 선 가장자리가 톱니처럼 된다.
 */
export function clearPaper(data: Uint8ClampedArray, threshold = PAPER_THRESHOLD): void {
  for (let i = 0; i < data.length; i += 4) {
    const light = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (light >= threshold) {
      data[i + 3] = 0;
    } else if (light > threshold - 60) {
      // 경계: 밝기에 비례해 흐리게
      const keep = (threshold - light) / 60;
      data[i + 3] = Math.round(data[i + 3] * keep);
    }
  }
}

/** 잉크(보이는 픽셀)가 있는 영역. 하나도 없으면 null. */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minAlpha = 16,
): { x: number; y: number; width: number; height: number } | null {
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < minAlpha) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (right < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** 잘라낸 서명을 담을 크기 — 이보다 크면 비율을 지켜 줄인다(저장 용량·결재칸 크기에 충분). */
export const MAX_SIGNATURE = { width: 480, height: 200 };

export function fitSize(width: number, height: number, max = MAX_SIGNATURE): { width: number; height: number } {
  const ratio = Math.min(1, max.width / width, max.height / height);
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/**
 * 캔버스의 그림을 서명 PNG(data URL)로 다듬는다. 잉크가 없으면 null.
 * 브라우저에서만 돈다(캔버스).
 */
export function canvasToSignature(source: HTMLCanvasElement): string | null {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const image = context.getImageData(0, 0, source.width, source.height);
  clearPaper(image.data);
  const bounds = inkBounds(image.data, source.width, source.height);
  if (!bounds) return null;

  // 선이 잘리지 않게 사방에 조금 여유를 둔다.
  const pad = 6;
  const x = Math.max(0, bounds.x - pad);
  const y = Math.max(0, bounds.y - pad);
  const width = Math.min(source.width - x, bounds.width + pad * 2);
  const height = Math.min(source.height - y, bounds.height + pad * 2);

  const cleaned = document.createElement("canvas");
  cleaned.width = source.width;
  cleaned.height = source.height;
  cleaned.getContext("2d")!.putImageData(image, 0, 0);

  const size = fitSize(width, height);
  const out = document.createElement("canvas");
  out.width = size.width;
  out.height = size.height;
  const outContext = out.getContext("2d")!;
  outContext.imageSmoothingQuality = "high";
  outContext.drawImage(cleaned, x, y, width, height, 0, 0, size.width, size.height);
  return out.toDataURL("image/png");
}

// ─── 저장(이 브라우저, 사용자별) ─────────────────────────────

const keyOf = (userId: string) => `ipg-forms:signature:${userId}`;
/** 같은 화면의 다른 곳(헤더 카드·결재 단추)에 등록·삭제를 알린다. */
export const SIGNATURE_EVENT = "ipg-signature-changed";

export function readSignature(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(keyOf(userId));
  } catch {
    return null;
  }
}

/** 저장하거나(data URL) 지운다(null). 저장이 막힌 브라우저면 false. */
export function writeSignature(userId: string, dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(keyOf(userId), dataUrl);
    else localStorage.removeItem(keyOf(userId));
    window.dispatchEvent(new CustomEvent(SIGNATURE_EVENT, { detail: userId }));
    return true;
  } catch {
    return false;
  }
}
