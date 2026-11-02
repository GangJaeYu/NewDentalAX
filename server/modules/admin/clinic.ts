// 이 파일이 하는 일: 병원 기본 정보 API(backend.md §3.2 GET/PUT /api/settings/clinic, FR-042 AC1)를 둔다.
// 값은 settings 테이블의 'clinic' 키에 JSON으로 저장한다(database.md §5): 병원 이름·대표번호·요일별 진료시간(점심 포함, 휴진은 null)·휴진 안내·주차·위치·보험 일반 안내.
// 조회는 로그인한 모든 사용자(AI 안내 스크립트가 이 값을 읽는다), 수정은 admin만(주소별 권한 표 settings.clinic.edit). 수정은 감사 로그에 남긴다.
import type { FastifyInstance } from 'fastify';
import { audit } from '../../lib/audit.ts';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { auditCtx } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { clinicSchema, defaultClinic, type ClinicSettings } from '../../../shared/schemas/admin.ts';

/** settings.clinic에 저장된 원래 값(없거나 깨졌으면 null) */
function readRaw(db: Db): Record<string, unknown> | null {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'clinic'");
  if (!row) return null;
  try {
    const v: unknown = JSON.parse(row.value);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 병원 기본 정보를 읽는다. 아직 다 채우지 않았으면 기본값(평일 09:30~18:30 등) 위에 저장된 값을 얹어 돌려준다.
 * 저장된 값 중 형식이 맞지 않는 항목은 기본값으로 둔다. 다른 모듈(AI 안내 스크립트 등)도 이 함수를 쓴다.
 */
export function readClinic(db: Db): ClinicSettings {
  const raw = readRaw(db) ?? {};
  const base = defaultClinic(typeof raw.name === 'string' ? raw.name : '');
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base) as Array<keyof ClinicSettings>) {
    if (raw[key] === undefined) continue;
    const one = clinicSchema.shape[key].safeParse(raw[key]);
    if (one.success) merged[key] = one.data;
  }
  const all = clinicSchema.safeParse(merged);
  return all.success ? all.data : base;
}

/** 병원 기본 정보를 저장한다(저장값에 이 화면이 모르는 항목이 있으면 남겨 둔다). 바뀐 항목 이름을 돌려준다 */
export function saveClinic(db: Db, clock: Clock, next: ClinicSettings): string[] {
  const prev = readClinic(db);
  const changed = (Object.keys(next) as Array<keyof ClinicSettings>).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
  const value = JSON.stringify({ ...(readRaw(db) ?? {}), ...next });
  db.run(
    "INSERT INTO settings (key, value, updated_at) VALUES ('clinic', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [value, clock.now().toISOString()],
  );
  return changed;
}

/** 병원 기본 정보 API를 등록한다 */
export async function clinicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings/clinic', async () => ({ data: readClinic(app.db) }));

  app.put('/settings/clinic', async (req) => {
    const input = parseInput(clinicSchema, req.body);
    const changed = saveClinic(app.db, app.clock, input);
    audit(auditCtx(req), 'settings.clinic.update', 'settings', 'clinic', { changed });
    return { data: readClinic(app.db) };
  });
}
