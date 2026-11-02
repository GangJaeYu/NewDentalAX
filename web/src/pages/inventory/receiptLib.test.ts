// 이 파일이 하는 일: "명세서 사진으로 입고" 화면 순수 로직(receiptLib.ts)과 사진 줄이기 크기 계산(lib/image.ts fitSize)을 확인한다(phase-04-task-08).
// 보내기 버튼 켜짐 조건(AC1), 4000×3000 → 1600×1200(AC2), 읽은 줄 → 미리 고른 품목·저장 본문(AC3), 가린 개인정보 안내(AC4).
import { describe, expect, test } from 'vitest';
import { fitSize } from '../../lib/image.ts';
import { buildCommitBody, canSend, imageInfoText, initialLines, lineAmount, linesTotal, maskedNotice, RECEIPT_MAX_SIDE, type ReceiptReadResult } from './receiptLib.ts';

const read: Pick<ReceiptReadResult, 'draft' | 'candidates'> = {
  draft: {
    vendorName: '한빛덴탈',
    date: '2026-11-02',
    lines: [
      { name: '니트릴 글러브 M (100매)', qty: 10, unitPrice: 8400, amount: 84000 },
      { name: '알 수 없는 품목', qty: 2, unitPrice: null, amount: 7000 },
      { name: '거즈', qty: null, unitPrice: null, amount: null },
    ],
    total: 91000,
  },
  candidates: [
    [
      { itemId: 7, name: '니트릴 글러브 M', unit: '박스', category: '소모품', score: 0.75 },
      { itemId: 6, name: '니트릴 글러브 S', unit: '박스', category: '소모품', score: 0.625 },
    ],
    [{ itemId: 9, name: '알지네이트 인상재', unit: '봉', category: '재료', score: 0.25 }],
    [],
  ],
};

describe('phase-04-task-08 명세서 입고 화면 로직', () => {
  test('phase-04-task-08 AC1: 사진이 있어도 확인 체크 전에는 보내기 버튼이 꺼져 있다', () => {
    expect(canSend({ hasFile: true, confirmed: false, ready: true, busy: false })).toBe(false);
    expect(canSend({ hasFile: false, confirmed: true, ready: true, busy: false })).toBe(false);
    expect(canSend({ hasFile: true, confirmed: true, ready: false, busy: false })).toBe(false);
    expect(canSend({ hasFile: true, confirmed: true, ready: true, busy: true })).toBe(false);
    expect(canSend({ hasFile: true, confirmed: true, ready: true, busy: false })).toBe(true);
  });

  test('phase-04-task-08 AC2: 4000×3000 사진은 긴 변 1600px(1600×1200)로, 세로 사진도 비율을 지켜 줄인다', () => {
    expect(RECEIPT_MAX_SIDE).toBe(1600);
    expect(fitSize(4000, 3000, RECEIPT_MAX_SIDE)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3000, 4000, RECEIPT_MAX_SIDE)).toEqual({ width: 1200, height: 1600 });
    expect(fitSize(1200, 900, RECEIPT_MAX_SIDE)).toEqual({ width: 1200, height: 900 });
    expect(imageInfoText({ width: 1600, height: 1200, bytes: 327_680 })).toBe('1600×1200px · 320KB');
  });

  test('phase-04-task-08 AC3: 충분히 비슷한 첫 후보는 미리 고르고, 단가가 없으면 금액 ÷ 수량을 넣는다', () => {
    const lines = initialLines(read);
    expect(lines.map((l) => l.choice)).toEqual(['7', '', '']);
    expect(lines[0]).toMatchObject({ readName: '니트릴 글러브 M (100매)', qty: '10', unitPrice: '8400' });
    expect(lines[1]).toMatchObject({ qty: '2', unitPrice: '3500' });
    expect(lines[2]).toMatchObject({ qty: '', unitPrice: '' });
    expect(lineAmount(lines[0]!)).toBe(84000);
    expect(linesTotal(lines)).toBe(91000);
  });

  test('phase-04-task-08 AC3: 고르지 않은 줄·잘못된 수량은 칸별 오류, 고친 뒤에는 입고(+지출) 저장 본문이 된다', () => {
    const lines = initialLines(read);
    const bad = buildCommitBody({ fileId: 3, vendorId: 1, vendorName: null, date: '2026-11-02', lines, alsoExpense: null });
    expect(bad.body).toBeNull();
    expect(Object.keys(bad.errors).sort()).toEqual(['lines.1.itemId', 'lines.2.itemId', 'lines.2.qty']);

    const fixed = lines.map((l, i) => (i === 1 ? { ...l, choice: 'new', newName: '새 인상재', newCategory: '재료', newUnit: '봉' } : i === 2 ? { ...l, choice: 'skip' } : l));
    expect(linesTotal(fixed)).toBe(91000);
    const ok = buildCommitBody({ fileId: 3, vendorId: null, vendorName: '한빛덴탈', date: '2026-11-02', lines: fixed, alsoExpense: { payMethod: 'card' } });
    expect(ok.errors).toEqual({});
    expect(ok.body).toEqual({
      fileId: 3,
      vendorName: '한빛덴탈',
      date: '2026-11-02',
      lines: [
        { itemId: 7, qty: 10, unitPrice: 8400 },
        { newItem: { name: '새 인상재', category: '재료', unit: '봉', par: 0 }, qty: 2, unitPrice: 3500 },
      ],
      alsoExpense: { payMethod: 'card' },
    });

    const allSkipped = buildCommitBody({ fileId: 3, vendorId: null, vendorName: null, date: '', lines: lines.map((l) => ({ ...l, choice: 'skip' })), alsoExpense: null });
    expect(allSkipped.formError).toContain('입고할 품목이 없어요');
    const noPrice = buildCommitBody({ fileId: 3, vendorId: 1, vendorName: null, date: '', lines: [{ ...lines[0]!, unitPrice: '' }], alsoExpense: { payMethod: 'cash' } });
    expect(noPrice.errors.alsoExpense).toContain('단가');
  });

  test('phase-04-task-08 AC4: 가린 개인정보가 있으면 종류·건수를 담은 안내를, 없으면 null을 돌려준다', () => {
    expect(maskedNotice([])).toBeNull();
    expect(maskedNotice([{ type: 'card', count: 1 }])).toBe('읽은 글에 카드번호 1건이 있어 가린 채 보여 드려요. 다음부터는 사진의 해당 부분을 가리고 올려 주세요.');
    expect(maskedNotice([{ type: 'card', count: 2 }, { type: 'phone', count: 1 }])).toContain('카드번호 2건, 전화번호 1건');
  });
});
