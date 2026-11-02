// 이 파일이 하는 일: 데모 공급자(NFR-008, FR-030 AC1). 키가 없거나 공급자가 demo일 때 기능별 예시 응답(features/<id>.demo)을 그대로 돌려주고,
// 스트림도 글을 몇 조각으로 나눠 조금씩 보내 흉내 낸다. 실제 네트워크 호출은 하지 않고, 사용량은 0원·"데모"로 기록된다.
import type { StreamChunk } from '../types.ts';
import { ProviderError } from '../types.ts';

/** 글을 n조각 안팎으로 나눈다(줄바꿈·띄어쓰기 경계를 우선) */
export function splitForStream(text: string, pieces = 6): string[] {
  if (!text) return [];
  const size = Math.max(1, Math.ceil(text.length / pieces));
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > i) end = space + 1;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/** 쉬는 시간. 끊기면 그 이유를 던진다 */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason instanceof ProviderError ? signal.reason : new ProviderError('AI_ABORTED'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason instanceof ProviderError ? signal.reason : new ProviderError('AI_ABORTED'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** 데모 글을 조각 스트림으로 보낸다 */
export async function* demoStream(text: string, delayMs: number, signal: AbortSignal): AsyncGenerator<StreamChunk> {
  for (const piece of splitForStream(text)) {
    await wait(delayMs, signal);
    yield { type: 'delta', text: piece };
  }
}
