// 이 파일이 하는 일: API 입력을 zod 스키마로 검사하고, 틀리면 400 VALIDATION과 항목별 한국어 이유(fields)로 바꾼다(NFR-002 AC5).
// 모든 라우트는 req.body·req.query를 직접 쓰지 말고 parseInput(스키마, 값)으로 검사한 값을 쓴다.
// 응답 예: { error: { code: 'VALIDATION', message: '입력값을 확인해 주세요.', fields: { password: '비밀번호는 8자 이상으로 적어 주세요.' } } }
import type { z } from 'zod';
import { validationError } from '../lib/errors.ts';

/** 항목 이름이 없는 오류(본문 전체가 틀림)를 담는 fields 키 */
export const ROOT_FIELD = '_';

/** zod 오류를 { 항목 경로: 한국어 이유 } 로 바꾼다. 같은 항목의 첫 번째 이유만 남긴다 */
export function issuesToFields(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : ROOT_FIELD;
    if (fields[key]) continue;
    // 영어 기본 문구(스키마에 한국어 문구를 안 적은 경우)는 쉬운 한국어로 바꾼다
    fields[key] = /[가-힣]/.test(issue.message) ? issue.message : '이 값을 확인해 주세요.';
  }
  return fields;
}

/**
 * 값을 스키마로 검사해 통과한 값을 돌려준다. 틀리면 400 VALIDATION AppError를 던진다.
 * 본문이 없으면 빈 객체로 보고 검사한다(필수 항목마다 이유가 붙는다). 객체가 아닌 본문은 fields._에 이유가 붙는다.
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value ?? {});
  if (r.success) return r.data;
  throw validationError(issuesToFields(r.error.issues));
}
