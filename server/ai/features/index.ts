// 이 파일이 하는 일: 기능 id → 기능 파일(프롬프트·입력 검사·데모) 등록표. shared/ai-features.ts의 기능이 모두 여기 있어야 한다(테스트로 확인).
import type { AiFeatureId } from '../../../shared/ai-features.ts';
import type { AiFeatureModule } from './types.ts';
import { quick } from './quick.ts';
import { script } from './script.ts';
import { review_reply } from './review_reply.ts';
import { template } from './template.ts';
import { doc_writer } from './doc_writer.ts';
import { doc_revise } from './doc_revise.ts';
import { minutes } from './minutes.ts';
import { adcheck } from './adcheck.ts';
import { promo } from './promo.ts';
import { hiring } from './hiring.ts';
import { onboarding } from './onboarding.ts';
import { assistant } from './assistant.ts';
import { receipt } from './receipt.ts';
import { monthly_summary } from './monthly_summary.ts';
import { transcribe } from './transcribe.ts';

/** 기능 등록표. 입력 타입은 기능마다 달라서, 꺼내 쓸 때는 inputSchema로 검사한 값만 넘긴다 */
export const FEATURE_MODULES = {
  quick,
  script,
  review_reply,
  template,
  doc_writer,
  doc_revise,
  minutes,
  adcheck,
  promo,
  hiring,
  onboarding,
  assistant,
  receipt,
  monthly_summary,
  transcribe,
} satisfies Record<AiFeatureId, { id: AiFeatureId }>;

/** 기능 파일을 꺼낸다 */
export function featureModule(id: AiFeatureId): AiFeatureModule<unknown> {
  return FEATURE_MODULES[id] as unknown as AiFeatureModule<unknown>;
}
