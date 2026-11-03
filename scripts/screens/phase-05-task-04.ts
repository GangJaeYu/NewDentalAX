// 이 파일이 하는 일: README에 넣을 대표 화면 목록(phase-05-task-04). 어떤 화면을 어떤 파일 이름(docs/images/<file>.png)·크기로 찍는지 적어 둔다.
// 실제 촬영은 scripts/readme-shots.ts가 한다(데모 데이터를 넣은 임시 서버에서 1440 라이트 중심 + 휴대폰 1장).
// 일반 스크린샷 점검(npm run screenshots)은 데모 데이터 없이 4너비×2테마로 찍으므로, 여기서는 pages를 비워 두고 README용 목록(readmeShots)만 따로 내보낸다.
// 화면이 바뀌면(예: phase-05-task-03 병합 뒤) `node scripts/readme-shots.ts`를 다시 실행하면 같은 이름으로 다시 찍힌다.
import type { Page } from '@playwright/test';
import type { ShotPage } from './types.ts';

/** README용 화면 한 장: 화면 정보 + 저장할 파일 이름 + 화면 크기 + README에서 쓰는 설명 */
export interface ReadmeShot extends ShotPage {
  /** docs/images/ 안의 파일 이름(확장자 .png 제외) */
  file: string;
  width: number;
  height: number;
  /** README 그림 설명(대체 글) */
  alt: string;
}

/** 원내 AI 도우미에 질문 하나를 보내고 답이 나올 때까지 기다린다(데모 응답, 비용 0원) */
async function askAssistant(page: Page): Promise<void> {
  const box = page.getByLabel('질문', { exact: true });
  await box.fill('멸균기 B&D 테스트는 언제 해?');
  await box.press('Enter');
  await page.getByTestId('assistant-answer').first().waitFor({ timeout: 15000 });
}

/** AI 문서 작성기에서 데모 초안을 하나 만든다 */
async function writeDemoDoc(page: Page): Promise<void> {
  const panel = page.getByTestId('ai-panel-doc_writer');
  await panel.getByLabel('요점').fill('임플란트 수술 후 주의사항, 거즈 2시간, 음주·흡연 금지, 이상하면 연락');
  await panel.getByRole('button', { name: '초안 만들기' }).click();
  await page.getByRole('article', { name: '문서 미리보기' }).waitFor({ timeout: 15000 });
}

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** README 대표 화면 목록(순서 = README에 나오는 순서) */
export const readmeShots: ReadmeShot[] = [
  { file: 'setup', name: 'readme-setup', url: '/setup', state: 'setup', ready: '첫 설정', ...DESK, alt: '첫 설정 화면' },
  { file: 'dashboard', name: 'readme-dashboard', url: '/', state: 'user', ready: '오늘 할 일', ...DESK, alt: '대시보드: 오늘 할 일·재고 경고·다가오는 점검' },
  { file: 'desk-board', name: 'readme-desk-board', url: '/desk/board', state: 'user', ready: '11월 원내 감염관리 교육 일정 안내', ...DESK, alt: '공지·인수인계 보드' },
  { file: 'inventory', name: 'readme-inventory', url: '/inventory', state: 'user', ready: '니트릴 글러브 M', ...DESK, alt: '재고 현황' },
  { file: 'docs-writer', name: 'readme-docs-writer', url: '/docs/writer', state: 'user', ready: '무엇을 쓸까요', action: writeDemoDoc, ...DESK, alt: 'AI 문서 작성기(데모 초안)' },
  { file: 'docs-assistant', name: 'readme-docs-assistant', url: '/docs/assistant', state: 'user', ready: '원내 AI 도우미', action: askAssistant, ...DESK, alt: '원내 AI 도우미(근거 문서와 함께 답)' },
  { file: 'facility-legal', name: 'readme-facility-legal', url: '/facility/legal', state: 'user', ready: '파노라마 정기검사', ...DESK, alt: '법정 의무 일정' },
  { file: 'admin-ai', name: 'readme-admin-ai', url: '/admin/ai', state: 'user', ready: 'AI 시험해 보기', ...DESK, alt: 'AI 설정·예산(키 입력)' },
  { file: 'admin-backup', name: 'readme-admin-backup', url: '/admin/backup', state: 'user', ready: '보관할 백업 개수', ...DESK, alt: '백업·복원' },
  { file: 'phone-dashboard', name: 'readme-phone-dashboard', url: '/', state: 'user', ready: '오늘 할 일', ...PHONE, alt: '휴대폰에서 본 대시보드' },
];

/** 일반 스크린샷 점검(scripts/screenshots.ts)에 더할 화면: 없음(README용은 readmeShots로 따로 찍는다) */
export const pages: ShotPage[] = [];
