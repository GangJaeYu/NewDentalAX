// 이 파일이 하는 일: 백업·복원·데모 초기화 API(backend.md §3.2)의 입력 모양(zod)과 응답 타입, 확인 문구를 정한다.
// 서버는 이 스키마로 입력을 검사하고, 화면은 같은 확인 문구·보관 개수 범위를 써서 미리 막는다. 문구는 쉬운 한국어로 쓴다.
import { z } from 'zod';

/** 복원할 때 그대로 입력해야 하는 문구 */
export const RESTORE_CONFIRM = '복원합니다';
/** 데모 데이터 초기화 때 그대로 입력해야 하는 문구 */
export const RESET_CONFIRM = '초기화합니다';

/** 백업을 만든 이유: 자동(하루 한 번), 직접("지금 백업"), 복원 직전, 초기화 직전 */
export const BACKUP_REASONS = ['auto', 'manual', 'pre-restore', 'pre-reset'] as const;
export type BackupReason = (typeof BACKUP_REASONS)[number];

/** 화면에 보일 이유 이름 */
export const BACKUP_REASON_LABEL: Readonly<Record<BackupReason, string>> = {
  auto: '자동',
  manual: '직접',
  'pre-restore': '복원 직전',
  'pre-reset': '초기화 직전',
};

/** 보관 개수 범위와 기본값(PRD FR-006 AC2: 30개) */
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 365;
export const BACKUP_KEEP_DEFAULT = 30;

/** 백업 목록 한 줄(GET /api/backups) */
export interface BackupItem {
  /** 폴더 이름(예: 20261102-090000-auto) */
  name: string;
  /** 만든 시각(ISO) */
  createdAt: string;
  reason: BackupReason;
  /** 백업 폴더 전체 크기(바이트) */
  sizeBytes: number;
}

/** 백업 설정(settings.backup). hour는 예전 설계 값으로, 지금은 하루 첫 확인 때 바로 만든다 */
export interface BackupSettings {
  keep: number;
  hour: number;
}

/** PUT /api/settings/backup 입력 */
export const backupSettingsSchema = z.object({
  keep: z
    .number({ error: `보관 개수를 ${BACKUP_KEEP_MIN}부터 ${BACKUP_KEEP_MAX} 사이 숫자로 적어 주세요.` })
    .int({ error: '보관 개수는 정수로 적어 주세요.' })
    .min(BACKUP_KEEP_MIN, { error: `보관 개수는 ${BACKUP_KEEP_MIN}개 이상이어야 해요.` })
    .max(BACKUP_KEEP_MAX, { error: `보관 개수는 ${BACKUP_KEEP_MAX}개까지 정할 수 있어요.` }),
});
export type BackupSettingsInput = z.infer<typeof backupSettingsSchema>;

/** POST /api/backups/:name/restore 입력 */
export const restoreSchema = z.object({
  confirm: z.literal(RESTORE_CONFIRM, { error: `확인 문구 "${RESTORE_CONFIRM}"를 똑같이 입력해 주세요.` }),
});

/** POST /api/demo/reset 입력 */
export const resetSchema = z.object({
  confirm: z.literal(RESET_CONFIRM, { error: `확인 문구 "${RESET_CONFIRM}"를 똑같이 입력해 주세요.` }),
});

/** GET /api/demo/status 응답 */
export interface DemoStatus {
  /** 데모 데이터를 넣은 상태인지(settings.demo.loaded) */
  loaded: boolean;
  /** 업무 데이터가 하나도 없는지(이때만 데모 데이터를 넣을 수 있다) */
  empty: boolean;
}

/** POST /api/demo/reset 응답 */
export interface ResetResult {
  /** 초기화 직전에 만든 백업 이름 */
  backup: string;
}
