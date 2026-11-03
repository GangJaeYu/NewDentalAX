// 이 파일이 하는 일: 바코드 출고 테스트(phase-06-task-01)용 "휴대폰으로 찍은 듯한" 바코드 사진을 직접 만든다. 외부 그림·실제 상품 사진은 쓰지 않는다.
// EAN-13·Code128은 이 파일의 표대로 막대를 그리고, QR은 @zxing/library의 QRCodeWriter로 칸을 만든다. 그다음 종이색 배경에 올려
// 조금 기울이고(회전), 크기를 소수 배율로 바꾸고, 밝기 얼룩과 정해진 난수 잡음을 더해 사진처럼 만든다. 매번 같은 결과가 나온다.
// 다시 만들기: node tests/fixtures/barcode/make-barcodes.ts  → 같은 폴더에 *.png(8비트 회색)를 쓴다. 환자 정보는 없다.
// 단위 테스트(tests/barcode-decode.test.ts)는 이 함수로 만든 그림과 저장된 PNG가 같은지, 그리고 해독되는지 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { BarcodeFormat, QRCodeWriter } from '@zxing/library';

/** 회색 그림: 한 칸 = 픽셀 하나(0 검정 ~ 255 흰색) */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ───────────── EAN-13 ─────────────

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map((p) => [...p].map((c) => (c === '0' ? '1' : '0')).join(''));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''));
/** 첫 숫자에 따라 왼쪽 6자리를 L·G 중 어느 표로 그릴지 */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN-13 검사 숫자(앞 12자리로 계산) */
export function ean13Check(first12: string): number {
  let t = 0;
  for (let i = 0; i < 12; i++) t += Number(first12[i]) * (i % 2 ? 3 : 1);
  return (10 - (t % 10)) % 10;
}

/** EAN-13 13자리 → 막대 칸(1 검정, 0 흰색) 95칸 */
export function ean13Modules(code: string): string {
  if (!/^\d{13}$/.test(code) || ean13Check(code.slice(0, 12)) !== Number(code[12])) throw new Error(`EAN-13 번호가 올바르지 않아요: ${code}`);
  const d = [...code].map(Number);
  const parity = EAN_PARITY[d[0] ?? 0] ?? 'LLLLLL';
  let s = '101';
  for (let i = 1; i <= 6; i++) s += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i] ?? 0];
  s += '01010';
  for (let i = 7; i <= 12; i++) s += EAN_R[d[i] ?? 0];
  return `${s}101`;
}

// ───────────── Code128(코드 세트 B) ─────────────

