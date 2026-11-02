// 이 파일이 하는 일: 실제로 띄운 테스트 서버(scripts/e2e-server.ts)에 HTTP로 첫 설정 → 세션 → CSRF 거부 → 로그아웃 → 잠금 흐름을 보내 확인한다
// (phase-01-task-03 AC1·AC2·AC4·AC5·AC6). 화면(/setup, /login)은 phase-01-task-04 담당이라 여기서는 API 흐름만 본다.
// 서버는 빈 임시 데이터 폴더로 켜지므로 첫 테스트가 첫 설정을 한다. 테스트는 이 파일 안 순서대로 실행된다(serial).
import { expect, test, type APIResponse } from '@playwright/test';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'e2eadmin', password: 'E2e-Admin-Pass-31', withDemo: false };

/** Set-Cookie에서 sid=값 부분만 꺼낸다 */
function sidFrom(res: APIResponse): string {
  const raw = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('sid='))?.value ?? '';
  const sid = raw.split(';')[0] ?? '';
  expect(sid).toMatch(/^sid=.+/);
  return sid;
}

test.describe.serial('인증 API 흐름', () => {
  test('phase-01-task-03 AC1: 사용자 0명일 때 POST /api/setup이 admin을 만들고, 다시 보내면 409 SETUP_DONE이다', async ({ request }) => {
    const before = await request.get('/api/session');
    expect(before.status()).toBe(200);
    expect(await before.json()).toMatchObject({ data: { setupRequired: true, user: null } });

    const first = await request.post('/api/setup', { data: ADMIN });
    expect(first.status()).toBe(201);
    expect(await first.json()).toMatchObject({ data: { user: { username: 'e2eadmin', role: 'admin' }, csrfToken: expect.any(String) } });
    const setCookie = first.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);

    const again = await request.post('/api/setup', { data: { ...ADMIN, username: 'another1' } });
    expect(again.status()).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: 'SETUP_DONE', message: '이미 첫 설정이 끝났습니다. 로그인해 주세요.' } });

    const after = await request.get('/api/session');
    expect(await after.json()).toMatchObject({ data: { setupRequired: false, user: { username: 'e2eadmin' }, clinicName: '하늘숲치과' } });
  });

  test('phase-01-task-03 AC4: CSRF 헤더 없는 POST는 403 CSRF, 로그아웃 후 이전 쿠키로 요청하면 401이다', async ({ request }) => {
    const login = await request.post('/api/auth/login', { data: { username: ADMIN.username, password: ADMIN.password } });
    expect(login.status()).toBe(200);
    const { data } = (await login.json()) as { data: { csrfToken: string } };
    const sid = sidFrom(login);

    const noCsrf = await request.post('/api/auth/logout', { headers: { cookie: sid } });
    expect(noCsrf.status()).toBe(403);
    expect(await noCsrf.json()).toEqual({ error: { code: 'CSRF', message: '보안 확인에 실패했습니다. 화면을 새로 고쳐 주세요.' } });

    const me = await request.get('/api/auth/me', { headers: { cookie: sid } });
    expect(me.status()).toBe(200);

    const out = await request.post('/api/auth/logout', { headers: { cookie: sid, 'x-csrf-token': data.csrfToken } });
    expect(out.status()).toBe(204);
    const old = await request.get('/api/auth/me', { headers: { cookie: sid } });
    expect(old.status()).toBe(401);
    expect(await old.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: '다시 로그인해 주세요.' } });
  });

  test('phase-01-task-03 AC5·AC6: 이 PC(127.0.0.1)에서는 접속되고, API·화면·404 응답 모두에 보안 헤더가 있다', async ({ request }) => {
    for (const url of ['/api/health', '/api/session', '/', '/inventory', '/api/nothing', '/api/auth/me']) {
      const res = await request.get(url);
      expect(res.status(), url).not.toBe(403);
      const h = res.headers();
      expect(h['content-security-policy'], url).toContain("frame-ancestors 'none'");
      expect(h['content-security-policy'], url).toContain("default-src 'self'");
      expect(h['x-content-type-options'], url).toBe('nosniff');
      expect(h['referrer-policy'], url).toBe('no-referrer');
    }
  });

  test('phase-01-task-03 AC6: 보안 헤더(CSP)가 걸린 상태로 첫 화면이 오류 없이 열린다', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto('/');
    expect(res?.headers()['content-security-policy']).toContain("script-src 'self'");
    await expect(page.getByRole('heading', { level: 1, name: '하늘숲치과 원내 업무' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('phase-01-task-03 AC2: 틀린 비밀번호 5회 뒤에는 맞는 비밀번호도 423 LOCKED이고 남은 시간을 알려 준다', async ({ request }) => {
    for (let i = 1; i <= 4; i++) {
      const r = await request.post('/api/auth/login', { data: { username: ADMIN.username, password: `wrong-${i}` } });
      expect(r.status()).toBe(401);
      expect(await r.json()).toEqual({ error: { code: 'INVALID_LOGIN', message: '아이디 또는 비밀번호가 맞지 않습니다.' } });
    }
    expect((await request.post('/api/auth/login', { data: { username: ADMIN.username, password: 'wrong-5' } })).status()).toBe(423);
    const locked = await request.post('/api/auth/login', { data: { username: ADMIN.username, password: ADMIN.password } });
    expect(locked.status()).toBe(423);
    const body = (await locked.json()) as { error: { code: string; message: string; retryAfterSec: number } };
    expect(body.error.code).toBe('LOCKED');
    expect(body.error.message).toMatch(/약 15분 뒤 다시 시도해 주세요/);
    expect(body.error.retryAfterSec).toBe(900);
  });
});
