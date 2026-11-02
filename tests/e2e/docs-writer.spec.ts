// 이 파일이 하는 일: AI 문서 작성·서식 상세·문서 인쇄 E2E(phase-03-task-06 AC1·AC2·AC5·AC6). 이 파일 전용 격리 서버를 가짜 LLM 서버(tests/fake-llm)에 연결하고
// 가짜 키(가짜 서버로만 감)로 Anthropic 공급자를 켠다. 스트림 조각 사이 시간을 늘려 "점차 표시 → 중지"를 확실히 보고, 다시 생성 → 저장 → 보관함 버전 1(AC1),
// 고쳐 저장 → 버전 2와 이전 버전 내용(AC2), <script> 본문이 미리보기·인쇄에서 실행되지 않음(AC5), 인쇄 PDF의 A4·머리말(병원명)·쪽 번호(AC6)를 확인한다.
import type { Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';
import { startFakeLlm, type FakeLlm } from '../fake-llm/server.ts';
import { apiCreateDoc, signIn, watchErrors } from './docs-helpers.ts';
import { expect, test } from './fixtures.ts';

/** 가짜 키(가짜 LLM 서버로만 간다) */
const KEY = 'sk-ant-e2e-ONLYFAKE-docs-4Qx8';
const DRAFT = [
  '# 임플란트 수술 후 주의사항 안내',
  '',
  '## 수술 당일',
  '- 거즈는 2시간 동안 꼭 물고 계세요.',
  '- 뜨거운 음식과 빨대 사용은 피해 주세요.',
  '',
  '## 일주일 동안',
  '- 술과 담배는 피해 주세요.',
  '- 처방받은 약은 시간에 맞춰 드세요.',
  '',
  '## 바로 연락 주세요',
  '- 피가 멈추지 않거나 많이 부을 때 병원으로 연락해 주세요.',
].join('\n');

let fake: FakeLlm;
let csrf = '';

test.beforeAll(async () => {
  fake = await startFakeLlm();
});

test.afterAll(async () => {
  await fake.close();
});

/** 이 파일의 테스트 서버가 가짜 LLM 서버 주소를 쓰게 한다(처음 한 번 다시 켬) */
test.beforeEach(async ({ isoServer }) => {
  if (isoServer.extraEnv.AI_BASE_URL_ANTHROPIC === fake.url) return;
  isoServer.extraEnv = { AI_BASE_URL_ANTHROPIC: fake.url, AI_BASE_URL_OPENAI: fake.url, AI_BASE_URL_GEMINI: fake.url };
  await isoServer.stop();
  await isoServer.start();
});

/** 로그인하고, 공급자를 Anthropic(가짜 키)으로 켠다 */
async function setup(page: Page): Promise<void> {
  csrf = await signIn(page);
  const r = await page.request.put('/api/ai/settings', { data: { provider: 'anthropic', keys: { anthropic: KEY } }, headers: { 'x-csrf-token': csrf } });
  expect(r.status()).toBe(200);
}

test.describe.serial('AI 문서 작성·서식 상세·인쇄', () => {
  test('phase-03-task-06 AC1: 환자 안내문 + 요점 → 스트리밍으로 초안이 점차 표시 → 중지 → 다시 생성 → 저장 → 서식 보관함에 버전 1', async ({ page }) => {
    const errors = watchErrors(page);
    await setup(page);
    fake.setReply(DRAFT, { input: 900, output: 400 });
    fake.setStream({ pieces: 12, gapMs: 700 });
    await page.goto('/docs/writer');
    await expect(page.getByRole('heading', { level: 1, name: 'AI 문서 작성' })).toBeVisible();
    await page.getByLabel('문서 종류').selectOption({ label: '환자 안내문' });
    const panel = page.getByTestId('ai-panel-doc_writer');
    await panel.getByLabel('요점').fill('임플란트 수술 후 주의사항, 거즈 2시간, 음주·흡연 금지, 이상하면 연락');
    await panel.getByRole('button', { name: '초안 만들기' }).click();

    // 스트림: 글이 조금씩 늘어난다
    const out = panel.getByTestId('ai-output');
    await expect(panel.getByText('받는 중')).toBeVisible();
    await expect(out).toContainText('임플란트', { timeout: 15000 });
    const first = ((await out.textContent()) ?? '').length;
    await expect.poll(async () => ((await out.textContent()) ?? '').length, { timeout: 10000 }).toBeGreaterThan(first);
    // 끝까지 오기 전에 중지
    await panel.getByRole('button', { name: '중지' }).click();
    await expect(panel.getByText('중지함')).toBeVisible();
    await expect(panel.getByText('중지했어요. 지금까지 받은 글만 보여요.')).toBeVisible();
    await expect(out).not.toContainText('병원으로 연락해 주세요');
    expect(await fake.waitClosedEarly(5000)).toBe(true);
    const stoppedLen = ((await out.textContent()) ?? '').length;
    await page.waitForTimeout(1500);
    expect(((await out.textContent()) ?? '').length).toBe(stoppedLen);
    // 편집기는 아직 비어 있다(다 받은 초안만 옮김)
    await expect(page.getByText('왼쪽에서 초안을 만들면 여기에서 바로 고칠 수 있어요.')).toBeVisible();

    // 다시 생성(이번에는 빨리 끝까지)
    fake.setStream({ pieces: 4, gapMs: 20 });
    await panel.getByRole('button', { name: '다시 생성' }).click();
    await expect(panel.getByTestId('ai-cost')).toBeVisible({ timeout: 15000 });
    await expect(out).toContainText('병원으로 연락해 주세요');
    await expect(page.getByLabel('제목')).toHaveValue('임플란트 수술 후 주의사항 안내');
    await expect(page.getByLabel('본문')).toHaveValue(DRAFT);
    // 미리보기(A4 종이 모양)
    const preview = page.getByRole('article', { name: '문서 미리보기' });
    await expect(preview).toContainText('하늘숲치과');
    await expect(preview.getByRole('heading', { name: '임플란트 수술 후 주의사항 안내' })).toBeVisible();

    await page.getByLabel('폴더').fill('환자 안내');
    await page.getByLabel('태그').fill('임플란트, 수술 후');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('서식 보관함에 저장했어요(버전 1).')).toBeVisible();
    await expect(page.getByText('버전 1 저장됨')).toBeVisible();

    // 서식 보관함에 나타나고 버전 1
    await page.goto('/docs/library');
    const row = page.getByRole('row', { name: /임플란트 수술 후 주의사항 안내/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('환자 안내문');
    await expect(row).toContainText('버전 1');
    await expect(row).toContainText('#임플란트');
    await expect(page.getByText('문서 1개')).toBeVisible();
    expect(fake.requests.length).toBe(2);
    expect(errors).toEqual([]);
  });

  test('phase-03-task-06 AC2: 수정 후 저장하면 버전 2가 생기고 이전 버전 내용을 볼 수 있다', async ({ page }) => {
    const errors = watchErrors(page);
    await setup(page);
    await page.goto('/docs/library');
    await page.getByRole('row', { name: /임플란트 수술 후 주의사항 안내/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: '임플란트 수술 후 주의사항 안내' })).toBeVisible();
    await expect(page.getByTestId('version-1')).toContainText('버전 1 (지금)');

    await page.getByRole('button', { name: '고치기' }).click();
    const body = page.getByLabel('본문');
    await body.fill(`${DRAFT}\n- 수술 다음 날 소독하러 오세요.`);
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장했어요(버전 2).')).toBeVisible();
    await expect(page.getByTestId('version-2')).toContainText('버전 2 (지금)');
    await expect(page.getByRole('article', { name: '문서 미리보기' })).toContainText('수술 다음 날 소독하러 오세요.');

    // 새로고침해도 버전 기록이 남고, 버전 1 내용을 열어 볼 수 있다
    await page.reload();
    await expect(page.getByTestId('version-2')).toBeVisible();
    await page.getByTestId('version-1').getByRole('button', { name: '내용 보기' }).click();
    const dialog = page.getByRole('dialog', { name: '버전 1 내용' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('version-body')).toContainText('피가 멈추지 않거나 많이 부을 때');
    await expect(dialog.getByTestId('version-body')).not.toContainText('수술 다음 날 소독하러 오세요.');
    await dialog.getByRole('button', { name: '닫기' }).first().click();
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('phase-03-task-06 AC2: 부분 고치기 "더 짧게"는 고른 부분만 AI 결과로 바꾼다', async ({ page }) => {
    await setup(page);
    // 먼저 초안을 받아 편집기를 채운다
    fake.setReply(DRAFT, { input: 900, output: 400 });
    fake.setStream({ pieces: 2, gapMs: 10 });
    await page.goto('/docs/writer');
    const panel = page.getByTestId('ai-panel-doc_writer');
    await panel.getByLabel('요점').fill('스케일링 후 주의');
    await panel.getByRole('button', { name: '초안 만들기' }).click();
    await expect(page.getByLabel('본문')).toHaveValue(DRAFT, { timeout: 15000 });

    fake.setReply('- 거즈 2시간 물기', { input: 50, output: 10 });
    const target = '- 거즈는 2시간 동안 꼭 물고 계세요.';
    const start = DRAFT.indexOf(target);
    await page.getByLabel('본문').evaluate((el, [s, e]) => (el as unknown as { setSelectionRange(a: number, b: number): void }).setSelectionRange(s as number, e as number), [start, start + target.length]);
    await page.getByRole('button', { name: '더 짧게' }).click();
    await expect(page.getByText('고른 부분을 "더 짧게"로 고쳤어요.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('본문')).toHaveValue(DRAFT.replace(target, '- 거즈 2시간 물기'));
    const last = fake.requests.at(-1)?.rawBody ?? '';
    expect(last).toContain('더 짧게 줄여 주세요');
    expect(last).toContain('거즈는 2시간 동안 꼭 물고 계세요.');
    expect(last).not.toContain('술과 담배는 피해 주세요.');
  });

  test('phase-03-task-06 AC5: <script>가 든 본문을 저장해도 미리보기·인쇄에서 실행되지 않는다(XSS)', async ({ page }) => {
    const errors = watchErrors(page);
    await setup(page);
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    const payload = '<script>window.__xss = 1; alert("xss")</script>';
    const img = '<img src=x onerror="window.__xss = 2">';
    const id = await apiCreateDoc(page, csrf, { kind: 'other', title: '보안 시험 <b>문서</b>', body_md: `# 보안 시험\n\n${payload}\n\n${img}\n\n**굵게** 글` });

    for (const path of [`/docs/library/${id}`, `/print/document/${id}`]) {
      await page.goto(path);
      const paper = page.getByRole('article', { name: '문서 미리보기' });
      await expect(paper).toContainText(payload);
      await expect(paper).toContainText(img);
      await expect(paper.locator('strong', { hasText: '굵게' })).toBeVisible();
      await expect(paper.getByRole('heading', { name: '보안 시험 <b>문서</b>' })).toBeVisible();
      expect(await paper.locator('script, img, b').count()).toBe(0);
      expect(await page.evaluate('window.__xss === undefined')).toBe(true);
    }
    expect(dialogs).toBe(0);
    expect(errors).toEqual([]);
  });

  test('phase-03-task-06 AC6: 문서 인쇄 PDF에 A4·머리말(병원명)·쪽 번호가 있고 버튼은 찍히지 않는다', async ({ page }) => {
    await setup(page);
    const lines = Array.from({ length: 70 }, (_, i) => `- 확인 항목 ${i + 1}: 기구 세척과 멸균 기록을 남깁니다.`);
    const id = await apiCreateDoc(page, csrf, { kind: 'policy', title: '감염 관리 규정', body_md: `# 감염 관리 규정\n\n## 기준\n${lines.join('\n')}` });
    await page.goto(`/print/document/${id}`);
    await expect(page.getByTestId('print-document')).toContainText('확인 항목 70');
    await expect(page.getByRole('button', { name: '인쇄하기' })).toBeVisible();
    const pdf = await page.pdf({ format: 'A4' });
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    expect(doc.numPages).toBeGreaterThanOrEqual(2);
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
    // A4 = 210×297mm. 브라우저는 픽셀 단위로 반올림하므로 1mm 안쪽 차이는 같은 크기로 본다
    const mm = (pt: number) => (pt * 25.4) / 72;
    expect(Math.abs(mm(vp.width) - 210)).toBeLessThan(1);
    expect(Math.abs(mm(vp.height) - 297)).toBeLessThan(1);
    const { text } = await extractText(doc, { mergePages: false });
    const pages = text as string[];
    pages.forEach((t, i) => {
      expect(t, `${i + 1}쪽 머리말`).toContain('하늘숲치과');
      expect(t.replace(/\s+/g, ' '), `${i + 1}쪽 쪽 번호`).toContain(`${i + 1} / ${pages.length}`);
      expect(t, `${i + 1}쪽에 버튼 없음`).not.toContain('인쇄하기');
    });
    expect(pages.join('\n')).toContain('확인 항목 70');
  });
});
