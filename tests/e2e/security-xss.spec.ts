// 이 파일이 하는 일: 저장형 XSS 횡단 점검 E2E(phase-05-task-02, NFR-002 AC2, TD-007). 실제 브라우저(Edge)로 확인한다.
// ① 데모 데이터(하늘숲치과, 환자 정보 없음)를 넣고 서버를 멈춘 뒤, DB의 모든 "사람이 적는 글 칸"(제목·이름·본문·메모·사유 등)
//    끝에 스크립트 문자열을 붙인다 = 공지·문서·리뷰 문구·광고 점검 규칙·채용·품목·거래처·장비·교육·지출… 어디에 저장돼도 같은 상태.
// ② 서버를 다시 켜고 web/src/routes.tsx에 등록된 모든 화면(대시보드·업무 화면·상세·인쇄)을 연다.
// ③ 화면마다 스크립트 문자열이 HTML 요소로 바뀐 것이 0개이고(data-xss 요소 없음), 스크립트가 실행되지 않았고(window.__xss·대화상자 없음),
//    CSP 위반 보고도 없음을 확인한다. 주요 화면에서는 그 문자열이 "글자 그대로" 보이는지도 확인한다(빈 시험 방지).
// spec은 tests/e2e 폴더에 둔다(Playwright testDir). 서버는 fixtures.ts가 이 파일 전용으로 띄운다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '보안점검원장', username: 'secadmin', password: 'Sec-Admin-Pass-55' };

/** 글 칸 끝에 붙이는 시험 문자열. HTML로 해석되면 data-xss 요소가 생기고, 실행되면 window.__xss가 생긴다 */
const PAYLOAD = '<img src=x data-xss=1 onerror="window.__xss=1"><script data-xss=2>window.__xss=2</script><b data-xss=3>XSS</b><svg data-xss=4 onload="window.__xss=4"></svg>';
/** 화면에 글자 그대로 보일 때 찾을 조각 */
const LITERAL = '<b data-xss=3>XSS</b>';

/** 사람이 적는 글 칸 이름(상태·종류·날짜·JSON 칸은 건드리지 않는다) */
const TEXT_COLUMN = /^(title|name|body|body_md|memo|note|content|reason|description|location|contact_name|summary|text|answer|question|guidance|basis|applies_text|label|vendor_name|item_name|comment|result|message|cycle_text|phrase|suggestion|example|purpose|holiday_note|position)$/;

