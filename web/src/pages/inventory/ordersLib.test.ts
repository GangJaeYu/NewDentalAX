// 이 파일이 하는 일: 발주서 화면 순수 로직(ordersLib.ts)을 확인한다. 편집 줄 합계·수량 오류 문구·PATCH/입고 본문 만들기·인쇄 머리말 이스케이프·안내 문구.
import { describe, expect, test } from 'vitest';
import { cssText, draftMessage, editTotals, orderPrintHeaderCss, parseNum, patchLines, qtyError, receiveBody, type EditLine } from './ordersLib.ts';

const line = (itemId: number, q: string, unitPrice: number | null): EditLine => ({ itemId, itemName: `품목${itemId}`, unit: '박스', qty: q, unitPrice });

describe('발주서 편집 계산', () => {
  test('phase-03-task-02 AC2: 수량을 고치면 합계가 다시 계산되고, 단가 없는 줄은 금액에서 빠진다', () => {
    expect(editTotals([line(1, '7', 8400), line(2, '5', 4200)])).toEqual({ qty: 12, amount: 7 * 8400 + 5 * 4200, missingPrice: false });
    expect(editTotals([line(1, '10', 8400), line(2, '2', null)])).toEqual({ qty: 12, amount: 84000, missingPrice: true });
    expect(editTotals([line(1, '1.5', 1000), line(2, 'abc', 500)])).toEqual({ qty: 1.5, amount: 1500, missingPrice: false });
    expect(editTotals([])).toEqual({ qty: 0, amount: 0, missingPrice: false });
  });

  test('phase-03-task-02 AC2: 수량 칸 검사와 PATCH 본문(단가는 보내지 않음)', () => {
    expect(qtyError('3')).toBeNull();
    expect(qtyError('0')).toBe('수량은 0보다 크게 적어 주세요.');
    expect(qtyError('-1')).toBe('수량은 0보다 크게 적어 주세요.');
    expect(qtyError('')).toBe('수량을 숫자로 적어 주세요.');
    expect(qtyError('두 개')).toBe('수량을 숫자로 적어 주세요.');
    expect(parseNum('1,200')).toBe(1200);
    expect(patchLines([line(3, '10', 8400), line(4, '2.5', null)])).toEqual([
      { itemId: 3, qty: 10 },
      { itemId: 4, qty: 2.5 },
    ]);
  });

  test('phase-03-task-02 AC3: 입고 입력 → 본문(빈 단가·로트·유효기간은 빼서 발주서 단가를 쓰게 한다)', () => {
    expect(
      receiveBody([
        { itemId: 1, qty: '7', unitPrice: '8900', lot: ' A1 ', expiryOn: '2027-03-31' },
        { itemId: 2, qty: '0', unitPrice: '', lot: '', expiryOn: '' },
      ]),
    ).toEqual([
      { itemId: 1, qty: 7, unitPrice: 8900, lot: 'A1', expiryOn: '2027-03-31' },
      { itemId: 2, qty: 0 },
    ]);
  });
});

describe('인쇄 머리말·안내 문구', () => {
  test('phase-03-task-02 AC4: 머리말은 병원명과 발주 번호를 쓰고, 따옴표·꺾쇠는 CSS 글자로 이스케이프한다', () => {
    const css = orderPrintHeaderCss('하늘숲치과', 'PO-2611-001');
    expect(css).toContain('@top-left { content: "하늘숲치과"');
    expect(css).toContain('@top-right { content: "발주서 PO-2611-001"');
    expect(cssText('a"b}<c>\\')).toBe('"a\\22 b}\\3c c\\3e \\5c "');
    expect(cssText('줄\n바꿈')).toBe('"줄 바꿈"');
    expect(cssText('가'.repeat(100)).length).toBe(82);
  });

  test('phase-03-task-02 AC1: "발주서 만들기" 결과 안내', () => {
    const row = { id: 1 } as never;
    expect(draftMessage({ orders: [row, row], skipped: 0 })).toBe('거래처별 발주서 2건을 만들었어요. 수량을 확인한 뒤 발주해 주세요.');
    expect(draftMessage({ orders: [row], skipped: 2 })).toContain('이미 발주서에 담긴 품목 2개는 뺐어요.');
    expect(draftMessage({ orders: [], skipped: 3 })).toBe('부족한 품목 3개가 모두 이미 작성 중이거나 발주한 발주서에 들어 있어요.');
    expect(draftMessage({ orders: [], skipped: 0 })).toBe('지금은 부족하거나 곧 부족한 품목이 없어요.');
  });
});
