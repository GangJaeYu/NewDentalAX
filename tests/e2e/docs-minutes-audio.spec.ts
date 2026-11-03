// 이 파일이 하는 일: 회의록 화면의 녹음 파일 받아쓰기 E2E(phase-06-task-03, FR-132). 이 파일 전용 격리 서버(키 없음 = 데모 공급자)를 쓴다.
// AC1 데모 모드에서 녹음 파일을 올리면 예시 받아쓰기 글이 회의 메모 칸에 들어가고, "정리하기"로 결정 사항·할 일·요약 화면이 이어진다.
// AC2 음성 미지원 공급자(Anthropic)로 바꾸면 고르기 칸 대신 "음성을 지원하지 않아요" 비활성 안내가 보인다(공급자로 요청은 나가지 않는다).
// AC3 20MB 넘는 파일은 화면이 먼저 거부하고(쉬운 안내), 화면을 거치지 않고 보내도 서버가 413으로 거부한다.
// 환자 이야기 경고는 늘 보인다. 4너비 × 2테마 가로 넘침 없음(390px은 창 너비 390 유지까지)과 axe 위반 0건을 함께 본다.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { signIn, watchErrors, WIDTHS } from './docs-helpers.ts';
import { expectNoHorizontalScroll } from './layout.ts';
import { expect, test } from './fixtures.ts';

/** 가짜 m4a(앞부분 'ftyp' 머리 + 채움 바이트) */
function fakeM4a(bytes = 4096): Buffer {
  const b = Buffer.alloc(bytes, 0x11);
  Buffer.from([0x00, 0x00, 0x00, 0x20]).copy(b, 0);
  Buffer.from('ftypM4A ', 'latin1').copy(b, 4);
  return b;
}

/** 녹음 카드 */
const recordingCard = (page: Page) => page.getByRole('article', { name: '녹음 파일로 받아쓰기' });

/** 녹음 파일을 고른다 */
async function pick(page: Page, name: string, buffer: Buffer) {
  await recordingCard(page).locator('input[type=file]').setInputFiles({ name, mimeType: 'audio/mp4', buffer });
}

