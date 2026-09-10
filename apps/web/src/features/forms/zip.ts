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
