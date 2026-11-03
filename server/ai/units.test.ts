// 이 파일이 하는 일: AI 게이트웨이의 작은 부품을 따로 확인한다. 기능 14개 등록, 비용 계산(구간 단가), 키 암호화·가림,
// 스트림 가리기 도우미, 알림 만들기(dedupe), JSON 추출(phase-02-task-02 AC1·AC2·AC4·AC6 보조).
import fs from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { AI_FEATURE_IDS, AI_FEATURES, defaultFeatureRoles, effectiveFeature } from '../../shared/ai-features.ts';
import { CAPS } from '../../shared/roles.ts';
import { FEATURE_MODULES, featureModule } from './features/index.ts';
import { DEMO_MARK, type PromptContext } from './features/types.ts';
import { costKrw, costUsd, estimateTokens } from './pricing.ts';
import { decryptText, encryptText, loadOrCreateSecretKey, maskSecret, secretKeyPath } from '../lib/crypto.ts';
import { extractJson, StreamRedactor } from './gateway.ts';
import { splitForStream } from './providers/demo.ts';
import { emitNotification } from '../modules/notifications/emit.ts';
import { openAppDb } from '../db/migrate.ts';
import { fixedClock } from '../lib/clock.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { z } from 'zod';

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});

const ctx: PromptContext = { clinic: { name: '하늘숲치과', phone: '02-123-4567' }, user: { name: '이직원', role: 'staff', jobType: 'desk' }, today: '2026-11-02' };

/** 기능마다 검사를 통과하는 예시 입력 */
const SAMPLE: Record<string, unknown> = {
  quick: '오늘 할 일',
  script: { situation: '예약 변경' },
  review_reply: { review: '친절했어요', tones: ['정중하게', '밝게'] },
  template: { purpose: '예약 안내' },
  doc_writer: { kind: '감염관리', points: '손 씻기' },
  doc_revise: { text: '원문', instruction: '짧게' },
  minutes: { notes: '다음 주 대청소' },
  adcheck: { text: '최고의 치과', ruleHits: [{ phrase: '최고' }] },
  promo: { topic: '스케일링', channel: '블로그' },
  hiring: { jobType: '치과위생사', conditions: '주 5일' },
  onboarding: { jobType: '데스크' },
  assistant: { question: '멸균 주기', chunks: [{ n: 1, text: '매일' }] },
  receipt: { images: [{ mime: 'image/jpeg', data: 'AAAA' }] },
  monthly_summary: { month: '2026-10', numbers: { 지출: 1000 } },
  roster_suggest: { week: { from: '2026-11-02', to: '2026-11-08' }, days: [{ date: '2026-11-02', weekday: '월', open: '09:30', close: '18:30' }], staff: [{ ref: 'S1', jobType: 'desk' }], shifts: [{ id: 1, label: '종일', startTime: '09:30', endTime: '18:30', countsAsWork: true }], rules: { minStaff: 1 } },
};

describe('phase-02-task-02 기능 목록', () => {
  test('phase-02-task-02 AC1: 14개 기능이 모두 등록되고, 데모 응답은 "[데모 응답]"으로 시작하며 JSON 기능의 데모는 검사를 통과한다', () => {
    expect(AI_FEATURE_IDS).toHaveLength(15); // 02-02의 14개 + roster_suggest(phase-06-task-02)
    expect(Object.keys(FEATURE_MODULES).sort()).toEqual([...AI_FEATURE_IDS].sort());
    for (const id of AI_FEATURE_IDS) {
      const def = AI_FEATURES[id];
      expect(def.id).toBe(id);
      expect(CAPS[def.cap]).toBeTruthy();
      const mod = featureModule(id);
      expect(mod.id).toBe(id);
      const input = mod.inputSchema.parse(SAMPLE[id]);
      const demo = mod.demo(input, ctx);
      expect(demo.startsWith(DEMO_MARK), id).toBe(true);
      const prompt = mod.buildPrompt(input, ctx);
      expect(prompt.system.length, id).toBeGreaterThan(10);
      if (def.output === 'json') {
        expect(mod.outputSchema, id).toBeTruthy();
        expect(extractJson(demo, mod.outputSchema as z.ZodType), id).not.toBeNull();
      }
    }
  });

  test('phase-02-task-02 AC7: 기본 역할은 권한 표를 따르고, 관리자 설정은 역할을 줄일 수만 있다', () => {
    expect(defaultFeatureRoles('quick')).toEqual(['admin', 'manager', 'staff']);
    expect(defaultFeatureRoles('monthly_summary')).toEqual(['admin', 'manager']);
    expect(effectiveFeature('monthly_summary', { roles: ['staff', 'admin'] }).roles).toEqual(['admin']);
    expect(effectiveFeature('quick', { enabled: false }).enabled).toBe(false);
    expect(AI_FEATURES.doc_writer).toMatchObject({ userTier: true, timeoutMs: 90_000, premiumTimeoutMs: 120_000 });
  });
});

