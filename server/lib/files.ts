// 이 파일이 하는 일: 업로드 파일의 검사·저장·내려보내기를 한곳에서 맡는다(TD-012, FR-062 AC2). 서식 보관함·원내 매뉴얼·명세서 사진 등이 함께 쓴다.
// - 검사: 허용 확장자 + 파일 앞부분 바이트(매직 넘버)를 함께 본다. 확장자만 바꾼 실행 파일(.exe → .pdf)도 막는다. HTML·SVG는 받지 않는다.
// - 크기: 기본 20MB, 사진은 8MB. 넘으면 413 FILE_TOO_LARGE, 형식이 틀리면 415 FILE_TYPE(쉬운 한국어 문구).
// - 저장: <데이터 폴더>/uploads/YYYY/MM/<무작위 ID>.<확장자>. 원래 이름은 files 테이블에만 둔다. 내려받을 때는 첨부 파일(attachment)로만 보낸다.
// - multipart 받기: registerUploads(app)로 플러그인 범위 안에 @fastify/multipart를 건다. readUpload(req)가 파일 하나와 글 칸을 꺼낸다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import type { Db } from '../db/index.ts';
import type { Clock } from './clock.ts';
import { AppError } from './errors.ts';

/** 1MB(바이트) */
export const MB = 1024 * 1024;
/** 기본 크기 상한(20MB) */
export const DEFAULT_MAX_BYTES = 20 * MB;
/** 사진 크기 상한(8MB) */
export const IMAGE_MAX_BYTES = 8 * MB;

/** files.purpose(database.md §1) */
export type FilePurpose = 'form' | 'kb' | 'receipt' | 'training' | 'equipment' | 'expense';

/** 파일 형식 하나: 확장자, 내려보낼 MIME, 앞부분 바이트 검사 */
interface FileKind {
  mime: string;
  image?: boolean;
  /** 앞부분 바이트가 이 형식이 맞는지 */
  sniff(head: Buffer): boolean;
}

