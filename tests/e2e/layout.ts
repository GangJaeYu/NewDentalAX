// 이 파일이 하는 일: E2E 공용 가로 넘침 판정(phase-05-task-03). "문서 전체 너비(scrollWidth) ≤ 창 너비(innerWidth)"에 더해
// "창 너비가 테스트가 정한 너비(viewport) 그대로인지"를 함께 본다. 휴대폰 흉내(isMobile)에서는 내용이 넘치면 브라우저가 화면을 축소해
// innerWidth 자체가 커지므로(04-05 발견: 390 → 656), 앞 조건만으로는 넘침을 놓친다. spec 파일이 아니라 Playwright가 테스트로 실행하지 않는다.
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

/** 지금 화면에 가로 스크롤이 없고, 창 너비가 정한 너비 그대로인지 확인한다 */
export async function expectNoHorizontalScroll(page: Page, label = ''): Promise<void> {
  const want = page.viewportSize()?.width;
  const { sw, iw } = (await page.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })')) as { sw: number; iw: number };
  expect(iw, `${label} 창 너비(innerWidth)가 ${want}px 그대로여야 해요`.trim()).toBe(want);
  expect(sw, `${label} 가로 스크롤`.trim()).toBeLessThanOrEqual(iw);
}
