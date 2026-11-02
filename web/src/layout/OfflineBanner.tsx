// 이 파일이 하는 일: 서버와 연결이 끊기면 화면 맨 위에 "원내 와이파이 연결 확인" 띠를 띄우고, 다시 연결되면 저절로 숨긴다(FR-091 AC2, TD-017).
// 연결 상태는 lib/connection.ts가 정한다(API 연속 2회 실패 → 끊김, 응답 1회 → 연결됨). 이 컴포넌트가 화면에 있는 동안 주기 확인(heartbeat)을 돌린다.
import { useEffect } from 'react';
import { startHeartbeat, useOffline } from '../lib/connection.ts';
import { Icon } from '../components/Icon.tsx';

/** 연결 끊김 띠 */
export function OfflineBanner() {
  const offline = useOffline();
  useEffect(() => startHeartbeat(), []);
  if (!offline) return null;
  return (
    <div className="offline" role="alert" data-testid="offline-banner">
      <Icon name="wifi" />
      <div>
        <b>원내 와이파이 연결 확인</b>
        서버와 연결이 끊겼어요. 원내 와이파이에 연결되어 있는지 확인하세요. 다시 연결되면 이 안내는 저절로 사라져요.
      </div>
    </div>
  );
}
