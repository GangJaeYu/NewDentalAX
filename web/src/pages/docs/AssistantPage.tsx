// 이 파일이 하는 일: "원내 AI 도우미" 화면(/docs/assistant, FR-070·071) 자리. 지금은 "준비 중" 안내만 보여 준다.
// 이 화면을 맡은 모듈 태스크가 이 파일만 실제 화면으로 바꾼다(PLAN.md §3). 경로·권한 등록은 web/src/routes.tsx에 이미 되어 있다.
import { StubPage } from '../StubPage.tsx';

/** 원내 AI 도우미 */
export default function AssistantPage() {
  return <StubPage title="원내 AI 도우미" />;
}
