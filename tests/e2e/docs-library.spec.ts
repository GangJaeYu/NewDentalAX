// 이 파일이 하는 일: 서식 보관함 E2E(phase-03-task-06 AC4, FR-062)와 문서 화면들의 접근성·반응형 확인. 이 파일 전용 격리 서버(키 없음 = 데모 공급자)를 쓴다.
// AC4: .exe 파일은 415, 21MB 파일은 413과 한국어 안내(API 직접 요청 + 화면의 안내 문구), 확장자만 바꾼 실행 파일도 서버가 거부, 정상 PDF는 올라가고 첨부 파일로 내려받는다.
// 직원(staff)에게는 "서식 파일 올리기"가 없다. 그 밖에 검색·폴더 거르기, 네 화면의 axe 위반 0건(두 테마)과 4너비 가로 스크롤 없음을 본다.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { apiCreateDoc, noHorizontalScroll, signIn, watchErrors, WIDTHS } from './docs-helpers.ts';
import { expect, test } from './fixtures.ts';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0x90)]);
const STAFF = { username: 'docsstaff', password: 'Docs-Staff-Pass-7' };

/** 서식 파일 올리기 대화상자를 열고 파일을 고른다 */
async function pick(page: Page, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '서식 파일 올리기' });
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: '서식 파일 올리기' }).click();
  await dialog.locator('input[type=file]').setInputFiles(file);
}

