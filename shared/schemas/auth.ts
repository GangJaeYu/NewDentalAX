// 이 파일이 하는 일: 첫 설정·로그인·비밀번호 변경 API의 입력 모양(zod 스키마)과 응답 타입을 정한다(backend.md §3.1).
// 서버는 이 스키마로 입력을 검사하고(틀리면 400 + 항목별 한국어 이유), 화면은 같은 스키마로 미리 검사한다.
// 오류 문구는 화면에 그대로 보이므로 쉬운 한국어로 쓴다.
import { z } from 'zod';
import type { Role } from '../roles.ts';

/** 아이디 규칙: 영문·숫자 4~20자 */
export const USERNAME_RE = /^[A-Za-z0-9]{4,20}$/;
/** 비밀번호 길이 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const username = z
  .string({ error: '아이디를 적어 주세요.' })
  .trim()
  .regex(USERNAME_RE, { error: '아이디는 영문과 숫자로 4~20자로 적어 주세요.' });

const newPassword = z
  .string({ error: '비밀번호를 적어 주세요.' })
  .min(PASSWORD_MIN, { error: `비밀번호는 ${PASSWORD_MIN}자 이상으로 적어 주세요.` })
  .max(PASSWORD_MAX, { error: `비밀번호는 ${PASSWORD_MAX}자까지 적을 수 있어요.` });

/** POST /api/setup 입력 */
export const setupSchema = z.object({
  clinicName: z
    .string({ error: '병원 이름을 적어 주세요.' })
    .trim()
    .min(1, { error: '병원 이름을 적어 주세요.' })
    .max(50, { error: '병원 이름은 50자까지 적을 수 있어요.' }),
  name: z
    .string({ error: '관리자 이름을 적어 주세요.' })
    .trim()
    .min(1, { error: '관리자 이름을 적어 주세요.' })
    .max(30, { error: '이름은 30자까지 적을 수 있어요.' }),
  username,
  password: newPassword,
  withDemo: z.boolean({ error: '데모 데이터 넣기를 선택해 주세요.' }).optional().default(false),
});
export type SetupInput = z.infer<typeof setupSchema>;

/** POST /api/auth/login 입력(어느 쪽이 틀렸는지 밝히지 않도록 형식 검사는 최소로 한다) */
export const loginSchema = z.object({
  username: z.string({ error: '아이디를 적어 주세요.' }).trim().min(1, { error: '아이디를 적어 주세요.' }).max(50, { error: '아이디가 너무 길어요.' }),
  password: z.string({ error: '비밀번호를 적어 주세요.' }).min(1, { error: '비밀번호를 적어 주세요.' }).max(PASSWORD_MAX, { error: '비밀번호가 너무 길어요.' }),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** POST /api/auth/password 입력 */
export const changePasswordSchema = z
  .object({
    current: z.string({ error: '현재 비밀번호를 적어 주세요.' }).min(1, { error: '현재 비밀번호를 적어 주세요.' }).max(PASSWORD_MAX, { error: '비밀번호가 너무 길어요.' }),
    next: newPassword,
  })
  .refine((v) => v.current !== v.next, { path: ['next'], error: '새 비밀번호는 지금 비밀번호와 다르게 정해 주세요.' });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** 로그인한 사용자 정보(backend.md §1 Me) */
export interface Me {
  id: number;
  username: string;
  name: string;
  role: Role;
  jobType: string;
  mustChangePw: boolean;
}

/** GET /api/session 응답의 data */
export interface SessionInfo {
  /** 사용자가 0명이라 첫 설정이 필요한지 */
  setupRequired: boolean;
  user: Me | null;
  /** 상태를 바꾸는 요청의 X-CSRF-Token 헤더에 넣을 값(로그인 전이면 null) */
  csrfToken: string | null;
  clinicName: string | null;
  /** 데모 데이터가 들어 있는지(settings.demo.loaded) */
  demoMode: boolean;
}

/** POST /api/setup, POST /api/auth/login 응답의 data */
export interface LoginResult {
  user: Me;
  csrfToken: string;
}

/** CSRF 토큰을 실어 보내는 요청 헤더 이름 */
export const CSRF_HEADER = 'x-csrf-token';
/** 세션 쿠키 이름 */
export const SESSION_COOKIE = 'sid';
