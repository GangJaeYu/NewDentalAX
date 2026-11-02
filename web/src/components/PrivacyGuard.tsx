// 이 파일이 하는 일: AI 입력창 바로 위·아래에 두는 개인정보 안내(frontend.md §2 PrivacyGuard, FR-032 AC5).
// PrivacyGuard는 늘 보이는 빨간 "환자 개인정보 입력 금지" 안내이고, PrivacyWarning은 입력 중인 글에 전화번호·주민등록번호 같은 내용이 보이면
// 노란 경고를 띄운다(판단 규칙은 lib/privacy.ts → shared/privacy-rules.ts, 서버와 같은 규칙). 화면 경고는 안내용이고 실제 가림·차단은 서버가 한다.
import { useMemo } from 'react';
import { inputPrivacyWarning, PRIVACY_GUARD_TEXT } from '../lib/privacy.ts';
import { Icon } from './Icon.tsx';

/** 빨간 고정 안내(입력창 바로 위에 둔다) */
export function PrivacyGuard({ text = PRIVACY_GUARD_TEXT }: { text?: string }) {
  return (
    <div className="guard" data-testid="privacy-guard">
      <Icon name="lock" size="md" />
      <span>{text}</span>
    </div>
  );
}

interface PrivacyWarningProps {
  /** 지금 입력 중인 글 */
  text: string;
  /** 가리지 않을 번호(병원 대표번호 등) */
  allowlist?: readonly string[];
  /** 경고 상자 id(입력창 aria-describedby 연결용) */
  id?: string;
}

/** 입력 중 노란 경고. 감지한 것이 없으면 아무것도 그리지 않는다 */
export function PrivacyWarning({ text, allowlist, id }: PrivacyWarningProps) {
  const warning = useMemo(() => inputPrivacyWarning(text, { allowlist }), [text, allowlist]);
  if (!warning) return null;
  return (
    <div className="pii" id={id} role="status" data-testid="privacy-warning">
      <Icon name="alert" size="md" />
      <span>{warning.message}</span>
    </div>
  );
}
