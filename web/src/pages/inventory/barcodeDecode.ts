// 이 파일이 하는 일: 휴대폰으로 찍은 바코드 사진(File)을 브라우저 안에서 읽는다(FR-130, phase-06-task-01). 서버나 인터넷으로 사진을 보내지 않는다.
// 사진을 MAX_SIDE 안으로 줄여 캔버스에 그리고, 회색 밝기 배열로 바꿔 barcodeCore.ts의 decodeLuminance로 해독한다.
// 실시간 카메라는 http 원내 주소에서 쓸 수 없어서(TD-017) 만들지 않고, <input type="file" capture>로 찍은 사진만 받는다.
import { decodeLuminance, MAX_SIDE, rgbaToLuminance, type DecodedBarcode } from './barcodeCore.ts';

export type { DecodedBarcode } from './barcodeCore.ts';

/**
 * 사진 파일에서 바코드를 읽는다(브라우저 전용). 사진을 MAX_SIDE 안으로 줄여 캔버스에 그린 뒤 밝기 배열로 바꿔 읽는다.
 * 사진을 열 수 없으면 오류를 던지고, 바코드를 못 찾으면 null을 돌려준다.
 */
export async function decodeImageFile(file: Blob): Promise<DecodedBarcode | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('사진을 열지 못했어요. JPG·PNG 사진을 다시 골라 주세요.');
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('이 브라우저에서는 사진을 읽을 수 없어요. 바코드 숫자를 직접 입력해 주세요.');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.drawImage(bitmap, 0, 0, w, h);
    const lum = rgbaToLuminance(g.getImageData(0, 0, w, h).data, w, h);
    return decodeLuminance(lum, w, h);
  } finally {
    bitmap.close();
  }
}
