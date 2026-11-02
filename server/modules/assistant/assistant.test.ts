// 이 파일이 하는 일: 원내 AI 도우미 API(자료 올리기·개인정보 검토·지우기·공개 범위·질문·근거·대화 기록)를 실제 라우트와 DB로 확인한다(phase-03-task-07 AC1~AC6의 서버 쪽).
// 요청은 fastify.inject, 시간은 manualClock, AI는 데모 공급자만 쓴다(키 없음). pdf·docx 샘플은 tests/fixtures/kb-files/에 있다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { clearBusinessData } from '../admin/demo-service.ts';
import { assistant as assistantFeature } from '../../ai/features/assistant.ts';
import { DEMO_MARK } from '../../ai/features/types.ts';
import { NOT_FOUND_ANSWER, type AskResponse, type AssistantMessage, type KbDocDetail, type KbDocItem } from '../../../shared/schemas/kb.ts';
import { KB_FTS_DDL } from './search.ts';
import { extractKbText, ExtractError, tidyText } from './extract.ts';
import { HISTORY_KEEP, makeExcerpt } from './service.ts';
import { loadDemoKbDocs, seedDemo, tables } from './seed.ts';

const START = '2026-11-02T09:00:00+09:00';
const FILES = path.join(process.cwd(), 'tests', 'fixtures', 'kb-files');
const SAMPLE_PDF = fs.readFileSync(path.join(FILES, 'clinic-cleanup.pdf'));
const SAMPLE_DOCX = fs.readFileSync(path.join(FILES, 'xray-room.docx'));
const BROKEN_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog \nthis file is broken and has no xref\n');
const B_AND_D = '멸균기 B&D 테스트는 언제 해?';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  tmp = null;
});

