// 이 파일이 하는 일: 서식 보관함 문서 API(저장·버전·권한·검색)와 업로드 검사(server/lib/files.ts), 문서 AI 기능(doc_writer·doc_revise·minutes)의
// 프롬프트·데모 응답을 실제 라우트와 DB로 확인한다(phase-03-task-06 AC1~AC5의 서버 쪽). 요청은 fastify.inject, 시간은 manualClock, AI는 데모 공급자만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, MINUTE_MS } from '../../lib/clock.ts';
import { checkUpload, extOf, storedFilePath, uploadsRoot, type FileRow } from '../../lib/files.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { doc_writer } from '../../ai/features/doc_writer.ts';
import { doc_revise } from '../../ai/features/doc_revise.ts';
import { minutes, findDue } from '../../ai/features/minutes.ts';
import type { PromptContext } from '../../ai/features/types.ts';
import { seedDemo, tables } from './seed.ts';
import type { DocDetail, DocListResponse, DocVersionView } from '../../../shared/schemas/docs.ts';

const START = '2026-11-02T09:00:00+09:00';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  tmp = null;
});

async function makeApp() {
  tmp = makeTmpDir('dentalax-docs-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock, ai: { demoStreamDelayMs: 1, baseUrls: {} } });
  return { app, clock, dataDir: tmp };
}

/** multipart 본문을 만든다(파일 하나 + 글 칸) */
function multipart(file: { name: string; data: Buffer; type?: string }, fields: Record<string, string> = {}) {
  const boundary = '----dentalaxTestBoundary7MA4YWxkTrZu0gW';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`,
    ),
  );
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(a: FastifyInstance, who: TestLogin, file: { name: string; data: Buffer }, fields: Record<string, string> = {}) {
  const m = multipart(file, fields);
  return a.inject({ method: 'POST', url: '/api/documents', headers: { ...who.writeHeaders, ...m.headers }, payload: m.payload });
}

async function createDoc(a: FastifyInstance, who: TestLogin, body: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/documents', headers: who.writeHeaders, payload: body });
}

async function list(a: FastifyInstance, who: TestLogin, query = ''): Promise<DocListResponse> {
  const res = await a.inject({ method: 'GET', url: `/api/documents${query}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<DocListResponse>();
}

const ctx: PromptContext = { clinic: { name: '하늘숲치과' }, user: { name: '김직원', role: 'staff', jobType: 'desk' }, today: '2026-11-02' };

describe('문서 저장과 버전', () => {
  test('phase-03-task-06 AC1: 환자 안내문을 저장하면 서식 보관함 목록에 나타나고 버전 1이다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const res = await createDoc(a, staff, {
      kind: 'notice_patient',
      title: '사랑니 발치 후 안내',
      body_md: '# 사랑니 발치 후 안내\n\n- 거즈를 2시간 물고 계세요.',
      folder: '환자 안내',
      tags: ['발치', '발치'],
      source: 'ai',
    });
    expect(res.statusCode).toBe(201);
    const doc = res.json<{ data: DocDetail }>().data;
    expect(doc).toMatchObject({ kind: 'notice_patient', title: '사랑니 발치 후 안내', version: 1, source: 'ai', tags: ['발치'], canEdit: true, folder: '환자 안내' });

    const page = await list(a, staff);
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({ id: doc.id, title: '사랑니 발치 후 안내', version: 1, createdBy: '테스트 staff' });
    expect(page.facets).toEqual({ folders: ['환자 안내'], tags: ['발치'] });
    // 감사 로그(본문 원문은 넣지 않음)
    const log = a.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'documents.create'");
    expect(log?.detail).toBeTruthy();
    expect(log?.detail).not.toContain('거즈');
  });

  test('phase-03-task-06 AC2: 수정 후 저장하면 버전 2가 생기고 이전 버전 내용을 볼 수 있다(내용이 같으면 버전이 늘지 않음)', async () => {
    const { app: a, clock } = await makeApp();
    const staff = loginAs(a, 'staff');
    const created = (await createDoc(a, staff, { kind: 'manual', title: '오픈 매뉴얼', body_md: '1. 불 켜기' })).json<{ data: DocDetail }>().data;
    clock.advance(5 * MINUTE_MS);
    const res = await a.inject({ method: 'PATCH', url: `/api/documents/${created.id}`, headers: staff.writeHeaders, payload: { body_md: '1. 불 켜기\n2. 컴프레서 켜기' } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: DocDetail }>().data).toMatchObject({ version: 2, bodyMd: '1. 불 켜기\n2. 컴프레서 켜기' });

    const v = await a.inject({ method: 'GET', url: `/api/documents/${created.id}/versions`, headers: staff.headers });
    const versions = v.json<{ data: DocVersionView[] }>().data;
    expect(versions.map((x) => x.version)).toEqual([2, 1]);
    expect(versions[1]).toMatchObject({ version: 1, bodyMd: '1. 불 켜기', title: '오픈 매뉴얼' });
    expect(versions[0]?.createdAt).toBe(new Date(new Date(START).getTime() + 5 * MINUTE_MS).toISOString());

    // 폴더만 바꾸면 버전은 그대로
    const same = await a.inject({ method: 'PATCH', url: `/api/documents/${created.id}`, headers: staff.writeHeaders, payload: { folder: '매뉴얼' } });
    expect(same.json<{ data: DocDetail }>().data).toMatchObject({ version: 2, folder: '매뉴얼' });
  });

  test('phase-03-task-06 AC2: 다른 사람 문서는 staff가 고치거나 지울 수 없고(403), manager는 고칠 수 있다', async () => {
    const { app: a } = await makeApp();
    const owner = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    const manager = loginAs(a, 'manager');
    const doc = (await createDoc(a, owner, { kind: 'other', title: '메모', body_md: '내용' })).json<{ data: DocDetail }>().data;
    const seen = await a.inject({ method: 'GET', url: `/api/documents/${doc.id}`, headers: other.headers });
    expect(seen.json<{ data: DocDetail }>().data.canEdit).toBe(false);
    const denied = await a.inject({ method: 'PATCH', url: `/api/documents/${doc.id}`, headers: other.writeHeaders, payload: { title: '바꿈' } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ error: { message: string } }>().error.message).toContain('내가 쓴 문서만');
    expect((await a.inject({ method: 'DELETE', url: `/api/documents/${doc.id}`, headers: other.writeHeaders })).statusCode).toBe(403);
    const ok = await a.inject({ method: 'PATCH', url: `/api/documents/${doc.id}`, headers: manager.writeHeaders, payload: { title: '바꿈' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: DocDetail }>().data.version).toBe(2);
    // 지우면 목록·상세에서 사라진다
    expect((await a.inject({ method: 'DELETE', url: `/api/documents/${doc.id}`, headers: owner.writeHeaders })).statusCode).toBe(204);
    expect((await list(a, owner)).total).toBe(0);
    expect((await a.inject({ method: 'GET', url: `/api/documents/${doc.id}`, headers: owner.headers })).statusCode).toBe(404);
  });

  test('phase-03-task-06 AC1: 입력이 틀리면 400과 항목별 한국어 이유, 검색·폴더·태그·종류로 거른다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const bad = await createDoc(a, staff, { kind: 'form', title: '', body_md: '' });
    expect(bad.statusCode).toBe(400);
    const fields = bad.json<{ error: { fields: Record<string, string> } }>().error.fields;
    expect(fields.title).toBe('제목을 적어 주세요.');
    expect(fields.body_md).toBe('본문을 적어 주세요.');
    expect(fields.kind).toBe('문서 종류를 골라 주세요.');

    await createDoc(a, staff, { kind: 'notice_patient', title: '스케일링 안내', body_md: '시린 느낌 100%', folder: '환자 안내', tags: ['스케일링'] });
    await createDoc(a, staff, { kind: 'policy', title: '감염 규정', body_md: '멸균 기록', folder: '규정', tags: ['감염'] });
    expect((await list(a, staff, '?q=멸균')).data.map((d) => d.title)).toEqual(['감염 규정']);
    expect((await list(a, staff, '?q=100%25')).data.map((d) => d.title)).toEqual(['스케일링 안내']);
    expect((await list(a, staff, '?q=_')).total).toBe(0);
    expect((await list(a, staff, `?folder=${encodeURIComponent('규정')}`)).data.map((d) => d.title)).toEqual(['감염 규정']);
    expect((await list(a, staff, `?tag=${encodeURIComponent('스케일링')}`)).data.map((d) => d.title)).toEqual(['스케일링 안내']);
    expect((await list(a, staff, '?kind=policy')).data.map((d) => d.title)).toEqual(['감염 규정']);
  });
});

