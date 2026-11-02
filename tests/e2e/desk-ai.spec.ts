// 이 파일이 하는 일: 데스크 AI 화면 E2E(phase-03-task-05 AC1~AC5, FR-042~044). 이 파일 전용 격리 서버(키 없음 = 데모 공급자)에서
// 병원 정보 저장 → 스크립트 결과에 "토요일 9:30~14:00" 반영·보관함 저장/검색, 리뷰 속 전화번호 가림 안내, 말투별 답글 초안 2개 이상·복사·저장·진료 사실 경고,
// 템플릿 {진료시간} 치환 미리보기·90바이트 초과 "장문" 표시, 치환자 목록에 환자 이름 없음을 실제 브라우저로 확인한다. 화면마다 접근성(axe)과 가로 스크롤도 본다.
// 리뷰 답글 초안마다 붙은 "광고 문구 점검" 버튼(phase-04-task-06 AC4 리뷰 답글, phase-04-task-07이 연결)과 데모 답글 조사도 본다.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { noHorizontalScroll, signIn, watchErrors } from './docs-helpers.ts';
import { expect, test } from './fixtures.ts';

const WEEKDAY = { open: '09:30', close: '18:30', lunch: { start: '13:00', end: '14:00' } };

/** 병원 정보를 저장한다(수요일은 야간 진료, 토요일 9:30~14:00) */
async function saveClinic(page: Page, csrf: string) {
  const r = await page.request.put('/api/settings/clinic', {
    headers: { 'x-csrf-token': csrf },
    data: {
      name: '하늘숲치과',
      phone: '02-123-4567',
      hours: { mon: WEEKDAY, tue: WEEKDAY, wed: { open: '14:00', close: '20:30', lunch: null }, thu: WEEKDAY, fri: WEEKDAY, sat: { open: '09:30', close: '14:00', lunch: null }, sun: null },
      holidayNote: '공휴일 휴진',
      parking: '건물 지하 1~2층, 1시간 무료',
      location: '하늘역 3번 출구 앞',
      insuranceNote: '',
    },
  });
  expect(r.status()).toBe(200);
}