/** routes.tsx에 등록된 화면 주소(대시보드 포함). 새 화면이 생기면 자동으로 점검 대상이 된다 */
function appPaths(): string[] {
  const src = fs.readFileSync(path.join(process.cwd(), 'web', 'src', 'routes.tsx'), 'utf8');
  return ['/', ...[...src.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((m) => m[1] as string)];
}

/** 서버를 멈춘 상태에서 DB 글 칸에 시험 문자열을 붙이고, 상세 화면에 쓸 id를 돌려준다 */
function poisonDb(file: string): { columns: string[]; rows: number; ids: Record<string, string> } {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'").all() as Array<{ name: string }>).map((t) => t.name);
    const columns: string[] = [];
    let rows = 0;
    for (const t of tables) {
      if (['audit_log', 'sessions', 'login_attempts', 'settings', 'schema_version', 'files', 'ai_usage'].includes(t)) continue;
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{ name: string; type: string }>;
      for (const c of cols) {
        if (!TEXT_COLUMN.test(c.name) || !/TEXT|^$/i.test(c.type)) continue;
        try {
          // JSON처럼 보이는 값({…}·[…])은 건드리지 않는다
          const r = db.prepare(`UPDATE "${t}" SET "${c.name}" = "${c.name}" || ? WHERE "${c.name}" IS NOT NULL AND "${c.name}" <> '' AND substr(trim("${c.name}"), 1, 1) NOT IN ('{', '[')`).run(PAYLOAD);
          if (Number(r.changes) > 0) {
            columns.push(`${t}.${c.name}`);
            rows += Number(r.changes);
          }
        } catch {
          // 글자 수·형식 제약(CHECK)이 있는 칸은 건너뛴다
        }
      }
    }
    // 알림은 데모에 없으므로(기한 작업이 만든다) 관리자에게 한 건 넣는다
    db.prepare("INSERT INTO notifications (user_id, type, title, body, link, created_at) SELECT id, 'notice', ?, ?, '/desk/board', ? FROM users WHERE username = ?").run(
      `새 공지${PAYLOAD}`,
      `본문${PAYLOAD}`,
      new Date('2026-11-02T00:00:00Z').toISOString(),
      ADMIN.username,
    );
    // 감사 로그는 고칠 수 없으므로(변경 불가 트리거) 새 줄을 넣는다
    db.prepare("INSERT INTO audit_log (at, user_id, username, action, target_type, target_id, detail, ip) VALUES (?, NULL, ?, 'security.test', 'post', ?, ?, '127.0.0.1')").run(
      new Date('2026-11-02T00:00:00Z').toISOString(),
      `secadmin${PAYLOAD}`,
      `1${PAYLOAD}`,
      JSON.stringify({ note: PAYLOAD }),
    );
    const first = (sql: string) => String((db.prepare(sql).get() as { id?: number } | undefined)?.id ?? 1);
    const ids = {
      post: first('SELECT id FROM posts ORDER BY id LIMIT 1'),
      item: first('SELECT id FROM items ORDER BY id LIMIT 1'),
      order: first('SELECT id FROM purchase_orders ORDER BY id LIMIT 1'),
      document: first("SELECT id FROM documents WHERE file_id IS NULL ORDER BY id LIMIT 1"),
      library: first('SELECT id FROM documents ORDER BY id LIMIT 1'),
      equipment: first('SELECT id FROM equipment ORDER BY id LIMIT 1'),
    };
    return { columns, rows, ids };
  } finally {
    db.close();
  }
}

/** 화면 주소 모양을 실제 주소로 */
function realPath(p: string, ids: Record<string, string>): string {
  if (p === '/desk/board/:id') return `/desk/board/${ids.post}`;
  if (p === '/inventory/items/:id') return `/inventory/items/${ids.item}`;
  if (p === '/inventory/orders/:id' || p === '/print/order/:id') return p.replace(':id', ids.order as string);
  if (p === '/docs/library/:id') return `/docs/library/${ids.library}`;
  if (p === '/print/document/:id') return `/print/document/${ids.document}`;
  if (p === '/print/equipment/:id') return `/print/equipment/${ids.equipment}`;
  if (p === '/print/checklist/:kind/:date') return '/print/checklist/opening/2026-11-02';
  if (p === '/print/roster' || p === '/print/sterilizer') return `${p}?from=2026-10-01&to=2026-11-30`;
  return p;
}

/** 열어 둔 화면에서 XSS 흔적을 센다 */
async function xssTrace(page: Page) {
  // 서버 쪽 tsconfig에는 브라우저 형(DOM)이 없으므로 브라우저에서 돌릴 식은 글로 넘긴다
  return (await page.evaluate(`({
    injected: document.querySelectorAll('[data-xss]').length,
    executed: window.__xss ?? null,
    csp: window.__cspViolations ?? [],
    literal: document.body.innerText.includes(${JSON.stringify(LITERAL)}),
  })`)) as { injected: number; executed: unknown; csp: string[]; literal: boolean };
}

