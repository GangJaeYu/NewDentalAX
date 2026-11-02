// 이 파일이 하는 일: 원내 AI 도우미 화면 E2E(phase-03-task-07 AC1~AC6, FR-070·071). 이 파일 전용 격리 서버(키 없음 = 데모 공급자)에 데모 데이터(매뉴얼 5종)를 넣고 쓴다.
// AC1 근거 카드·원문 링크, AC2 근거 없음 안내와 ai_usage 0건, AC3 실장님 이상 공개 문서가 직원 질문 근거에서 빠짐, AC4 pdf·docx 업로드 완료·조각 수와 손상 pdf 실패 이유,
// AC5 전화번호 문서의 검토·"가리고 저장"·가린 발췌, AC6 지운 문서가 근거에서 빠짐. 그 밖에 대화 지우기, 화면별 axe 위반 0건(두 테마)과 4너비 가로 스크롤 없음을 본다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';
import { noHorizontalScroll, watchErrors, WIDTHS } from './docs-helpers.ts';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '박원장', username: 'kbadmin', password: 'Kb-Admin-Pass-7' };
const MANAGER = { username: 'kbmanager', password: 'Kb-Manager-Pass-7' };
const STAFF = { username: 'kbstaff', password: 'Kb-Staff-Pass-7' };
const FILES = path.join(process.cwd(), 'tests', 'fixtures', 'kb-files');
const B_AND_D = '멸균기 B&D 테스트는 언제 해?';
const STERIL_TITLE = '하늘숲치과 기구 세척·멸균 매뉴얼';