test.describe.serial('서식 보관함', () => {
  test('phase-03-task-06 AC4: .exe 파일 업로드는 415, 21MB 파일은 413과 한국어 안내(API)', async ({ page }) => {
    const csrf = await signIn(page);
    const exe = await page.request.post('/api/documents', { headers: { 'x-csrf-token': csrf }, multipart: { file: { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: EXE } } });
    expect(exe.status()).toBe(415);
    expect(await exe.json()).toEqual({ error: { code: 'FILE_TYPE', message: '올릴 수 없는 파일 형식입니다. PDF·DOCX·XLSX·HWP·HWPX·JPG·PNG 파일만 올릴 수 있어요.' } });

    const big = Buffer.concat([PDF, Buffer.alloc(21 * 1024 * 1024 - PDF.length, 0x20)]);
    const tooBig = await page.request.post('/api/documents', { headers: { 'x-csrf-token': csrf }, multipart: { file: { name: '큰 서식.pdf', mimeType: 'application/pdf', buffer: big } } });
    expect(tooBig.status()).toBe(413);
    expect(await tooBig.json()).toEqual({ error: { code: 'FILE_TOO_LARGE', message: '파일이 너무 큽니다(최대 20MB). 크기를 줄여서 다시 올려 주세요.' } });

    const list = await page.request.get('/api/documents');
    expect(((await list.json()) as { total: number }).total).toBe(0);
  });

  test('phase-03-task-06 AC4: 화면에서 .exe·21MB는 올리기 전에 한국어 이유를, 확장자만 바꾼 파일은 서버 거부 이유를 보여 주고, 정상 PDF는 올라간다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/docs/library');
    await expect(page.getByText('아직 저장한 문서가 없어요')).toBeVisible();
    const dialog = page.getByRole('dialog', { name: '서식 파일 올리기' });

    await pick(page, { name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: EXE });
    await expect(dialog.getByRole('alert')).toContainText('setup.exe: PDF·DOCX·XLSX·HWP·HWPX·JPG·JPEG·PNG 파일만 올릴 수 있어요.');

    await pick(page, { name: '큰 서식.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(21 * 1024 * 1024, 0x20) });
    await expect(dialog.getByRole('alert')).toContainText('파일이 너무 커요');
    await expect(dialog.getByRole('alert')).toContainText('20MB 이하로 올려 주세요.');

    // 확장자만 .pdf로 바꾼 실행 파일 → 서버가 내용을 보고 거부(415)
    await pick(page, { name: '동의서.pdf', mimeType: 'application/pdf', buffer: EXE });
    await expect(dialog.getByTestId('upload-picked')).toContainText('동의서.pdf');
    await dialog.getByRole('button', { name: '올리기' }).click();
    await expect(dialog.getByTestId('upload-error')).toHaveText('올릴 수 없는 파일 형식입니다. 파일 내용이 PDF 형식이 아니에요.');

    // 정상 PDF
    await pick(page, { name: '진료 동의서 양식.pdf', mimeType: 'application/pdf', buffer: PDF });
    await dialog.getByLabel('폴더').fill('양식');
    await dialog.getByLabel('태그').fill('동의서, 양식');
    await dialog.getByRole('button', { name: '올리기' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '진료 동의서 양식' })).toBeVisible();
    await expect(page.getByText('서식 파일 · 올린 파일')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: '파일 내려받기' }).click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('진료 동의서 양식.pdf');
    expect(errors).toEqual([]);
  });

  test('phase-03-task-06 AC4: 직원에게는 업로드 버튼이 없고 API도 403, 검색·폴더 거르기가 된다', async ({ page, isoServer }) => {
    const csrf = await signIn(page);
    await apiCreateDoc(page, csrf, { kind: 'policy', title: '감염 관리 규정', body_md: '# 감염 관리 규정\n\n멸균 기록을 남깁니다.', folder: '규정', tags: ['감염'] });
    await apiCreateDoc(page, csrf, { kind: 'notice_patient', title: '스케일링 후 안내', body_md: '# 스케일링 후 안내\n\n시릴 수 있어요.', folder: '환자 안내', tags: ['스케일링'] });
    await isoServer.addUser('staff', STAFF.username, STAFF.password, '김직원');
    await page.request.post('/api/auth/logout', { headers: { 'x-csrf-token': csrf } });
    const staffCsrf = await signIn(page, STAFF);

    await page.goto('/docs/library');
    await expect(page.getByRole('heading', { level: 1, name: '서식 보관함' })).toBeVisible();
    await expect(page.getByText('문서 3개')).toBeVisible();
    await expect(page.getByRole('button', { name: '서식 파일 올리기' })).toHaveCount(0);
    const denied = await page.request.post('/api/documents', { headers: { 'x-csrf-token': staffCsrf }, multipart: { file: { name: '양식.pdf', mimeType: 'application/pdf', buffer: PDF } } });
    expect(denied.status()).toBe(403);

    await page.getByLabel('제목·내용·파일 이름 검색').fill('멸균');
    await page.getByLabel('제목·내용·파일 이름 검색').press('Enter');
    await expect(page.getByText('문서 1개')).toBeVisible();
    await expect(page.getByRole('row', { name: /감염 관리 규정/ })).toBeVisible();
    await page.getByRole('button', { name: '거르기 지우기' }).click();
    await page.getByLabel('폴더').selectOption('환자 안내');
    await expect(page.getByText('문서 1개')).toBeVisible();
    await expect(page.getByRole('row', { name: /스케일링 후 안내/ })).toBeVisible();
    await page.getByLabel('폴더').selectOption('규정');
    await page.getByLabel('종류').selectOption('notice_patient');
    await expect(page.getByText('조건에 맞는 문서가 없어요')).toBeVisible();
    // 직원은 다른 사람 문서를 고칠 수 없다(버튼 없음)
    await page.goto('/docs/library');
    await page.getByRole('row', { name: /감염 관리 규정/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '감염 관리 규정' })).toBeVisible();
    await expect(page.getByRole('button', { name: '고치기' })).toHaveCount(0);
    await page.request.post('/api/auth/logout', { headers: { 'x-csrf-token': staffCsrf } });
  });

  /** 확인할 화면과 준비 동작 */
  const SCREENS: Array<{ path: string; ready: (page: Page) => Promise<void> }> = [
    {
      path: '/docs/writer',
      ready: async (page) => {
        const panel = page.getByTestId('ai-panel-doc_writer');
        await panel.getByLabel('요점').fill('스케일링 후 주의사항, 시린 느낌, 부드러운 칫솔');
        await panel.getByRole('button', { name: '초안 만들기' }).click();
        await expect(page.getByRole('article', { name: '문서 미리보기' })).toBeVisible({ timeout: 15000 });
      },
    },
    { path: '/docs/minutes', ready: async (page) => void (await expect(page.getByTestId('ai-panel-minutes')).toBeVisible()) },
    { path: '/docs/library', ready: async (page) => void (await expect(page.getByRole('row', { name: /감염 관리 규정/ })).toBeVisible()) },
    { path: '/docs/library/2', ready: async (page) => void (await expect(page.getByTestId('version-1')).toBeVisible()) },
    { path: '/print/document/2', ready: async (page) => void (await expect(page.getByTestId('print-document')).toBeVisible()) },
  ];

  for (const theme of ['light', 'dark'] as const) {
    for (const s of SCREENS) {
      test(`phase-03-task-06 화면: ${s.path} 접근성 위반 0건(${theme})`, async ({ browser, isoServer }) => {
        const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
        const page = await ctx.newPage();
        await signIn(page);
        await page.goto(s.path);
        await s.ready(page);
        const r = await new AxeBuilder({ page }).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        await ctx.close();
      });
    }
  }

  for (const s of SCREENS) {
    test(`phase-03-task-06 화면: ${s.path} 4너비에서 가로 스크롤이 없다`, async ({ browser, isoServer }) => {
      for (const [width, height] of WIDTHS) {
        const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width, height }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
        const page = await ctx.newPage();
        await signIn(page);
        await page.goto(s.path);
        await s.ready(page);
        const m = await noHorizontalScroll(page);
        expect(m.sw, `${s.path} ${width}px 가로 스크롤`).toBeLessThanOrEqual(m.iw);
        await ctx.close();
      }
    });
  }
});
