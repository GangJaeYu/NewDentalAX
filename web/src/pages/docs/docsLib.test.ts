// 이 파일이 하는 일: 문서 화면 도구(docsLib.ts)의 순수 함수를 확인한다(phase-03-task-06). 데모 표시 떼기·제목 뽑기·부분 바꿔 끼우기·
// 회의 할 일 → 인수인계 글·회의록 마크다운·인쇄 머리말 CSS 이스케이프, 그리고 미리보기가 <script>를 글자로만 다루는지(parseMarkdown).
import { describe, expect, test } from 'vitest';
import { parseMarkdown } from '../../components/Markdown.tsx';
import {
  cssString,
  dueLabel,
  extractTitle,
  listQuery,
  minutesToMarkdown,
  parseTagText,
  printHeaderCss,
  readMinutes,
  replaceRange,
  sizeLabel,
  stripDemoMark,
  todoToPost,
  withoutTitleLine,
} from './docsLib.ts';

describe('문서 작성 도구', () => {
  test('phase-03-task-06 AC1: AI 결과의 "[데모 응답]" 첫 줄을 떼고, 첫 "# 제목"을 뽑는다', () => {
    expect(stripDemoMark('[데모 응답]\n# 안내문\n\n본문')).toEqual({ text: '# 안내문\n\n본문', demo: true });
    expect(stripDemoMark('# 실제 응답')).toEqual({ text: '# 실제 응답', demo: false });
    expect(extractTitle('\n# 임플란트 수술 후 안내 #\n## 소제목')).toBe('임플란트 수술 후 안내');
    expect(extractTitle('## 소제목만')).toBeNull();
    expect(withoutTitleLine('\n# 제목\n\n본문')).toBe('본문');
    expect(withoutTitleLine('본문만')).toBe('본문만');
  });

  test('phase-03-task-06 AC2: 고른 부분만 바꿔 끼우고, 고른 것이 없으면 전체를 바꾼다', () => {
    expect(replaceRange('가나다라마', 1, 3, '바사')).toEqual({ value: '가바사라마', start: 1, end: 3 });
    expect(replaceRange('가나다라마', 3, 1, 'X')).toEqual({ value: '가X라마', start: 1, end: 2 });
    expect(replaceRange('가나다', 2, 2, '새 글')).toEqual({ value: '새 글', start: 0, end: 3 });
    expect(parseTagText(' 임플란트, ,수술 후,임플란트 ')).toEqual(['임플란트', '수술 후']);
    expect(listQuery({ q: ' 안내 ', kind: 'official', folder: '', tag: '휴진' })).toBe('q=%EC%95%88%EB%82%B4&kind=official&tag=%ED%9C%B4%EC%A7%84&pageSize=200');
    expect(sizeLabel(1536)).toBe('2KB');
    expect(sizeLabel(21 * 1024 * 1024)).toBe('21MB');
  });

  test('phase-03-task-06 AC3: 회의록 결과를 읽고, 할 일 하나를 인수인계 글(POST /api/posts 본문)로 만든다', () => {
    const r = readMinutes({ decisions: ['예약 간격 30분'], todos: [{ text: '문자 문구 고치기', role: '데스크', due: '2026-11-06' }, { bad: 1 }], summary: '요약' });
    expect(r).toEqual({ decisions: ['예약 간격 30분'], todos: [{ text: '문자 문구 고치기', role: '데스크', due: '2026-11-06' }], summary: '요약' });
    expect(readMinutes({ text: '틀린 모양' })).toBeNull();
    expect(dueLabel('2026-11-06')).toBe('11월 6일');
    expect(dueLabel(null)).toBeNull();
    const post = todoToPost({ text: '문자 문구 고치기', role: '데스크', due: '2026-11-06' }, 'handover', '11월 직원 회의');
    expect(post).toEqual({
      kind: 'handover',
      category: '회의 할 일',
      title: '문자 문구 고치기',
      body: '회의(11월 직원 회의)에서 정한 할 일입니다.\n\n- 할 일: 문자 문구 고치기\n- 담당: 데스크\n- 기한: 11월 6일',
    });
    const md = minutesToMarkdown('11월 직원 회의', r as NonNullable<typeof r>);
    expect(md).toContain('## 결정 사항\n- 예약 간격 30분');
    expect(md).toContain('- 문자 문구 고치기 (데스크, 11월 6일까지)');
  });

  test('phase-03-task-06 AC5: 미리보기 해석기는 <script>·<img onerror>를 태그가 아닌 글자로 남긴다', () => {
    const blocks = parseMarkdown('# 안내\n<script>alert(1)</script>\n<img src=x onerror=alert(2)>');
    expect(blocks).toEqual([
      { type: 'h', level: 1, inlines: [{ text: '안내' }] },
      { type: 'p', inlines: [{ text: '<script>alert(1)</script> <img src=x onerror=alert(2)>' }] },
    ]);
  });

  test('phase-03-task-06 AC6: 인쇄 머리말 CSS는 병원명·제목을 쪽마다 넣고, 따옴표·꺾쇠·줄바꿈을 이스케이프한다', () => {
    expect(cssString('하늘숲치과')).toBe('"하늘숲치과"');
    expect(cssString('a"b\\c</style>\n')).toBe('"a\\22 b\\5c c\\3c /style\\3e  "');
    const css = printHeaderCss('하늘숲치과', '안내');
    expect(css).toContain('@top-left { content: "하늘숲치과"');
    expect(css).toContain('@top-right { content: "안내"');
  });
});
