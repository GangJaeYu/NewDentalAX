// 이 파일이 하는 일: 사용자 문서(README·LLM_GUIDE·COST·PLAN·DECISIONS·SECURITY·PROGRESS)에 원문 12·13절이 요구한 소제목이 빠짐없이 있는지 검사한다(NFR-011, phase-05-task-04).
// 더해서 COST.md 가격·데이터 정책 표의 모든 줄에 확인일(YYYY-MM-DD)과 출처 주소(https://)가 있는지, README·GUIDE의 그림 파일이 실제로 있는지도 본다.
// 2026-11-03: 원문 12절의 비개발자용 안내(설치·접속·첫 설정·백업·FAQ·폴더 지도 등)는 docs/GUIDE.md로 옮기고, README는 첫 화면용 요약(공개 저장소 소개)으로 바꿨다.
// `npm run lint`의 docs 단계가 부른다(scripts/lint.ts). 따로 실행: node scripts/check-docs.ts [--root <폴더>]  (문제가 있으면 목록을 보여 주고 종료 코드 1)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 문서별 필수 소제목(## 또는 ### 제목이 이 글자로 시작해야 한다). 원문 12절 = GUIDE(+README 요약), 13절 = COST, 나머지는 원문 12~13절 문서 목록 */
export const REQUIRED_HEADINGS: Readonly<Record<string, readonly string[]>> = {
  'README.md': ['어떻게 만들었나', '할 수 있는 일', '빠른 시작', '문서', '원칙'],
  'docs/GUIDE.md': [
    '할 수 있는 일',
    '준비물',
    '설치하기 (Windows)',
    '설치할 때 막히기 쉬운 곳',
    '매일 켜고 끄기',
    '직원 PC·태블릿·휴대폰에서 접속하기',
    'Windows 방화벽 허용',
    '첫 설정',
    '관리자 계정 만들기',
    '직원 추가하기',
    'AI 키 넣기',
    '백업과 복원',
    '업데이트',
    '보안·주의 (외부 공개 위험)',
    '자주 묻는 질문 (FAQ)',
    '문제 해결',
    '폴더 지도',
    'Claude Code로 고쳐 달라고 할 때',
    '관련 문서',
  ],
  'docs/LLM_GUIDE.md': [
    'LLM API란',
    '공급자별 API 키 발급',
    'Anthropic (Claude)',
    'OpenAI',
    'Google (Gemini)',
    '토큰과 요금',
    '키 관리 안전 수칙',
    '이 프로그램에 키 넣기',
  ],
  'docs/COST.md': [
    '계산 가정',
    '공급자·모델 가격 비교표',
    '기능별 1회 평균 토큰',
    '병원 규모별 월 비용',
    '추천 조합',
    '비용 절약 팁',
    '공급자별 데이터 정책',
    '서버 운영 비용',
  ],
  'docs/PLAN.md': ['단계 요약', '현재 상태'],
  'docs/DECISIONS.md': ['사용자가 정한 것', '에이전트가 정한 것', '구현 중 결정'],
  'docs/SECURITY.md': ['1. 요약', '2. 체크리스트', '5. 받아들인 위험'],
  'PROGRESS.md': ['지금', '완료한 단계', '구현 진행'],
};

/** COST.md에서 줄마다 확인일·출처를 요구하는 표가 있는 소제목 */
export const SOURCED_SECTIONS = ['공급자·모델 가격 비교표', '공급자별 데이터 정책'] as const;

/** 안내서(GUIDE) 그림이 있어야 하는 최소 장수(대표 화면 + 휴대폰 1장). README는 첫 화면 그림 1장 이상 */
export const MIN_README_IMAGES = 5;
export const MIN_IMAGES: Readonly<Record<string, number>> = { 'docs/GUIDE.md': MIN_README_IMAGES, 'README.md': 1 };

export interface DocsResult {
  /** 검사한 문서 수 */
  checked: number;
  /** 사람이 읽을 문제 목록(비어 있으면 통과) */
  problems: string[];
}

