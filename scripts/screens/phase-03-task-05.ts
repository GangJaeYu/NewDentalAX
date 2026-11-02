// 이 파일이 하는 일: phase-03-task-05 화면(전화 응대 스크립트·리뷰 답글 초안·문자/안내문 템플릿)의 스크린샷 목록. scripts/screenshots.ts가 자동으로 더한다.
// 처음 한 번 보관함 예시 문구(스크립트 2·답글 1·템플릿 2)를 API로 넣고, 각 화면은 데모 공급자로 결과까지 만든 뒤 찍는다(템플릿은 미리보기·바이트 표시까지).
import type { Page } from '@playwright/test';
import type { ShotPage } from './types.ts';

/** 지금 화면의 서버 주소 */
function origin(page: Page): string {
  return new URL(page.url()).origin;
}

/** 보관함 예시 문구를 처음 한 번만 넣는다 */
async function withSavedTexts(page: Page): Promise<void> {
  const list = (await (await page.request.get(`${origin(page)}/api/saved-texts`)).json()) as { total: number };
  if (list.total > 0) return;
  const s = (await (await page.request.get(`${origin(page)}/api/session`)).json()) as { data: { csrfToken: string } };
  const texts = [
    { kind: 'script', category: '진료시간 문의', title: '진료시간 문의 기본 응대', body: '직원: 안녕하세요, 하늘숲치과입니다. 무엇을 도와드릴까요?\n직원: 저희 진료시간은 월~금 9:30~18:30(점심시간 13:00~14:00), 토요일 9:30~14:00, 일요일 휴진입니다.', shared: true },
    { kind: 'script', category: '주차 문의', title: '주차 문의 응대', body: '직원: 건물 지하 1~2층 주차장을 이용하시면 되고, 1시간 무료 주차를 등록해 드립니다.' },
    { kind: 'review_reply', category: '좋은 리뷰', title: '친절 칭찬 리뷰 답글', body: '안녕하세요, 하늘숲치과입니다. 따뜻한 리뷰 남겨 주셔서 감사합니다. 앞으로도 편안한 치과가 되도록 노력하겠습니다.', shared: true },
    { kind: 'template', category: '예약 안내', title: '예약 하루 전 안내(단문)', body: '[{병원이름}] {날짜} {시간} 예약 안내입니다. 변경은 {대표번호}', shared: true },
    { kind: 'template', category: '휴진 안내', title: '연말 휴진 안내(장문)', body: '[{병원이름}] 연말 휴진 안내\n12월 31일과 1월 1일은 휴진합니다.\n- 평소 진료시간: {진료시간}\n- 문의: {대표번호}' },
  ];
  for (const t of texts) await page.request.post(`${origin(page)}/api/saved-texts`, { data: t, headers: { 'x-csrf-token': s.data.csrfToken } });
  await page.reload({ waitUntil: 'networkidle' });
}

export const pages: ShotPage[] = [
  // phase-03-task-05: 스크립트(데모 결과까지)·리뷰 답글(초안 3개)·템플릿({진료시간} 미리보기와 장문 표시)
  {
    name: 'desk-script',
    url: '/desk/script',
    state: 'user',
    ready: '스크립트 만들기',
    action: async (page) => {
      await withSavedTexts(page);
      await page.getByTestId('ai-panel-script').getByRole('button', { name: '스크립트 만들기' }).click();
      await page.getByTestId('ai-panel-script').getByRole('button', { name: '보관함에 저장' }).waitFor();
    },
  },
  {
    name: 'desk-review',
    url: '/desk/review',
    state: 'user',
    ready: '리뷰 붙여 넣기',
    action: async (page) => {
      await withSavedTexts(page);
      await page.getByLabel('리뷰 내용').fill('직원분들이 친절하고 설명도 자세했어요. 대기 시간이 조금 길었던 건 아쉬워요.');
      await page.getByRole('button', { name: '답글 초안 만들기' }).click();
      await page.getByTestId('reply-draft').nth(2).waitFor();
    },
  },
  {
    name: 'desk-templates',
    url: '/desk/templates',
    state: 'user',
    ready: '템플릿 쓰기',
    action: async (page) => {
      await withSavedTexts(page);
      await page.getByLabel('제목').fill('진료시간 안내');
      await page.getByLabel('내용').fill('[{병원이름}] 진료시간 안내\n{진료시간}\n문의 {대표번호}');
      await page.getByTestId('sms-bytes').getByText('장문', { exact: true }).waitFor();
    },
  },
];
