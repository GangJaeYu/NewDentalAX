// 이 파일이 하는 일: assistant 모듈(원내 AI 도우미)의 데모 데이터. 01-06이 만든 가상 "하늘숲치과" 매뉴얼 5종(tests/fixtures/kb/*.md, eval-set.json 목록 순서)을
// 완료(ready) 상태 자료로 넣고 조각·검색 색인을 만든다. 환자 정보는 없다(NFR-001). 대화 기록은 넣지 않는다. scale과 관계없이 한 벌만 넣는다(같은 매뉴얼을 여러 번 넣으면 검색 근거가 겹친다).
// 모양은 server/db/seed/types.ts의 ModuleSeed다. 등록은 server/db/seed/registry.ts가 이미 해 두었다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { indexDocument, titleOf } from './search.ts';

/** 이 모듈이 소유한 업무 테이블(앞 테이블을 뒤 테이블이 가리킨다) */
export const tables: readonly string[] = ['kb_docs', 'kb_chunks', 'kb_fts', 'assistant_messages'];

/** 데모 매뉴얼 폴더(01-06 검색 실험과 같은 자료) */
export const DEMO_KB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tests', 'fixtures', 'kb');

/** 데모 매뉴얼 한 개 */
export interface DemoKbDoc {
  file: string;
  title: string;
  body: string;
  visibility: 'all' | 'manager';
}

/** 데모 매뉴얼 목록을 읽는다(폴더가 없으면 빈 목록) */
export function loadDemoKbDocs(dir: string = DEMO_KB_DIR): DemoKbDoc[] {
  const listPath = path.join(dir, 'eval-set.json');
  if (!fs.existsSync(listPath)) return [];
  const set = JSON.parse(fs.readFileSync(listPath, 'utf8')) as { docs: { file: string; visibility?: string }[] };
  return set.docs.map((d) => {
    const body = fs.readFileSync(path.join(dir, d.file), 'utf8').replace(/\r\n?/g, '\n').trim();
    return { file: d.file, title: titleOf(body) ?? d.file.replace(/\.md$/, ''), body, visibility: d.visibility === 'manager' ? 'manager' : 'all' };
  });
}

/** 데모 자료를 넣는다(관리자 계정이 올린 것으로) */
export function seedDemo(db: Db, ctx: SeedContext): void {
  const admin = db.get<{ id: number }>("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")?.id ?? null;
  const docs = loadDemoKbDocs();
  const base = ctx.clock.now().getTime();
  db.tx(() => {
    docs.forEach((d, i) => {
      // 오래된 것부터 하루씩 간격을 두고 올린 것으로 한다
      const at = new Date(base - (docs.length - i) * 24 * 60 * 60 * 1000).toISOString();
      const id = db.run(
        "INSERT INTO kb_docs (title, visibility, status, body, chunk_count, created_by, created_at, updated_at) VALUES (?, ?, 'ready', ?, 0, ?, ?, ?)",
        [d.title, d.visibility, d.body, admin, at, at],
      ).lastInsertRowid;
      const n = indexDocument(db, id, d.title, d.body);
      db.run('UPDATE kb_docs SET chunk_count = ? WHERE id = ?', [n, id]);
    });
  });
}
