// 이 파일이 하는 일: phase-06-task-03 화면(회의록 화면의 녹음 파일 받아쓰기)의 스크린샷 목록. scripts/screenshots.ts가 자동으로 더한다.
// 처음 화면(경고·녹음 고르기)과, 데모 공급자로 녹음을 받아써 회의 메모 칸에 넣은 뒤 화면을 찍는다.
import type { ShotPage } from './types.ts';

/** 가짜 m4a(앞부분 'ftyp' 머리) */
function fakeM4a(): Buffer {
  const b = Buffer.alloc(4096, 0x11);
  Buffer.from([0x00, 0x00, 0x00, 0x20]).copy(b, 0);
  Buffer.from('ftypM4A ', 'latin1').copy(b, 4);
  return b;
}

export const pages: ShotPage[] = [
  { name: 'docs-minutes-recording', url: '/docs/minutes', state: 'user', ready: '휴대폰 녹음 파일을 끌어다 놓거나 눌러서 고르세요' },
  {
    name: 'docs-minutes-transcribed',
    url: '/docs/minutes',
    state: 'user',
    ready: '휴대폰 녹음 파일을 끌어다 놓거나 눌러서 고르세요',
    action: async (page) => {
      await page.getByRole('article', { name: '녹음 파일로 받아쓰기' }).locator('input[type=file]').setInputFiles({ name: '직원회의.m4a', mimeType: 'audio/mp4', buffer: fakeM4a() });
      await page.getByLabel('환자 이야기가 들어간 녹음이 아닌 것을 확인했어요').check();
      await page.getByRole('button', { name: '받아쓰기' }).click();
      await page.getByTestId('recording-done').waitFor();
    },
  },
];
