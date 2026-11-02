// 이 파일이 하는 일: 명세서 사진 입고 테스트(phase-04-task-08)용 가짜 사진 바이트를 만든다. 실제 그림 자료는 없고,
// 서버가 읽는 머리 부분(JPEG SOF·PNG IHDR·WebP VP8/VP8L/VP8X)에 원하는 가로·세로를 적는다. 형식 검사(앞부분 바이트)도 통과한다.
// 브라우저 축소까지 보는 E2E는 tests/fixtures/receipt/statement-4000x3000.jpg(실제 4000×3000 JPEG)를 쓴다.

/** 가로·세로가 적힌 최소 JPEG(SOI + APP0 + SOF0 + EOI). pad만큼 뒤에 0을 채워 용량을 키울 수 있다 */
export function fakeJpeg(width: number, height: number, pad = 0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  sof.set([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 10);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(pad), Buffer.from([0xff, 0xd9])]);
}

/** 가로·세로가 적힌 최소 PNG(서명 + IHDR) */
export function fakePng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.set([8, 2, 0, 0, 0], 16);
  return Buffer.concat([sig, ihdr, Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
}

/** 가로·세로가 적힌 최소 WebP. kind: 'VP8 '(손실)·'VP8L'(무손실)·'VP8X'(확장) */
export function fakeWebp(width: number, height: number, kind: 'VP8 ' | 'VP8L' | 'VP8X' = 'VP8 '): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'latin1');
  b.write(kind, 12, 'latin1');
  b.writeUInt32LE(20, 16);
  if (kind === 'VP8 ') {
    b.set([0x9d, 0x01, 0x2a], 23);
    b.writeUInt16LE(width & 0x3fff, 26);
    b.writeUInt16LE(height & 0x3fff, 28);
  } else if (kind === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  } else {
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
  }
  return b;
}
