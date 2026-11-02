// 이 파일이 하는 일: API 키 같은 비밀값을 AES-256-GCM으로 암호화·복호화한다(TD-008, FR-031 AC2).
// 암호화 키는 DB와 다른 파일 <DATA_DIR>/secret.key(32바이트)에 두고, 처음 필요할 때 만든다. 화면·로그에는 끝 4자리 가림 표시(maskSecret)만 쓴다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 암호화한 값(database.md §5: {iv, tag, data}, 모두 base64) */
export interface EncryptedValue {
  iv: string;
  tag: string;
  data: string;
}

/** 데이터 폴더 안 암호화 키 파일 경로 */
export function secretKeyPath(dataDir: string): string {
  return path.join(dataDir, 'secret.key');
}

/**
 * 암호화 키(32바이트)를 읽는다. 파일이 없으면 새로 만들어 저장한다.
 * 파일이 망가져 길이가 맞지 않으면 다시 만들지 않고 오류를 낸다(이미 저장한 키를 못 읽게 되는 것을 막기 위해).
 */
export function loadOrCreateSecretKey(dataDir: string): Buffer {
  const file = secretKeyPath(dataDir);
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error('암호화 키 파일(secret.key)이 손상됐어요. 백업에서 secret.key를 되살리거나 AI 키를 다시 입력해 주세요.');
    return key;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const key = crypto.randomBytes(32);
  // 이미 다른 요청이 먼저 만들었으면(wx 실패) 그 파일을 읽는다
  try {
    fs.writeFileSync(file, key, { flag: 'wx', mode: 0o600 });
    return key;
  } catch {
    return loadOrCreateSecretKey(dataDir);
  }
}

/** 글자를 암호화한다 */
export function encryptText(key: Buffer, plain: string): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** 암호화한 값을 되돌린다. 키가 다르거나 값이 바뀌었으면 null */
export function decryptText(key: Buffer, value: EncryptedValue): string | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** 값이 암호화한 값 모양인지 */
export function isEncryptedValue(v: unknown): v is EncryptedValue {
  const o = v as Record<string, unknown> | null;
  return !!o && typeof o === 'object' && typeof o.iv === 'string' && typeof o.tag === 'string' && typeof o.data === 'string';
}

/** 비밀값을 끝 4자리만 보이게 가린다. 예: "sk-abc...wxyz" → "••••wxyz". 너무 짧으면 모두 가린다 */
export function maskSecret(secret: string): string {
  if (secret.length < 8) return '••••';
  return `••••${secret.slice(-4)}`;
}
