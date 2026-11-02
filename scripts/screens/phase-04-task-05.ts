// 이 파일이 하는 일: phase-04-task-05(알림센터 완성) 화면의 스크린샷 목록. scripts/screenshots.ts가 이 파일의 pages를 자동으로 더한다.
// FR-090 AC2 알림 종류가 모두 섞인 알림 화면과, "모두 읽음"을 누른 뒤 "읽지 않음" 거르기의 빈 상태를 찍는다.
// 찍기 전에 관리자(원장)가 받을 예시 알림을 서버 DB에 한 번만 넣는다. 서버 데이터 폴더는 이번 실행의 .tmp/screens/run-* 중 가장 최근 것이다.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { appDbPath, openDb } from '../../server/db/index.ts';
import { fixedClock } from '../../server/lib/clock.ts';
import { emitNotification } from '../../server/modules/notifications/emit.ts';
import type { ShotPage } from './types.ts';

/** 이번 스크린샷 실행의 서버 데이터 폴더(가장 최근 run-* 중 app.db가 있는 것) */
function currentDataDir(): string {
  const base = path.join(process.cwd(), '.tmp', 'screens');
  const runs = fs
    .readdirSync(base)
    .filter((n) => /^run-\d+$/.test(n) && fs.existsSync(appDbPath(path.join(base, n))))
    .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)));
  if (!runs[0]) throw new Error('스크린샷 서버의 데이터 폴더(.tmp/screens/run-*)를 찾지 못했어요.');
  return path.join(base, runs[0]);
}

let seeded = false;

/** 알림 종류마다 예시 알림을 한 건씩 원장에게 넣는다(처음 한 번만) */
function ensureKinds(): void {
  if (seeded) return;
  const db = openDb(appDbPath(currentDataDir()));
  const clock = fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00');
  try {
    const admin = db.get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1");
    const me = admin ? [admin.id] : [];
    const kinds = [
      { type: 'leave_result', userIds: me, title: '11월 6일(금) 반차(오전) 신청이 승인됐어요', link: '/hr/leave' },
      { type: 'stock_expiry', userIds: me, title: '표면 마취 젤 유효기간이 D-12예요', body: '2026-11-14까지 · 남은 3개', link: '/inventory' },
      { type: 'legal_due', userIds: me, title: '개인 피폭선량 측정(TLD) 기한이 8일 남았어요', body: '다음 예정일 2026-11-10', link: '/facility/legal' },
      { type: 'sterilizer_fail', userIds: me, title: '오토클레이브 1호기 BI(생물학적 지표) 불합격이에요', body: '조치를 기록해 주세요', link: '/facility/sterilizer' },
      { type: 'notice', userIds: me, title: '새 공지: 11월 회식 안내', body: '금요일 저녁 7시', link: '/desk/board' },
    ];
    for (const k of kinds) emitNotification(db, { ...k, dedupeKey: `shot45:${k.type}` }, clock);
  } finally {
    db.close();
  }
  seeded = true;
}

/** 예시 알림을 넣고 화면을 다시 그린 뒤 waitText가 보일 때까지 기다린다 */
async function withKinds(page: Page, waitText: string): Promise<void> {
  ensureKinds();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

export const pages: ShotPage[] = [
  { name: 'notifications-kinds', url: '/notifications', state: 'user', ready: '알림', action: (page) => withKinds(page, 'BI(생물학적 지표) 불합격') },
  {
    name: 'notifications-read-all',
    url: '/notifications',
    state: 'user',
    ready: '알림',
    action: async (page) => {
      await withKinds(page, 'BI(생물학적 지표) 불합격');
      const all = page.getByRole('button', { name: '모두 읽음' });
      if (await all.isEnabled()) await all.click();
      await page.getByText('읽지 않은 알림 0개').waitFor({ timeout: 10000 });
      await page.getByRole('group', { name: '알림 거르기' }).getByRole('button', { name: '읽지 않음' }).click();
      await page.getByText('읽지 않은 알림이 없어요').waitFor({ timeout: 10000 });
    },
  },
];
