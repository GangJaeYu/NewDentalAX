// 이 파일이 하는 일: 회의록 요약 화면 E2E(phase-03-task-06 AC3, FR-061). 이 파일 전용 격리 서버(키 없음 = 데모 공급자)에서 회의 메모를 정리하면
// 결정 사항·할 일(담당 역할·기한)·요약이 세 칸으로 나뉘어 보이는지, 할 일 "인수인계로 보내기"가 POST /api/posts에 올바른 글을 보내는지 확인한다.
// /api/posts(공지·인수인계 보드)는 phase-03-task-04가 만든다. 이 파일은 그 요청을 page.route로 받아 내용만 확인하고(서버 의존 없음),
// 실제 보드에 나타나는지는 docs-handover.spec.ts가 확인한다(03-04 병합 뒤 통과).
import AxeBuilder from '@axe-core/playwright';
import { signIn, watchErrors } from './docs-helpers.ts';
import { expect, test } from './fixtures.ts';

const NOTES = ['- 다음 주부터 오전 예약 간격을 30분으로 바꾸기로 결정', '- 예약 안내 문자 문구 고치기 (데스크 담당, 11월 6일까지)', '- 멸균기 점검표 새로 만들기 위생사가 11/10까지'].join('\n');

test.describe.serial('회의록 요약', () => {
  test('phase-03-task-06 AC3: 회의 메모 → 결정 사항·할 일(역할·기한)·요약이 분리 표시되고, 할 일을 인수인계로 보내면 보드용 글이 만들어진다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    const posted: unknown[] = [];
    await page.route('**/api/posts', async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 7, kind: 'handover' } }) });
    });
    await page.goto('/docs/minutes');
    await expect(page.getByRole('heading', { level: 1, name: '회의록 요약' })).toBeVisible();
    await page.getByLabel('회의 이름').fill('11월 첫째 주 직원 회의');
    const panel = page.getByTestId('ai-panel-minutes');
    await panel.getByLabel('회의 메모').fill(NOTES);
    await panel.getByRole('button', { name: '정리하기' }).click();

    const result = page.getByTestId('minutes-result');
    await expect(result).toBeVisible({ timeout: 15000 });
    const decisions = result.getByRole('list', { name: '결정 사항' });
    await expect(decisions.getByRole('listitem')).toHaveText(['다음 주부터 오전 예약 간격을 30분으로 바꾸기로 결정']);
    const todos = page.getByTestId('minutes-todo');
    await expect(todos).toHaveCount(2);
    await expect(todos.nth(0)).toContainText('예약 안내 문자 문구 고치기');
    await expect(todos.nth(0)).toContainText('담당: 데스크');
    await expect(todos.nth(0)).toContainText('기한: 11월 6일');
    await expect(todos.nth(1)).toContainText('담당: 치과위생사');
    await expect(todos.nth(1)).toContainText('기한: 11월 10일');
    await expect(result.getByRole('article', { name: '논의 요약' })).toContainText('결정 1건, 할 일 2건');

    // 할 일 하나 → 인수인계
    await todos.nth(0).getByRole('button', { name: '인수인계로 보내기' }).click();
    await expect(todos.nth(0).getByText('인수인계로 보냄')).toBeVisible();
    await expect(todos.nth(0).getByRole('link', { name: '보드에서 보기' })).toHaveAttribute('href', '/desk/board/7');
    expect(posted).toEqual([
      {
        kind: 'handover',
        category: '회의 할 일',
        title: '예약 안내 문자 문구 고치기',
        body: '회의(11월 첫째 주 직원 회의)에서 정한 할 일입니다.\n\n- 할 일: 예약 안내 문자 문구 고치기\n- 담당: 데스크\n- 기한: 11월 6일',
      },
    ]);
    // 관리자는 공지로도 올릴 수 있다(버튼이 보임)
    await expect(todos.nth(1).getByRole('button', { name: '공지로 올리기' })).toBeVisible();

    // 회의록을 서식 보관함에 저장
    await page.getByRole('button', { name: '회의록 저장' }).click();
    await expect(page.getByText('서식 보관함에 회의록을 저장했어요(버전 1).')).toBeVisible();
    await page.getByRole('link', { name: '저장한 회의록 보기' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '11월 첫째 주 직원 회의' })).toBeVisible();
    await expect(page.getByRole('article', { name: '문서 미리보기' })).toContainText('예약 안내 문자 문구 고치기 (데스크, 11월 6일까지)');
    expect(errors).toEqual([]);
  });

  test('phase-03-task-06 AC3: 보내기에 실패하면 이유를 보여 주고 다시 보낼 수 있다', async ({ page }) => {
    await signIn(page);
    await page.route('**/api/posts', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FORBIDDEN', message: '이 기능을 사용할 권한이 없습니다.' } }) }),
    );
    await page.goto('/docs/minutes');
    const panel = page.getByTestId('ai-panel-minutes');
    await panel.getByLabel('회의 메모').fill(NOTES);
    await panel.getByRole('button', { name: '정리하기' }).click();
    const todo = page.getByTestId('minutes-todo').first();
    await todo.getByRole('button', { name: '인수인계로 보내기' }).click();
    await expect(todo.getByRole('alert')).toHaveText('이 기능을 사용할 권한이 없습니다.');
    await expect(todo.getByRole('button', { name: '인수인계로 보내기' })).toBeEnabled();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`phase-03-task-06 화면: /docs/minutes 결과 화면 접근성 위반 0건(${theme})`, async ({ browser, isoServer }) => {
      const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      const page = await ctx.newPage();
      await signIn(page);
      await page.goto('/docs/minutes');
      const panel = page.getByTestId('ai-panel-minutes');
      await panel.getByLabel('회의 메모').fill(NOTES);
      await panel.getByRole('button', { name: '정리하기' }).click();
      await expect(page.getByTestId('minutes-result')).toBeVisible({ timeout: 15000 });
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await ctx.close();
    });
  }
});
