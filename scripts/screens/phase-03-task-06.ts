// 이 파일이 하는 일: phase-03-task-06 화면(AI 문서 작성·회의록 요약·서식 보관함·서식 상세·문서 인쇄)의 스크린샷 목록. scripts/screenshots.ts가 자동으로 더한다.
// 작성·회의록은 데모 공급자로 결과까지 만든 뒤 찍고, 보관함은 처음 한 번 예시 문서 3개를 API로 넣는다(상세·인쇄 화면이 그 문서를 쓴다).
import type { Page } from '@playwright/test';
import type { ShotPage } from './types.ts';

/** 지금 화면의 서버 주소(예: http://localhost:18090) */
function origin(page: Page): string {
  return new URL(page.url()).origin;
}

export const pages: ShotPage[] = [
  // phase-03-task-06: AI 문서 작성(데모 초안까지)·회의록 요약(정리 결과까지)·서식 보관함(예시 문서 3개)·서식 상세·문서 인쇄
  {
    name: 'docs-writer',
    url: '/docs/writer',
    state: 'user',
    ready: '무엇을 쓸까요',
    action: async (page) => {
      const panel = page.getByTestId('ai-panel-doc_writer');
      await panel.getByLabel('요점').fill('임플란트 수술 후 주의사항, 거즈 2시간, 음주·흡연 금지, 이상하면 연락');
      await panel.getByRole('button', { name: '초안 만들기' }).click();
      await page.getByRole('article', { name: '문서 미리보기' }).waitFor();
    },
  },
  {
    name: 'docs-minutes',
    url: '/docs/minutes',
    state: 'user',
    ready: '회의 메모',
    action: async (page) => {
      const panel = page.getByTestId('ai-panel-minutes');
      await panel.getByLabel('회의 메모').fill('- 다음 주부터 오전 예약 간격을 30분으로 바꾸기로 결정\n- 예약 안내 문자 문구 고치기 (데스크 담당, 11월 6일까지)\n- 멸균기 점검표 새로 만들기 위생사가 11/10까지');
      await panel.getByRole('button', { name: '정리하기' }).click();
      await page.getByTestId('minutes-result').waitFor();
    },
  },
  {
    name: 'docs-library',
    url: '/docs/library',
    state: 'user',
    ready: '서식 보관함',
    action: async (page) => {
      // 처음 한 번만 예시 문서 3개를 API로 넣고 다시 그린다
      const list = (await (await page.request.get(`${origin(page)}/api/documents`)).json()) as { total: number };
      if (list.total === 0) {
        const s = (await (await page.request.get(`${origin(page)}/api/session`)).json()) as { data: { csrfToken: string } };
        const docs = [
          { kind: 'notice_patient', title: '임플란트 수술 후 주의사항 안내', body_md: '# 임플란트 수술 후 주의사항 안내\n\n## 수술 당일\n- 거즈는 **2시간** 동안 꼭 물고 계세요.\n- 뜨거운 음식과 빨대 사용은 피해 주세요.\n\n## 바로 연락 주세요\n- 피가 멈추지 않거나 많이 부을 때', folder: '환자 안내', tags: ['임플란트', '수술 후'] },
          { kind: 'official', title: '연말 휴진 안내 공문', body_md: '# 연말 휴진 안내\n\n- **수신**: 거래처 담당자 각위\n- **참조**: 없음\n- **제목**: 연말 휴진 안내\n\n## 본문\n1. 귀사의 무궁한 발전을 기원합니다.\n2. 당원은 12월 31일부터 1월 1일까지 휴진합니다.\n\n## 붙임\n1. 휴진 일정표 1부.  끝.', folder: '공문', tags: ['휴진'] },
          { kind: 'policy', title: '감염 관리 내부 규정', body_md: '# 감염 관리 내부 규정\n\n## 기준\n- 사용한 기구는 바로 세척실로 옮깁니다.\n- 멸균기 점검 기록은 매일 남깁니다.', folder: '규정', tags: ['감염 관리', '멸균'] },
        ];
        for (const d of docs) await page.request.post(`${origin(page)}/api/documents`, { data: d, headers: { 'x-csrf-token': s.data.csrfToken } });
        await page.reload({ waitUntil: 'networkidle' });
      }
      await page.getByRole('row', { name: /감염 관리 내부 규정/ }).waitFor();
    },
  },
  { name: 'docs-library-detail', url: '/docs/library/1', state: 'user', ready: '버전 기록' },
  { name: 'print-document', url: '/print/document/2', state: 'user', ready: '인쇄하기' },
];
