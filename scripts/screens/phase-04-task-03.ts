// 이 파일이 하는 일: phase-04-task-03(장비 점검·멸균기 기록, /facility/equipment·/facility/sterilizer와 인쇄 화면) 스크린샷 화면 목록. scripts/screenshots.ts가 자동으로 더한다.
// 찍기 전에 관리자 로그인 상태의 API로 예시 데이터를 한 번만 넣는다: 장비 4대(1호기는 마지막 점검 2026-05-10 → D-8), 점검·수리 이력,
// 멸균기 2대의 지난 14일 기록(B&D·사이클·BI)과 조치 전 불합격 1건. 화면: 장비 목록, 장비 서랍, 멸균 기록(경고 띠), 멸균 기록 인쇄, 장비 대장 인쇄.
import type { Page } from '@playwright/test';
import type { ShotPage } from './types.ts';

let seeded: { st1: number } | null = null;

/** 관리자 세션으로 API를 불러 예시 데이터를 넣는다(처음 한 번만) */
async function seedEquipment(page: Page): Promise<{ st1: number }> {
  if (seeded) return seeded;
  const base = new URL(page.url()).origin;
  const session = (await (await page.request.get(`${base}/api/session`)).json()) as { data: { csrfToken: string } };
  const headers = { 'x-csrf-token': session.data.csrfToken };
  const post = async (path: string, data: Record<string, unknown>): Promise<number> => {
    const r = await page.request.post(`${base}${path}`, { headers, data });
    if (r.status() !== 201) throw new Error(`스크린샷용 데이터 넣기 실패(${path}): ${r.status()}`);
    return ((await r.json()) as { data: { id: number } }).data.id;
  };
  const st1 = await post('/api/equipment', { name: '오토클레이브 1호기', kind: 'sterilizer', installedOn: '2022-03-15', vendorName: '한빛메디칼', inspectCycleMonths: 6, memo: '진공형(B형), 소독실 왼쪽' });
  const st2 = await post('/api/equipment', { name: '오토클레이브 2호기', kind: 'sterilizer', installedOn: '2024-08-01', vendorName: '한빛메디칼', inspectCycleMonths: 6 });
  const xray = await post('/api/equipment', { name: '파노라마 촬영장치', kind: 'xray', installedOn: '2020-11-23', vendorName: '바른영상', inspectCycleMonths: 12 });
  const comp = await post('/api/equipment', { name: '공기 압축기(컴프레서)', kind: 'compressor', installedOn: '2019-04-01', vendorName: '하늘덴탈서비스', inspectCycleMonths: 3 });
  await post(`/api/equipment/${st1}/logs`, { date: '2025-11-10', kind: 'inspection', content: '정기 점검: 도어 패킹·안전밸브 확인', vendorName: '한빛메디칼' });
  await post(`/api/equipment/${st1}/logs`, { date: '2026-02-03', kind: 'repair', content: '급수 펌프 소음 → 펌프 교체', cost: 280000, vendorName: '한빛메디칼' });
  await post(`/api/equipment/${st1}/logs`, { date: '2026-05-10', kind: 'inspection', content: '정기 점검: 챔버 청소, 필터 교체', vendorName: '한빛메디칼' });
  await post(`/api/equipment/${st2}/logs`, { date: '2026-08-20', kind: 'inspection', content: '정기 점검: 이상 없음' });
  await post(`/api/equipment/${xray}/logs`, { date: '2025-10-28', kind: 'inspection', content: '업체 정기 점검(화질·출력 확인)' });
  await post(`/api/equipment/${comp}/logs`, { date: '2026-09-01', kind: 'inspection', content: '오일 교환, 드레인 밸브 점검' });
  await post(`/api/equipment/${comp}/logs`, { date: '2026-07-14', kind: 'repair', content: '압력 스위치 교체', cost: 380000 });
  let n = 0;
  for (let d = 13; d >= 0; d -= 1) {
    const date = new Date(Date.UTC(2026, 10, 2 - d)).toISOString().slice(0, 10);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
    for (const eq of [st1, st2]) {
      n += 1;
      await post('/api/sterilizer-logs', { equipmentId: eq, date, testType: 'bd', cycleNo: String(1000 + n), tempC: 134, pressureKpa: 216, minutes: 3.5, result: eq === st2 && d === 0 ? 'fail' : 'pass' });
      n += 1;
      await post('/api/sterilizer-logs', { equipmentId: eq, date, testType: 'cycle', cycleNo: String(1000 + n), tempC: 134, pressureKpa: 216, minutes: 4, result: 'pass' });
    }
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 1) {
      n += 1;
      await post('/api/sterilizer-logs', { equipmentId: st1, date, testType: 'bi', cycleNo: String(1000 + n), tempC: 134, pressureKpa: 216, minutes: 4, result: 'pass' });
    }
  }
  seeded = { st1 };
  return seeded;
}

/** 예시 데이터를 넣고 다시 그려 waitText가 보일 때까지 기다린다 */
async function withEquipmentDemo(page: Page, waitText: string): Promise<{ st1: number }> {
  const s = await seedEquipment(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
  return s;
}

export const pages: ShotPage[] = [
  { name: 'facility-equipment', url: '/facility/equipment', state: 'user', ready: '장비 점검·유지보수', action: async (page) => void (await withEquipmentDemo(page, '오토클레이브 1호기')) },
  {
    name: 'facility-equipment-drawer',
    url: '/facility/equipment',
    state: 'user',
    ready: '장비 점검·유지보수',
    action: async (page) => {
      await withEquipmentDemo(page, '오토클레이브 1호기');
      await page.getByRole('row', { name: /오토클레이브 1호기/ }).click();
      await page.getByTestId('equipment-logs').waitFor({ timeout: 10000 });
    },
  },
  { name: 'facility-sterilizer', url: '/facility/sterilizer', state: 'user', ready: '멸균기 점검 기록', action: async (page) => void (await withEquipmentDemo(page, '조치하지 않은 멸균 불합격')) },
  {
    name: 'print-sterilizer',
    url: '/print/sterilizer?from=2026-10-20&to=2026-11-02',
    state: 'user',
    ready: '멸균기 점검 기록 인쇄',
    action: async (page) => void (await withEquipmentDemo(page, '확인자')),
  },
  {
    name: 'print-equipment',
    url: '/facility/equipment',
    state: 'user',
    ready: '장비 점검·유지보수',
    action: async (page) => {
      const s = await withEquipmentDemo(page, '오토클레이브 1호기');
      await page.goto(new URL(`/print/equipment/${s.st1}`, page.url()).toString(), { waitUntil: 'networkidle' });
      await page.getByText('장비 대장 — 오토클레이브 1호기').waitFor({ timeout: 10000 });
    },
  },
];
