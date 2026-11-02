// 이 파일이 하는 일: 서버와 화면이 함께 쓰는 고정 선택지 목록과 한국어 이름표를 둔다.
// DB의 CHECK 제약(server/db/migrations/001_core.sql)과 값이 같아야 한다. 역할별 권한 표는 shared/roles.ts(phase-01-task-03)에 있다.
// shared 폴더는 다른 폴더를 import하지 않는다.

/** 직원 직무(users.job_type) */
export const JOB_TYPES = ['hygienist', 'assistant', 'desk', 'doctor', 'other'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  hygienist: '치과위생사',
  assistant: '간호조무사',
  desk: '데스크',
  doctor: '의사',
  other: '기타',
};

/** 계정 역할 값(users.role). 역할마다 할 수 있는 일은 shared/roles.ts가 정한다 */
export const USER_ROLE_VALUES = ['admin', 'manager', 'staff'] as const;
export type UserRoleValue = (typeof USER_ROLE_VALUES)[number];
export const USER_ROLE_LABELS: Record<UserRoleValue, string> = {
  admin: '원장·관리자',
  manager: '실장',
  staff: '직원',
};

/** 업로드 파일 용도(files.purpose) */
export const FILE_PURPOSES = ['form', 'kb', 'receipt', 'training', 'equipment', 'expense'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];
export const FILE_PURPOSE_LABELS: Record<FilePurpose, string> = {
  form: '서식',
  kb: '원내 매뉴얼',
  receipt: '거래명세서',
  training: '교육 이수증',
  equipment: '장비 기록',
  expense: '지출 증빙',
};

/** settings 테이블의 키(database.md §5) */
export const SETTING_KEYS = ['clinic', 'privacy', 'ai', 'inventory', 'leave', 'backup', 'legal', 'demo'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
