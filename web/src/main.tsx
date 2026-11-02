// 이 파일이 하는 일: 화면 앱의 시작점. 지금은 "하늘숲치과 원내 업무" 제목과 준비 중 안내만 보여 주는 최소 화면이다.
// 디자인 시스템·레이아웃·화면 경로는 phase-01-task-04가 이 파일 위에 붙인다.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './boot.css';

/** 준비 중 안내 화면 */
function BootScreen() {
  return (
    <main className="boot">
      <h1>하늘숲치과 원내 업무</h1>
      <p>서비스를 준비하고 있어요. 곧 업무 화면이 열려요.</p>
    </main>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <BootScreen />
    </StrictMode>,
  );
}
