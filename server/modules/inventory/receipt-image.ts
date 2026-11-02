// 이 파일이 하는 일: 올라온 사진(JPEG·PNG·WebP)의 머리 부분만 읽어 가로·세로 픽셀 수를 알아낸다(TD-012 "서버는 이미지 머리 부분을 읽어 크기를 다시 확인").
// 네이티브 이미지 라이브러리 없이 순수 JS로 읽는다. 명세서 사진 입고(receipt.service.ts)가 "긴 변 1600px 이하" 검사에 쓴다.

/** 읽은 사진 크기 */
export interface ImageSize {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
}

/** PNG: 8바이트 서명 뒤 첫 덩어리(IHDR)에 가로·세로가 4바이트씩 들어 있다 */
function pngSize(b: Buffer): ImageSize | null {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: 'png' };
}

/** JPEG의 SOF(프레임 시작) 표시 번호인지(C4·C8·CC는 SOF가 아니다) */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** JPEG: 표시(FF xx)를 차례로 건너뛰며 SOF 구간을 찾아 세로·가로를 읽는다 */
function jpegSize(b: Buffer): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1] as number;
    // 채움 바이트(FF FF …)는 건너뛴다
    while (marker === 0xff && i + 2 < b.length) {
      i += 1;
      marker = b[i + 1] as number;
    }
    // 길이가 없는 표시(SOI·EOI·RSTn·TEM)
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // 그림 자료가 시작됐는데 SOF가 없었다
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (isSof(marker)) {
      const height = b.readUInt16BE(i + 5);
      const width = b.readUInt16BE(i + 7);
      return width > 0 && height > 0 ? { width, height, format: 'jpeg' } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** WebP: RIFF 머리 뒤 첫 덩어리(VP8 손실·VP8L 무손실·VP8X 확장)마다 크기 적는 자리가 다르다 */
function webpSize(b: Buffer): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // 프레임 머리: 시작 코드 9D 01 2A 뒤에 14비트 가로·세로
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, format: 'webp' };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
  }
  if (chunk === 'VP8X') {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1, format: 'webp' };
  }
  return null;
}

/** 사진 크기를 읽는다. 형식을 모르거나 머리가 깨졌으면 null */
export function readImageSize(b: Buffer): ImageSize | null {
  try {
    if (b.length >= 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return pngSize(b);
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpegSize(b);
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return webpSize(b);
  } catch {
    // 범위를 벗어나 읽으면(잘린 파일) 모르는 형식으로 본다
  }
  return null;
}