test.describe.serial('phase-05-task-02 저장형 XSS 횡단 점검', () => {
  let ids: Record<string, string> = {};
  const literalSeen: string[] = [];

  test('phase-05-task-02 점검(XSS 준비): 데모 데이터의 사람이 적는 글 칸 모두에 스크립트 문자열을 넣는다', async ({ page, isoServer }) => {
    test.setTimeout(120000);
    const r = await page.request.post('/api/setup', { data: { ...ADMIN, withDemo: true } });
    expect(r.status(), await r.text()).toBe(201);
    await isoServer.stop();
    const out = poisonDb(path.join(isoServer.dataDir, 'app.db'));
    ids = out.ids;
    await isoServer.start();
    // 공지·문서·리뷰 문구·광고 규칙·채용 등 대표 칸이 모두 들어갔는지(빈 시험 방지)
    for (const c of ['posts.title', 'posts.body', 'documents.title', 'saved_texts.body', 'items.name', 'vendors.name', 'equipment.name', 'users.name']) expect(out.columns, c).toContain(c);
    expect(out.rows).toBeGreaterThan(100);
    console.log(`[security-xss] 시험 문자열을 넣은 칸 ${out.columns.length}개, 줄 ${out.rows}개: ${out.columns.join(', ')}`);
  });

  /** 화면 묶음 하나를 열어 확인한다 */
  async function sweep(page: Page, paths: string[]) {
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    // CSP 위반 보고를 모은다(어느 파일 몇째 줄이 막혔는지까지)
    await page.addInitScript({
      content:
        "window.__cspViolations = []; document.addEventListener('securitypolicyviolation', function (e) { window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI + ' @' + e.sourceFile + ':' + e.lineNumber + ':' + e.columnNumber); });",
    });
    const login = await page.request.post('/api/auth/login', { data: { username: ADMIN.username, password: ADMIN.password } });
    expect(login.status()).toBe(200);
    const wrong: string[] = [];
    for (const p of paths) {
      const url = realPath(p, ids);
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      // 화면이 실제로 그려졌는지(빈 화면·오류 화면에서 0개를 세지 않게)
      await expect(page.locator('body'), url).not.toBeEmpty();
      await page.waitForTimeout(150);
      const t = await xssTrace(page);
      if (t.injected || t.executed !== null || t.csp.length) wrong.push(`${url}: 요소 ${t.injected}개, 실행 ${String(t.executed)}, CSP ${t.csp.join('|')}`);
      if (t.literal) literalSeen.push(p);
    }
    expect(wrong).toEqual([]);
    expect(dialogs).toEqual([]);
  }

  const all = appPaths();
  const groups: Array<[string, (p: string) => boolean]> = [
    ['대시보드·데스크·알림', (p) => p === '/' || p.startsWith('/desk') || p === '/notifications'],
    ['재고', (p) => p.startsWith('/inventory')],
    ['문서·마케팅', (p) => p.startsWith('/docs')],
    ['인사', (p) => p.startsWith('/hr')],
    ['시설·재무', (p) => p.startsWith('/facility') || p.startsWith('/finance')],
    ['관리', (p) => p.startsWith('/admin')],
    ['인쇄', (p) => p.startsWith('/print')],
  ];

  for (const [name, match] of groups) {
    test(`phase-05-task-02 점검(XSS): ${name} 화면에서 저장된 스크립트가 HTML로 해석·실행되지 않는다`, async ({ page }) => {
      test.setTimeout(180000);
      const paths = all.filter(match);
      expect(paths.length, name).toBeGreaterThan(0);
      await sweep(page, paths);
    });
  }

  test('phase-05-task-02 점검(XSS): 모든 화면이 점검 묶음에 들어 있고, 주요 화면에서는 스크립트 문자열이 글자 그대로 보였다', async () => {
    const covered = all.filter((p) => groups.some(([, m]) => m(p)));
    expect(covered).toEqual(all);
    expect(all.length).toBeGreaterThan(40);
    for (const p of ['/desk/board', '/inventory', '/inventory/vendors', '/docs/library', '/facility/equipment', '/admin/users', '/notifications']) expect(literalSeen, p).toContain(p);
    console.log(`[security-xss] 글자 그대로 보인 화면 ${literalSeen.length}/${all.length}: ${literalSeen.join(', ')}`);
  });
});
