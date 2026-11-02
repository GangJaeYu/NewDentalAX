// 이 파일이 하는 일: admin 모듈(직원 계정·병원 설정)의 데모 데이터(database.md §11, TD-024). 가상 치과 "하늘숲치과"의 직원 9명과 병원 기본 정보를 넣는다.
// 직원은 모두 가상 인물이고 환자 정보는 없다. 로그인 가능한 실제 비밀번호는 첫 설정에서 만든 관리자만 갖고,
// 데모 직원은 무작위 비밀번호 + must_change_pw=1이라 관리자가 비밀번호를 초기화해 줘야 로그인할 수 있다.
// 관리자가 이미 있으면(첫 설정에서 만든 계정) 데모 원장 계정은 만들지 않고 나머지 8명만 넣어 모두 9명이 된다. 같은 아이디가 있으면 건너뛴다.
// 모양은 server/db/seed/types.ts의 ModuleSeed다. 등록은 server/db/seed/registry.ts가 이미 해 두었다.
import { randomBytes } from 'node:crypto';
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { hashPassword } from '../../auth/password.ts';
import { addDays, kstDate } from '../../lib/dates.ts';

/**
 * 이 모듈이 소유한 업무 테이블. users·settings는 초기화 때 "관리자만 남김·설정 유지" 규칙으로 따로 다루므로(demo-service.ts)
 * 여기서 비울 대상으로 적지 않는다.
 */
export const tables: readonly string[] = [];

/** 데모 직원 한 명 */
interface DemoStaff {
  username: string;
  name: string;
  role: 'admin' | 'manager' | 'staff';
  jobType: 'hygienist' | 'assistant' | 'desk' | 'doctor' | 'other';
  /** 기준일로부터 며칠 전에 입사했는지 */
  hiredDaysAgo: number;
}

/** 하늘숲치과 직원 9명(가상 인물). 첫 줄 원장은 관리자가 없을 때만 넣는다 */
export const DEMO_STAFF: readonly DemoStaff[] = [
  { username: 'director', name: '한서준', role: 'admin', jobType: 'doctor', hiredDaysAgo: 2900 },
  { username: 'yoongaram', name: '윤가람', role: 'manager', jobType: 'hygienist', hiredDaysAgo: 2100 },
  { username: 'jeonghaneul', name: '정하늘', role: 'staff', jobType: 'hygienist', hiredDaysAgo: 1300 },
  { username: 'ohsodam', name: '오소담', role: 'staff', jobType: 'hygienist', hiredDaysAgo: 700 },
  { username: 'limchaeun', name: '임채운', role: 'staff', jobType: 'hygienist', hiredDaysAgo: 120 },
  { username: 'seodaon', name: '서다온', role: 'staff', jobType: 'assistant', hiredDaysAgo: 950 },
  { username: 'baenuri', name: '배누리', role: 'staff', jobType: 'assistant', hiredDaysAgo: 40 },
  { username: 'moonjian', name: '문지안', role: 'manager', jobType: 'desk', hiredDaysAgo: 1600 },
  { username: 'joeunsol', name: '조은솔', role: 'staff', jobType: 'desk', hiredDaysAgo: 400 },
];

/** 하늘숲치과 병원 기본 정보(가상). 이미 적힌 항목(첫 설정의 병원 이름 등)은 덮지 않는다 */
export const DEMO_CLINIC = {
  name: '하늘숲치과',
  phone: '02-123-4567',
  hours: {
    mon: { open: '09:30', close: '18:30', lunch: '13:00-14:00' },
    tue: { open: '09:30', close: '18:30', lunch: '13:00-14:00' },
    wed: { open: '09:30', close: '20:30', lunch: '13:00-14:00' },
    thu: { open: '09:30', close: '18:30', lunch: '13:00-14:00' },
    fri: { open: '09:30', close: '18:30', lunch: '13:00-14:00' },
    sat: { open: '09:30', close: '14:00' },
    sun: null,
  },
  holidayNote: '일요일·공휴일 휴진',
  parking: '건물 지하 주차장 2시간 무료',
  location: '하늘숲역 2번 출구에서 걸어서 3분, 숲빛빌딩 3층',
  insuranceNote: '스케일링은 만 19세 이상 연 1회 건강보험이 적용됩니다.',
} as const;

/** 데모 직원과 병원 정보를 넣는다 */
export async function seedDemo(db: Db, ctx: SeedContext): Promise<void> {
  const now = ctx.clock.now();
  const nowIso = now.toISOString();
  const today = kstDate(now);
  const hasAdmin = !!db.get("SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1");
  const list = DEMO_STAFF.filter((s) => s.role !== 'admin' || !hasAdmin);
  const existing = new Set(db.all<{ username: string }>('SELECT username FROM users').map((r) => r.username.toLowerCase()));
  // 비밀번호 해시는 오래 걸리므로 트랜잭션 밖에서 먼저 만든다(무작위 비밀번호, 아무도 모름)
  const rows: Array<DemoStaff & { hash: string }> = [];
  for (const s of list) {
    if (existing.has(s.username.toLowerCase())) continue;
    rows.push({ ...s, hash: await hashPassword(randomBytes(18).toString('base64url')) });
  }
  db.tx(() => {
    for (const s of rows) {
      db.run(
        'INSERT INTO users (username, name, role, job_type, hired_on, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
        [s.username, s.name, s.role, s.jobType, addDays(today, -s.hiredDaysAgo), s.hash, nowIso, nowIso],
      );
    }
    // 병원 정보: 비어 있는 항목만 채운다
    const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'clinic'");
    let current: Record<string, unknown> = {};
    try {
      if (row) current = JSON.parse(row.value) as Record<string, unknown>;
    } catch {
      current = {};
    }
    const merged: Record<string, unknown> = { ...DEMO_CLINIC };
    for (const [k, v] of Object.entries(current)) if (v !== null && v !== undefined && v !== '') merged[k] = v;
    db.run(
      "INSERT INTO settings (key, value, updated_at) VALUES ('clinic', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [JSON.stringify(merged), nowIso],
    );
  });
}