const startsWith = (head: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b);
const ZIP = (h: Buffer) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]);
const OLE = (h: Buffer) => startsWith(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** 글 파일인지: NUL 바이트가 없고 UTF-8로 읽힌다 */
function looksLikeText(head: Buffer): boolean {
  if (head.includes(0)) return false;
  try {
    // 앞부분만 읽으므로 끝에 잘린 글자가 있어도 괜찮게 stream 모드로 읽는다
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** 받을 수 있는 형식(확장자 → 검사). 여기 없는 확장자(.exe, .html, .svg 등)는 모두 거부한다 */
export const FILE_KINDS: Readonly<Record<string, FileKind>> = {
  '.pdf': { mime: 'application/pdf', sniff: (h) => startsWith(h, [0x25, 0x50, 0x44, 0x46]) },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sniff: ZIP },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sniff: ZIP },
  '.hwp': { mime: 'application/x-hwp', sniff: OLE },
  '.hwpx': { mime: 'application/hwp+zip', sniff: ZIP },
  '.jpg': { mime: 'image/jpeg', image: true, sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  '.jpeg': { mime: 'image/jpeg', image: true, sniff: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  '.png': { mime: 'image/png', image: true, sniff: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  '.webp': { mime: 'image/webp', image: true, sniff: (h) => startsWith(h, [0x52, 0x49, 0x46, 0x46]) && startsWith(h, [0x57, 0x45, 0x42, 0x50], 8) },
  '.txt': { mime: 'text/plain; charset=utf-8', sniff: looksLikeText },
  '.md': { mime: 'text/markdown; charset=utf-8', sniff: looksLikeText },
};

/** 쓰임새별 허용 확장자 */
export const PURPOSE_EXTS: Readonly<Record<FilePurpose, readonly string[]>> = {
  form: ['.pdf', '.docx', '.xlsx', '.hwp', '.hwpx', '.jpg', '.jpeg', '.png'],
  kb: ['.txt', '.md', '.pdf', '.docx'],
  receipt: ['.jpg', '.jpeg', '.png', '.webp', '.pdf'],
  training: ['.pdf', '.jpg', '.jpeg', '.png'],
  equipment: ['.pdf', '.jpg', '.jpeg', '.png'],
  expense: ['.pdf', '.jpg', '.jpeg', '.png'],
};

/** 확장자(점 포함, 소문자). 없으면 '' */
export function extOf(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/** 확장자 목록을 사람이 읽는 글로(예: "PDF·DOCX·HWP") */
export function extLabel(exts: readonly string[]): string {
  return [...new Set(exts.map((e) => (e === '.jpeg' ? '.jpg' : e)))].map((e) => e.slice(1).toUpperCase()).join('·');
}

/** 형식별 크기 상한 */
export function maxBytesFor(ext: string): number {
  return FILE_KINDS[ext]?.image ? IMAGE_MAX_BYTES : DEFAULT_MAX_BYTES;
}

/** 검사를 통과한 파일 정보 */
export interface CheckedFile {
  ext: string;
  mime: string;
}

/**
 * 올린 파일을 검사한다. 문제가 있으면 AppError를 던진다.
 * - 허용 확장자가 아니거나, 앞부분 바이트가 그 형식이 아니면 415 FILE_TYPE
 * - 크기 상한을 넘으면 413 FILE_TOO_LARGE, 빈 파일은 400 VALIDATION
 */
export function checkUpload(name: string, data: Buffer, purpose: FilePurpose): CheckedFile {
  const allowed = PURPOSE_EXTS[purpose];
  const ext = extOf(name);
  const kind = FILE_KINDS[ext];
  if (!kind || !allowed.includes(ext)) {
    throw new AppError('FILE_TYPE', { message: `올릴 수 없는 파일 형식입니다. ${extLabel(allowed)} 파일만 올릴 수 있어요.` });
  }
  const max = maxBytesFor(ext);
  if (data.length > max) {
    throw new AppError('FILE_TOO_LARGE', { message: `파일이 너무 큽니다(최대 ${Math.round(max / MB)}MB). 크기를 줄여서 다시 올려 주세요.` });
  }
  if (data.length === 0) throw new AppError('VALIDATION', { message: '빈 파일이에요. 다른 파일을 골라 주세요.', fields: { file: '빈 파일이에요.' } });
  if (!kind.sniff(data.subarray(0, 4096))) {
    throw new AppError('FILE_TYPE', { message: `올릴 수 없는 파일 형식입니다. 파일 내용이 ${extLabel([ext])} 형식이 아니에요.` });
  }
  return { ext, mime: kind.mime };
}

/** files 테이블 한 줄 */
export interface FileRow {
  id: number;
  stored_path: string;
  original_name: string;
  mime: string;
  size: number;
  sha256: string;
  purpose: FilePurpose;
  uploaded_by: number | null;
  created_at: string;
}

/** 업로드 폴더(<데이터 폴더>/uploads). 백업·초기화도 이 폴더를 쓴다 */
export function uploadsRoot(dataDir: string): string {
  return path.join(dataDir, 'uploads');
}

/** 원래 파일 이름을 안전하게(경로·제어 문자 제거, 최대 200자) */
export function cleanFileName(name: string): string {
  // 제어 문자(코드 0~31, 127)를 뺀다
  const base = [...path.basename(name.replace(/\\/g, '/'))]
    .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)
    .join('')
    .trim();
  return (base || '파일').slice(-200);
}

/** 저장에 필요한 값 */
export interface SaveEnv {
  db: Db;
  clock: Clock;
  dataDir: string;
}

/**
 * 검사한 뒤 uploads/YYYY/MM/<무작위 ID>.<확장자>로 저장하고 files 줄을 만든다. 검사에 실패하면 저장하지 않고 오류를 던진다.
 * 트랜잭션 안에서 불러도 되도록 파일은 먼저 쓰고, DB 넣기가 실패하면 지운다.
 */
export function saveUpload(env: SaveEnv, input: { name: string; data: Buffer; purpose: FilePurpose; userId: number | null }): FileRow {
  const checked = checkUpload(input.name, input.data, input.purpose);
  const now = env.clock.now();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const rel = `${yyyy}/${mm}/${crypto.randomBytes(16).toString('hex')}${checked.ext}`;
  const abs = path.join(uploadsRoot(env.dataDir), ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, input.data, { flag: 'wx' });
  try {
    const sha256 = crypto.createHash('sha256').update(input.data).digest('hex');
    const r = env.db.run(
      'INSERT INTO files (stored_path, original_name, mime, size, sha256, purpose, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [rel, cleanFileName(input.name), checked.mime, input.data.length, sha256, input.purpose, input.userId, now.toISOString()],
    );
    return getFile(env.db, r.lastInsertRowid) as FileRow;
  } catch (e) {
    fs.rmSync(abs, { force: true });
    throw e;
  }
}

/** files 줄 하나(없으면 undefined) */
export function getFile(db: Db, id: number): FileRow | undefined {
  return db.get<FileRow>('SELECT * FROM files WHERE id = ?', [id]);
}

/** 저장 파일의 실제 경로. uploads 폴더 밖을 가리키면 null */
export function storedFilePath(dataDir: string, row: Pick<FileRow, 'stored_path'>): string | null {
  const root = path.resolve(uploadsRoot(dataDir));
  const abs = path.resolve(root, ...row.stored_path.split('/'));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** Content-Disposition 값(한글 이름은 RFC 5987 filename*로) */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** 파일을 첨부 파일로 내려보낸다(브라우저가 열지 않고 저장하게). 저장 파일이 없으면 404 */
export function sendAttachment(reply: FastifyReply, dataDir: string, row: FileRow): FastifyReply {
  const abs = storedFilePath(dataDir, row);
  if (!abs || !fs.existsSync(abs)) throw new AppError('NOT_FOUND', { message: '파일을 찾을 수 없어요. 지워졌거나 옮겨졌을 수 있어요.' });
  const data = fs.readFileSync(abs);
  return reply
    .header('content-type', row.mime.includes('/') ? row.mime : 'application/octet-stream')
    .header('content-disposition', attachmentHeader(row.original_name))
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'private, no-store')
    .send(data);
}

/** 이 플러그인 범위에 multipart 받기를 건다. 크기 상한보다 조금 더 받아 두고 정확한 판정은 checkUpload가 한다 */
export async function registerUploads(app: FastifyInstance): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: DEFAULT_MAX_BYTES + 1, files: 1, fields: 20, fieldSize: 100 * 1024, parts: 25 },
  });
}