/** 테스트 서버(데모 매뉴얼 5종을 넣을지 고른다) */
async function makeApp(opts: { demo?: boolean } = {}) {
  tmp = makeTmpDir('dentalax-kb-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock, ai: { demoStreamDelayMs: 1, baseUrls: {} } });
  const admin = loginAs(app, 'admin');
  const manager = loginAs(app, 'manager');
  const staff = loginAs(app, 'staff');
  if (opts.demo) seedDemo(app.db, { clock, scale: 1 });
  return { app, clock, admin, manager, staff };
}

/** multipart 본문을 만든다(파일 하나 + 글 칸) */
function multipart(file: { name: string; data: Buffer }, fields: Record<string, string> = {}) {
  const boundary = '----dentalaxKbBoundary7MA4YWxkTrZu0gW';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(a: FastifyInstance, who: TestLogin, file: { name: string; data: Buffer }, fields: Record<string, string> = {}) {
  const m = multipart(file, fields);
  return a.inject({ method: 'POST', url: '/api/kb/docs', headers: { ...who.writeHeaders, ...m.headers }, payload: m.payload });
}

/** 올리고 201이면 자료를 돌려준다 */
async function uploadOk(a: FastifyInstance, who: TestLogin, file: { name: string; data: Buffer }, fields: Record<string, string> = {}): Promise<KbDocItem> {
  const res = await upload(a, who, file, fields);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ data: KbDocItem }>().data;
}

async function askAs(a: FastifyInstance, who: TestLogin, question: string): Promise<AskResponse> {
  const res = await a.inject({ method: 'POST', url: '/api/assistant/ask', headers: who.writeHeaders, payload: { question } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ data: AskResponse }>().data;
}

async function listAs(a: FastifyInstance, who: TestLogin): Promise<KbDocItem[]> {
  const res = await a.inject({ method: 'GET', url: '/api/kb/docs', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: KbDocItem[] }>().data;
}

const usageCount = (a: FastifyInstance) => a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_usage')!.n;

const md = (s: string) => Buffer.from(s, 'utf8');
const SAFE_MD = '# 원장실 금고 관리\n\n## 금고 열쇠 보관\n금고 열쇠는 원장실 책상 오른쪽 서랍 안 잠금함에 보관한다. 퇴근할 때 잠금함을 잠근다.\n\n## 금고 점검\n매달 첫 근무일에 금고 안 서류 목록을 확인한다.';

describe('질문과 근거', () => {
  test('phase-03-task-07 AC1: 데모 매뉴얼에서 "멸균기 B&D 테스트는 언제 해?" → 멸균 매뉴얼이 근거 1번, 발췌에 B&D, 답은 근거 번호를 인용한다', async () => {
    const { app: a, staff } = await makeApp({ demo: true });
    const r = await askAs(a, staff, B_AND_D);
    expect(r.found).toBe(true);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources.length).toBeLessThanOrEqual(3);
    const first = r.sources[0]!;
    expect(first.n).toBe(1);
    expect(first.title).toContain('멸균');
    expect(first.excerpt).toContain('B&D');
    expect(first.heading.startsWith(first.title)).toBe(true);
    // 원문 보기: 근거 조각이 그 자료의 조각 목록에 있다
    const doc = (await a.inject({ method: 'GET', url: `/api/kb/docs/${first.kbDocId}`, headers: staff.headers })).json<{ data: KbDocDetail }>().data;
    expect(doc.title).toBe(first.title);
    expect(doc.chunks.some((c) => c.id === first.chunkId && c.text.includes('B&D'))).toBe(true);
    // 데모 답: 표시 + 근거 번호. AI 사용량 1건(데모)
    expect(r.answer.startsWith(DEMO_MARK)).toBe(true);
    expect(r.answer).toContain('[1]');
    expect(r.ai).toMatchObject({ demo: true });
    expect(usageCount(a)).toBe(1);
    expect(a.db.get<{ feature: string; demo: number }>('SELECT feature, demo FROM ai_usage')).toMatchObject({ feature: 'assistant', demo: 1 });
    // 대화 기록에 질문·답·근거가 남는다
    expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(r.messages[1]!.sources[0]).toMatchObject({ kbDocId: first.kbDocId, chunkId: first.chunkId });
  });

  test('phase-03-task-07 AC2: 관련 없는 질문 → "원내 문서에서 찾지 못했습니다" + 문서 올리기 안내, AI를 부르지 않아 ai_usage에 기록이 없다', async () => {
    const { app: a, staff, manager } = await makeApp({ demo: true });
    const r = await askAs(a, staff, '오늘 주식 시세 알려줘');
    expect(r).toMatchObject({ found: false, answer: NOT_FOUND_ANSWER, sources: [], ai: null });
    expect(r.hint).toContain('주식 시세');
    expect(r.hint).toContain('실장님께 올려 달라고');
    const m = await askAs(a, manager, '오늘 주식 시세 알려줘');
    expect(m.hint).toContain('"원내 문서" 탭에서 올리면');
    expect(usageCount(a)).toBe(0);
    expect(r.messages[1]).toMatchObject({ role: 'assistant', found: false, sources: [] });
    expect(r.messages[1]!.text.startsWith(NOT_FOUND_ANSWER)).toBe(true);
    // 자료가 하나도 없을 때도 같다
    const empty = await makeAppNoDemoAsk();
    expect(empty).toMatchObject({ found: false, answer: NOT_FOUND_ANSWER });
  });

  test('질문 검사: 빈 질문·너무 긴 질문은 400, 직원 권한 없는 사람(로그인 안 함)은 401', async () => {
    const { app: a, staff } = await makeApp();
    const blank = await a.inject({ method: 'POST', url: '/api/assistant/ask', headers: staff.writeHeaders, payload: { question: '   ' } });
    expect(blank.statusCode).toBe(400);
    expect(blank.json<{ error: { fields: Record<string, string> } }>().error.fields.question).toBe('질문을 적어 주세요.');
    const long = await a.inject({ method: 'POST', url: '/api/assistant/ask', headers: staff.writeHeaders, payload: { question: '가'.repeat(501) } });
    expect(long.statusCode).toBe(400);
    const anon = await a.inject({ method: 'POST', url: '/api/assistant/ask', payload: { question: '멸균' } });
    expect(anon.statusCode).toBe(401);
  });

  test('질문 속 전화번호는 대화 기록에 가려서 남는다', async () => {
    const { app: a, staff } = await makeApp({ demo: true });
    const r = await askAs(a, staff, '010-2345-6789 번호로 B&D 테스트 결과를 보내도 돼?');
    expect(r.messages[0]!.text).toContain('[전화번호]');
    expect(r.messages[0]!.text).not.toContain('6789');
  });
});

/** 자료가 없는 새 서버에서 질문 한 번 */
async function makeAppNoDemoAsk(): Promise<AskResponse> {
  const t = makeTmpDir('dentalax-kb-empty-');
  const b = await buildApp({ dataDir: t, webDist: path.join(t, 'no-web'), clock: manualClock(START), ai: { baseUrls: {} } });
  try {
    const s = loginAs(b, 'staff');
    const r = await askAs(b, s, B_AND_D);
    expect(usageCount(b)).toBe(0);
    return r;
  } finally {
    await b.close();
    fs.rmSync(t, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('공개 범위', () => {
  test('phase-03-task-07 AC3: visibility=manager 자료는 staff 질문의 근거로 쓰이지 않고 목록·원문 보기에도 없다. manager에게는 근거가 된다', async () => {
    const { app: a, manager, staff } = await makeApp({ demo: true });
    const doc = await uploadOk(a, manager, { name: '금고 관리.md', data: md(SAFE_MD) }, { visibility: 'manager' });
    // 제목을 비우면 글의 첫 # 제목을 쓴다
    expect(doc).toMatchObject({ status: 'ready', visibility: 'manager', title: '원장실 금고 관리' });

    const q = '금고 열쇠는 어디에 보관해?';
    const byManager = await askAs(a, manager, q);
    expect(byManager.found).toBe(true);
    expect(byManager.sources[0]!.kbDocId).toBe(doc.id);

    const byStaff = await askAs(a, staff, q);
    expect(byStaff.sources.some((s) => s.kbDocId === doc.id)).toBe(false);
    expect(byStaff.found).toBe(false);

    expect((await listAs(a, staff)).some((d) => d.id === doc.id)).toBe(false);
    expect((await listAs(a, manager)).some((d) => d.id === doc.id)).toBe(true);
    const peek = await a.inject({ method: 'GET', url: `/api/kb/docs/${doc.id}`, headers: staff.headers });
    expect(peek.statusCode).toBe(404);
  });

  test('직원은 자료를 올리거나 지우거나 "가리고 저장"을 할 수 없다(403)', async () => {
    const { app: a, staff } = await makeApp({ demo: true });
    const up = await upload(a, staff, { name: '규정.md', data: md(SAFE_MD) });
    expect(up.statusCode).toBe(403);
    const fromDoc = await a.inject({ method: 'POST', url: '/api/kb/docs', headers: staff.writeHeaders, payload: { documentId: 1 } });
    expect(fromDoc.statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: '/api/kb/docs/1', headers: staff.writeHeaders })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: '/api/kb/docs/1/confirm-redact', headers: staff.writeHeaders })).statusCode).toBe(403);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kb_docs WHERE deleted_at IS NULL')!.n).toBe(5);
  });
});

