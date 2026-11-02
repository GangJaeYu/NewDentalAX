// 이 파일이 하는 일: 법정 의무 일정의 기한형 알림 scanner('facility.legal')를 만든다(FR-100 AC3, overview §3.8).
// 켜진 항목의 다음 예정일을 보고 D-30(설정 warnDays)·D-7·당일·기한 지남 네 단계 알림을 만든다. 받는 사람은 manager 이상(알림 종류 legal_due).
// 같은 예정일의 같은 단계는 dedupeKey 'legal:<id>:<예정일>:<단계>'로 한 번만 간다. 수행을 기록해 예정일이 바뀌면 새 단계부터 다시 알린다.
// "해당 없음"으로 끈 항목은 listLegalDue가 빼므로 알림도 가지 않는다. 등록은 routes.ts가 registerLegalNotifyScanner()로 한다.
import type { NotificationInput } from '../notifications/emit.ts';
import { registerNotifyScanner, type NotifyScanContext, type NotifyScanner } from '../../jobs/notify-job.ts';
import { listLegalDue } from './legal.ts';

/** 남은 날로 알림 단계를 정한다: 지남 → over, 0 → d0, 1~7 → d7, 그 뒤(알림 일수 안) → d30 */
export function legalStage(daysLeft: number): 'over' | 'd0' | 'd7' | 'd30' {
  if (daysLeft < 0) return 'over';
  if (daysLeft === 0) return 'd0';
  if (daysLeft <= 7) return 'd7';
  return 'd30';
}

/** 알림 제목: 단계마다 쉬운 문장 */
function titleOf(title: string, daysLeft: number): string {
  if (daysLeft < 0) return `${title} 기한이 ${-daysLeft}일 지났어요`;
  if (daysLeft === 0) return `오늘이 ${title} 기한이에요`;
  return `${title} 기한이 ${daysLeft}일 남았어요`;
}

/** 지금 만들 법정 일정 알림 목록 */
export function scanLegalDue({ db, clock }: NotifyScanContext): NotificationInput[] {
  return listLegalDue(db, clock).map((t) => {
    const days = t.daysLeft ?? 0;
    return {
      type: 'legal_due',
      title: titleOf(t.title, days),
      body: `다음 예정일 ${t.nextDueOn ?? '-'} · 근거 ${t.basis || '-'}`,
      link: '/facility/legal',
      dedupeKey: `legal:${t.id}:${t.nextDueOn}:${legalStage(days)}`,
    };
  });
}

/** 등록부에 넣을 scanner */
export const legalNotifyScanner: NotifyScanner = { name: 'facility.legal', scan: scanLegalDue };

/** scanner를 등록한다(같은 이름이면 바꿔 끼운다). 돌려준 함수를 부르면 등록을 푼다 */
export function registerLegalNotifyScanner(): () => void {
  return registerNotifyScanner(legalNotifyScanner);
}
