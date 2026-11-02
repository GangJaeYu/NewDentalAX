// 이 파일이 하는 일: 화면 공용 lib·컴포넌트의 순수 함수 단위 테스트(phase-01-task-04 범위). 금액·날짜·D-n 표시, API 오류 변환과 SSE 나누기,
// 파일 검사·사진 축소 크기, 표 정렬, 마크다운 미리보기(HTML 불허), 그래프 좌표를 확인한다.
import { describe, expect, it } from 'vitest';
import { daysBetween, formatDate, formatDateLong, formatDDay, formatNumber, formatPercent, formatWon, greeting, initials } from './format.ts';
import { parseSse, toApiError } from './api.ts';
import { checkFile, fitSize, formatBytes } from './image.ts';
import { isThemePref } from './theme.ts';
import { sortRows } from '../components/DataTable.tsx';
import { applyFormat, parseInline, parseMarkdown } from '../components/Markdown.tsx';
import { donutArcs, sparkPoints } from '../components/Charts.tsx';

describe('format', () => {
  it('phase-01-task-04 범위: 숫자·금액·백분율을 한국식으로 보여 준다', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(null)).toBe('-');
    expect(formatWon(12400)).toBe('12,400원');
    expect(formatWon(64300.4)).toBe('64,300원');
    expect(formatPercent(0.314)).toBe('31%');
  });

  it('phase-01-task-04 범위: 날짜는 한국 시간 기준이다(UTC 15시 = 다음 날)', () => {
    expect(formatDate('2026-11-02T00:00:00.000Z')).toBe('2026-11-02');
    expect(formatDate('2026-11-01T15:30:00.000Z')).toBe('2026-11-02');
    expect(formatDateLong('2026-11-02T00:00:00.000Z')).toBe('2026년 11월 2일 월요일');
    expect(daysBetween('2026-11-02', '2026-11-14')).toBe(12);
    expect(daysBetween('2026-11-02T09:00:00+09:00', '2026-11-01')).toBe(-1);
  });

  it('phase-01-task-04 범위: 남은 날은 오늘·D-n·기한 지남으로, 글자와 색을 함께 정한다', () => {
    expect(formatDDay(0)).toEqual({ text: '오늘', tone: 'danger' });
    expect(formatDDay(5)).toEqual({ text: 'D-5', tone: 'warn' });
    expect(formatDDay(21)).toEqual({ text: 'D-21', tone: 'ghost' });
    expect(formatDDay(-2)).toEqual({ text: '기한 지남 2일', tone: 'danger' });
  });

  it('phase-01-task-04 범위: 인사말과 아바타 글자', () => {
    expect(greeting('2026-11-02T09:00:00+09:00')).toBe('좋은 아침이에요');
    expect(greeting('2026-11-02T14:00:00+09:00')).toBe('좋은 오후예요');
    expect(initials('김지현')).toBe('지현');
    expect(initials('김원장')).toBe('원장');
    expect(initials('Kim')).toBe('KI');
  });
});

describe('api', () => {
  it('phase-01-task-04 범위: 서버 오류 응답을 ApiError로 바꾸고 한국어 문구·항목 오류·남은 시간을 그대로 담는다', () => {
    const e = toApiError(400, { error: { code: 'VALIDATION', message: '입력값을 확인해 주세요.', fields: { username: '아이디를 적어 주세요.' } } });
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION');
    expect(e.message).toBe('입력값을 확인해 주세요.');
    expect(e.fields).toEqual({ username: '아이디를 적어 주세요.' });
    const l = toApiError(423, { error: { code: 'LOCKED', message: '약 15분 뒤 다시 시도해 주세요.', retryAfterSec: 900 } });
    expect(l.retryAfterSec).toBe(900);
    const s = toApiError(502, null);
    expect(s.code).toBe('INTERNAL');
    expect(s.message).toMatch(/잠시 뒤 다시 시도/);
  });

  it('phase-01-task-04 범위: SSE 글 조각을 사건으로 나누고 끝나지 않은 조각은 남긴다', () => {
    const r = parseSse('event: delta\ndata: 안녕\n\ndata: {"a":1}\n\n: 주석\n\nevent: done\ndata: x');
    expect(r.events).toEqual([
      { event: 'delta', data: '안녕' },
      { event: 'message', data: '{"a":1}' },
    ]);
    expect(r.rest).toBe('event: done\ndata: x');
    expect(parseSse('data: 줄1\r\ndata: 줄2\r\n\r\n').events).toEqual([{ event: 'message', data: '줄1\n줄2' }]);
  });
});