describe('자료 올리기', () => {
  test('phase-03-task-07 AC4: pdf·docx 샘플이 ready가 되고 조각 수가 나온다. 꺼낸 글로 검색된다', async () => {
    const { app: a, manager, staff } = await makeApp();
    const pdf = await uploadOk(a, manager, { name: '진료실 정리 규정.pdf', data: SAMPLE_PDF });
    // # 제목이 없는 PDF는 파일 이름이 제목이 된다
    expect(pdf).toMatchObject({ status: 'ready', error: null, title: '진료실 정리 규정', sourceName: '진료실 정리 규정.pdf', sourceKind: 'file' });
    expect(pdf.chunkCount).toBeGreaterThan(0);
    const docx = await uploadOk(a, manager, { name: 'xray-room.docx', data: SAMPLE_DOCX }, { title: '엑스레이실 사용 규정' });
    expect(docx).toMatchObject({ status: 'ready', title: '엑스레이실 사용 규정' });
    expect(docx.chunkCount).toBeGreaterThan(0);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kb_chunks WHERE kb_doc_id = ?', [docx.id])!.n).toBe(docx.chunkCount);

    expect((await askAs(a, staff, '유니트체어 표면 소독')).sources[0]!.kbDocId).toBe(pdf.id);
    expect((await askAs(a, staff, '엑스레이 센서 보관')).sources[0]!.kbDocId).toBe(docx.id);
    expect((await listAs(a, staff)).map((d) => d.id).sort()).toEqual([pdf.id, docx.id].sort());
  });

  test('phase-03-task-07 AC4: 손상된 pdf는 failed와 쉬운 이유가 남고 검색되지 않는다. 직원 목록에는 보이지 않는다', async () => {
    const { app: a, manager, staff } = await makeApp();
    const bad = await uploadOk(a, manager, { name: '깨진 매뉴얼.pdf', data: BROKEN_PDF });
    expect(bad.status).toBe('failed');
    expect(bad.chunkCount).toBe(0);
    expect(bad.error).toBe('PDF 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요. 원본 파일을 다시 저장해서 올려 주세요.');
    expect((await listAs(a, manager)).find((d) => d.id === bad.id)).toMatchObject({ status: 'failed', error: bad.error });
    expect((await listAs(a, staff)).some((d) => d.id === bad.id)).toBe(false);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kb_chunks')!.n).toBe(0);
  });

  test('HWP·실행 파일은 415(허용 형식 안내), 확장자만 바꾼 파일도 거부하고 저장하지 않는다', async () => {
    const { app: a, manager } = await makeApp();
    const hwp = await upload(a, manager, { name: '규정.hwp', data: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]) });
    expect(hwp.statusCode).toBe(415);
    expect(hwp.json<{ error: { message: string } }>().error.message).toBe('올릴 수 없는 파일 형식입니다. TXT·MD·PDF·DOCX 파일만 올릴 수 있어요.');
    const fake = await upload(a, manager, { name: '매뉴얼.pdf', data: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 0x90)]) });
    expect(fake.statusCode).toBe(415);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kb_docs')!.n).toBe(0);
  });

  test('서식 보관함 문서를 골라 자료로 넣는다: 글 문서는 본문, 올린 PDF 서식은 파일 글을 쓰고, HWP 서식은 415', async () => {
    const { app: a, manager, admin } = await makeApp();
    const created = await a.inject({
      method: 'POST', url: '/api/documents', headers: manager.writeHeaders,
      payload: { kind: 'policy', title: '소독실 출입 규정', body_md: '# 소독실 출입 규정\n\n## 출입\n소독실에 들어갈 때는 덧신을 신고 손을 씻는다.', folder: '규정', tags: [] },
    });
    expect(created.statusCode).toBe(201);
    const docId = created.json<{ data: { id: number } }>().data.id;
    const res = await a.inject({ method: 'POST', url: '/api/kb/docs', headers: manager.writeHeaders, payload: { documentId: docId } });
    expect(res.statusCode, res.body).toBe(201);
    const item = res.json<{ data: KbDocItem }>().data;
    expect(item).toMatchObject({ status: 'ready', title: '소독실 출입 규정', sourceKind: 'document', sourceName: '서식 보관함: 소독실 출입 규정' });

    // 올린 PDF 서식(관리자만 서식 업로드 가능)
    const m = multipart({ name: '정리 규정.pdf', data: SAMPLE_PDF }, { title: '정리 규정 서식' });
    const form = await a.inject({ method: 'POST', url: '/api/documents', headers: { ...admin.writeHeaders, ...m.headers }, payload: m.payload });
    expect(form.statusCode, form.body).toBe(201);
    const fromPdf = await a.inject({ method: 'POST', url: '/api/kb/docs', headers: manager.writeHeaders, payload: { documentId: form.json<{ data: { id: number } }>().data.id, visibility: 'manager' } });
    expect(fromPdf.json<{ data: KbDocItem }>().data).toMatchObject({ status: 'ready', visibility: 'manager', title: '정리 규정 서식' });

    const hm = multipart({ name: '휴가 신청서.hwp', data: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]) });
    const hwpForm = await a.inject({ method: 'POST', url: '/api/documents', headers: { ...admin.writeHeaders, ...hm.headers }, payload: hm.payload });
    expect(hwpForm.statusCode).toBe(201);
    const fromHwp = await a.inject({ method: 'POST', url: '/api/kb/docs', headers: manager.writeHeaders, payload: { documentId: hwpForm.json<{ data: { id: number } }>().data.id } });
    expect(fromHwp.statusCode).toBe(415);
    expect(fromHwp.json<{ error: { message: string } }>().error.message).toContain('HWP');
    const missing = await a.inject({ method: 'POST', url: '/api/kb/docs', headers: manager.writeHeaders, payload: { documentId: 999 } });
    expect(missing.statusCode).toBe(404);
  });

  test('글 꺼내기: txt·md는 UTF-8로 읽고, 빈 글·UTF-8이 아닌 글은 쉬운 이유로 실패한다', async () => {
    expect(await extractKbText('.md', md('\uFEFF# 제목\r\n\r\n\r\n\r\n본문  \r\n'))).toBe('# 제목\n\n본문');
    await expect(extractKbText('.txt', md('   \n  '))).rejects.toThrow(new ExtractError('파일에서 글자를 찾지 못했어요. 내용이 있는 파일을 올려 주세요.'));
    await expect(extractKbText('.txt', Buffer.from([0xff, 0xfe, 0x41]))).rejects.toThrow('UTF-8');
    await expect(extractKbText('.docx', Buffer.from('PK\u0003\u0004 broken'))).rejects.toThrow('DOCX 파일을 읽지 못했어요');
    await expect(extractKbText('.hwp', Buffer.alloc(10))).rejects.toThrow('TXT·MD·PDF·DOCX');
    expect(tidyText('a \t\nb')).toBe('a\nb');
  });
});