describe('phase-02-task-02 비용 계산', () => {
  const haiku = { inputUsdPerM: 0.1, outputUsdPerM: 0.5, longThresholdTokens: 100_000, longInputUsdPerM: 0.5, longOutputUsdPerM: 2.5 };
  test('phase-02-task-02 AC2: (입력×입력단가 + 출력×출력단가) ÷ 1e6 × 환율', () => {
    expect(costUsd(haiku, 1200, 340)).toBeCloseTo((1200 * 0.1 + 340 * 0.5) / 1e6, 15);
    expect(costKrw(costUsd(haiku, 1200, 340), 1450)).toBeCloseTo(((1200 * 0.1 + 340 * 0.5) / 1e6) * 1450, 12);
  });
  test('phase-02-task-02 AC2: 입력이 구간 기준(10만 토큰)을 넘으면 긴 입력 단가를 쓴다', () => {
    expect(costUsd(haiku, 100_000, 0)).toBeCloseTo((100_000 * 0.1) / 1e6, 15);
    expect(costUsd(haiku, 150_000, 1000)).toBeCloseTo((150_000 * 0.5 + 1000 * 2.5) / 1e6, 15);
  });
  test('phase-02-task-02 AC2: 사용량이 없으면 글자 수로 어림한다', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('가나다라')).toBe(2);
  });
});

describe('phase-02-task-02 키 암호화', () => {
  test('phase-02-task-02 AC6: AES-GCM으로 암호화·복호화하고 secret.key(32바이트)를 데이터 폴더에 만든다, 가림은 끝 4자리만', () => {
    const dir = makeTmpDir('dentalax-crypto-');
    tmps.push(dir);
    const key = loadOrCreateSecretKey(dir);
    expect(key.length).toBe(32);
    expect(fs.readFileSync(secretKeyPath(dir)).equals(key)).toBe(true);
    expect(loadOrCreateSecretKey(dir).equals(key)).toBe(true);
    const enc = encryptText(key, 'sk-test-plain-key-1234');
    expect(JSON.stringify(enc)).not.toContain('sk-test-plain');
    expect(decryptText(key, enc)).toBe('sk-test-plain-key-1234');
    expect(decryptText(Buffer.alloc(32, 1), enc)).toBeNull();
    expect(maskSecret('sk-test-plain-key-1234')).toBe('••••1234');
    expect(maskSecret('short')).toBe('••••');
  });
});

describe('phase-02-task-02 스트림 가리기', () => {
  test('phase-02-task-02 AC8: 조각 경계에 걸친 전화번호도 내보내기 전에 가린다', () => {
    const r = new StreamRedactor((s) => s.replace(/010-\d{4}-\d{4}/g, '[전화번호]'));
    const text = '안내드립니다. 담당 번호는 010-1234-5678 입니다. 오전 9시부터 받습니다. 그 밖의 문의는 대표번호로 해 주세요.';
    let out = '';
    for (const piece of text.match(/.{1,3}/gs) ?? []) out += r.push(piece);
    out += r.flush();
    expect(out).toBe(text.replace('010-1234-5678', '[전화번호]'));
    expect(splitForStream('하나 둘 셋 넷 다섯 여섯 일곱').join('')).toBe('하나 둘 셋 넷 다섯 여섯 일곱');
  });
});

describe('phase-02-task-02 알림 만들기', () => {
  test('phase-02-task-02 AC4: emitNotification은 역할 이상 사용자에게 넣고, 같은 dedupeKey는 두 번 넣지 않는다', () => {
    const dir = makeTmpDir('dentalax-emit-');
    tmps.push(dir);
    const clock = fixedClock('2026-11-02T09:00:00+09:00');
    const { db } = openAppDb(dir, { clock });
    try {
      const now = clock.now().toISOString();
      const add = (u: string, role: string, active = 1) =>
        db.run('INSERT INTO users (username, name, role, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [u, u, role, 'x', active, now, now]).lastInsertRowid;
      const a = add('a1', 'admin');
      add('a2', 'admin', 0);
      const m = add('m1', 'manager');
      add('s1', 'staff');
      expect(emitNotification(db, { role: 'admin', type: 't', title: '제목', dedupeKey: 'k1' }, clock)).toBe(1);
      expect(emitNotification(db, { role: 'admin', type: 't', title: '제목', dedupeKey: 'k1' }, clock)).toBe(0);
      expect(emitNotification(db, { role: 'manager', type: 't', title: '제목', dedupeKey: 'k2' }, clock)).toBe(2);
      expect(emitNotification(db, { userIds: [m], type: 't', title: '제목', body: '본문', link: '/x' }, clock)).toBe(1);
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?', [a])?.n).toBe(2);
      expect(emitNotification(db, { userIds: [], type: 't', title: '제목' }, clock)).toBe(0);
    } finally {
      db.close();
    }
  });
});
