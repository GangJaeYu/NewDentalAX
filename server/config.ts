// 이 파일이 하는 일: 서버 실행 설정(포트·데이터 폴더·백업 폴더·원내망 제한 해제 여부·테스트 고정 시각)을
// 환경 변수와 data/config.json에서 읽어 하나의 설정 객체로 만든다.
// 우선순위: 환경 변수 > data/config.json > 기본값(포트 8090, ./data, ./backups).
import fs from 'node:fs';
import path from 'node:path';

/** 서버 전체가 함께 쓰는 실행 설정 */
export interface AppConfig {
  /** 서버가 기다리는 포트(기본 8090) */
  port: number;
  /** 서버가 기다리는 주소. 원내 다른 기기도 접속하도록 기본은 0.0.0.0 */
  host: string;
  /** 업무 데이터 폴더(app.db, config.json, logs/, server.pid 등) */
  dataDir: string;
  /** 자동 백업 폴더 */
  backupDir: string;
  /** true면 원내망 밖 접속 제한을 끈다(위험, README 안내) */
  allowExternal: boolean;
  /** 남겨 둘 백업 개수 */
  backupKeep: number;
  /** 테스트 전용 고정 시각(ISO 문자열). production에서는 항상 비어 있다 */
  testNow: string | null;
}

/** 설정이 잘못됐을 때 내는 오류. message는 사용자에게 그대로 보여 줄 한국어 문장이다 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_PORT = 8090;

/** data/config.json에 적을 수 있는 값 */
interface FileConfig {
  port?: unknown;
  allowExternal?: unknown;
  backupKeep?: unknown;
}

/** 문자열이나 숫자를 1~65535 사이 포트 번호로 바꾼다. 아니면 한국어 오류를 낸다 */
export function parsePort(value: unknown, where: string): number {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new ConfigError(`${where}의 포트 값 "${String(value)}"이(가) 올바르지 않아요. 1부터 65535 사이의 숫자로 적어 주세요(예: 8090).`);
  }
  return n;
}

/** data/config.json을 읽는다. 파일이 없으면 빈 설정을, 형식이 틀리면 한국어 오류를 돌려준다 */
function readFileConfig(dataDir: string): FileConfig {
  const file = path.join(dataDir, 'config.json');
  if (!fs.existsSync(file)) return {};
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 메모장이 붙이는 BOM 제거
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('객체가 아님');
    return parsed as FileConfig;
  } catch {
    throw new ConfigError(`설정 파일(${file})의 형식이 올바르지 않아요. 중괄호 { } 로 감싼 JSON 형식인지 확인하거나, 파일을 지운 뒤 다시 실행해 주세요.`);
  }
}

/**
 * 환경 변수와 설정 파일을 합쳐 실행 설정을 만든다.
 * - env: 보통 process.env. 테스트는 원하는 값만 넣어 부른다.
 * - cwd: 상대 경로의 기준 폴더(보통 프로젝트 폴더)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): AppConfig {
  const dataDir = path.resolve(cwd, env.DATA_DIR || 'data');
  const backupDir = path.resolve(cwd, env.BACKUP_DIR || 'backups');
  const file = readFileConfig(dataDir);

  let port = DEFAULT_PORT;
  if (file.port !== undefined) port = parsePort(file.port, '설정 파일(config.json)');
  if (env.PORT) port = parsePort(env.PORT, '환경 변수 PORT');

  const backupKeep = typeof file.backupKeep === 'number' && Number.isInteger(file.backupKeep) && file.backupKeep > 0 ? file.backupKeep : 14;

  // 고정 시각은 테스트에서만 쓴다. 실제 운영(production)에서는 무시해서 시간이 멈추는 사고를 막는다.
  let testNow: string | null = null;
  if (env.TEST_NOW && env.NODE_ENV !== 'production') {
    if (Number.isNaN(Date.parse(env.TEST_NOW))) throw new ConfigError(`환경 변수 TEST_NOW 값 "${env.TEST_NOW}"을(를) 날짜로 읽을 수 없어요. 예: 2026-11-02T09:00:00+09:00`);
    testNow = env.TEST_NOW;
  }

  return {
    port,
    host: env.HOST || '0.0.0.0',
    dataDir,
    backupDir,
    allowExternal: file.allowExternal === true,
    backupKeep,
    testNow,
  };
}
