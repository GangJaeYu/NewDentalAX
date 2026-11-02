// 이 파일이 하는 일: 기능 파일(server/ai/features/<id>.ts)이 지켜야 할 모양을 정하고, 여러 기능이 함께 쓰는 작은 도구(입력 글 스키마, 데모 표시, 병원 소개)를 둔다.
// 기능 파일은 { id, inputSchema, buildPrompt, demo, outputSchema? }를 export한다(overview §3.2). 이후 모듈 태스크는 자기 기능 파일의 프롬프트·데모 본문만 고친다.
import { z } from 'zod';
import type { AiFeatureId } from '../../../shared/ai-features.ts';
import type { AiImage } from '../types.ts';

/** 프롬프트를 만들 때 서버가 채워 주는 값(병원 정보 등) */
export interface PromptContext {
  /** settings.clinic(없으면 null) */
  clinic: { name?: string; phone?: string; hours?: unknown; holidayNote?: string; parking?: string; location?: string; insuranceNote?: string } | null;
  user: { name: string; role: string; jobType: string };
  /** 오늘 날짜(KST, YYYY-MM-DD) */
  today: string;
}

/** buildPrompt 결과: 시스템 안내와 사용자 글(+사진) */
export interface BuiltPrompt {
  system: string;
  user: string;
  images?: AiImage[];
}

/** 기능 파일 하나의 모양 */
export interface AiFeatureModule<I = unknown> {
  id: AiFeatureId;
  /** 입력 검사(zod). 틀리면 400 VALIDATION */
  inputSchema: z.ZodType<I>;
  /** 공급자에게 보낼 글을 만든다 */
  buildPrompt(input: I, ctx: PromptContext): BuiltPrompt;
  /** 키가 없을 때의 예시 응답. 맨 앞에 "[데모 응답]"을 붙인다. JSON 기능은 그 뒤에 JSON을 둔다 */
  demo(input: I, ctx: PromptContext): string;
  /** JSON 기능의 응답 검사(zod). 실패하면 한 번 더 요청하고, 또 실패하면 AI_BAD_OUTPUT */
  outputSchema?: z.ZodType;
}

/** 데모 응답 표시(backend.md §4) */
export const DEMO_MARK = '[데모 응답]';

/** 입력 글 한 칸(앞뒤 공백 제거, 최대 길이) */
export function textField(max: number, label: string) {
  return z.string({ error: `${label}을(를) 적어 주세요.` }).trim().min(1, `${label}을(를) 적어 주세요.`).max(max, `${label}은(는) ${max}자 이하로 줄여 주세요.`);
}

/** 고르지 않아도 되는 입력 글 */
export function optionalText(max: number, label: string) {
  return z.string().trim().max(max, `${label}은(는) ${max}자 이하로 줄여 주세요.`).optional();
}

/** 글의 앞부분만(데모 응답에 입력 핵심 단어를 반영할 때) */
export function snippet(text: string, max = 30): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 모든 기능 공통 시스템 안내 */
export function baseSystem(ctx: PromptContext): string {
  const name = ctx.clinic?.name ? `"${ctx.clinic.name}"` : '한 치과';
  return [
    `당신은 ${name}의 원내 업무를 돕는 도우미입니다. 오늘은 ${ctx.today}입니다.`,
    '쉬운 한국어로, 짧고 정확하게 답합니다. 환자 개인정보는 다루지 않으며, 의료 진단·법률 자문을 하지 않습니다.',
  ].join('\n');
}

/** 병원 기본 정보를 글로(스크립트·템플릿에 쓰임) */
export function clinicInfo(ctx: PromptContext): string {
  const c = ctx.clinic;
  if (!c) return '병원 정보: 등록되지 않음';
  const lines = [
    c.name ? `병원 이름: ${c.name}` : null,
    c.phone ? `대표번호: ${c.phone}` : null,
    c.location ? `위치: ${c.location}` : null,
    c.parking ? `주차: ${c.parking}` : null,
    c.holidayNote ? `휴진 안내: ${c.holidayNote}` : null,
    c.insuranceNote ? `보험 안내: ${c.insuranceNote}` : null,
    c.hours ? `진료 시간: ${JSON.stringify(c.hours)}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : '병원 정보: 등록되지 않음';
}

/** JSON으로만 답하라는 안내 */
export function jsonOnly(shape: string): string {
  return `반드시 아래 모양의 JSON 하나만 답합니다. 설명 글이나 코드 블록 표시는 붙이지 않습니다.\n${shape}`;
}

/** 데모 JSON 응답(표시 + JSON) */
export function demoJson(value: unknown): string {
  return `${DEMO_MARK}\n${JSON.stringify(value, null, 2)}`;
}
