// 이 파일이 하는 일: 회의록 할 일 → 인수인계 보드 통합 E2E(phase-03-task-06 AC3 후반, FR-061·FR-040). 실제 POST /api/posts와 보드 화면(/desk/board)을 거친다.
// 공지·인수인계 보드는 phase-03-task-04가 만든다. 그 태스크가 main에 병합되기 전에는 이 파일이 실패하는 것이 정상이다(조정자 지시, 병합 뒤 통합 검증).
// 회의록 화면 자체(분리 표시·보내는 글 내용)는 docs-minutes.spec.ts가 서버 의존 없이 확인한다.
import { signIn } from './docs-helpers.ts';
import { expect, test } from './fixtures.ts';

const NOTES = ['- 다음 주부터 오전 예약 간격을 30분으로 바꾸기로 결정', '- 예약 안내 문자 문구 고치기 (데스크 담당, 11월 6일까지)'].join('\n');

test('phase-03-task-06 AC3: 회의 메모의 할 일 하나를 인수인계로 보내면 보드에 나타난다', async ({ page }) => {
  await signIn(page);
  await page.goto('/docs/minutes');
  await page.getByLabel('회의 이름').fill('11월 직원 회의');
  const panel = page.getByTestId('ai-panel-minutes');
  await panel.getByLabel('회의 메모').fill(NOTES);
  await panel.getByRole('button', { name: '정리하기' }).click();
  const todo = page.getByTestId('minutes-todo').first();
  await expect(todo).toContainText('예약 안내 문자 문구 고치기', { timeout: 15000 });
  await todo.getByRole('button', { name: '인수인계로 보내기' }).click();
  await expect(todo.getByText('인수인계로 보냄')).toBeVisible();

  // 서버에 인수인계 글로 저장되었다
  const list = await page.request.get('/api/posts?kind=handover');
  expect(list.status()).toBe(200);
  expect(await list.text()).toContain('예약 안내 문자 문구 고치기');

  // 보드 화면에 보인다
  await todo.getByRole('link', { name: '보드에서 보기' }).click();
  await expect(page.getByText('예약 안내 문자 문구 고치기').first()).toBeVisible();
  await page.goto('/desk/board?tab=handover');
  await expect(page.getByText('예약 안내 문자 문구 고치기').first()).toBeVisible();
});
