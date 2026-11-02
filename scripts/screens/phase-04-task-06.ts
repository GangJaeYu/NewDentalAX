// 이 파일이 하는 일: phase-04-task-06 화면(의료광고 문구 점검·블로그/SNS 홍보 글)의 스크린샷 목록. scripts/screenshots.ts가 자동으로 더한다.
// 점검 화면은 예시 문장("국내 최고 임플란트, 100% 성공, 지금 50% 할인")을 점검한 결과까지, 홍보 글 화면은 데모 초안과 자동 점검 결과까지 만든 뒤 찍는다.
import type { ShotPage } from './types.ts';

export const pages: ShotPage[] = [
  {
    name: 'docs-adcheck',
    url: '/docs/adcheck',
    state: 'user',
    ready: '점검 규칙 사전',
    action: async (page) => {
      await page.getByRole('textbox', { name: '점검할 글' }).fill('국내 최고 임플란트, 100% 성공, 지금 50% 할인');
      await page.getByRole('button', { name: '점검하기' }).click();
      await page.getByTestId('adcheck-ai').waitFor();
    },
  },
  {
    // 규칙 사전 표(관리자: 추가·고치기·끄기 버튼)가 보이게 아래로 내린 모습
    name: 'docs-adcheck-rules',
    url: '/docs/adcheck',
    state: 'user',
    ready: '점검 규칙 사전',
    action: async (page) => {
      await page.getByRole('row').filter({ hasText: '전문병원' }).waitFor();
      await page.getByRole('article', { name: '점검 규칙 사전' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
  },
  {
    name: 'docs-promo',
    url: '/docs/promo',
    state: 'user',
    ready: '무엇을 쓸까요',
    action: async (page) => {
      const panel = page.getByTestId('ai-panel-promo');
      await panel.getByLabel('주제').fill('스케일링 주기 안내, 지역 최고 무료 스케일링 이벤트');
      await panel.getByRole('button', { name: '초안 만들기' }).click();
      await page.getByTestId('adcheck-ai').waitFor({ timeout: 15000 });
    },
  },
];
