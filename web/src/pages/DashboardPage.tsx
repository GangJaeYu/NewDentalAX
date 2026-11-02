// 이 파일이 하는 일: 대시보드(/) 셸. 인사말·날짜, 주 행동 버튼, 요약 숫자 6칸 자리, 카드 격자(시안 v2 순서)를 빈 상태로 그린다(DESIGN §4).
// 실제 숫자와 카드 내용은 phase-03-task-10이 이 파일을 바꿔 채운다. 지금은 각 자리가 "아직 자료가 없어요" 빈 상태를 보여 준다.
// 권한이 없는 링크(발주서·지출·AI 사용량)는 걸지 않고, "이번 달 지출" 카드는 원장·실장에게만 보인다.
import { can } from '../../../shared/roles.ts';
import { Button } from '../components/Button.tsx';
import { Card, CardGrid, PageHeader } from '../components/Card.tsx';
import { Kpi, KpiRow } from '../components/Chip.tsx';
import { EmptyState } from '../components/States.tsx';
import type { IconName } from '../components/Icon.tsx';
import { formatDateLong, greeting } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { ROLE_LABELS } from '../../../shared/roles.ts';
import { RosterTodayCard } from './hr/RosterTodayCard.tsx'; // phase-04-task-01: 오늘 근무 카드

/** 카드 자리 하나의 정의 */
interface Slot {
  title: string;
  span?: 1 | 2;
  link?: { label: string; to: string };
  empty: string;
  hint: string;
  icon: IconName;
}

/** 대시보드 */
export default function DashboardPage() {
  const { info } = useSession();
  const user = info?.user;
  if (!user) return null;
  const role = user.role;
  const now = new Date();

  const slots: Slot[] = [
    { title: '오늘 할 일', link: { label: '전체', to: '/desk/checklist' }, empty: '오늘 할 일이 아직 없어요', hint: '오픈·마감 체크리스트와 인수인계가 여기에 모여요.', icon: 'check' },
    { title: '재고 경고', link: { label: '재고 보기', to: '/inventory' }, empty: '재고 경고가 없어요', hint: '부족·유효기간 임박 품목이 생기면 여기에 보여요.', icon: 'box' },
    { title: '다가오는 점검·의무 일정', link: { label: '전체', to: '/facility/legal' }, empty: '30일 안에 할 점검이 없어요', hint: '장비 점검과 법정 의무 일정이 여기에 보여요.', icon: 'shield' },
    { title: '오늘 근무', link: { label: '근무표', to: '/hr/roster' }, empty: '오늘 근무표가 아직 없어요', hint: '근무표를 만들면 오늘 근무자가 보여요.', icon: 'people' },
    { title: '공지', span: 2, link: { label: '공지 보드', to: '/desk/board' }, empty: '새 공지가 없어요', hint: '고정 공지와 최근 공지가 여기에 보여요.', icon: 'board' },
    { title: 'AI 빠른 요청', empty: 'AI 빠른 요청을 준비하고 있어요', hint: '전화 멘트·안내 문구 같은 짧은 글을 바로 만들 수 있게 돼요.', icon: 'spark' },
    { title: '발주 진행', link: can(role, 'orders.manage') ? { label: '발주서', to: '/inventory/orders' } : undefined, empty: '진행 중인 발주가 없어요', hint: '작성·발주·입고 단계가 여기에 보여요.', icon: 'cart' },
    { title: '이번 주 일정', span: 2, empty: '이번 주 일정이 없어요', hint: '근무·휴가·점검 일정을 한 주 단위로 보여 줘요.', icon: 'cal' },
    { title: '최근 입출고', link: { label: '입출고 기록', to: '/inventory/moves' }, empty: '최근 입출고 기록이 없어요', hint: '입고·출고를 기록하면 여기에 보여요.', icon: 'box' },
  ];
  if (can(role, 'finance.monthly')) {
    slots.push({ title: '이번 달 지출', link: { label: '지출 기록', to: '/finance/expenses' }, empty: '이번 달 지출 기록이 없어요', hint: '지출을 기록하면 분류별 합계가 보여요.', icon: 'won' });
  }

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${user.name}님`}
        summary={`${formatDateLong(now)} · ${ROLE_LABELS[role]}`}
        actions={
          <>
            <Button to="/inventory/moves" icon="box">
              출고 기록
            </Button>
            <Button to="/desk/board" icon="plus">
              공지 쓰기
            </Button>
            <Button to="/docs/writer" icon="spark" variant="primary">
              AI 문서 작성
            </Button>
          </>
        }
      />

      <KpiRow>
        <Kpi label="오늘 근무" value={null} unit="명" to="/hr/roster" />
        <Kpi label="오픈 체크리스트" value={null} to="/desk/checklist" />
        <Kpi label="재고 경고" value={null} unit="건" to="/inventory" />
        <Kpi label="30일 내 점검·의무" value={null} unit="건" to="/facility/legal" />
        <Kpi label="승인 대기" value={null} unit="건" to="/hr/leave" />
        <Kpi label="이번 달 AI 사용" value={null} unit="%" to={can(role, 'ai.usage') ? '/admin/ai-usage' : undefined} />
      </KpiRow>

      <CardGrid label="오늘 현황">
        {slots.map((s, i) => (
          <Card key={s.title} id={`dash-card-${i}`} title={s.title} span={s.span} action={s.link}>
            {s.title === '오늘 근무' ? <RosterTodayCard /> : <EmptyState icon={s.icon} title={s.empty} description={s.hint} />}
          </Card>
        ))}
      </CardGrid>
    </>
  );
}
