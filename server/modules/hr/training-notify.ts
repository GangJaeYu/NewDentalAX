// 이 파일이 하는 일: 교육 이수 예정 알림 scanner('hr.training')를 만든다(FR-082 AC1, overview §3.8, backend.md §6 "교육 예정").
// 주기가 있는 교육의 다음 예정일이 알림 일수(settings.legal.warnDays, 기본 30일) 안이면 D-30·D-7·당일·기한 지남 단계별로 한 번씩 알린다.
// 받는 사람은 해당 직원과 manager 이상(알림 종류 training_due). dedupeKey 'training:<교육>:<직원>:<예정일>:<단계>'로 같은 단계는 한 번만 간다.
// 새 이수 기록으로 예정일이 바뀌면 키가 달라져 새 단계부터 다시 알린다. 등록은 routes.ts가 registerTrainingNotifyScanner()로 한다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { emitNotification, type NotificationInput } from '../notifications/emit.ts';
import { registerNotifyScanner, type NotifyScanContext, type NotifyScanner } from '../../jobs/notify-job.ts';
import { listTrainingDue, type TrainingDue } from './training.ts';

/** 남은 날로 알림 단계를 정한다: 지남 → over, 0 → d0, 1~7 → d7, 그 뒤(알림 일수 안) → d30 */
export function trainingStage(daysLeft: number): 'over' | 'd0' | 'd7' | 'd30' {
  if (daysLeft < 0) return 'over';
  if (daysLeft === 0) return 'd0';
  if (daysLeft <= 7) return 'd7';
  return 'd30';
}

/** 알림 제목: 단계마다 쉬운 문장 */
function titleOf(d: TrainingDue): string {
  const who = `${d.userName} 님 ${d.trainingName}`;
  if (d.daysLeft < 0) return `${who} 이수 기한이 ${-d.daysLeft}일 지났어요`;
  if (d.daysLeft === 0) return `오늘이 ${who} 이수 예정일이에요`;
  return `${who} 이수 예정일이 ${d.daysLeft}일 남았어요`;
}

/** 대상 한 줄 → 알림 한 건(해당 직원 + manager 이상) */
export function trainingNotification(d: TrainingDue): NotificationInput {
  return {
    type: 'training_due',
    userIds: [d.userId],
    role: 'manager',
    title: titleOf(d),
    body: `다음 이수 예정일 ${d.nextDueOn}`,
    link: '/hr/training',
    dedupeKey: `training:${d.trainingId}:${d.userId}:${d.nextDueOn}:${trainingStage(d.daysLeft)}`,
  };
}

/** 지금 만들 교육 예정 알림 목록 */
export function scanTrainingDue({ db, clock }: NotifyScanContext): NotificationInput[] {
  return listTrainingDue(db, clock).map(trainingNotification);
}

/** 기록을 저장한 직후 그 (교육, 직원) 짝만 확인해 바로 알린다. 새로 들어간 알림 수를 돌려준다 */
export function notifyTrainingPair(db: Db, clock: Clock, trainingId: number, userId: number): number {
  let created = 0;
  for (const d of listTrainingDue(db, clock, { trainingId, userId })) created += emitNotification(db, trainingNotification(d), clock);
  return created;
}

/** 등록부에 넣을 scanner */
export const trainingNotifyScanner: NotifyScanner = { name: 'hr.training', scan: scanTrainingDue };

/** scanner를 등록한다(같은 이름이면 바꿔 끼운다). 돌려준 함수를 부르면 등록을 푼다 */
export function registerTrainingNotifyScanner(): () => void {
  return registerNotifyScanner(trainingNotifyScanner);
}
