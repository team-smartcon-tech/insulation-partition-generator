/**
 * .xlsx 안의 파일 하나를 꺼내는 최소한의 ZIP 리더.
 *
 * 왜 직접 쓰나: 도형(순서도)은 `xl/drawings/drawing*.xml` 에 들어 있는데 exceljs 가
 * 이걸 내주지 않는다. 압축 해제 라이브러리를 새로 들이는 대신, 브라우저와 Node 에
 * 모두 있는 `DecompressionStream("deflate-raw")` 을 쓴다. 필요한 건 "이름으로 파일
 * 하나 꺼내기"뿐이라 ZIP 규격 전체를 다룰 이유가 없다.
 *
 * 다루지 않는 것: 암호화, ZIP64(4GB 넘는 압축파일), deflate·무압축 외의 방식.
 * 엑셀 양식 파일에는 나오지 않는다. 만나면 해당 파일만 건너뛴다.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** ZIP 꼬리말은 최대 22 + 65535(주석) 바이트 */
const MAX_EOCD_SCAN = 22 + 0xffff;

interface ZipEntry {
  /** 0 = 무압축, 8 = deflate */
  method: number;
  compressedSize: number;
  localOffset: number;
}

/**
 * 압축파일의 파일 목록을 읽는다.
 *
 * 중앙 디렉터리(끝에 모여 있는 목차)만 읽는다 — 앞에서부터 훑으면 파일마다 헤더를
 * 해석해야 하고, 중간에 하나만 이상해도 뒤가 전부 어긋난다.
 */
export function readZipIndex(data: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const decoder = new TextDecoder("utf-8");
  const index = new Map<string, ZipEntry>();

  // 1) 꼬리말(EOCD)을 뒤에서부터 찾는다.
  let eocd = -1;
  const scanFrom = Math.max(0, data.byteLength - MAX_EOCD_SCAN);
  for (let i = data.byteLength - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return index;

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  // 2) 목차를 훑어 이름 → 위치를 만든다.
  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.byteLength) break;
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    index.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return index;
}

/** 압축파일에서 텍스트 파일 하나를 꺼낸다. 없거나 못 풀면 null. */
export async function readZipText(
  data: ArrayBuffer,
  index: Map<string, ZipEntry>,
  name: string,
): Promise<string | null> {
  const entry = index.get(name);
  if (!entry) return null;

  const view = new DataView(data);
  const at = entry.localOffset;
  if (at + 30 > data.byteLength || view.getUint32(at, true) !== SIG_LOCAL) return null;

  // 지역 헤더의 이름·추가필드 길이는 목차 쪽과 다를 수 있어 여기서 다시 읽는다.
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const start = at + 30 + nameLength + extraLength;
  const body = new Uint8Array(data, start, Math.min(entry.compressedSize, data.byteLength - start));

  if (entry.method === 0) return new TextDecoder("utf-8").decode(body);
  if (entry.method !== 8) return null; // 엑셀이 쓰지 않는 압축 방식

  try {
    const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

// ─── 쓰기 ──────────────────────────────────────────────────
// 양식을 "채운 내용 포함"으로 내려받으려면 원본 .xlsx 에서 **글자만 바꾼 새 파일**이
// 필요하다. 엑셀 라이브러리로 다시 저장하면 우리가 모르는 것(도형·차트·설정)이 통째로
// 날아간다 — 실제로 순서도가 전부 사라졌다. 그래서 건드리지 않는 파일은 **압축된 바이트
// 그대로 복사**하고, 손댄 파일만 다시 압축해 넣는다.

/** 압축파일 안의 파일 하나(원본 바이트 그대로) */
export interface ZipItem {
  name: string;
  /** 0 = 무압축, 8 = deflate */
  method: number;
  crc32: number;
  compressed: Uint8Array;
  uncompressedSize: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 압축파일 안의 모든 파일을 **압축된 채로** 꺼낸다(다시 쓰려고 들고 있는 것이다). */
export function readZipItems(data: ArrayBuffer): ZipItem[] {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const items: ZipItem[] = [];
  for (const [name, entry] of readZipIndex(data)) {
    const at = entry.localOffset;
    if (at + 30 > data.byteLength || view.getUint32(at, true) !== SIG_LOCAL) continue;
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const start = at + 30 + nameLength + extraLength;
    items.push({
      name,
      method: entry.method,
      crc32: view.getUint32(at + 14, true),
      compressed: bytes.slice(start, start + entry.compressedSize),
      uncompressedSize: view.getUint32(at + 22, true),
    });
  }
  return items;
}

/** 글자를 deflate 로 압축한다. 브라우저·Node 에 모두 있는 기본 기능을 쓴다. */
export async function deflateText(text: string): Promise<{ compressed: Uint8Array; raw: Uint8Array }> {
  const raw = new TextEncoder().encode(text);
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return { compressed, raw };
}

/** 파일 목록을 하나의 .xlsx(zip) 바이트로 묶는다. */
export function writeZip(items: ZipItem[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const encoded = items.map((item) => ({ item, name: encoder.encode(item.name) }));

  let size = 0;
  for (const { item, name } of encoded) size += 30 + name.length + item.compressed.length + 46 + name.length;
  size += 22;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];

  for (const { item, name } of encoded) {
    offsets.push(at);
    view.setUint32(at, SIG_LOCAL, true);
    view.setUint16(at + 4, 20, true); // 풀려면 필요한 버전
    view.setUint16(at + 6, 0x0800, true); // 이름이 UTF-8 이다
    view.setUint16(at + 8, item.method, true);
    view.setUint16(at + 10, 0, true); // 시각 — 엑셀은 보지 않는다
    view.setUint16(at + 12, 0, true);
    view.setUint32(at + 14, item.crc32, true);
    view.setUint32(at + 18, item.compressed.length, true);
    view.setUint32(at + 22, item.uncompressedSize, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(item.compressed, at + 30 + name.length);
    at += 30 + name.length + item.compressed.length;
  }

  const centralStart = at;
  encoded.forEach(({ item, name }, index) => {
    view.setUint32(at, SIG_CENTRAL, true);
    view.setUint16(at + 4, 20, true);
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, item.method, true);
    view.setUint16(at + 12, 0, true);
    view.setUint16(at + 14, 0, true);
    view.setUint32(at + 16, item.crc32, true);
    view.setUint32(at + 20, item.compressed.length, true);
    view.setUint32(at + 24, item.uncompressedSize, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint16(at + 30, 0, true); // 추가필드
    view.setUint16(at + 32, 0, true); // 주석
    view.setUint16(at + 34, 0, true); // 디스크 번호
    view.setUint16(at + 36, 0, true); // 내부 속성
    view.setUint32(at + 38, 0, true); // 외부 속성
    view.setUint32(at + 42, offsets[index], true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });

  view.setUint32(at, SIG_EOCD, true);
  view.setUint16(at + 8, encoded.length, true);
  view.setUint16(at + 10, encoded.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  view.setUint16(at + 20, 0, true);
  return out.buffer;
}