describe('업로드 검사(TD-012)', () => {
  test('phase-03-task-06 AC4: .exe 파일 업로드는 415, 21MB 파일은 413과 한국어 안내', async () => {
    const { app: a } = await makeApp();
    const manager = loginAs(a, 'manager');
    const exe = await upload(a, manager, { name: 'setup.exe', data: EXE });
    expect(exe.statusCode).toBe(415);
    expect(exe.json()).toMatchObject({ error: { code: 'FILE_TYPE' } });
    expect(exe.json<{ error: { message: string } }>().error.message).toBe('올릴 수 없는 파일 형식입니다. PDF·DOCX·XLSX·HWP·HWPX·JPG·PNG 파일만 올릴 수 있어요.');

    const big = Buffer.concat([PDF, Buffer.alloc(21 * 1024 * 1024 - PDF.length, 0x20)]);
    const tooBig = await upload(a, manager, { name: '큰 서식.pdf', data: big });
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE', message: '파일이 너무 큽니다(최대 20MB). 크기를 줄여서 다시 올려 주세요.' } });

    // 거부된 파일은 저장되지 않는다
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files')?.n).toBe(0);
    expect(fs.existsSync(uploadsRoot(a.dataDir)) ? fs.readdirSync(uploadsRoot(a.dataDir), { recursive: true }).filter((f) => String(f).includes('.')) : []).toEqual([]);
  });

  test('phase-03-task-06 AC4: 확장자만 바꾼 실행 파일·HTML·SVG도 415, 정상 PDF는 uploads/YYYY/MM/<무작위>.pdf로 저장되고 첨부 파일로 내려받는다', async () => {
    const { app: a, dataDir } = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const fake = await upload(a, manager, { name: '동의서.pdf', data: EXE });
    expect(fake.statusCode).toBe(415);
    expect(fake.json<{ error: { message: string } }>().error.message).toContain('파일 내용이 PDF 형식이 아니에요');
    expect((await upload(a, manager, { name: 'page.html', data: Buffer.from('<script>alert(1)</script>') })).statusCode).toBe(415);
    expect((await upload(a, manager, { name: 'logo.svg', data: Buffer.from('<svg onload="alert(1)"/>') })).statusCode).toBe(415);

    // staff는 서식 파일을 올릴 수 없다(문서 작성은 가능)
    const denied = await upload(a, staff, { name: '동의서.pdf', data: PDF });
    expect(denied.statusCode).toBe(403);

    const ok = await upload(a, manager, { name: '진료 동의서 양식.pdf', data: PDF }, { folder: '양식', tags: '동의서, 양식' });
    expect(ok.statusCode).toBe(201);
    const doc = ok.json<{ data: DocDetail }>().data;
    expect(doc).toMatchObject({ kind: 'form', source: 'upload', title: '진료 동의서 양식', folder: '양식', tags: ['동의서', '양식'], version: 0 });
    expect(doc.file).toMatchObject({ name: '진료 동의서 양식.pdf', mime: 'application/pdf', size: PDF.length });
    const row = a.db.get<FileRow>('SELECT * FROM files WHERE id = ?', [doc.file?.id ?? 0]) as FileRow;
    expect(row.purpose).toBe('form');
    expect(row.stored_path).toMatch(/^2026\/11\/[0-9a-f]{32}\.pdf$/);
    expect(fs.readFileSync(storedFilePath(dataDir, row) as string)).toEqual(PDF);

    // 내려받기: 첨부 파일, 한글 이름은 filename*
    const dl = await a.inject({ method: 'GET', url: `/api/files/${row.id}`, headers: staff.headers });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain('attachment;');
    expect(dl.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('진료 동의서 양식.pdf')}`);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.rawPayload).toEqual(PDF);
    // 검색은 파일 이름으로도 된다
    expect((await list(a, staff, `?q=${encodeURIComponent('동의서')}`)).total).toBe(1);
    // 올린 서식은 본문을 고칠 수 없다
    const patch = await a.inject({ method: 'PATCH', url: `/api/documents/${doc.id}`, headers: manager.writeHeaders, payload: { body_md: '본문' } });
    expect(patch.statusCode).toBe(400);
    // 문서를 지우면 파일도 내려받을 수 없다
    await a.inject({ method: 'DELETE', url: `/api/documents/${doc.id}`, headers: manager.writeHeaders });
    expect((await a.inject({ method: 'GET', url: `/api/files/${row.id}`, headers: staff.headers })).statusCode).toBe(404);
  });

  test('phase-03-task-06 AC4: checkUpload은 쓰임새별 확장자·매직 넘버·크기(사진 8MB)를 함께 본다', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(checkUpload('사진.PNG', png, 'form')).toEqual({ ext: '.png', mime: 'image/png' });
    expect(() => checkUpload('사진.png', Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]), 'form')).toThrow('최대 8MB');
    expect(() => checkUpload('메모.txt', Buffer.from('안녕하세요'), 'form')).toThrow('올릴 수 없는 파일 형식');
    expect(checkUpload('메모.txt', Buffer.from('안녕하세요'), 'kb').ext).toBe('.txt');
    expect(() => checkUpload('메모.txt', Buffer.from([0x00, 0x01, 0x02]), 'kb')).toThrow('TXT 형식이 아니에요');
    expect(checkUpload('규정.hwp', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'form').ext).toBe('.hwp');
    expect(checkUpload('표.xlsx', Buffer.from('PK\u0003\u0004rest'), 'form').ext).toBe('.xlsx');
    expect(() => checkUpload('빈.pdf', Buffer.alloc(0), 'form')).toThrow('빈 파일');
    expect(extOf('..\\..\\evil.PDF')).toBe('.pdf');
    expect(extOf('noext')).toBe('');
    expect(storedFilePath('C:/data', { stored_path: '../../secret.key' })).toBeNull();
  });
});

describe('문서 AI 기능(데모 공급자)', () => {
  test('phase-03-task-06 AC1: 공문 프롬프트는 수신·참조·제목·본문·붙임 형식을 요구하고, 데모 응답도 그 형식이다', () => {
    const input = doc_writer.inputSchema.parse({ kind: 'official', points: '연말 휴진 안내, 12월 31일 휴진' });
    const p = doc_writer.buildPrompt(input, ctx);
    for (const w of ['공문', '수신', '참조', '제목', '본문', '붙임']) expect(p.system).toContain(w);
    const demo = doc_writer.demo(input, ctx);
    expect(demo.startsWith('[데모 응답]')).toBe(true);
    for (const w of ['**수신**', '**참조**', '**제목**', '## 본문', '## 붙임', '하늘숲치과 원장']) expect(demo).toContain(w);
    // 환자 안내문: 종류 이름과 요점이 반영된다
    const notice = doc_writer.inputSchema.parse({ kind: 'notice_patient', points: '임플란트 수술 후 주의, 2시간 거즈' });
    expect(doc_writer.buildPrompt(notice, ctx).system).toContain('환자 안내문');
    expect(doc_writer.demo(notice, ctx)).toContain('- 2시간 거즈');
  });

  test('phase-03-task-06 AC1: AI 문서 작성을 데모 스트림으로 부르면 글 조각(delta)이 여러 번 오고 마지막에 done이 온다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const res = await a.inject({
      method: 'POST',
      url: '/api/ai/stream',
      headers: staff.writeHeaders,
      payload: { feature: 'doc_writer', input: { kind: 'notice_patient', points: '스케일링 후 주의' }, tier: 'standard' },
    });
    expect(res.statusCode).toBe(200);
    const deltas = res.body.split('\n').filter((l) => l === 'event: delta').length;
    expect(deltas).toBeGreaterThan(2);
    expect(res.body).toContain('event: done');
  });

  test('phase-03-task-06 AC2: 부분 수정 데모는 "더 짧게"면 줄을 줄이고, 결과 맨 앞에 데모 표시가 붙는다', () => {
    const input = doc_revise.inputSchema.parse({ text: '첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄', instruction: '더 짧게' });
    const out = doc_revise.demo(input, ctx);
    expect(out.startsWith('[데모 응답]')).toBe(true);
    expect(out).toContain('첫째 줄\n둘째 줄');
    expect(out).not.toContain('넷째 줄');
  });

  test('phase-03-task-06 AC3: 회의 메모 → 결정 사항·할 일(역할·기한)·요약으로 나뉜 JSON(extra)이 온다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const notes = '- 다음 주부터 오전 예약 간격을 30분으로 바꾸기로 결정\n- 예약 안내 문자 문구 고치기 (데스크 담당, 11월 6일까지)\n- 멸균기 점검표 새로 만들기 위생사가 11/10까지';
    const res = await a.inject({ method: 'POST', url: '/api/ai/run', headers: staff.writeHeaders, payload: { feature: 'minutes', input: { notes } } });
    expect(res.statusCode).toBe(200);
    const extra = res.json<{ data: { extra: { decisions: string[]; todos: { text: string; role: string | null; due: string | null }[]; summary: string } } }>().data.extra;
    expect(extra.decisions).toEqual(['다음 주부터 오전 예약 간격을 30분으로 바꾸기로 결정']);
    expect(extra.todos).toEqual([
      { text: '예약 안내 문자 문구 고치기', role: '데스크', due: '2026-11-06' },
      { text: '멸균기 점검표 새로 만들기 위생사가 11/10까지', role: '치과위생사', due: '2026-11-10' },
    ]);
    expect(extra.summary).toContain('결정 1건, 할 일 2건');
    expect(minutes.outputSchema?.safeParse(extra).success).toBe(true);
    // 지난 날짜(10월)는 다음 해로 본다
    expect(findDue('10월 3일까지', '2026-11-02')).toBe('2027-10-03');
    expect(findDue('마감 없음', '2026-11-02')).toBeNull();
  });
});

describe('XSS·데모 데이터', () => {
  test('phase-03-task-06 AC5: <script>가 든 본문은 글 그대로 저장·응답되고(JSON), 응답에는 스크립트 실행을 막는 CSP가 붙는다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const body = '# 안내\n<script>window.__xss = 1</script>\n<img src=x onerror="window.__xss=2">';
    const doc = (await createDoc(a, staff, { kind: 'other', title: '<script>alert(1)</script>', body_md: body })).json<{ data: DocDetail }>().data;
    const res = await a.inject({ method: 'GET', url: `/api/documents/${doc.id}`, headers: staff.headers });
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.json<{ data: DocDetail }>().data.bodyMd).toBe(body);
  });

  test('phase-03-task-06 AC1: 데모 데이터는 하늘숲치과 문서 6개와 버전 1을 넣고, 환자 정보는 없다', async () => {
    const { app: a } = await makeApp();
    loginAs(a, 'manager');
    seedDemo(a.db, { clock: manualClock(START), scale: 1 });
    expect(tables).toEqual(['documents', 'document_versions']);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM documents')?.n).toBe(6);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM document_versions')?.n).toBe(6);
    const all = a.db.all<{ body_md: string }>('SELECT body_md FROM documents').map((r) => r.body_md).join('\n');
    expect(all).not.toMatch(/\d{6}-\d{7}|01[016789]-\d{3,4}-\d{4}/);
    seedDemo(a.db, { clock: manualClock(START), scale: 3 });
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM documents')?.n).toBe(6 + 18);
  });
});
