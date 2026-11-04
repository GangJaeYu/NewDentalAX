// 이 파일이 하는 일: 화면 앱의 시작점. 디자인 토큰·기본·골격·컴포넌트·인쇄 스타일을 불러오고,
// 라우터(BrowserRouter) → 로그인 상태(SessionProvider) → 알림(ToastProvider) → 연결 끊김 띠 + 경로(AppRoutes) 순서로 앱을 감싼다.
// 구경용 체험판 빌드(VITE_DEMO=1)에서만 demo/demoMode.ts를 먼저 켠다(GitHub Pages, 서버 없음).
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
import { installDemo } from './demo/demoMode.ts';

// 구경용 체험판 빌드(VITE_DEMO=1, GitHub Pages)에서만 녹화한 응답으로 서버를 대신한다. 원내 서버용 빌드에서는 부르지 않는다
if (import.meta.env.VITE_DEMO === '1') installDemo();
// 체험판은 /NewDentalAX/ 같은 하위 주소에 올라가므로 라우터 기준 주소를 빌드의 base에 맞춘다(원내 빌드는 '/')
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter basename={basename}>
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
