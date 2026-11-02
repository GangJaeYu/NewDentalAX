// 이 파일이 하는 일: 재고 CSV 가져오기·내보내기(FR-056, backend.md §3.5 import/export)의 API 모양을 서버와 화면이 함께 쓰게 둔다.
// 품목 CSV 열 이름(양식과 내보내기가 같은 이름을 써서, 내보낸 파일을 고쳐 다시 올릴 수 있다), 미리보기 줄 모양, 확정 입력 검사가 있다.
// 환자 정보 항목은 두지 않는다. shared 폴더는 다른 폴더를 import하지 않는다(zod만 쓴다).
import { z } from 'zod';

/** 가져올 수 있는 품목 칸 */
export const IMPORT_FIELDS = ['name', 'category', 'unit', 'par', 'trackExpiry', 'vendor', 'location', 'memo'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** 품목 CSV 열 이름(양식 첫 줄). *는 새 품목에 꼭 적어야 하는 칸 */
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: '품목명',
  category: '분류',
  unit: '단위',
  par: '적정 재고',
  trackExpiry: '유효기간 관리',
  vendor: '기본 거래처',
  location: '보관 위치',
  memo: '메모',
};

/** 미리보기 줄의 처리 방법: 새 품목 · 기존 품목 변경 · 바뀌는 것 없음 · 오류 */
export const IMPORT_ACTIONS = ['new', 'update', 'unchanged', 'error'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];
export const IMPORT_ACTION_LABELS: Record<ImportAction, string> = { new: '신규', update: '변경', unchanged: '변경 없음', error: '오류' };

/** 줄에서 읽은 값(빈 칸은 null) */
export interface ImportRowData {
  name: string | null;
  category: string | null;
  unit: string | null;
  par: number | null;
  trackExpiry: boolean | null;
  vendor: string | null;
  location: string | null;
  memo: string | null;
}

/** 기존 품목에서 바뀌는 칸 하나 */
export interface ImportChange {
  field: ImportField;
  label: string;
  from: string;
  to: string;
}

/** 미리보기 한 줄 */
export interface ImportPreviewRow {
  /** 파일의 줄 번호(1번 줄은 열 이름) */
  line: number;
  action: ImportAction;
  data: ImportRowData;
  /** 변경일 때 바뀌는 칸 */
  changes: ImportChange[];
  /** 오류 이유(쉬운 한국어) */
  errors: string[];
  /** 알아 둘 점(오류는 아님) */
  notes: string[];
  /** 변경·변경 없음일 때 기존 품목 번호 */
  itemId: number | null;
}

/** 미리보기 응답(POST /api/import/items/preview) */
export interface ImportPreview {
  /** 확정할 때 보내는 표(30분 동안, 올린 사람만 쓸 수 있다) */
  token: string;
  fileName: string;
  /** 판별한 글자 인코딩 */
  encoding: 'utf-8' | 'cp949';
  totals: Record<ImportAction, number>;
  rows: ImportPreviewRow[];
  /** 파일에 있었지만 쓰지 않은 열 이름(현재고·상태 등 내보내기 전용 열) */
  ignoredColumns: string[];
}

/** 확정 입력(POST /api/import/items/commit) */
export const importCommitSchema = z
  .object({
    token: z.string({ error: '미리보기를 다시 해 주세요.' }).min(10, '미리보기를 다시 해 주세요.').max(100, '미리보기를 다시 해 주세요.'),
    skipErrors: z.boolean({ error: '오류 줄 건너뛰기 여부를 골라 주세요.' }).default(false),
  })
  .strict();
export type ImportCommitInput = z.output<typeof importCommitSchema>;

/** 확정 결과 */
export interface ImportCommitResult {
  created: number;
  updated: number;
  /** 건너뛴 오류 줄 + 변경 없는 줄 */
  skipped: number;
  errorLines: number[];
}

/** 내보낼 수 있는 것(GET /api/export/<이름>.csv) */
export const EXPORT_ENTITIES = ['items', 'vendors', 'moves'] as const;
export type ExportEntity = (typeof EXPORT_ENTITIES)[number];
export const EXPORT_ENTITY_LABELS: Record<ExportEntity, string> = { items: '품목', vendors: '거래처', moves: '입출고 기록' };
