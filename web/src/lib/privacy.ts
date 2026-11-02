// 이 파일이 하는 일: 화면에서 AI 입력창에 글을 쓰는 동안 개인정보로 보이는 내용이 있으면 노란 경고 문구를 만든다.
// 규칙은 서버와 같은 shared/privacy-rules.ts를 그대로 가져다 쓰는 얇은 래퍼다(규칙을 따로 복사하지 않는다).
// 화면 경고는 안내용이고, 실제로 가리거나 막는 판정은 서버가 한 번 더 한다(TD-010).
// 쓰는 곳: PrivacyGuard 컴포넌트(phase-01-task-04), AI 화면(phase-02-task-03).
import {
  DEFAULT_PRIVACY_POLICY,
  PII_TYPES,
  detectPii,
  joinPiiLabels,
  piiMask,
  resolvePolicy,
  type PiiType,
  type PrivacyPolicy,
} from '../../../shared/privacy-rules.ts';

export { PII_LABELS, PII_TYPES, piiMask, type PiiType } from '../../../shared/privacy-rules.ts';

/** 입력창 바로 위에 늘 보이는 빨간 안내(FR-032 AC5) */
export const PRIVACY_GUARD_TEXT = '환자 개인정보 입력 금지 — 특정 환자 이야기가 아니라 병원 전체에 해당하는 내용만 적어 주세요.';

export interface InputPrivacyWarning {
  /** 감지한 종류 전체(PII_TYPES 순서) */
  types: PiiType[];
  /** 보내면 막히는 종류(기본: 주민등록번호·카드번호) */
  blockTypes: PiiType[];
  /** 보내면 가려지는 종류 */
  redactTypes: PiiType[];
  /** 노란 경고 상자에 그대로 넣을 문구 */
  message: string;
}

/**
 * 입력 중인 글을 검사해서 경고가 필요하면 문구를 돌려준다. 개인정보로 보이는 내용이 없으면 null.
 * allowlist·policy는 서버 설정(settings.privacy)을 받았으면 넘기고, 없으면 기본 정책으로 판단한다.
 */
export function inputPrivacyWarning(
  text: string,
  options: { allowlist?: readonly string[]; policy?: Partial<PrivacyPolicy> } = {},
): InputPrivacyWarning | null {
  const matches = detectPii(text, { allowlist: options.allowlist });
  if (matches.length === 0) return null;
  const policy = options.policy ? resolvePolicy(options.policy) : DEFAULT_PRIVACY_POLICY;
  const types = PII_TYPES.filter((t) => matches.some((m) => m.type === t));
  const blockTypes = types.filter((t) => policy[t] === 'block');
  const redactTypes = types.filter((t) => policy[t] !== 'block');
  const parts: string[] = [];
  if (blockTypes.length > 0) {
    parts.push(`${joinPiiLabels(blockTypes)}로 보이는 내용이 있어요. 이대로는 AI로 보낼 수 없으니 지워 주세요.`);
  }
  if (redactTypes.length > 0) {
    const example = piiMask(redactTypes[0] as PiiType);
    parts.push(
      `${joinPiiLabels(redactTypes)}로 보이는 내용이 있어요. 보내면 자동으로 가려집니다(예: ${example}). 환자 정보라면 지워 주세요.`,
    );
  }
  return { types, blockTypes, redactTypes, message: parts.join(' ') };
}
