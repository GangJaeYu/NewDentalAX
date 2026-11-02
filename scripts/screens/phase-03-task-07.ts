// 이 파일이 하는 일: phase-03-task-07 화면(원내 AI 도우미: 대화·근거 카드, 원내 문서 목록, 원문 보기, 개인정보 검토)의 스크린샷 목록. scripts/screenshots.ts가 자동으로 더한다.
// 스크린샷 서버는 데모 데이터 없이 시작하므로, 처음 한 번 데모 매뉴얼 5종(tests/fixtures/kb)과 검토 필요(전화번호)·실패(손상된 PDF) 예시를 API로 올리고, 질문 두 개(근거 있음·없음)를 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { ShotPage } from './types.ts';

const KB_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'kb');

/** 지금 화면의 서버 주소(예: http://localhost:18090) */
function origin(page: Page): string {
  return new URL(page.url()).origin;
}

/** 예시 자료와 대화를 처음 한 번만 넣고 화면을 다시 그린다 */
async function withKbDemo(page: Page): Promise<void> {
  const base = origin(page);
  const docs = (await (await page.request.get(`${base}/api/kb/docs`)).json()) as { data: unknown[] };
  if (docs.data.length === 0) {
    const s = (await (await page.request.get(`${base}/api/session`)).json()) as { data: { csrfToken: string } };
    const headers = { 'x-csrf-token': s.data.csrfToken };
    const set = JSON.parse(fs.readFileSync(path.join(KB_DIR, 'eval-set.json'), 'utf8')) as { docs: { file: string }[] };
    const files = [
      ...set.docs.map((d) => ({ name: d.file, mimeType: 'text/markdown', buffer: fs.readFileSync(path.join(KB_DIR, d.file)) })),
      { name: '거래처 연락.md', mimeType: 'text/markdown', buffer: Buffer.from('# 거래처 연락 규정\n\n## 재료 주문 연락\n재료 주문은 거래처 담당자에게 010-2345-6789로 연락한다.', 'utf8') },
      { name: '깨진 매뉴얼.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nbroken file\n') },
    ];
    for (const file of files) await page.request.post(`${base}/api/kb/docs`, { headers, multipart: { file } });
    for (const question of ['멸균기 B&D 테스트는 언제 해?', '오늘 주식 시세 알려줘']) {
      await page.request.post(`${base}/api/assistant/ask`, { headers, data: { question } });
    }
    await page.reload({ waitUntil: 'networkidle' });
  }
}

export const pages: ShotPage[] = [
  // phase-03-task-07: 대화(근거 카드·근거 없음 안내)·원내 문서 목록(완료·검토 필요·실패)·원문 보기(근거 조각 강조)·개인정보 검토 대화상자
  {
    name: 'docs-assistant',
    url: '/docs/assistant',
    state: 'user',
    ready: '원내 AI 도우미',
    action: async (page) => {
      await withKbDemo(page);
      await page.getByTestId('assistant-answer').nth(1).waitFor();
    },
  },
  {
    name: 'docs-assistant-docs',
    url: '/docs/assistant?tab=docs',
    state: 'user',
    ready: '원내 AI 도우미',
    action: async (page) => {
      await withKbDemo(page);
      await page.getByRole('row', { name: /깨진 매뉴얼/ }).waitFor();
    },
  },
  {
    name: 'docs-assistant-viewer',
    url: '/docs/assistant',
    state: 'user',
    ready: '원내 AI 도우미',
    action: async (page) => {
      await withKbDemo(page);
      await page.getByRole('link', { name: /원문 보기/ }).first().click();
      await page.getByTestId('kb-viewer').waitFor();
    },
  },
  {
    name: 'docs-assistant-review',
    url: '/docs/assistant?tab=docs',
    state: 'user',
    ready: '원내 AI 도우미',
    action: async (page) => {
      await withKbDemo(page);
      await page.getByRole('button', { name: '검토하기' }).first().click();
      await page.getByTestId('kb-review').waitFor();
    },
  },
];
