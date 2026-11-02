// 이 파일이 하는 일: phase-04-task-07 화면(채용 공고·면접 질문)의 스크린샷 목록. scripts/screenshots.ts가 자동으로 더한다.
// 처음 한 번 보관함 예시 공고 1건(kind=hiring)을 API로 넣고, 근무 조건에 "20대 여성 우대"를 넣어 데모 초안을 만든 뒤
// 입력 경고·공고 경고·면접 질문(직무·태도·상황)이 모두 보이는 모습을 찍는다. 두 번째 장면은 경고 없이 만든 깨끗한 초안이다.
import type { Page } from '@playwright/test';
import type { ShotPage } from './types.ts';

/** 지금 화면의 서버 주소 */
function origin(page: Page): string {
  return new URL(page.url()).origin;
}

/** 보관함 예시 공고를 처음 한 번만 넣는다 */
async function withSavedHiring(page: Page): Promise<void> {
  const list = (await (await page.request.get(`${origin(page)}/api/saved-texts?kind=hiring`)).json()) as { data?: unknown[] };
  if ((list.data?.length ?? 0) > 0) return;
  const s = (await (await page.request.get(`${origin(page)}/api/session`)).json()) as { data: { csrfToken: string } };
  await page.request.post(`${origin(page)}/api/saved-texts`, {
    headers: { 'x-csrf-token': s.data.csrfToken },
    data: {
      kind: 'hiring',
      category: '치과위생사',
      title: '치과위생사 정규직 채용 공고',
      body: '## 하늘숲치과 치과위생사 채용\n\n### 근무 조건\n- 주 5일(월~금 9:30~18:30)\n- 4대 보험, 연차 15일\n\n## 면접 질문\n\n### 직무 질문\n- 스케일링 전후로 기구 준비와 소독을 어떤 순서로 하셨는지 말씀해 주세요.\n\n### 태도 질문\n- 바쁜 시간에 동료와 일을 어떻게 나누고 도우시나요?\n\n### 상황 질문\n- 오래 기다린 환자가 데스크에서 화를 내면 어떻게 하시겠어요?',
      meta: { jobType: '치과위생사', conditions: '주 5일(월~금 9:30~18:30), 4대 보험, 연차 15일', preferred: '' },
      shared: true,
    },
  });
  await page.reload({ waitUntil: 'networkidle' });
}

/** 근무 조건을 넣고 데모 초안을 만든다 */
async function makeDraft(page: Page, conditions: string): Promise<void> {
  const panel = page.getByTestId('ai-panel-hiring');
  await panel.getByLabel('근무 조건', { exact: true }).fill(conditions);
  await panel.getByRole('button', { name: '공고 초안 만들기' }).click();
  await page.getByTestId('hiring-questions').waitFor({ timeout: 15000 });
  await page.getByTestId('hiring-risk-posting').waitFor({ timeout: 15000 });
}

export const pages: ShotPage[] = [
  {
    // 차별 소지 표현 경고가 보이는 모습(입력 칸 + 공고)
    name: 'hr-hiring',
    url: '/hr/hiring',
    state: 'user',
    ready: '어떤 분을 뽑나요',
    action: async (page) => {
      await withSavedHiring(page);
      await page.getByLabel('우대 사항(선택)').fill('치과 근무 경력 1년 이상');
      await makeDraft(page, '주 5일(월~금 9:30~18:30), 4대 보험, 20대 여성 우대');
    },
  },
  {
    // 경고 없는 초안과 면접 질문, 보관함이 보이게 아래로 내린 모습
    name: 'hr-hiring-draft',
    url: '/hr/hiring',
    state: 'user',
    ready: '어떤 분을 뽑나요',
    action: async (page) => {
      await withSavedHiring(page);
      await makeDraft(page, '주 5일(월~금 9:30~18:30), 4대 보험, 연차 15일');
      await page.getByTestId('hiring-questions').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
];
