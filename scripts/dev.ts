// 이 파일이 하는 일: 개발 실행(`npm run dev`). Node 서버(파일이 바뀌면 다시 시작)와 Vite 화면 개발 서버를 함께 띄운다.
// 화면은 http://localhost:5173 에서 보고, /api 요청은 Vite가 Node 서버(PORT, 기본 8090)로 넘긴다. Ctrl+C로 둘 다 끈다.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const children: ChildProcess[] = [];

/** 자식 프로세스를 띄우고 출력은 이 창에 그대로 보여 준다 */
function start(args: string[]): void {
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NO_BROWSER: '1' } });
  children.push(child);
  child.on('exit', (code) => {
    console.log(`[dev] ${args.join(' ')} 종료(코드 ${code})`);
    stopAll();
  });
}

/** 띄운 자식 프로세스를 모두 끈다 */
function stopAll(): void {
  for (const c of children) if (c.exitCode === null) c.kill();
}

process.on('SIGINT', stopAll);
start(['--disable-warning=ExperimentalWarning', '--watch-path=server', '--watch-path=shared', 'server/main.ts']);
start([path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', path.join('config', 'vite.config.ts')]);