/** 첫 설정(데모 데이터 포함, 처음 한 번)·직원 계정 준비와 로그인. CSRF 토큰을 돌려준다 */
async function signIn(page: Page, isoServer: IsoServer, who: { username: string; password: string } = ADMIN): Promise<string> {
  const s = await page.request.get('/api/session');
  if (((await s.json()) as { data: { setupRequired: boolean } }).data.setupRequired) {
    const r = await page.request.post('/api/setup', { data: { ...ADMIN, withDemo: true } });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, '이실장');
    await isoServer.addUser('staff', STAFF.username, STAFF.password, '김직원');
  }
  const r = await page.request.post('/api/auth/login', { data: { username: who.username, password: who.password } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken;
}

/** 새 브라우저 창(쿠키 따로)으로 로그인한다 */
async function openAs(browser: Browser, isoServer: IsoServer, who: { username: string; password: string }, opts: { width?: number; height?: number; theme?: 'light' | 'dark' } = {}) {
  const ctx = await browser.newContext({
    baseURL: isoServer.baseURL,
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.theme ?? 'light',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await ctx.newPage();
  await signIn(page, isoServer, who);
  return { ctx, page };
}

/** ai_usage 줄 수(테스트 서버 DB를 읽기 전용으로 연다) */
function aiUsageCount(isoServer: IsoServer): number {
  const db = new DatabaseSync(path.join(isoServer.dataDir, 'app.db'), { readOnly: true });
  try {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get() as { n: number }).n);
  } finally {
    db.close();
  }
}

/** 질문 칸에 적고 보낸 뒤 새 답(마지막 답)을 돌려준다 */
async function ask(page: Page, question: string) {
  // 대화 기록을 다 불러온 뒤에 센다
  await expect(page.getByTestId('assistant-chat')).toHaveAttribute('data-loaded', 'true');
  const before = await page.getByTestId('assistant-answer').count();
  await page.getByRole('textbox', { name: '질문' }).fill(question);
  await page.getByRole('button', { name: '질문하기' }).click();
  await expect(page.getByTestId('assistant-answer')).toHaveCount(before + 1, { timeout: 15000 });
  return page.getByTestId('assistant-answer').last();
}

/** 원내 문서 올리기 대화상자에서 파일을 올린다 */
async function uploadFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, opts: { visibility?: '전체 직원' | '실장님 이상'; title?: string } = {}) {
  await page.goto('/docs/assistant?tab=docs');
  await page.getByRole('button', { name: '원내 문서 올리기' }).first().click();
  const dialog = page.getByRole('dialog', { name: '원내 문서 올리기' });
  await dialog.locator('input[type=file]').setInputFiles(file);
  await expect(dialog.getByTestId('kb-picked')).toContainText(file.name);
  if (opts.title) await dialog.getByLabel('제목').fill(opts.title);
  if (opts.visibility) await dialog.getByLabel('공개 범위').selectOption({ label: opts.visibility });
  await dialog.getByRole('button', { name: '올리기', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const md = (name: string, body: string) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(body, 'utf8') });

test.describe.serial('원내 AI 도우미', () => {
  test('phase-03-task-07 AC1: "멸균기 B&D 테스트는 언제 해?" → 답 아래 근거 카드에 멸균 매뉴얼 이름과 발췌, 링크로 원문이 열린다', async ({ page, isoServer }) => {
    const errors = watchErrors(page);
    await signIn(page, isoServer, STAFF);
    await page.goto('/docs/assistant');
    await expect(page.getByRole('heading', { level: 1, name: '원내 AI 도우미' })).toBeVisible();
    await expect(page.getByText('무엇이든 물어보세요')).toBeVisible();
    const answer = await ask(page, B_AND_D);
    await expect(answer).toContainText('데모 응답');
    const card = answer.getByRole('listitem', { name: /^근거 1: .*멸균/ });
    await expect(card).toBeVisible();
    await expect(card).toContainText(STERIL_TITLE);
    await expect(card.locator('blockquote')).toContainText('B&D');
    // 답 속 근거 번호는 카드로 가는 링크
    await expect(answer.getByRole('link', { name: '[1] 근거로 가기' })).toBeVisible();
    await card.getByRole('link', { name: /원문 보기/ }).click();
    await expect(page).toHaveURL(/\/docs\/assistant\?doc=\d+&chunk=\d+/);
    const viewer = page.getByRole('dialog', { name: STERIL_TITLE });
    await expect(viewer).toBeVisible();
    const cited = viewer.locator('section[aria-current="true"]');
    await expect(cited).toContainText('근거로 쓴 부분');
    await expect(cited).toContainText('B&D');
    await expect(cited).toBeInViewport();
    // 새로 고쳐도(링크 주소로 바로 열어도) 원문이 열린다
    await page.reload();
    await expect(page.getByRole('dialog', { name: STERIL_TITLE }).locator('section[aria-current="true"]')).toContainText('B&D');
    await page.getByRole('dialog', { name: STERIL_TITLE }).getByRole('button', { name: '닫기' }).click();
    await expect(page).toHaveURL(/\/docs\/assistant$/);
    // 대화 기록이 남아 다시 들어와도 보인다
    await page.goto('/docs/assistant');
    await expect(page.getByTestId('assistant-answer')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('phase-03-task-07 AC2: 관련 없는 질문 → "원내 문서에서 찾지 못했습니다" + 문서 올리기 안내, ai_usage에 기록이 없다', async ({ page, isoServer }) => {
    await signIn(page, isoServer, ADMIN);
    const before = aiUsageCount(isoServer);
    await page.goto('/docs/assistant');
    const answer = await ask(page, '오늘 주식 시세 알려줘');
    await expect(answer).toContainText('원내 문서에서 찾지 못했습니다.');
    await expect(answer).toContainText('근거 없음');
    await expect(answer).toContainText('"오늘 주식 시세"에 관한 원내 규정이나 매뉴얼을 "원내 문서" 탭에서 올리면');
    await expect(answer.getByRole('list', { name: '근거' })).toHaveCount(0);
    expect(aiUsageCount(isoServer)).toBe(before);
    // 안내 버튼으로 바로 올리기 화면이 열린다
    await answer.getByRole('button', { name: '원내 문서 올리기' }).click();
    await expect(page.getByRole('dialog', { name: '원내 문서 올리기' })).toBeVisible();
    await expect(page).toHaveURL(/tab=docs/);
    await page.getByRole('dialog', { name: '원내 문서 올리기' }).getByRole('button', { name: '닫기' }).first().click();
  });

  test('phase-03-task-07 AC3: 실장님 이상 공개 문서는 직원 질문의 근거로 쓰이지 않고 직원 목록에도 없다', async ({ browser, isoServer }) => {
    const m = await openAs(browser, isoServer, MANAGER);
    await uploadFile(m.page, md('금고 관리.md', '# 원장실 금고 관리\n\n## 금고 열쇠 보관\n금고 열쇠는 원장실 책상 오른쪽 서랍 안 잠금함에 보관한다. 퇴근할 때 잠금함을 잠근다.'), { visibility: '실장님 이상' });
    const row = m.page.getByRole('row', { name: /원장실 금고 관리/ });
    await expect(row).toContainText('실장님 이상');
    await expect(row).toContainText('완료');
    await m.page.goto('/docs/assistant');
    const mAnswer = await ask(m.page, '금고 열쇠는 어디에 보관해?');
    await expect(mAnswer.getByRole('listitem', { name: /^근거 1: 원장실 금고 관리/ })).toBeVisible();
    await m.ctx.close();

    const s = await openAs(browser, isoServer, STAFF);
    await s.page.goto('/docs/assistant');
    const sAnswer = await ask(s.page, '금고 열쇠는 어디에 보관해?');
    await expect(sAnswer).not.toContainText('원장실 금고 관리');
    await expect(sAnswer).toContainText('원내 문서에서 찾지 못했습니다.');
    await expect(sAnswer).toContainText('실장님께 올려 달라고');
    await s.page.getByRole('button', { name: '원내 문서', exact: true }).click();
    await expect(s.page.getByRole('row', { name: new RegExp(STERIL_TITLE) })).toBeVisible();
    await expect(s.page.getByRole('row', { name: /원장실 금고 관리/ })).toHaveCount(0);
    // 직원에게는 올리기·지우기가 없다
    await expect(s.page.getByRole('button', { name: '원내 문서 올리기' })).toHaveCount(0);
    await expect(s.page.getByRole('button', { name: /지우기$/ })).toHaveCount(0);
    await s.ctx.close();
  });

  test('phase-03-task-07 AC4: pdf·docx 샘플이 완료가 되고 조각 수가 보인다. 손상된 pdf는 실패와 이유가 보인다', async ({ page, isoServer }) => {
    await signIn(page, isoServer, MANAGER);
    await uploadFile(page, { name: '진료실 정리 규정.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(FILES, 'clinic-cleanup.pdf')) });
    await expect(page.getByText(/"진료실 정리 규정"을\(를\) 올렸어요\. 조각 \d+개로 나눴어요\./)).toBeVisible();
    const pdfRow = page.getByRole('row', { name: /진료실 정리 규정/ });
    await expect(pdfRow).toContainText('완료');
    await expect(pdfRow.getByRole('cell').nth(4)).toHaveText(/^[1-9]\d*개$/);

    await uploadFile(page, { name: '엑스레이실 규정.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(path.join(FILES, 'xray-room.docx')) }, { title: '엑스레이실 사용 규정' });
    const docxRow = page.getByRole('row', { name: /엑스레이실 사용 규정/ });
    await expect(docxRow).toContainText('완료');
    await expect(docxRow.getByRole('cell').nth(4)).toHaveText(/^[1-9]\d*개$/);

    await uploadFile(page, { name: '깨진 매뉴얼.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog\nbroken file without xref\n') });
    const badRow = page.getByRole('row', { name: /깨진 매뉴얼/ });
    await expect(badRow).toContainText('실패');
    await expect(badRow).toContainText('PDF 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요.');
    await expect(badRow.getByRole('cell').nth(4)).toHaveText('—');

    // HWP는 올리기 전에 막는다
    await page.getByRole('button', { name: '원내 문서 올리기' }).first().click();
    const dialog = page.getByRole('dialog', { name: '원내 문서 올리기' });
    await dialog.locator('input[type=file]').setInputFiles({ name: '규정.hwp', mimeType: 'application/x-hwp', buffer: Buffer.alloc(100, 1) });
    await expect(dialog.getByRole('alert')).toContainText('TXT·MD·PDF·DOCX 파일만 올릴 수 있어요.');
    await dialog.getByRole('button', { name: '닫기' }).first().click();

    // 올린 pdf 내용으로 답한다
    await page.goto('/docs/assistant');
    const answer = await ask(page, '유니트체어 표면은 언제 닦아?');
    await expect(answer.getByRole('listitem', { name: /^근거 1: 진료실 정리 규정/ })).toBeVisible();
  });

  test('phase-03-task-07 AC5: 전화번호가 든 문서는 검토 필요와 감지 항목이 보이고, "가리고 저장" 뒤 발췌에 번호가 가려져 있다', async ({ page, isoServer }) => {
    await signIn(page, isoServer, MANAGER);
    await uploadFile(page, md('거래처 연락.md', '# 거래처 연락 규정\n\n## 재료 주문 연락\n재료 주문은 거래처 담당자에게 010-2345-6789로 연락한다. 주문서 사본은 데스크 서랍에 둔다.'));
    const review = page.getByRole('dialog', { name: '개인정보 검토' });
    await expect(review).toBeVisible();
    await expect(review.getByTestId('kb-findings')).toHaveText('감지 항목: 전화번호 1건');
    await expect(review.getByRole('list', { name: '가린 모습 미리보기' })).toContainText('담당자에게 [전화번호]로 연락한다');
    await expect(review).not.toContainText('6789');
    // 닫아도 목록에 검토 필요로 남는다
    await review.getByRole('button', { name: '닫기' }).click();
    const row = page.getByRole('row', { name: /거래처 연락 규정/ });
    await expect(row).toContainText('검토 필요');
    await expect(row).toContainText('감지 항목: 전화번호 1건');
    await row.getByRole('button', { name: '검토하기' }).click();
    await review.getByRole('button', { name: '가리고 저장' }).click();
    await expect(review).toBeHidden();
    await expect(row).toContainText('완료');

    await page.goto('/docs/assistant');
    const answer = await ask(page, '재료 주문은 어디로 연락해?');
    const card = answer.getByRole('listitem', { name: /^근거 1: 거래처 연락 규정/ });
    await expect(card.locator('blockquote')).toContainText('[전화번호]');
    await expect(answer).not.toContainText('6789');
  });

  test('phase-03-task-07 AC6: 문서를 지우면 이후 질문의 근거에 나오지 않고, 지난 근거 카드는 "지워진 문서"로 바뀐다', async ({ page, isoServer }) => {
    await signIn(page, isoServer, ADMIN);
    await page.goto('/docs/assistant');
    const first = await ask(page, B_AND_D);
    await expect(first.getByRole('listitem', { name: new RegExp(`^근거 1: ${STERIL_TITLE}`) })).toBeVisible();

    await page.getByRole('button', { name: '원내 문서', exact: true }).click();
    await page.getByRole('row', { name: new RegExp(STERIL_TITLE) }).getByRole('button', { name: `${STERIL_TITLE} 지우기` }).click();
    const confirm = page.getByRole('dialog', { name: '문서 지우기' });
    await confirm.getByRole('button', { name: '지우기' }).click();
    await expect(page.getByText('문서를 지웠어요.')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(STERIL_TITLE) })).toHaveCount(0);

    await page.getByRole('button', { name: '대화', exact: true }).click();
    const prev = page.getByTestId('assistant-answer').last();
    await expect(prev.getByRole('listitem', { name: new RegExp(`^근거 1: ${STERIL_TITLE}`) })).toContainText('지워진 문서');
    await expect(prev.getByRole('listitem', { name: new RegExp(`^근거 1: ${STERIL_TITLE}`) }).getByRole('link', { name: /원문 보기/ })).toHaveCount(0);
    const after = await ask(page, B_AND_D);
    await expect(after).not.toContainText(STERIL_TITLE);
  });

  test('대화 지우기: 내 대화 기록을 모두 지우면 처음 안내가 다시 보인다', async ({ page, isoServer }) => {
    await signIn(page, isoServer, STAFF);
    await page.goto('/docs/assistant');
    await expect(page.getByTestId('assistant-answer').first()).toBeVisible();
    await page.getByRole('button', { name: '대화 지우기' }).click();
    await page.getByRole('dialog', { name: '대화 지우기' }).getByRole('button', { name: '모두 지우기' }).click();
    await expect(page.getByText('무엇이든 물어보세요')).toBeVisible();
    await page.reload();
    await expect(page.getByText('무엇이든 물어보세요')).toBeVisible();
    // 예시 질문 버튼으로 바로 물어본다
    await page.getByRole('button', { name: '연차 신청은 며칠 전까지 해야 돼?' }).click();
    await expect(page.getByTestId('assistant-answer')).toHaveCount(1, { timeout: 15000 });
  });

  /** 확인할 화면과 준비 동작(관리자, 데모 데이터) */
  const SCREENS: Array<{ name: string; path: string; ready: (page: Page) => Promise<void> }> = [
    {
      name: '대화(답·근거 카드)',
      path: '/docs/assistant',
      ready: async (page) => {
        if (!(await page.getByTestId('assistant-answer').count())) await ask(page, '연차 신청은 며칠 전까지 해야 돼?');
        await expect(page.getByTestId('assistant-answer').first()).toBeVisible();
      },
    },
    { name: '원내 문서 목록', path: '/docs/assistant?tab=docs', ready: async (page) => void (await expect(page.getByRole('row', { name: /연차/ })).toBeVisible()) },
    {
      name: '원문 보기',
      path: '/docs/assistant?tab=docs',
      ready: async (page) => {
        await page.getByRole('link', { name: /재고 관리/ }).first().click();
        await expect(page.getByTestId('kb-viewer')).toBeVisible();
      },
    },
    {
      name: '올리기 대화상자',
      path: '/docs/assistant?tab=docs',
      ready: async (page) => {
        await page.getByRole('button', { name: '원내 문서 올리기' }).first().click();
        await expect(page.getByRole('dialog', { name: '원내 문서 올리기' })).toBeVisible();
      },
    },
  ];

  for (const theme of ['light', 'dark'] as const) {
    for (const s of SCREENS) {
      test(`phase-03-task-07 화면: ${s.name} 접근성 위반 0건(${theme})`, async ({ browser, isoServer }) => {
        const { ctx, page } = await openAs(browser, isoServer, ADMIN, { theme });
        await page.goto(s.path);
        await s.ready(page);
        const r = await new AxeBuilder({ page }).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        await ctx.close();
      });
    }
  }

  for (const s of SCREENS) {
    test(`phase-03-task-07 화면: ${s.name} 4너비에서 가로 스크롤이 없다`, async ({ browser, isoServer }) => {
      for (const [width, height] of WIDTHS) {
        const { ctx, page } = await openAs(browser, isoServer, ADMIN, { width, height });
        await page.goto(s.path);
        await s.ready(page);
        const m = await noHorizontalScroll(page);
        expect(m.sw, `${s.name} ${width}px 가로 스크롤`).toBeLessThanOrEqual(m.iw);
        await ctx.close();
      }
    });
  }
});
