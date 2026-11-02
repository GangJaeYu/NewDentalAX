// 이 파일이 하는 일: phase-03-task-08(법정 의무 일정, /facility/legal) 스크린샷 화면 목록. scripts/screenshots.ts가 자동으로 더한다.
// 찍기 전에 관리자 로그인 상태의 API로 예시 기록을 한 번만 넣는다: 파노라마 정기검사(최근 2023-11-23 → D-21), 몇몇 템플릿의 수행일, "해당 없음" 1개.
// 화면: 목록, 항목 자세히 보기 서랍, 항목 추가 대화상자.
import type { Page } from '@playwright/test';
import type { ShotPage } from './types.ts';

/** 템플릿 이름 → 데모 최근 수행일(2026-11-02 기준 여러 상태가 고루 보이게) */
const DONE: ReadonlyArray<[string, string]> = [
  ['개인정보취급자 교육', '2025-10-15'], // 기한 지남
  ['의료폐기물 보관시설 소독', '2026-10-28'], // D-2
  ['개인 피폭선량 측정(TLD)', '2026-08-10'], // D-8
  ['감염병 예방 교육', '2025-11-13'], // D-11
  ['의료폐기물 배출자 교육', '2024-03-15'], // 여유
  ['직장 내 성희롱 예방교육', '2026-03-05'],
];

let seeded = false;

/** 관리자 세션으로 API를 불러 예시 기록을 넣는다(처음 한 번만) */
async function seedLegal(page: Page): Promise<void> {
  if (seeded) return;
  // 스크린샷 브라우저에는 baseURL이 없어서 지금 주소의 origin을 붙인다
  const base = new URL(page.url()).origin;
  const session = (await (await page.request.get(`${base}/api/session`)).json()) as { data: { csrfToken: string } };
  const headers = { 'x-csrf-token': session.data.csrfToken };
  const list = (await (await page.request.get(`${base}/api/legal-tasks`)).json()) as { data: { items: Array<{ id: number; title: string }> } };
  const idOf = (title: string) => list.data.items.find((i) => i.title === title)?.id;
  const r = await page.request.post(`${base}/api/legal-tasks`, {
    headers,
    data: {
      title: '파노라마 정기검사',
      category: 'radiation',
      cycleMonths: 36,
      cycleText: '3년, 만료일 전후 31일이 검사기간',
      basis: '진단용 방사선 규칙 제4조',
      sourceUrl: 'https://www.law.go.kr/법령/진단용방사선발생장치의안전관리에관한규칙',
      verifyStatus: 'verified',
      applicability: 'always',
      appliesText: '항상(구내·파노라마·CBCT)',
      note: '2층 촬영실 파노라마 1대',
      lastDoneOn: '2023-11-23',
    },
  });
  if (r.status() !== 201) throw new Error(`스크린샷용 법정 일정 추가 실패: ${r.status()}`);
  for (const [title, doneOn] of DONE) {
    const id = idOf(title);
    if (id) await page.request.post(`${base}/api/legal-tasks/${id}/done`, { headers, data: { doneOn } });
  }
  const pension = idOf('퇴직연금 가입자 교육');
  if (pension) await page.request.patch(`${base}/api/legal-tasks/${pension}`, { headers, data: { enabled: false } });
  seeded = true;
}

/** 예시 기록을 넣고 다시 그려 waitText가 보일 때까지 기다린다 */
async function withLegalDemo(page: Page, waitText: string): Promise<void> {
  await seedLegal(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

export const pages: ShotPage[] = [
  { name: 'facility-legal', url: '/facility/legal', state: 'user', ready: '법정 의무 일정', action: (page) => withLegalDemo(page, '파노라마 정기검사') },
  {
    name: 'facility-legal-drawer',
    url: '/facility/legal',
    state: 'user',
    ready: '법정 의무 일정',
    action: async (page) => {
      await withLegalDemo(page, '파노라마 정기검사');
      await page.getByRole('row', { name: /파노라마 정기검사/ }).click();
      await page.getByTestId('legal-logs').waitFor({ timeout: 10000 });
    },
  },
  {
    name: 'facility-legal-add',
    url: '/facility/legal',
    state: 'user',
    ready: '법정 의무 일정',
    action: async (page) => {
      await withLegalDemo(page, '파노라마 정기검사');
      await page.getByRole('button', { name: '항목 추가' }).click();
      await page.getByRole('dialog', { name: '법정 일정 추가' }).waitFor({ timeout: 10000 });
    },
  },
];