test.describe.serial('회의 녹음 → 회의록', () => {
  test('phase-06-task-03 AC1: 데모 모드에서 녹음 파일 업로드 → 예시 받아쓰기 글 → 정리하기로 회의록 요약 화면까지 이어진다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/docs/minutes');
    const card = recordingCard(page);
    await expect(card.getByTestId('recording-warning')).toHaveText(/환자 이야기가 들어간 녹음은 올리지 마세요/);
    await expect(card.getByText('데모 모드: 예시 받아쓰기가 나와요')).toBeVisible();

    await pick(page, '11월 직원회의.m4a', fakeM4a());
    await expect(card.getByTestId('recording-picked')).toContainText('고른 녹음: 11월 직원회의.m4a · 4KB');
    // 확인 체크 전에는 보낼 수 없다
    const run = card.getByRole('button', { name: '받아쓰기' });
    await expect(run).toBeDisabled();
    await expect(card.getByText('확인 칸에 체크해야 보낼 수 있어요.')).toBeVisible();
    await card.getByLabel('환자 이야기가 들어간 녹음이 아닌 것을 확인했어요').check();
    await run.click();

    await expect(card.getByTestId('recording-done')).toContainText('받아쓴 글을 아래 회의 메모에 넣었어요');
    await expect(card.getByTestId('recording-done')).toContainText('데모 모드라서 예시 글이 들어갔어요.');
    const memo = page.getByTestId('ai-panel-minutes').getByLabel('회의 메모');
    await expect(memo).toHaveValue(/^\[데모 응답\] 예시 회의 녹음을 받아쓴 글입니다/);
    await expect(memo).toHaveValue(/원장: 그럼 다음 주부터 오전 예약 간격을 30분으로 바꾸기로 하죠\./);

    await page.getByTestId('ai-panel-minutes').getByRole('button', { name: '정리하기' }).click();
    const result = page.getByTestId('minutes-result');
    await expect(result).toBeVisible({ timeout: 15000 });
    await expect(result.getByRole('list', { name: '결정 사항' }).getByRole('listitem').first()).toContainText('30분으로 바꾸기로');
    const todos = page.getByTestId('minutes-todo');
    await expect(todos).toHaveCount(3);
    await expect(todos.nth(0)).toContainText('담당: 데스크');
    await expect(todos.nth(0)).toContainText('기한: 11월 6일');
    await expect(page.getByRole('button', { name: '회의록 저장' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('phase-06-task-03 AC3: 20MB 넘는 녹음은 화면이 먼저 거부하고, 화면을 거치지 않고 보내도 서버가 413으로 거부한다', async ({ page }) => {
    const csrf = await signIn(page);
    await page.goto('/docs/minutes');
    const card = recordingCard(page);
    await pick(page, '긴 회의.m4a', fakeM4a(20 * 1024 * 1024 + 1));
    await expect(card.getByRole('alert')).toHaveText('긴 회의.m4a: 파일이 너무 커요(20MB). 20MB 이하로 올려 주세요.');
    await expect(card.getByTestId('recording-picked')).toHaveCount(0);
    await expect(card.getByRole('button', { name: '받아쓰기' })).toBeDisabled();

    const r = await page.request.post('/api/ai/transcribe', {
      headers: { 'x-csrf-token': csrf },
      multipart: { confirmed: 'true', file: { name: '긴 회의.m4a', mimeType: 'audio/mp4', buffer: fakeM4a(20 * 1024 * 1024 + 1) } },
    });
    expect(r.status()).toBe(413);
    expect(((await r.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`phase-06-task-03 화면: 녹음 카드가 4너비에서 가로로 넘치지 않고, 받아쓴 뒤 화면 접근성 위반 0건(${theme})`, async ({ browser, isoServer }) => {
      const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      const page = await ctx.newPage();
      await signIn(page);
      await page.goto('/docs/minutes');
      await expect(recordingCard(page).getByTestId('recording-warning')).toBeVisible();
      for (const [w, h] of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        await expectNoHorizontalScroll(page, `${w}px ${theme}`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await pick(page, '회의.m4a', fakeM4a());
      await recordingCard(page).getByLabel('환자 이야기가 들어간 녹음이 아닌 것을 확인했어요').check();
      await recordingCard(page).getByRole('button', { name: '받아쓰기' }).click();
      await expect(recordingCard(page).getByTestId('recording-done')).toBeVisible();
      for (const [w, h] of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        await expectNoHorizontalScroll(page, `받아쓴 뒤 ${w}px ${theme}`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await ctx.close();
    });
  }

  // 공급자를 바꾸는 시험은 마지막에 둔다(같은 spec 서버를 함께 쓰므로)
  test('phase-06-task-03 AC2: 음성 미지원 공급자(Anthropic)면 녹음 고르기 대신 비활성 안내가 보이고, 메모 직접 입력은 그대로 쓸 수 있다', async ({ page }) => {
    const csrf = await signIn(page);
    const put = await page.request.put('/api/ai/settings', { headers: { 'x-csrf-token': csrf }, data: { provider: 'anthropic', keys: { anthropic: 'sk-ant-e2e-ONLYFAKE-transcribe-7Qa1' } } });
    expect(put.status()).toBe(200);
    await page.goto('/docs/minutes');
    const card = recordingCard(page);
    await expect(card.getByTestId('recording-off')).toContainText('지금 설정된 AI(Anthropic Claude)는 음성을 지원하지 않아요');
    await expect(card.locator('input[type=file]')).toHaveCount(0);
    await expect(card.getByRole('button', { name: '받아쓰기' })).toHaveCount(0);
    await expect(card.getByTestId('recording-warning')).toBeVisible();
    await expect(page.getByTestId('ai-panel-minutes').getByLabel('회의 메모')).toBeEditable();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
