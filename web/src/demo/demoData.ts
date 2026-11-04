// 이 파일이 하는 일: 구경용 체험판(GitHub Pages)에서 미리 녹화한 서버 응답을 찾는 순수 로직.
// 녹화 파일(demo-data.json)은 scripts/demo-site.ts가 가상 하늘숲치과 데이터로 만든다. 조회(GET)는 주소·쿼리로 찾고,
// 저장하지 않는 AI 요청(POST)만 녹화한 예시 답을 다시 보여 준다. 그 밖의 저장·삭제 요청은 찾지 않는다(체험판은 저장되지 않음).

/** 녹화한 응답 하나 */
export interface DemoRecord {
  /** HTTP 방법(GET·POST) */
  m: string;
  /** 주소 경로(/api/...) */
  p: string;
  /** 정렬한 쿼리 문자열 */
  q: string;
  /** AI 기능 이름(본문의 feature, 없으면 빈 문자열) */
  k: string;
  /** 응답 상태 코드 */
  s: number;
  /** 응답 content-type */
  t: string;
  /** 응답 본문(글자) */
  b: string;
}

/** 녹화 파일 전체 */
export interface DemoData {
  /** 녹화할 때 서버의 고정 시각 */
  now: string;
  records: DemoRecord[];
}

/** 저장하지 않고 답만 돌려주는 POST(AI·미리보기). 체험판에서는 녹화한 예시 답을 보여 준다 */
export const REPLAY_POST_PATHS: readonly string[] = [
  '/api/ai/stream',
  '/api/ai/run',
  '/api/ai/receipt',
  '/api/ai/transcribe',
  '/api/assistant/ask',
  '/api/adcheck',
  '/api/roster/suggest',
  '/api/finance/monthly/summary',
  '/api/import/items/preview',
];

/** 쿼리 문자열을 이름·값 순으로 정렬해 같은 뜻이면 같은 글자가 되게 한다 */
export function normQuery(search: string): string {
  const entries = [...new URLSearchParams(search).entries()];
  entries.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  return new URLSearchParams(entries).toString();
}

/** 요청 본문(JSON 글자)에서 AI 기능 이름(feature)을 꺼낸다 */
export function featureOf(body: unknown): string {
  if (typeof body !== 'string') return '';
  try {
    const f = (JSON.parse(body) as { feature?: unknown } | null)?.feature;
    return typeof f === 'string' ? f : '';
  } catch {
    return '';
  }
}

/** 두 쿼리에서 이름과 값이 같은 항목 수 */
function sharedParams(a: string, b: string): number {
  const bp = new URLSearchParams(b);
  let n = 0;
  for (const [k, v] of new URLSearchParams(a)) if (bp.get(k) === v) n += 1;
  return n;
}

/**
 * 요청에 맞는 녹화 응답을 찾는다. 없으면 null.
 * - GET: 경로·쿼리가 같은 것 → 없으면 같은 경로 중 쿼리가 가장 많이 겹치는 것(예: 녹화하지 않은 쪽 번호)
 * - POST: REPLAY_POST_PATHS만, 같은 AI 기능(feature)의 답. 기능 이름이 없는 요청(사진·녹음 파일)은 경로만 맞으면 된다
 */
export function findRecord(data: DemoData, method: string, pathname: string, search: string, feature = ''): DemoRecord | null {
  const m = method.toUpperCase();
  const same = data.records.filter((r) => r.m === m && r.p === pathname);
  if (same.length === 0) return null;
  if (m === 'GET') {
    const q = normQuery(search);
    const exact = same.find((r) => r.q === q);
    if (exact) return exact;
    let best = same[0] as DemoRecord;
    let bestScore = -1;
    for (const r of same) {
      const score = sharedParams(r.q, q);
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    return best;
  }
  if (m !== 'POST' || !REPLAY_POST_PATHS.includes(pathname)) return null;
  return same.find((r) => r.k === feature) ?? (feature ? null : (same[0] as DemoRecord));
}
