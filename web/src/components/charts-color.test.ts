// 이 파일이 하는 일: 도넛 그래프 조각 색이 맞닿은 조각끼리 겹치지 않는지 검사한다(05-03 검증 관찰: 월간 요약 '기타'·'임대료' 같은 색).
import { describe, expect, test } from 'vitest';
import { donutColor } from './Charts.tsx';

describe('도넛 조각 색', () => {
  test('조각 수가 몇 개여도 이웃한 조각(마지막과 첫 조각 포함)은 색이 다르다', () => {
    for (let n = 2; n <= 20; n++) {
      const colors = Array.from({ length: n }, (_, i) => donutColor(i, n));
      for (let i = 0; i < n; i++) expect(colors[i], `n=${n} i=${i}`).not.toBe(colors[(i + 1) % n]);
    }
  });
  test('6개 이하에서는 예전과 같은 순서(c1~c6)를 쓴다', () => {
    expect(Array.from({ length: 6 }, (_, i) => donutColor(i, 6))).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });
});
