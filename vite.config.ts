// 이 파일이 하는 일: 화면(web/) 빌드·개발 서버 설정. 빌드 결과는 web/dist에 만들고, 개발 중 /api 요청은 Node 서버로 넘긴다.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.PORT || '8090';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
});
