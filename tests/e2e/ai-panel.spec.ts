// 이 파일이 하는 일: AI 공용 부품 AiPanel·PrivacyGuard E2E(phase-02-task-03 AC4·AC5). 이 파일 전용 격리 서버(키 없음 = 데모 모드)에서
// /admin/ai의 "AI 시험해 보기" 패널로 확인한다: 빨간 개인정보 안내가 늘 보이고, 전화번호를 치면 노란 경고 → 실행하면 "전화번호 1건을 가리고 보냈습니다"(AC4),
// 월 예산을 0원으로 바꿔 예산 초과 상태에서 실행하면 한국어 안내와 관리자 문의 문구가 보이고, 한도를 올리면 바로 다시 된다(AC5, FR-035 AC3).
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '박원장', username: 'paneladmin', password: 'Panel-Admin-Pass-7' };
const PHONE = '010-1234-5678';

/** 첫 설정(처음 한 번)과 관리자 로그인 */
async function signIn(page: Page): Promise<void> {
  const s = await page.request.get('/api/session');
  if (((await s.json()) as { data: { setupRequired: boolean } }).data.setupRequired) {
    const r = await page.request.post('/api/setup', { data: { ...ADMIN, withDemo: false } });
    expect(r.status()).toBe(201);
  }
  const r = await page.request.post('/api/auth/login', { data: { username: ADMIN.username, password: ADMIN.password } });
  expect(r.status()).toBe(200);
}

/** 월 예산을 바꾼다(AI 설정 화면) */
async function setBudget(page: Page, won: string): Promise<void> {
  await page.getByLabel('월 예산(원)').fill(won);
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByText('AI 설정을 저장했어요').first()).toBeVisible();
}

test.describe.serial('AI 패널', () => {
  test('phase-02-task-03 AC4: AiPanel 입력에 전화번호를 치면 노란 경고가, 실행 후 "전화번호 1건을 가리고 보냈습니다"가 보인다', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/ai');
    const panel = page.getByTestId('ai-panel-quick');
    // 입력창 바로 위 빨간 안내(FR-032 AC5)
    const guard = panel.getByTestId('privacy-guard');
    await expect(guard).toContainText('환자 개인정보 입력 금지');
    await expect(panel.getByTestId('privacy-warning')).toHaveCount(0);

    await panel.getByLabel('시험 요청').fill(`주차 2시간 무료 안내 문자 만들어줘. 문의 ${PHONE}`);
    const warn = panel.getByTestId('privacy-warning');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('전화번호로 보이는 내용이 있어요');
    // 노란색(--warn-weak 바탕, --warn 글자)
    // 브라우저 안 계산은 문자열로 넘긴다(서버용 타입 설정에는 DOM 타입이 없음)
    const colors = (await page.evaluate(`(() => {
      const el = document.querySelector('[data-testid="privacy-warning"]');
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('div');
      probe.style.background = root.getPropertyValue('--warn-weak');
      probe.style.color = root.getPropertyValue('--warn');
      document.body.append(probe);
      const want = { bg: getComputedStyle(probe).backgroundColor, fg: getComputedStyle(probe).color };
      probe.remove();
      return { bg: cs.backgroundColor, fg: cs.color, want };
    })()`)) as { bg: string; fg: string; want: { bg: string; fg: string } };
    expect(colors.bg).toBe(colors.want.bg);
    expect(colors.fg).toBe(colors.want.fg);

    await panel.getByRole('button', { name: '실행' }).click();
    await expect(panel.getByTestId('ai-privacy-notice')).toHaveText('전화번호 1건을 가리고 보냈습니다', { timeout: 15000 });
    const out = panel.getByTestId('ai-output');
    await expect(out).toContainText('[데모 응답]');
    await expect(out).not.toContainText(PHONE);
    await expect(panel.getByTestId('ai-cost')).toHaveText('데모 응답 · 비용 0원');
    await expect(panel).toContainText('AI 초안은 참고용이며 법률 자문을 대신하지 않습니다.');
    // 다시 고쳐 쓰면 경고가 사라진다
    await panel.getByLabel('시험 요청').fill('주차 2시간 무료 안내 문자 만들어줘');
    await expect(panel.getByTestId('privacy-warning')).toHaveCount(0);
  });

  test('phase-02-task-03 AC5: 예산 초과 상태에서 실행하면 한국어 안내와 관리자 문의 문구가 보이고, 한도를 올리면 다시 된다', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/ai');
    await setBudget(page, '0');
    const panel = page.getByTestId('ai-panel-quick');
    await panel.getByLabel('시험 요청').fill('주차 안내 멘트 만들어줘');
    await panel.getByRole('button', { name: '실행' }).click();
    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요.');
    await expect(alert).toContainText('AI 설정에서 월 예산을 올리면 바로 다시 쓸 수 있어요.');
    // 기술 오류 원문(코드·상태 번호)은 보이지 않는다
    await expect(alert).not.toContainText('AI_BUDGET_EXCEEDED');
    await expect(alert).not.toContainText('402');
    await expect(panel.getByTestId('ai-output')).toHaveCount(0);

    // 한도를 올리면 바로 다시 쓸 수 있다
    await setBudget(page, '40000');
    await panel.getByRole('button', { name: '실행' }).click();
    await expect(panel.getByTestId('ai-cost')).toHaveText('데모 응답 · 비용 0원', { timeout: 15000 });
    await expect(panel.getByRole('alert')).toHaveCount(0);
  });
});
