// 이 파일이 하는 일: 구경용 체험판의 녹화 응답 찾기(demoData.ts)를 검사한다. 쿼리 순서, 녹화하지 않은 쿼리, AI 예시 답, 저장 요청을 확인한다.
import { describe, expect, it } from 'vitest';
import { featureOf, findRecord, normQuery, type DemoData, type DemoRecord } from './demoData.ts';

const rec = (m: string, p: string, q = '', k = '', b = '{}'): DemoRecord => ({ m, p, q: normQuery(q), k, s: 200, t: 'application/json', b });
const data: DemoData = {
  now: '2026-11-02T09:00:00+09:00',
  records: [
    rec('GET', '/api/items', 'page=1&size=20', '', 'p1'),
    rec('GET', '/api/items', 'page=1&q=장갑&size=20', '', 'search'),
    rec('GET', '/api/session', '', '', 'session'),
    rec('POST', '/api/ai/stream', '', 'docs.write', 'write'),
    rec('POST', '/api/ai/stream', '', 'desk.review', 'review'),
    rec('POST', '/api/ai/receipt', '', '', 'receipt'),
    rec('POST', '/api/items', '', '', 'created'),
  ],
};

describe('normQuery', () => {
  it('이름 순으로 정렬해 순서만 다른 쿼리는 같게 만든다', () => {
    expect(normQuery('?size=20&page=1')).toBe(normQuery('page=1&size=20'));
  });
});

describe('featureOf', () => {
  it('JSON 본문의 feature를 꺼내고, 아니면 빈 글자', () => {
    expect(featureOf(JSON.stringify({ feature: 'docs.write', input: {} }))).toBe('docs.write');
    expect(featureOf('not json')).toBe('');
    expect(featureOf(undefined)).toBe('');
  });
});

describe('findRecord', () => {
  it('GET은 쿼리 순서와 관계없이 같은 주소의 녹화를 찾는다', () => {
    expect(findRecord(data, 'GET', '/api/items', '?size=20&page=1')?.b).toBe('p1');
    expect(findRecord(data, 'get', '/api/session', '')?.b).toBe('session');
  });

  it('녹화하지 않은 쿼리면 같은 주소에서 가장 많이 겹치는 녹화를 쓴다', () => {
    expect(findRecord(data, 'GET', '/api/items', '?page=3&q=장갑&size=20')?.b).toBe('search');
    expect(findRecord(data, 'GET', '/api/items', '?page=3')?.b).toBe('p1');
  });

  it('녹화가 없는 주소는 null', () => {
    expect(findRecord(data, 'GET', '/api/vendors', '')).toBeNull();
  });

  it('AI 요청은 같은 기능의 예시 답만 돌려준다', () => {
    expect(findRecord(data, 'POST', '/api/ai/stream', '', 'desk.review')?.b).toBe('review');
    expect(findRecord(data, 'POST', '/api/ai/stream', '', 'docs.promo')).toBeNull();
    expect(findRecord(data, 'POST', '/api/ai/receipt', '', '')?.b).toBe('receipt');
  });

  it('저장 요청(POST /api/items 등)은 녹화가 있어도 다시 보여 주지 않는다', () => {
    expect(findRecord(data, 'POST', '/api/items', '', '')).toBeNull();
    expect(findRecord(data, 'DELETE', '/api/items', '', '')).toBeNull();
  });
});
