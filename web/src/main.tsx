// 이 파일이 하는 일: 화면 앱의 시작점. 디자인 토큰·기본·골격·컴포넌트·인쇄 스타일을 불러오고,
// 라우터(BrowserRouter) → 로그인 상태(SessionProvider) → 알림(ToastProvider) → 연결 끊김 띠 + 경로(AppRoutes) 순서로 앱을 감싼다.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/print.css';
import { SessionProvider } from './lib/session.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { OfflineBanner } from './layout/OfflineBanner.tsx';
import { AppRoutes } from './routes.tsx';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter>
        <SessionProvider>
          <ToastProvider>
            <OfflineBanner />
            <AppRoutes />
          </ToastProvider>
        </SessionProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