describe('개인정보 검토', () => {
  const PHONE_MD = '# 거래처 연락 규정\n\n## 재료 주문 연락\n재료 주문은 거래처 담당자에게 010-2345-6789로 연락한다. 주문서 사본은 데스크 서랍에 둔다.\n\n## 반품\n반품은 받은 날부터 7일 안에 요청한다.';

  test('phase-03-task-07 AC5: 전화번호가 든 문서는 needs_review + 감지 항목, "가리고 저장" 뒤 검색 발췌·조각에 번호가 가려져 있다', async () => {
    const { app: a, manager, staff } = await makeApp();
    const item = await uploadOk(a, manager, { name: '거래처 연락.md', data: md(PHONE_MD) });
    expect(item.status).toBe('needs_review');
    expect(item.findings).toEqual([{ type: 'phone', count: 1 }]);
    expect(item.chunkCount).toBe(0);
    // 검토 전에는 색인하지 않는다
    expect((await askAs(a, manager, '재료 주문 연락')).found).toBe(false);
    // 검토 화면용 미리보기: 가린 줄
    const detail = (await a.inject({ method: 'GET', url: `/api/kb/docs/${item.id}`, headers: manager.headers })).json<{ data: KbDocDetail }>().data;
    expect(detail.samples).toEqual(['재료 주문은 거래처 담당자에게 [전화번호]로 연락한다. 주문서 사본은 데스크 서랍에 둔다.']);
    expect(JSON.stringify(detail)).not.toContain('6789');

    const done = await a.inject({ method: 'POST', url: `/api/kb/docs/${item.id}/confirm-redact`, headers: manager.writeHeaders });
    expect(done.statusCode).toBe(200);
    expect(done.json<{ data: KbDocItem }>().data).toMatchObject({ status: 'ready', findings: [] });
    const r = await askAs(a, staff, '재료 주문은 어디로 연락해?');
    expect(r.found).toBe(true);
    expect(r.sources[0]!.excerpt).toContain('[전화번호]');
    expect(r.sources[0]!.excerpt).not.toContain('6789');
    expect(r.answer).not.toContain('6789');
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM kb_chunks WHERE text LIKE '%6789%'")!.n).toBe(0);
    expect(a.db.get<{ body: string }>('SELECT body FROM kb_docs WHERE id = ?', [item.id])!.body).not.toContain('6789');
    // 감사 기록(원문 없음)
    const log = a.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'kb.confirm_redact'");
    expect(log?.detail).toContain('phone');
    expect(log?.detail).not.toContain('6789');
    // 두 번 하면 409
    expect((await a.inject({ method: 'POST', url: `/api/kb/docs/${item.id}/confirm-redact`, headers: manager.writeHeaders })).statusCode).toBe(409);
  });

  test('병원 대표번호(허용 목록)는 개인정보로 세지 않고, 검토 "취소"(지우기)는 꺼낸 글까지 비운다', async () => {
    const { app: a, manager } = await makeApp();
    a.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('privacy', ?, ?)", [JSON.stringify({ allowlist: ['02-555-1234'], policy: {} }), START]);
    const ok = await uploadOk(a, manager, { name: '대표번호.md', data: md('# 안내\n\n병원 대표번호는 02-555-1234이다.') });
    expect(ok.status).toBe('ready');
    const pend = await uploadOk(a, manager, { name: '연락.md', data: md(PHONE_MD) });
    expect((await a.inject({ method: 'DELETE', url: `/api/kb/docs/${pend.id}`, headers: manager.writeHeaders })).statusCode).toBe(204);
    expect(a.db.get<{ body: string; deleted_at: string | null }>('SELECT body, deleted_at FROM kb_docs WHERE id = ?', [pend.id])).toMatchObject({ body: '' });
    expect((await listAs(a, manager)).some((d) => d.id === pend.id)).toBe(false);
  });
});

