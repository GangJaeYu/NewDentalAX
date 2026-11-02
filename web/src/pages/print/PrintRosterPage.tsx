// 이 파일이 하는 일: "근무표 인쇄" 인쇄 전용 화면(/print/roster, FR-063) 자리. 셸 없이 A4 인쇄 모양으로 열리고, 지금은 "준비 중" 안내만 보여 준다.
// 이 화면을 맡은 모듈 태스크가 이 파일만 실제 인쇄 화면으로 바꾼다(PLAN.md §3).
import { PrintStub } from './PrintStub.tsx';

/** 근무표 인쇄 */
export default function PrintRosterPage() {
  return <PrintStub title="근무표 인쇄" />;
}
