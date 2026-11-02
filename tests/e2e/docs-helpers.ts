// 이 파일이 하는 일: 문서 화면 E2E(docs-*.spec.ts, phase-03-task-06)가 함께 쓰는 도우미. 첫 설정(하늘숲치과)·로그인, CSRF 토큰을 붙인 API 요청,
// 콘솔 오류 모으기, 문서를 API로 바로 만들기를 둔다. spec 파일이 아니라서 Playwright가 테스트로 실행하지 않는다.
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

export const DOCS_ADMIN = { clinicName: '하늘숲치과', name: '박원장', username: 'docsadmin', password: 'Docs-Admin-Pass-7' };
export const WIDTHS: Array<[number, number]> = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
];

/** 첫 설정(처음 한 번)과 로그인. CSRF 토큰을 돌려준다 */
export async function signIn(page: Page, who: { username: string; password: string } = DOCS_ADMIN): Promise<string> {
  const s = await page.request.get('/api/session');
  if (((await s.json()) as { data: { setupRequired: boolean } }).data.setupRequired) {
    const r = await page.request.post('/api/setup', { data: { ...DOCS_ADMIN, withDemo: false } });
    expect(r.status()).toBe(201);
  }
  const r = await page.request.post('/api/auth/login', { data: { username: who.username, password: who.password } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken;
}

/** 콘솔 오류를 모은다(일부러 만든 4xx 응답 줄은 뺀다) */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** API로 글 문서를 만든다(id 돌려줌) */
export async function apiCreateDoc(page: Page, csrf: string, body: { kind: string; title: string; body_md: string; folder?: string; tags?: string[] }): Promise<number> {
  const r = await page.request.post('/api/documents', { data: body, headers: { 'x-csrf-token': csrf } });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { data: { id: number } }).data.id;
}

/** 가로 스크롤 여부(문서 전체 너비 ≤ 창 너비) */
export async function noHorizontalScroll(page: Page): Promise<{ sw: number; iw: number }> {
  return (await page.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })')) as { sw: number; iw: number };
}