test.describe.serial('데스크 AI(스크립트·리뷰 답글·템플릿)', () => {
  test('phase-03-task-05 AC1: 병원 정보에 토요일 9:30~14:00을 저장하면 데모 스크립트 결과에 그 값이 들어가고, 보관함에 저장·검색된다', async ({ page }) => {
    const errors = watchErrors(page);
    const csrf = await signIn(page);
    await saveClinic(page, csrf);
    await page.goto('/desk/script');
    await expect(page.getByRole('heading', { level: 1, name: '전화 응대 스크립트' })).toBeVisible();
    // 자동으로 들어가는 병원 정보가 보인다
    const facts = page.getByTestId('clinic-facts');
    await expect(facts).toContainText('토요일 9:30~14:00');
    await expect(facts).toContainText('수요일 14:00~20:30');

    await page.getByLabel('상황', { exact: true }).selectOption('진료시간 문의');
    await page.getByLabel('말투').selectOption('밝고 상냥하게');
    const panel = page.getByTestId('ai-panel-script');
    await panel.getByRole('button', { name: '스크립트 만들기' }).click();
    const out = panel.getByTestId('ai-output');
    await expect(out).toContainText('토요일 9:30~14:00', { timeout: 15000 });
    await expect(out).toContainText('수요일 14:00~20:30');
    await expect(out).toContainText('하늘숲치과');
    await expect(out).toContainText('좋은 하루 보내세요');
    // 결과 상자는 키보드로 초점을 받는다(스크롤 영역)
    await expect(out).toHaveAttribute('tabindex', '0');
    await expect(panel.getByRole('button', { name: '복사' })).toBeVisible();

    // 주차 문의도 병원 정보(주차)와 진료시간을 넣는다
    await page.getByLabel('상황', { exact: true }).selectOption('주차 문의');
    await panel.getByLabel('덧붙일 내용(선택)').fill('저녁에는 주차장이 붐벼요');
    await panel.getByRole('button', { name: '스크립트 만들기' }).click();
    await expect(out).toContainText('건물 지하 1~2층, 1시간 무료', { timeout: 15000 });
    await expect(out).toContainText('저녁에는 주차장이 붐벼요');

    // 보관함에 저장 → 목록에 보이고 검색·분류로 찾는다
    await panel.getByRole('button', { name: '보관함에 저장' }).click();
    await expect(panel.getByRole('button', { name: '저장했어요' })).toBeVisible();
    const lib = page.getByRole('list', { name: '응대 스크립트 보관함' });
    await expect(lib.getByTestId('saved-item')).toHaveCount(1);
    await expect(lib).toContainText('주차 문의 스크립트');
    await expect(lib).toContainText('건물 지하 1~2층, 1시간 무료');
    await expect(lib).not.toContainText('[데모 응답]');
    await page.getByRole('searchbox', { name: '응대 스크립트 검색' }).fill('없는말');
    await expect(page.getByText('찾는 글이 없어요')).toBeVisible();
    await page.getByRole('searchbox', { name: '응대 스크립트 검색' }).fill('주차');
    await expect(lib.getByTestId('saved-item')).toHaveCount(1);
    await page.getByLabel('분류 거르기').selectOption('진료시간 문의');
    await expect(page.getByText('찾는 글이 없어요')).toBeVisible();
    await page.getByLabel('분류 거르기').selectOption('주차 문의');
    await expect(lib.getByTestId('saved-item')).toHaveCount(1);
    // 새로 고쳐도 남아 있다
    await page.reload();
    await expect(page.getByRole('list', { name: '응대 스크립트 보관함' })).toContainText('주차 문의 스크립트');
    expect(errors).toEqual([]);
  });

  test('phase-03-task-05 AC2: 리뷰에 전화번호가 있으면 보내기 전 경고, 가린 뒤 처리되고 "가리고 보냈습니다" 안내가 보인다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/desk/review');
    await expect(page.getByRole('heading', { level: 1, name: '리뷰 답글 초안' })).toBeVisible();
    const panel = page.getByTestId('ai-panel-review_reply');
    await panel.getByLabel('리뷰 내용').fill('대기가 너무 길었어요. 010-1234-5678로 연락 주세요.');
    await expect(panel.getByTestId('privacy-warning')).toBeVisible();
    await panel.getByRole('button', { name: '답글 초안 만들기' }).click();
    await expect(panel.getByTestId('ai-privacy-notice')).toContainText('전화번호 1건을 가리고', { timeout: 15000 });
    const drafts = page.getByTestId('reply-draft');
    await expect(drafts).toHaveCount(3);
    for (const box of await page.getByRole('list', { name: '답글 초안' }).getByRole('textbox').all()) {
      await expect(box).not.toHaveValue(/5678/);
      await expect(box).toHaveValue(/죄송|사과/);
    }
    // 의료광고 점검은 초안마다 버튼으로 연결됐다(phase-04-task-07, 04-06 후속)
    await expect(page.getByTestId('adcheck-note')).toContainText('초안마다 “광고 문구 점검”을 눌러');
    await expect(drafts.getByRole('button', { name: '광고 문구 점검' })).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('phase-04-task-06 AC4 리뷰 답글: 답글 초안마다 "광고 문구 점검" 버튼이 있고, 고친 답글을 점검하면 그 초안 아래에 결과와 고지가 보인다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/desk/review');
    const panel = page.getByTestId('ai-panel-review_reply');
    await panel.getByLabel('리뷰 내용').fill('직원분들이 친절했어요.');
    await panel.getByRole('button', { name: '답글 초안 만들기' }).click();
    const drafts = page.getByTestId('reply-draft');
    await expect(drafts).toHaveCount(3, { timeout: 15000 });
    for (const d of await drafts.all()) await expect(d.getByRole('button', { name: '광고 문구 점검' })).toBeVisible();

    // 데모 답글 문구는 받침에 맞는 조사를 쓴다(03-05 검증 참고 후속)
    const warm = await drafts.nth(1).getByRole('textbox').inputValue();
    expect(warm).toContain('직원 응대를 좋게 봐 주셔서');
    expect(warm).toContain('편안한 하늘숲치과가 되도록');
    expect(warm).not.toMatch(/을\(를\)|치과이 /);

    // 두 번째 초안에 광고 위험 표현을 넣고 점검한다
    const second = drafts.nth(1);
    await second.getByRole('textbox').fill(`${warm} 국내 최고 임플란트를 지금 50% 할인해 드려요.`);
    await second.getByRole('button', { name: '광고 문구 점검' }).click();
    const result = second.getByTestId('adcheck-result');
    await expect(result).toBeVisible({ timeout: 15000 });
    await expect(result.getByTestId('adcheck-hit').filter({ hasText: '“국내 최고”' })).toBeVisible();
    await expect(result.getByTestId('adcheck-hit').filter({ hasText: '“50% 할인”' })).toBeVisible();
    await expect(second.getByTestId('adcheck-notice')).toContainText('법률 자문이 아니며');
    // 다른 초안에는 결과가 붙지 않는다
    await expect(drafts.nth(0).getByTestId('adcheck-result')).toHaveCount(0);
    // 글을 고치면 다시 점검하라고 알려 준다
    await second.getByRole('textbox').fill(warm);
    await expect(second.getByText('글이 바뀌었어요. 다시 점검해 주세요.')).toBeVisible();
    await second.getByRole('button', { name: '광고 문구 점검 다시 하기' }).click();
    await expect(result.getByText('규칙에 걸린 표현 없음')).toBeVisible({ timeout: 15000 });
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('phase-03-task-05 AC3: 답글 초안이 말투별로 2개 이상 보이고, 복사·저장되며, 진료 사실 확인 표현을 넣으면 경고한다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/desk/review');
    // 말투는 2개보다 적게 고를 수 없다
    await page.getByLabel('간결하게').uncheck();
    await expect(page.getByLabel('정중하게')).toBeDisabled();
    await expect(page.getByLabel('따뜻하게')).toBeDisabled();
    const panel = page.getByTestId('ai-panel-review_reply');
    await panel.getByLabel('리뷰 내용').fill('직원분들이 정말 친절하고 설명도 자세했어요.');
    await panel.getByRole('button', { name: '답글 초안 만들기' }).click();
    const drafts = page.getByTestId('reply-draft');
    await expect(drafts).toHaveCount(2, { timeout: 15000 });
    await expect(drafts.nth(0)).toContainText('정중하게');
    await expect(drafts.nth(1)).toContainText('따뜻하게');
    const first = await drafts.nth(0).getByRole('textbox').inputValue();
    const second = await drafts.nth(1).getByRole('textbox').inputValue();
    expect(first).not.toBe(second);
    expect(first).not.toContain('[데모 응답]');
    // 날 JSON은 보이지 않는다
    await expect(panel).not.toContainText('"replies"');
    await expect(drafts.nth(0).getByText('진료 사실 확인 표현 없음')).toBeVisible();

    // 복사
    await drafts.nth(0).getByRole('button', { name: '복사' }).click();
    await expect(drafts.nth(0).getByRole('button', { name: '복사했어요' })).toBeVisible();
    // 진료 사실을 밝히는 문장을 넣으면 경고
    await drafts.nth(1).getByRole('textbox').fill(`${second} 지난번 임플란트 치료 받으신 부분도 확인해 보겠습니다.`);
    const warn = drafts.nth(1).getByRole('alert');
    await expect(warn).toContainText('진료 사실을 확인해 주는 표현이 있어요');
    await expect(warn).toContainText('"임플란트"');
    await expect(warn).toContainText('"치료 받으"');
    await drafts.nth(1).getByRole('textbox').fill(second);
    await expect(warn).toBeHidden();

    // 저장 → 답글 보관함
    await drafts.nth(0).getByRole('button', { name: '보관함에 저장' }).click();
    await expect(drafts.nth(0).getByRole('button', { name: '저장했어요' })).toBeVisible();
    const lib = page.getByRole('list', { name: '리뷰 답글 보관함' });
    await expect(lib).toContainText('리뷰 답글 초안(정중하게)');
    await expect(lib).toContainText(first.slice(0, 20));
    expect(errors).toEqual([]);
  });

  test('phase-03-task-05 AC4: 템플릿에 {진료시간}을 넣으면 병원 정보로 바꾼 미리보기가 보이고, 90바이트를 넘으면 "장문", 이하면 "단문"이다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/desk/templates');
    await expect(page.getByRole('heading', { level: 1, name: '안내 문자·안내문 템플릿' })).toBeVisible();
    await page.getByLabel('제목').fill('진료시간 안내');
    const body = page.getByLabel('내용');
    await body.fill('[{병원이름}] 진료시간 안내: ');
    const preview = page.getByTestId('template-preview');
    const bytes = page.getByTestId('sms-bytes');
    // "[하늘숲치과] 진료시간 안내: " = 한글 11자(22바이트) + 기호·빈칸 6자(6바이트) = 28바이트 → 단문
    await expect(preview).toHaveText('[하늘숲치과] 진료시간 안내:');
    await expect(bytes).toContainText('28바이트');
    await expect(bytes).toContainText('단문');

    // 치환자 {진료시간}을 골라 넣는다(커서는 글 끝)
    await body.press('End');
    await page.getByLabel('치환자').selectOption('진료시간');
    await page.getByRole('button', { name: '넣기' }).click();
    await expect(body).toHaveValue('[{병원이름}] 진료시간 안내: {진료시간}');
    await expect(preview).toContainText('토요일 9:30~14:00');
    await expect(preview).toContainText('수요일 14:00~20:30');
    await expect(preview).not.toContainText('{진료시간}');
    await expect(bytes).toContainText('장문');
    await expect(bytes).toContainText('90바이트를 넘어 장문 문자로 보내져요');

    // 복사는 바뀐 글로, 저장하면 보관함에 남는다
    await page.getByRole('button', { name: '바뀐 글 복사' }).click();
    await expect(page.getByRole('button', { name: '복사했어요' })).toBeVisible();
    await page.getByRole('button', { name: '템플릿 저장' }).click();
    await expect(page.getByText('템플릿을 저장했어요.')).toBeVisible();
    const lib = page.getByRole('list', { name: '문자·안내문 템플릿 보관함' });
    await expect(lib).toContainText('진료시간 안내');
    await expect(page.getByRole('heading', { name: '템플릿 고치기' })).toBeVisible();

    // AI 초안을 편집기로 가져온다(데모 표시는 떼고, 병원 정보 치환자를 쓴다)
    await page.getByRole('button', { name: '새 템플릿' }).click();
    await expect(body).toHaveValue('');
    const panel = page.getByTestId('ai-panel-template');
    await panel.getByLabel('무엇을 안내할까요').fill('예약 하루 전 안내');
    await panel.getByRole('button', { name: '초안 만들기' }).click();
    await panel.getByRole('button', { name: '편집기로 가져오기' }).click({ timeout: 15000 });
    await expect(body).toHaveValue(/^\[\{병원이름\}\] \{날짜\} \{시간\} 예약 안내입니다/);
    await expect(preview).toContainText('[하늘숲치과]');
    await expect(bytes).toContainText('단문');
    expect(errors).toEqual([]);
  });

  test('phase-03-task-05 AC5: 치환자 고르기 목록에 환자 이름 치환자가 없고, {이름}을 직접 적으면 경고하며 저장되지 않는다', async ({ page }) => {
    await signIn(page);
    await page.goto('/desk/templates');
    await expect(page.getByLabel('치환자').locator('option').first()).toBeAttached();
    const options =(await page.getByLabel('치환자').locator('option').allTextContents()).map((t) => t.trim());
    expect(options.length).toBeGreaterThanOrEqual(8);
    expect(options.some((t) => t.startsWith('{진료시간}'))).toBe(true);
    expect(options.filter((t) => /이름|성함|환자/.test(t))).toEqual(['{병원이름} 병원 이름']);
    await page.getByLabel('제목').fill('이름 넣은 문자');
    await page.getByLabel('내용').fill('{이름}님 {날짜} 예약입니다.');
    await expect(page.getByRole('alert').filter({ hasText: '환자 개인 정보 치환자라 쓸 수 없어요' })).toBeVisible();
    const before = ((await (await page.request.get('/api/saved-texts?kind=template')).json()) as { data: unknown[] }).data.length;
    await page.getByRole('button', { name: '템플릿 저장' }).click();
    await expect(page.getByText('환자 이름 같은 개인 정보 치환자는 쓸 수 없어요.')).toBeVisible();
    const after = ((await (await page.request.get('/api/saved-texts?kind=template')).json()) as { data: unknown[] }).data.length;
    expect(after).toBe(before);
  });

  for (const [path, heading] of [
    ['/desk/script', '전화 응대 스크립트'],
    ['/desk/review', '리뷰 답글 초안'],
    ['/desk/templates', '안내 문자·안내문 템플릿'],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`phase-03-task-05 화면: ${path} 접근성 위반 0건·가로 스크롤 없음(${theme})`, async ({ browser, isoServer }) => {
        const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
        const page = await ctx.newPage();
        await signIn(page);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        // 결과가 보이는 상태로 검사한다
        if (path === '/desk/script') {
          await page.getByTestId('ai-panel-script').getByRole('button', { name: '스크립트 만들기' }).click();
          await expect(page.getByTestId('ai-output')).toContainText('토요일', { timeout: 15000 });
        } else if (path === '/desk/review') {
          await page.getByLabel('리뷰 내용').fill('친절하게 설명해 주셔서 좋았어요.');
          await page.getByRole('button', { name: '답글 초안 만들기' }).click();
          await expect(page.getByTestId('reply-draft')).toHaveCount(3, { timeout: 15000 });
        } else {
          await page.getByLabel('내용').fill('[{병원이름}] 진료시간 {진료시간}');
          await expect(page.getByTestId('sms-bytes')).toContainText('장문');
        }
        const r = await new AxeBuilder({ page }).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        for (const [w, h] of [
          [1024, 768],
          [390, 844],
        ] as const) {
          await page.setViewportSize({ width: w, height: h });
          const { sw, iw } = await noHorizontalScroll(page);
          expect(sw, `${path} ${w}px`).toBeLessThanOrEqual(iw);
        }
        await ctx.close();
      });
    }
  }
});
