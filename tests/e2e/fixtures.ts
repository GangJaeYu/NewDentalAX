// 이 파일이 하는 일: E2E 격리 fixture. spec 파일마다 새 임시 데이터 폴더로 따로 띄운 테스트 서버(scripts/e2e-server.ts)를 쓰게 해서,
// 한 spec이 계정을 잠그거나 첫 설정을 해도 다른 spec에 영향이 없게 한다(2026-11-02 조정자 요청, 하네스 보완).
// - 포트: E2E_PORT(슬롯 기준값, 기본 18090) + 워커 번호×10 부터 10개 중 비어 있는 것
// - 서버 준비 판정: GET /api/health가 { ok:true, db:'ok' }
// - 같은 spec 파일 안 테스트는 같은 서버를 쓰고(serial 흐름 유지), 다음 파일로 넘어가면 앞 서버(이 fixture가 띄운 자식 프로세스만)를 끄고 폴더를 지운다.
// - baseURL을 그 서버 주소로 바꿔 주므로 page.goto('/')·request.get('/api/...')는 그대로 쓴다. isoServer로 stop()/start()(같은 데이터로 재시작)·addUser()를 쓸 수 있다.
// spec은 '@playwright/test' 대신 이 파일의 test·expect를 import한다.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test as base, expect } from '@playwright/test';
import { hashPassword } from '../../server/auth/password.ts';

const ROOT = process.cwd();
const TEST_NOW = '2026-11-02T09:00:00+09:00';

/** 포트가 비어 있는지(127.0.0.1에 잠깐 열어 본다) */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/** 이 워커가 쓸 수 있는 빈 포트(E2E_PORT + 워커 번호×10 부터 10개) */
async function pickPort(workerIndex: number): Promise<number> {
  const start = Number(process.env.E2E_PORT || 18090) + workerIndex * 10;
  for (let p = start; p < start + 10; p++) if (await portFree(p)) return p;
  throw new Error(`E2E 서버 포트 ${start}~${start + 9}가 모두 사용 중이에요.`);
}

/** spec 파일 하나가 쓰는 격리 서버 */
export class IsoServer {
  readonly dataDir: string;
  port = 0;
  private child: ChildProcess | null = null;
  private readonly workerIndex: number;

  constructor(workerIndex: number) {
    this.workerIndex = workerIndex;
    const dir = path.join(ROOT, '.tmp', 'e2e-iso');
    fs.mkdirSync(dir, { recursive: true });
    this.dataDir = fs.mkdtempSync(path.join(dir, `w${workerIndex}-`));
  }

  get baseURL(): string {
    return `http://localhost:${this.port}`;
  }

  /** 서버를 켠다(멈췄다 다시 켜면 같은 데이터 폴더·같은 포트를 쓴다) */
  async start(): Promise<void> {
    if (this.child) return;
    if (!this.port) this.port = await pickPort(this.workerIndex);
    const env: NodeJS.ProcessEnv = { ...process.env, E2E_PORT: String(this.port), E2E_DATA_DIR: this.dataDir, TEST_NOW: process.env.TEST_NOW || TEST_NOW };
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/e2e-server.ts'], { cwd: ROOT, env, stdio: 'ignore' });
    this.child = child;
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      if (child.exitCode !== null) throw new Error(`E2E 서버가 바로 꺼졌어요(종료 코드 ${child.exitCode}, 포트 ${this.port}).`);
      try {
        const r = await fetch(`${this.baseURL}/api/health`);
        const body = (await r.json()) as { ok?: boolean; db?: string };
        if (r.ok && body.ok && body.db === 'ok') return;
      } catch {
        // 아직 안 켜짐
      }
      await new Promise((res) => setTimeout(res, 200));
    }
    throw new Error(`E2E 서버(${this.baseURL})가 60초 안에 준비되지 않았어요.`);
  }

  /** 이 fixture가 띄운 자식 프로세스만 끄고, 포트가 더는 응답하지 않을 때까지 기다린다 */
  async stop(): Promise<void> {
    const c = this.child;
    this.child = null;
    if (!c) return;
    if (c.exitCode === null) {
      await new Promise<void>((resolve) => {
        c.once('exit', () => resolve());
        c.kill();
      });
    }
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      try {
        await fetch(`${this.baseURL}/api/health`);
      } catch {
        return;
      }
      await new Promise((res) => setTimeout(res, 200));
    }
  }

  /** 역할을 가진 로그인 가능한 계정을 DB에 직접 넣는다(사용자 관리 화면은 다른 태스크 담당) */
  async addUser(role: 'admin' | 'manager' | 'staff', username: string, password: string, name: string): Promise<void> {
    const hash = await hashPassword(password);
    const db = new DatabaseSync(path.join(this.dataDir, 'app.db'));
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const now = new Date(TEST_NOW).toISOString();
      db.prepare(
        'INSERT INTO users (username, name, role, job_type, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)',
      ).run(username, name, role, 'other', hash, now, now);
    } finally {
      db.close();
    }
  }

  /** 서버를 끄고 임시 데이터 폴더를 지운다 */
  async dispose(): Promise<void> {
    await this.stop();
    try {
      fs.rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // 파일을 아직 쥐고 있으면 남겨 둔다(.tmp는 git 제외)
    }
  }
}

/** 워커 하나가 지금 쓰고 있는 서버(spec 파일이 바뀌면 바꾼다) */
interface ServerPool {
  get(file: string): Promise<IsoServer>;
}

export const test = base.extend<{ isoServer: IsoServer }, { serverPool: ServerPool }>({
  serverPool: [
    async ({ playwright: _pw }, run, workerInfo) => {
      let current: { file: string; server: IsoServer } | null = null;
      const pool: ServerPool = {
        async get(file) {
          if (current && current.file === file) {
            await current.server.start();
            return current.server;
          }
          if (current) await current.server.dispose();
          const server = new IsoServer(workerInfo.workerIndex);
          current = { file, server };
          await server.start();
          return server;
        },
      };
      await run(pool);
      if (current) await (current as { server: IsoServer }).server.dispose();
    },
    { scope: 'worker', timeout: 90000 },
  ],
  isoServer: async ({ serverPool }, run, testInfo) => {
    await run(await serverPool.get(testInfo.file));
  },
  baseURL: async ({ isoServer }, run) => {
    await run(isoServer.baseURL);
  },
});

export { expect };
