// 이 파일이 하는 일: 무거운 검사(e2e·스크린샷)가 이 PC 전체에서 동시에 몇 개까지만 돌게 자리를 잡고 돌려준다.
// harness_setup/scripts/gate.mjs의 e2e 자리와 같은 폴더(OS 임시 폴더/dentalax-heavy-slots)와 같은 규칙을 쓴다(2026-11-03, 메모리 부족 대응).
// 주인 프로세스가 없어진 자리 표시는 치운다. E2E_SLOT_LIMIT(기본 2)으로 개수를 바꿀 수 있다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 자리를 하나 얻을 때까지 기다렸다가(최대 40분) 자리를 돌려줄 함수를 준다 */
export async function acquireHeavySlot(label: string): Promise<() => void> {
  const dir = path.join(os.tmpdir(), 'dentalax-heavy-slots');
  fs.mkdirSync(dir, { recursive: true });
  const limit = Number(process.env.E2E_SLOT_LIMIT || 2);
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + 40 * 60 * 1000;
  let waited = false;
  for (;;) {
    for (let i = 0; i < limit; i++) {
      const f = path.join(dir, `slot-${i}.lock`);
      try {
        fs.writeFileSync(f, String(process.pid), { flag: 'wx' });
        if (waited) console.log(`[${label}] 자리 ${i}를 얻었어요`);
        return () => {
          try {
            if (fs.readFileSync(f, 'utf8') === String(process.pid)) fs.rmSync(f);
          } catch {
            /* 이미 없음 */
          }
        };
      } catch {
        try {
          const owner = Number(fs.readFileSync(f, 'utf8'));
          if (!owner || !alive(owner)) fs.rmSync(f, { force: true });
        } catch {
          /* 다른 프로세스와 경쟁 */
        }
      }
    }
    if (Date.now() > deadline) {
      console.log(`[${label}] 40분 동안 자리가 나지 않아 그냥 실행해요`);
      return () => {};
    }
    if (!waited) {
      console.log(`[${label}] 다른 무거운 검사가 ${limit}개 돌고 있어 자리를 기다려요...`);
      waited = true;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
