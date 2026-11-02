// 이 파일이 하는 일: 공급자 이름(anthropic·openai·gemini)으로 알맞은 어댑터를 만든다. gateway는 이 함수만 부른다.
import type { RealProvider } from '../../../shared/ai-features.ts';
import type { ProviderAdapter, ProviderConfig } from '../types.ts';
import { anthropicProvider } from './anthropic.ts';
import { geminiProvider } from './gemini.ts';
import { openaiProvider } from './openai.ts';

/** 공급자 어댑터를 만든다 */
export function makeProvider(name: RealProvider, cfg: ProviderConfig): ProviderAdapter {
  if (name === 'anthropic') return anthropicProvider(cfg);
  if (name === 'openai') return openaiProvider(cfg);
  return geminiProvider(cfg);
}