describe('지우기', () => {
  test('phase-03-task-07 AC6: 자료를 지우면 조각·색인이 빠져 이후 질문의 근거로 나오지 않는다. 지난 대화의 근거 카드는 "지워짐"으로 표시된다', async () => {
    const { app: a, manager, staff } = await makeApp({ demo: true });
    const before = await askAs(a, staff, B_AND_D);
    const sterilId = before.sources[0]!.kbDocId;
    const del = await a.inject({ method: 'DELETE', url: `/api/kb/docs/${sterilId}`, headers: manager.writeHeaders });
    expect(del.statusCode).toBe(204);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM kb_chunks WHERE kb_doc_id = ?', [sterilId])!.n).toBe(0);
    const after = await askAs(a, staff, B_AND_D);
    expect(after.sources.some((s) => s.kbDocId === sterilId)).toBe(false);
    expect((await listAs(a, staff)).some((d) => d.id === sterilId)).toBe(false);
    expect((await a.inject({ method: 'GET', url: `/api/kb/docs/${sterilId}`, headers: manager.headers })).statusCode).toBe(404);
    const hist = (await a.inject({ method: 'GET', url: '/api/assistant/history', headers: staff.headers })).json<{ data: AssistantMessage[] }>().data;
    expect(hist[1]!.sources[0]).toMatchObject({ kbDocId: sterilId, deleted: true });
    expect(a.db.get<{ action: string }>("SELECT action FROM audit_log WHERE action = 'kb.delete'")).toBeTruthy();
    // 이미 지운 자료를 또 지우면 404
    expect((await a.inject({ method: 'DELETE', url: `/api/kb/docs/${sterilId}`, headers: manager.writeHeaders })).statusCode).toBe(404);
  });
});

