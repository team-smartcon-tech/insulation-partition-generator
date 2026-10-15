/** EMF → SVG — 엑셀 "카메라" 그림(7.2)을 브라우저에서 그리려고 옮기는 명령들. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { emfToSvg } from '../apps/web/src/features/forms/emfToSvg.ts';

/** 명령(종류, 32비트 정수들)을 이어 붙여 EMF 바이트를 만든다. */
function emf(records) {
  const parts = [];
  // 헤더: 종류 1, 크기 88, 경계 0,0,99,49, " EMF" 서명
  const header = new DataView(new ArrayBuffer(88));
  header.setUint32(0, 1, true);
  header.setUint32(4, 88, true);
  [0, 0, 99, 49].forEach((v, i) => header.setInt32(8 + i * 4, v, true));
  header.setUint32(40, 0x464d4520, true);
  parts.push(new Uint8Array(header.buffer));
  for (const [type, ints] of records) {
    const view = new DataView(new ArrayBuffer(8 + ints.length * 4));
    view.setUint32(0, type, true);
    view.setUint32(4, 8 + ints.length * 4, true);
    ints.forEach((v, i) => view.setInt32(8 + i * 4, v, true));
    parts.push(new Uint8Array(view.buffer));
  }
  parts.push(new Uint8Array([14, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0, 0]));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

test('EMF 가 아니면 null', () => {
  assert.equal(emfToSvg(new Uint8Array(100)), null);
});

test('선·붓 칠하기를 SVG 로 — 색은 COLORREF(BGR) 를 RGB 로', () => {
  const svg = emfToSvg(
    emf([
      [39, [1, 0, 0x00e7c6b4, 0]], // 붓 1: 단색 #b4c6e7
      [37, [1]], // 붓 고르기
      [76, [0, 0, 0, 0, 0, 0, 50, 20, 0x00f00021, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // BitBlt PATCOPY
      [76, [0, 0, 0, 0, 0, 0, 50, 20, 0x00aa0029, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 대상 그대로 — 칠하지 않음
      [27, [0, 30]], // 이동
      [54, [99, 30]], // 잇기
    ]),
  );
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /viewBox="0 0 100 50"/);
  assert.equal((svg.match(/<rect /g) ?? []).length, 1, 'PATCOPY 만 칠한다');
  assert.match(svg, /fill="#b4c6e7"/);
  assert.match(svg, /<line x1="0" y1="30" x2="99" y2="30"/);
});
