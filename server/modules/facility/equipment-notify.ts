// 이 파일이 하는 일: 장비 정기 점검의 기한형 알림 scanner('facility.equipment')를 만든다(FR-101, overview §3.8).
// 사용 중인 장비의 다음 점검일을 보고 D-30·D-7·당일·기한 지남 네 단계 알림을 만든다. 받는 사람은 manager 이상(알림 종류 equipment_due).
// 같은 점검일의 같은 단계는 dedupeKey 'equipment:<id>:<점검일>:<단계>'로 한 번만 간다. 점검을 기록해 점검일이 바뀌면 새 단계부터 다시 알린다.
// 멸균 불합격 알림은 즉시 알림이라 여기가 아니라 sterilizer.ts가 기록할 때 바로 보낸다. 등록은 routes.ts가 registerEquipmentNotifyScanner()로 한다.
import type { NotificationInput } from '../notifications/emit.ts';
import { registerNotifyScanner, type NotifyScanContext, type NotifyScanner } from '../../jobs/notify-job.ts';
import { listEquipmentDue } from './equipment.ts';
import { legalStage } from './legal-notify.ts';

/** 알림 제목: 단계마다 쉬운 문장 */
function titleOf(name: string, daysLeft: number): string {
  if (daysLeft < 0) return `${name} 정기 점검이 ${-daysLeft}일 지났어요`;
  if (daysLeft === 0) return `오늘이 ${name} 정기 점검일이에요`;
  return `${name} 정기 점검이 ${daysLeft}일 남았어요`;
}

/** 지금 만들 장비 점검 알림 목록 */
export function scanEquipmentDue({ db, clock }: NotifyScanContext): NotificationInput[] {
  return listEquipmentDue(db, clock).map((e) => {
    const days = e.daysLeft ?? 0;
    return {
      type: 'equipment_due',
      title: titleOf(e.name, days),
      body: `다음 점검일 ${e.nextInspectionOn ?? '-'} · 마지막 점검 ${e.lastInspectionOn ?? '기록 없음'}`,
      link: `/facility/equipment?open=${e.id}`,
      dedupeKey: `equipment:${e.id}:${e.nextInspectionOn}:${legalStage(days)}`,
    };
  });
}

/** 등록부에 넣을 scanner */
export const equipmentNotifyScanner: NotifyScanner = { name: 'facility.equipment', scan: scanEquipmentDue };

/** scanner를 등록한다(같은 이름이면 바꿔 끼운다). 돌려준 함수를 부르면 등록을 푼다 */
export function registerEquipmentNotifyScanner(): () => void {
  return registerNotifyScanner(equipmentNotifyScanner);
}