/** 값 0~106의 막대·빈칸 너비(막대부터 번갈아). 106은 끝 표시(7칸) */
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/** Code128 B 글자(공백~~) → 막대 칸 문자열 */
export function code128Modules(text: string): string {
  const values: number[] = [104];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Code128 B로 그릴 수 없는 글자예요: ${ch}`);
    values.push(c - 32);
  }
  let sum = 104;
  values.slice(1).forEach((v, i) => (sum += v * (i + 1)));
  values.push(sum % 103, 106);
  let s = '';
  for (const v of values) {
    const w = C128[v] ?? '';
    [...w].forEach((n, i) => (s += (i % 2 ? '0' : '1').repeat(Number(n))));
  }
  return s;
}

// ───────────── 그리기 ─────────────

/** 1차원 막대 칸을 그림으로: 칸 하나 = px 픽셀, 앞뒤 여백 quiet칸, 높이 h */
export function render1d(modules: string, px: number, h: number, quiet = 12): GrayImage {
  const width = (modules.length + quiet * 2) * px;
  const data = new Uint8ClampedArray(width * h).fill(255);
  for (let m = 0; m < modules.length; m++) {
    if (modules[m] !== '1') continue;
    for (let y = 0; y < h; y++) data.fill(0, y * width + (m + quiet) * px, y * width + (m + quiet + 1) * px);
  }
  return { width, height: h, data };
}

/** QR 글자 → 그림(칸 하나 = px 픽셀, 여백 4칸 포함) */
export function renderQr(text: string, px: number): GrayImage {
  const m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, new Map());
  const n = m.getWidth();
  const width = n * px;
  const data = new Uint8ClampedArray(width * width).fill(255);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (m.get(Math.floor(x / px), Math.floor(y / px))) data[y * width + x] = 0;
  return { width, height: width, data };
}

/** 정해진 씨앗으로 매번 같은 수를 내는 난수(0 이상 1 미만) */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 사진처럼 만드는 정도 */
export interface PhotoOptions {
  width: number;
  height: number;
  /** 바코드를 키우는 배율(소수 가능) */
  scale: number;
  /** 기울기(도) */
  angle: number;
  /** 잡음 크기(±) */
  noise: number;
  seed: number;
}

/**
 * 바코드 그림을 종이색 배경 가운데에 올린 사진처럼 만든다.
 * 검정은 진한 회색(40), 흰색은 종이색(235)으로 낮추고, 회전·배율은 쌍선형 보간으로 계산한다. 왼쪽 위가 조금 어둡게 밝기 얼룩을 넣는다.
 */
export function photoLike(src: GrayImage, o: PhotoOptions): GrayImage {
  const rand = rng(o.seed);
  const out = new Uint8ClampedArray(o.width * o.height);
  const cos = Math.cos((o.angle * Math.PI) / 180);
  const sin = Math.sin((o.angle * Math.PI) / 180);
  const cx = o.width / 2;
  const cy = o.height / 2;
  const sample = (x: number, y: number): number => {
    // 바코드 밖은 흰색(종이)
    if (x < 0 || y < 0 || x > src.width - 1 || y > src.height - 1) return 255;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(src.width - 1, x0 + 1);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const at = (xx: number, yy: number) => src.data[yy * src.width + xx] ?? 255;
    return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
  };
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      // 결과 픽셀 → 원본 좌표(거꾸로 돌리고 줄인다)
      const dx = x - cx;
      const dy = y - cy;
      const sx = (dx * cos + dy * sin) / o.scale + src.width / 2;
      const sy = (-dx * sin + dy * cos) / o.scale + src.height / 2;
      const v = sample(sx, sy) / 255; // 0 검정 ~ 1 흰색
      const shade = 0.88 + 0.12 * ((x / o.width + y / o.height) / 2); // 밝기 얼룩
      const base = (40 + v * (235 - 40)) * shade;
      out[y * o.width + x] = Math.round(base + (rand() * 2 - 1) * o.noise);
    }
  }
  return { width: o.width, height: o.height, data: out };
}

// ───────────── PNG(8비트 회색) 쓰기·읽기 ─────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

/** 회색 그림 → PNG 바이트(줄마다 필터 0) */
export function encodePng(img: GrayImage): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 0; // 회색
  const raw = Buffer.alloc((img.width + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * img.width, img.width).copy(raw, y * (img.width + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** encodePng로 만든 PNG(8비트 회색·필터 0)만 읽는다(테스트 비교용) */
export function decodeOwnPng(buf: Buffer): GrayImage {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let p = 8; p < buf.length; ) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (width + 1)] !== 0) throw new Error('필터 0 PNG만 읽을 수 있어요.');
    data.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
  }
  return { width, height, data };
}

// ───────────── fixture 목록 ─────────────

/** 만들 fixture: 파일 이름, 들어 있는 글자(빈 글자면 바코드 없음), 형식 이름 */
export const FIXTURES = [
  { file: 'ean13-photo.png', text: '2001000000029', format: 'EAN-13' },
  { file: 'code128-photo.png', text: 'HS-STER-090', format: 'Code128' },
  { file: 'qr-photo.png', text: 'HS-QR-0001', format: 'QR' },
  { file: 'ean13-sideways-photo.png', text: '2001000000050', format: 'EAN-13' },
  { file: 'no-barcode-photo.png', text: '', format: '' },
] as const;

export type FixtureName = (typeof FIXTURES)[number]['file'];

/** fixture 하나를 만든다 */
export function makeFixture(file: FixtureName): GrayImage {
  const photo = { width: 960, height: 720, noise: 10 };
  switch (file) {
    case 'ean13-photo.png':
      return photoLike(render1d(ean13Modules('2001000000029'), 3, 180), { ...photo, scale: 1.37, angle: 4, seed: 11 });
    case 'code128-photo.png':
      return photoLike(render1d(code128Modules('HS-STER-090'), 3, 160), { ...photo, scale: 1.21, angle: -3, seed: 22 });
    case 'qr-photo.png':
      return photoLike(renderQr('HS-QR-0001', 8), { ...photo, scale: 1.53, angle: 7, seed: 33 });
    case 'ean13-sideways-photo.png':
      // 세로로 세워 찍은 사진(90도 돌린 상태): 해독할 때 돌려 보는지 확인한다
      return photoLike(render1d(ean13Modules('2001000000050'), 3, 180), { width: 720, height: 960, noise: 10, scale: 1.3, angle: 92, seed: 44 });
    case 'no-barcode-photo.png':
      return photoLike({ width: 1, height: 1, data: new Uint8ClampedArray([255]) }, { ...photo, scale: 1, angle: 0, seed: 55 });
  }
}

/** 이 폴더 경로 */
export const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));

// node로 직접 실행하면 PNG 파일을 쓴다
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of FIXTURES) {
    const png = encodePng(makeFixture(f.file));
    fs.writeFileSync(path.join(FIXTURE_DIR, f.file), png);
    console.log(`${f.file}  ${png.length.toLocaleString()}바이트  ${f.text || '(바코드 없음)'}`);
  }
}
