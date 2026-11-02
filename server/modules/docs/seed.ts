// 이 파일이 하는 일: docs 모듈(문서·서식 보관함)의 데모 데이터. 가상 "하늘숲치과"의 원내 문서 몇 개(환자 일반 안내문·공문·내부 규정·업무 매뉴얼·회의록)를
// 폴더·태그와 함께 넣고, 문서마다 버전 1을 남긴다. 환자 이름·연락처 같은 개인정보는 넣지 않는다(NFR-001). scale=10이면 같은 묶음을 10번 넣는다(NFR-005).
// 모양은 server/db/seed/types.ts의 ModuleSeed다. 등록은 server/db/seed/registry.ts가 이미 해 두었다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import type { DocKind } from '../../../shared/schemas/docs.ts';

/** 이 모듈이 소유한 업무 테이블(앞 테이블을 뒤 테이블이 가리킨다) */
export const tables: readonly string[] = ['documents', 'document_versions'];

/** 데모 문서 한 개 */
interface DemoDoc {
  kind: DocKind;
  title: string;
  folder: string;
  tags: string[];
  source: 'ai' | 'manual';
  /** 기준 시각보다 며칠 전에 만들었는지 */
  daysAgo: number;
  body: string;
}

const DOCS: readonly DemoDoc[] = [
  {
    kind: 'notice_patient',
    title: '임플란트 수술 후 주의사항 안내',
    folder: '환자 안내',
    tags: ['임플란트', '수술 후'],
    source: 'ai',
    daysAgo: 20,
    body: '# 임플란트 수술 후 주의사항 안내\n\n## 수술 당일\n- 거즈는 **2시간** 동안 꼭 물고 계세요.\n- 침이나 피는 삼키셔도 괜찮아요.\n- 뜨거운 음식과 빨대 사용은 피해 주세요.\n\n## 일주일 동안\n- 술과 담배는 상처 회복을 늦추니 피해 주세요.\n- 처방받은 약은 시간에 맞춰 드세요.\n\n## 바로 연락 주세요\n- 피가 멈추지 않거나 많이 부을 때\n- 열이 나거나 통증이 점점 심해질 때',
  },
  {
    kind: 'notice_patient',
    title: '스케일링 후 안내',
    folder: '환자 안내',
    tags: ['스케일링'],
    source: 'manual',
    daysAgo: 12,
    body: '# 스케일링 후 안내\n\n- 하루 이틀은 이가 시릴 수 있어요. 점점 나아져요.\n- 잇몸에서 피가 조금 나는 것은 정상이에요.\n- 부드러운 칫솔로 꼼꼼히 닦아 주세요.',
  },
  {
    kind: 'official',
    title: '연말 휴진 안내 공문',
    folder: '공문',
    tags: ['휴진', '연말'],
    source: 'ai',
    daysAgo: 6,
    body: '# 연말 휴진 안내\n\n- **수신**: 거래처 담당자 각위\n- **참조**: 하늘숲치과 원무팀\n- **제목**: 연말 휴진 안내\n\n## 본문\n1. 귀사의 무궁한 발전을 기원합니다.\n2. 당원은 12월 31일(목)부터 1월 1일(금)까지 휴진합니다.\n3. 휴진 기간의 납품 일정은 12월 29일까지 알려 주시기 바랍니다.\n\n## 붙임\n1. 휴진 일정표 1부.  끝.',
  },
  {
    kind: 'policy',
    title: '감염 관리 내부 규정',
    folder: '규정',
    tags: ['감염 관리', '멸균'],
    source: 'manual',
    daysAgo: 40,
    body: '# 감염 관리 내부 규정\n\n## 목적\n원내 감염을 막기 위해 기구 소독과 멸균 절차를 정합니다.\n\n## 기준\n- 사용한 기구는 바로 세척실로 옮깁니다.\n- 멸균기 점검 기록은 매일 남깁니다.\n- 일회용품은 다시 쓰지 않습니다.',
  },
  {
    kind: 'manual',
    title: '마감 업무 매뉴얼',
    folder: '매뉴얼',
    tags: ['마감', '데스크'],
    source: 'manual',
    daysAgo: 30,
    body: '# 마감 업무 매뉴얼\n\n1. 진료실 장비 전원을 끕니다.\n2. 석션 라인을 세척합니다.\n3. 내일 예약 준비물을 확인합니다.\n4. 마감 체크리스트를 체크합니다.',
  },
  {
    kind: 'minutes',
    title: '11월 첫째 주 직원 회의록',
    folder: '회의록',
    tags: ['회의'],
    source: 'ai',
    daysAgo: 1,
    body: '# 11월 첫째 주 직원 회의록\n\n## 결정 사항\n- 다음 주부터 오전 예약 간격을 30분으로 바꾼다.\n\n## 할 일\n- 예약 안내 문자 문구 고치기 (데스크, 11월 6일까지)\n\n## 요약\n예약 간격과 안내 문자 정리를 논의했다.',
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** 데모 문서를 넣는다(작성자는 첫 관리자·실장 계정, 없으면 비워 둔다) */
export function seedDemo(db: Db, ctx: SeedContext): void {
  const author = db.get<{ id: number }>("SELECT id FROM users WHERE role IN ('admin', 'manager') AND active = 1 ORDER BY CASE role WHEN 'manager' THEN 0 ELSE 1 END, id LIMIT 1")?.id ?? null;
  const now = ctx.clock.now().getTime();
  const rounds = Math.max(1, Math.floor(ctx.scale));
  db.tx(() => {
    for (let round = 0; round < rounds; round++) {
      for (const d of DOCS) {
        const at = new Date(now - (d.daysAgo + round) * DAY_MS).toISOString();
        const title = round === 0 ? d.title : `${d.title} (${round + 1})`;
        const r = db.run(
          'INSERT INTO documents (kind, title, body_md, folder, tags, source, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [d.kind, title, d.body, d.folder, JSON.stringify(d.tags), d.source, author, at, at],
        );
        db.run('INSERT INTO document_versions (document_id, title, body_md, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [r.lastInsertRowid, title, d.body, author, at]);
      }
    }
  });
}
