// 이 파일이 하는 일: 바코드 사진 해독(FR-130, phase-06-task-01 AC2)을 브라우저 없이 확인한다. 화면이 쓰는 해독 핵심(web/src/pages/inventory/barcodeCore.ts)에
// tests/fixtures/barcode/의 사진처럼 만든 PNG(EAN-13·Code128·QR·세로로 찍은 EAN-13·바코드 없는 사진)를 넣어 글자와 형식이 맞는지 본다.
// 저장된 PNG가 생성 스크립트(make-barcodes.ts) 결과와 같은지도 확인해, fixture를 다시 만드는 방법이 기록과 맞는지 보증한다.
// 화면에서 사진을 올려 품목 출고 창이 열리는 흐름은 tests/e2e/inventory-barcode.spec.ts가 본다.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeLuminance, rgbaToLuminance, rotate90 } from '../web/src/pages/inventory/barcodeCore.ts';
import { code128Modules, decodeOwnPng, ean13Check, ean13Modules, FIXTURE_DIR, FIXTURES, makeFixture, render1d } from './fixtures/barcode/make-barcodes.ts';

describe('바코드 사진 해독', () => {
  for (const f of FIXTURES) {
    test(`phase-06-task-01 AC2: ${f.file} → ${f.text ? `${f.format} "${f.text}"` : '바코드 없음(null)'}`, () => {
      const img = decodeOwnPng(fs.readFileSync(path.join(FIXTURE_DIR, f.file)));
      const r = decodeLuminance(img.data, img.width, img.height);
      if (f.text) expect(r).toEqual({ text: f.text, format: f.format });
      else expect(r).toBeNull();
    });
  }

  test('phase-06-task-01 AC2: 저장된 fixture PNG는 생성 스크립트로 다시 만든 그림과 똑같다', () => {
    for (const f of FIXTURES) {
      const saved = decodeOwnPng(fs.readFileSync(path.join(FIXTURE_DIR, f.file)));
      const made = makeFixture(f.file);
      expect([saved.width, saved.height], f.file).toEqual([made.width, made.height]);
      expect(Buffer.compare(Buffer.from(saved.data), Buffer.from(made.data)), f.file).toBe(0);
    }
  });

  test('phase-06-task-01: 깨끗한 막대 그림도 읽고, 손상된 EAN-13(검사 숫자 틀림)은 그리기 전에 막는다', () => {
    const ean = render1d(ean13Modules('2001000000012'), 2, 60);
    expect(decodeLuminance(ean.data, ean.width, ean.height)).toEqual({ text: '2001000000012', format: 'EAN-13' });
    const c128 = render1d(code128Modules('Lot-42 ab'), 2, 60);
    expect(decodeLuminance(c128.data, c128.width, c128.height)).toEqual({ text: 'Lot-42 ab', format: 'Code128' });
    expect(ean13Check('200100000002')).toBe(9);
    expect(() => ean13Modules('2001000000020')).toThrow();
    // 크기가 맞지 않는 배열은 해독하지 않는다
    expect(decodeLuminance(new Uint8ClampedArray(10), 100, 100)).toBeNull();
  });

  test('phase-06-task-01: rotate90은 시계 방향으로 돌리고, rgbaToLuminance는 투명한 곳을 흰색으로 본다', () => {
    // 2×1 [a b] → 1×2 [a; b]
    expect([...rotate90(new Uint8ClampedArray([1, 2]), 2, 1)]).toEqual([1, 2]);
    // 2×2 [1 2; 3 4] → [3 1; 4 2]
    expect([...rotate90(new Uint8ClampedArray([1, 2, 3, 4]), 2, 2)]).toEqual([3, 1, 4, 2]);
    const lum = rgbaToLuminance(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]), 3, 1);
    expect([...lum]).toEqual([0, 255, 255]);
  });
});