/** multipart 요청에서 꺼낸 파일과 글 칸 */
export interface UploadedPart {
  name: string;
  data: Buffer;
  fields: Record<string, string>;
}

/**
 * multipart 요청에서 파일 하나(field 이름은 무엇이든)와 글 칸들을 꺼낸다.
 * 크기 상한을 넘으면 413 FILE_TOO_LARGE, 파일이 없으면 400 VALIDATION을 던진다.
 */
export async function readUpload(req: FastifyRequest): Promise<UploadedPart> {
  if (!req.isMultipart()) throw new AppError('VALIDATION', { message: '올릴 파일을 골라 주세요.', fields: { file: '파일을 골라 주세요.' } });
  const fields: Record<string, string> = {};
  let file: { name: string; data: Buffer } | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const data = await part.toBuffer();
        if (!file) file = { name: part.filename || '파일', data };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new AppError('FILE_TOO_LARGE', { message: '파일이 너무 큽니다(최대 20MB). 크기를 줄여서 다시 올려 주세요.' });
    }
    if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT' || code === 'FST_FIELDS_LIMIT') {
      throw new AppError('VALIDATION', { message: '파일은 한 번에 하나만 올릴 수 있어요.' });
    }
    throw e;
  }
  if (!file) throw new AppError('VALIDATION', { message: '올릴 파일을 골라 주세요.', fields: { file: '파일을 골라 주세요.' } });
  return { ...file, fields };
}