/** 문서의 ## · ### 제목 글자 목록(앞의 # 과 공백을 뗀 것) */
export function headingsOf(markdown: string): string[] {
  const out: string[] = [];
  let inCode = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (inCode) continue;
    const m = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m?.[1]) out.push(m[1].trim());
  }
  return out;
}

/** 빠진 필수 소제목(제목이 필수 글자로 시작하면 있는 것으로 본다) */
export function missingHeadings(markdown: string, required: readonly string[]): string[] {
  const hs = headingsOf(markdown);
  return required.filter((r) => !hs.some((h) => h.startsWith(r)));
}

/** 소제목 하나의 본문(다음 같은 단계 이상 제목 전까지) */
export function sectionBody(markdown: string, heading: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,3}\s+/.test(l) && l.replace(/^#{2,3}\s+/, '').trim().startsWith(heading));
  if (start < 0) return null;
  const level = /^(#+)/.exec(lines[start] ?? '')?.[1]?.length ?? 2;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = /^(#+)\s+/.exec(l);
    return !!m && (m[1] ?? '').length <= level;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/** 표의 본문 줄(머리 줄과 구분 줄 제외) */
export function tableRows(body: string): string[] {
  const rows = body.split(/\r?\n/).filter((l) => /^\s*\|/.test(l));
  const isRule = (l: string | undefined) => l !== undefined && /^\s*\|[\s:|-]+\|\s*$/.test(l);
  return rows.filter((l, i) => !isRule(l) && !isRule(rows[i + 1]));
}

/** 표 줄마다 확인일(YYYY-MM-DD)과 출처(https://)가 있는지. 문제 줄 목록을 돌려준다 */
export function unsourcedRows(body: string): string[] {
  const rows = tableRows(body);
  return rows.filter((r) => !/\d{4}-\d{2}-\d{2}/.test(r) || !/https?:\/\/\S+/.test(r));
}

/** README가 가리키는 그림 파일 경로(문서 기준 상대 경로) */
export function imageLinks(markdown: string): string[] {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? '').filter((p) => p !== '' && !/^https?:/.test(p));
}

/** 문서 전체를 검사한다 */
export function checkDocs(root: string): DocsResult {
  const problems: string[] = [];
  let checked = 0;
  for (const [rel, required] of Object.entries(REQUIRED_HEADINGS)) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
      problems.push(`${rel}: 문서가 없어요`);
      continue;
    }
    checked += 1;
    const text = fs.readFileSync(file, 'utf8');
    for (const h of missingHeadings(text, required)) problems.push(`${rel}: 필수 소제목 "${h}"이(가) 없어요`);

    if (rel === 'docs/COST.md') {
      for (const sec of SOURCED_SECTIONS) {
        const body = sectionBody(text, sec);
        if (body === null) continue; // 소제목 누락은 위에서 이미 알림
        const rows = tableRows(body);
        if (rows.length === 0) problems.push(`${rel}: "${sec}"에 표가 없어요`);
        for (const r of unsourcedRows(body)) problems.push(`${rel}: "${sec}" 표의 줄에 확인일 또는 출처 주소가 없어요 → ${r.trim().slice(0, 80)}`);
      }
    }
    const minImages = MIN_IMAGES[rel];
    if (minImages !== undefined) {
      const imgs = imageLinks(text);
      if (imgs.length < minImages) problems.push(`${rel}: 화면 그림이 ${imgs.length}장뿐이에요(최소 ${minImages}장)`);
      for (const img of imgs) {
        if (!fs.existsSync(path.join(root, path.dirname(rel), img))) problems.push(`${rel}: 그림 파일 "${img}"이(가) 없어요`);
      }
    }
  }
  return { checked, problems };
}

// 직접 실행했을 때만 결과를 출력한다(테스트·lint.ts에서 불러올 때는 실행하지 않음)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--root');
  const r = checkDocs(path.resolve(i > 0 ? (process.argv[i + 1] ?? '.') : process.cwd()));
  for (const p of r.problems) console.log(`  - ${p}`);
  console.log(`[docs] 문서 ${r.checked}개 검사, 문제 ${r.problems.length}건`);
  process.exit(r.problems.length ? 1 : 0);
}