describe('대화 기록', () => {
  test('대화는 사용자별로 남고(남의 기록은 안 보임), 본인이 지울 수 있다', async () => {
    const { app: a, staff, manager } = await makeApp({ demo: true });
    await askAs(a, staff, B_AND_D);
    await askAs(a, manager, '연차 신청은 며칠 전까지?');
    const mine = (await a.inject({ method: 'GET', url: '/api/assistant/history', headers: staff.headers })).json<{ data: AssistantMessage[] }>().data;
    expect(mine.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(mine[0]!.text).toBe(B_AND_D);
    const clear = await a.inject({ method: 'DELETE', url: '/api/assistant/history', headers: staff.writeHeaders });
    expect(clear.statusCode).toBe(204);
    expect((await a.inject({ method: 'GET', url: '/api/assistant/history', headers: staff.headers })).json<{ data: unknown[] }>().data).toEqual([]);
    expect((await a.inject({ method: 'GET', url: '/api/assistant/history', headers: manager.headers })).json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  test(`사용자별로 최근 ${HISTORY_KEEP}개만 남긴다`, async () => {
    const { app: a, staff } = await makeApp();
    for (let i = 0; i < HISTORY_KEEP / 2 + 3; i++) await askAs(a, staff, `관계없는 질문 ${i}번 주식`);
    const hist = (await a.inject({ method: 'GET', url: '/api/assistant/history', headers: staff.headers })).json<{ data: AssistantMessage[] }>().data;
    expect(hist).toHaveLength(HISTORY_KEEP);
    expect(hist.at(-2)!.text).toBe(`관계없는 질문 ${HISTORY_KEEP / 2 + 2}번 주식`);
    expect(hist[0]!.text).toBe('관계없는 질문 3번 주식');
  });
});

describe('스키마·데모 데이터·발췌', () => {
  test('마이그레이션의 kb_fts 정의가 search.ts의 KB_FTS_DDL과 같다', async () => {
    const { app: a } = await makeApp();
    const sql = a.db.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'kb_fts'")!.sql;
    expect(sql).toBe(KB_FTS_DDL.replace(' IF NOT EXISTS', ''));
  });

  test('데모 seed는 매뉴얼 5종을 완료 자료로 넣고(감염·멸균·재고·연차·데스크), 초기화하면 자료·조각·색인·대화가 모두 비워진다', async () => {
    const { app: a, staff } = await makeApp({ demo: true });
    expect(tables).toEqual(['kb_docs', 'kb_chunks', 'kb_fts', 'assistant_messages']);
    const docs = await listAs(a, staff);
    expect(docs).toHaveLength(5);
    expect(docs.every((d) => d.status === 'ready' && d.chunkCount > 0 && d.sourceKind === 'demo')).toBe(true);
    expect(docs.map((d) => d.title).sort()).toEqual(loadDemoKbDocs().map((d) => d.title).sort());
    await askAs(a, staff, B_AND_D);
    clearBusinessData(a.db);
    for (const t of tables) expect(a.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n, t).toBe(0);
    // 초기화는 세션도 비우므로 다시 로그인한다
    expect((await askAs(a, loginAs(a, 'staff'), B_AND_D)).found).toBe(false);
  });

  test('발췌는 질문 낱말 둘레를 자르고 앞뒤가 잘리면 …를 붙인다', () => {
    const text = `${'가나다라마 '.repeat(40)}멸균기 예열 뒤 B&D 테스트를 한다. ${'바사아자차 '.repeat(40)}`;
    const ex = makeExcerpt(text, 'B&D 테스트 언제');
    expect(ex.startsWith('…')).toBe(true);
    expect(ex.endsWith('…')).toBe(true);
    expect(ex).toContain('B&D 테스트');
    expect(makeExcerpt('짧은 글\n둘째 줄', '짧은')).toBe('짧은 글 둘째 줄');
    expect(makeExcerpt('- 첫째 규칙\n- 둘째 규칙', '규칙')).toBe('첫째 규칙 둘째 규칙');
  });

  test('assistant 기능의 데모 답은 첫 근거 조각의 앞부분을 옮기고 근거 번호를 붙인다', () => {
    const ctx = { clinic: { name: '하늘숲치과' }, user: { name: '김직원', role: 'staff', jobType: 'desk' }, today: '2026-11-02' };
    const input = assistantFeature.inputSchema.parse({ question: 'B&D?', chunks: [{ n: 1, title: '멸균 매뉴얼 > 2. 점검', text: '- 아침 첫 운전 전에 B&D 테스트를 한다.' }] });
    const demo = assistantFeature.demo(input, ctx);
    expect(demo).toBe(`${DEMO_MARK} "멸균 매뉴얼 > 2. 점검"에 따르면 다음과 같습니다. 아침 첫 운전 전에 B&D 테스트를 한다. [1]\n자세한 내용은 아래 근거 문서를 확인해 주세요.`);
    const prompt = assistantFeature.buildPrompt(input, ctx);
    expect(prompt.user).toContain('[1] 멸균 매뉴얼 > 2. 점검: - 아침 첫 운전 전에 B&D 테스트를 한다.');
    expect(prompt.system).toContain('지어내지 않고');
  });
});