describe('image·file', () => {
  it('phase-01-task-04 범위: 사진은 긴 변 기준으로 비율을 지켜 줄인다', () => {
    expect(fitSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(1000, 3000, 1600)).toEqual({ width: 533, height: 1600 });
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('phase-01-task-04 범위: 파일 확장자·크기를 보내기 전에 검사한다', () => {
    const rule = { accept: ['.jpg', '.png', '.pdf'], maxBytes: 10 * 1024 * 1024 };
    expect(checkFile({ name: '명세서.JPG', size: 2000 }, rule)).toBeNull();
    expect(checkFile({ name: '메모.txt', size: 10 }, rule)).toBe('JPG·PNG·PDF 파일만 올릴 수 있어요.');
    expect(checkFile({ name: '큰사진.png', size: 11 * 1024 * 1024 }, rule)).toBe('파일이 너무 커요(11MB). 10MB 이하로 올려 주세요.');
    expect(checkFile({ name: '빈.pdf', size: 0 }, rule)).toMatch(/빈 파일/);
    expect(formatBytes(2560)).toBe('3KB');
  });

  it('phase-01-task-04 범위: 테마 값은 시스템·라이트·다크 3가지만 받는다', () => {
    expect(['system', 'light', 'dark'].every(isThemePref)).toBe(true);
    expect(isThemePref('blue')).toBe(false);
    expect(isThemePref(null)).toBe(false);
  });
});

describe('DataTable 정렬', () => {
  it('phase-01-task-04 범위: 숫자·가나다순 정렬, 빈 값은 항상 맨 뒤', () => {
    const rows = [{ n: '석션 팁', q: 3 }, { n: '글러브', q: null }, { n: '레진', q: 10 }];
    expect(sortRows(rows, (r) => r.q, 'asc').map((r) => r.n)).toEqual(['석션 팁', '레진', '글러브']);
    expect(sortRows(rows, (r) => r.q, 'desc').map((r) => r.n)).toEqual(['레진', '석션 팁', '글러브']);
    expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual(['글러브', '레진', '석션 팁']);
  });
});

describe('마크다운 미리보기', () => {
  it('phase-01-task-04 범위: 제목·목록·굵게·구분선을 나누고 HTML 태그는 글자 그대로 둔다', () => {
    const blocks = parseMarkdown('# 안내\n\n**주차** 2시간 무료\n<script>alert(1)</script>\n\n- 하나\n- 둘\n1. 첫째\n---');
    expect(blocks[0]).toEqual({ type: 'h', level: 1, inlines: [{ text: '안내' }] });
    expect(blocks[1]).toEqual({ type: 'p', inlines: [{ text: '주차', bold: true }, { text: ' 2시간 무료 <script>alert(1)</script>' }] });
    expect(blocks[2]).toEqual({ type: 'ul', items: [[{ text: '하나' }], [{ text: '둘' }]] });
    expect(blocks[3]).toEqual({ type: 'ol', items: [[{ text: '첫째' }]] });
    expect(blocks[4]).toEqual({ type: 'hr' });
    expect(parseInline('그냥 글')).toEqual([{ text: '그냥 글' }]);
  });

  it('phase-01-task-04 범위: 편집기 버튼은 선택한 글을 굵게 하고 줄 앞에 제목·목록 표시를 붙인다', () => {
    expect(applyFormat('주차 안내', 0, 2, 'bold')).toEqual({ value: '**주차** 안내', start: 2, end: 4 });
    expect(applyFormat('첫 줄\n둘째 줄', 6, 6, 'heading').value).toBe('첫 줄\n## 둘째 줄');
    expect(applyFormat('항목', 0, 0, 'list').value).toBe('- 항목');
  });
});

describe('그래프 좌표', () => {
  it('phase-01-task-04 범위: 추세 선은 작은 값이 아래, 큰 값이 위다', () => {
    const pts = sparkPoints([0, 5, 10], 100, 50, 0);
    expect(pts).toEqual([[0, 50], [50, 25], [100, 0]]);
    expect(sparkPoints([], 100, 50)).toEqual([]);
  });

  it('phase-01-task-04 범위: 도넛 조각은 비율대로 0~360도를 나눈다', () => {
    const arcs = donutArcs([1, 1, 2]);
    expect(arcs.map((a) => [a.start, a.end])).toEqual([[0, 90], [90, 180], [180, 360]]);
    expect(donutArcs([0, 0]).every((a) => a.ratio === 0)).toBe(true);
  });
});
