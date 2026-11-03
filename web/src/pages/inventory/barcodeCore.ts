// 이 파일이 하는 일: 바코드 해독의 핵심(브라우저 기능 없이 도는 부분, FR-130 phase-06-task-01). 회색 밝기 배열을 받아 바코드 글자를 찾는다.
// Windows Edge에는 BarcodeDetector가 없어서 순수 JS 해독 라이브러리(@zxing/library, eval·wasm 없음)를 쓴다. 읽는 형식: EAN-13·EAN-8·UPC·Code128·Code39·QR.
// 1차원 바코드를 세로로 찍은 사진도 읽도록 90도 돌려 한 번 더 본다. 사진 파일을 여는 부분은 barcodeDecode.ts(브라우저 전용)에 있다.
// 단위 테스트(tests/barcode-decode.test.ts)가 이 파일을 직접 불러 fixture 그림을 읽는다.
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  GlobalHistogramBinarizer,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
  type Binarizer,
  type LuminanceSource,
} from '@zxing/library';

/** 읽을 바코드 형식 */
const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
];

/** 형식 번호 → 화면에 보일 이름 */
const FORMAT_NAMES: Partial<Record<BarcodeFormat, string>> = {
  [BarcodeFormat.EAN_13]: 'EAN-13',
  [BarcodeFormat.EAN_8]: 'EAN-8',
  [BarcodeFormat.UPC_A]: 'UPC-A',
  [BarcodeFormat.UPC_E]: 'UPC-E',
  [BarcodeFormat.CODE_128]: 'Code128',
  [BarcodeFormat.CODE_39]: 'Code39',
  [BarcodeFormat.QR_CODE]: 'QR',
};

/** 읽은 결과 */
export interface DecodedBarcode {
  text: string;
  /** 'EAN-13'·'Code128'·'QR' 같은 형식 이름 */
  format: string;
}

/** 사진을 이 크기(긴 변, px) 안으로 줄여서 읽는다. 휴대폰 사진(4000px)을 그대로 읽으면 느리다 */
export const MAX_SIDE = 1600;

/** 해독기(한 번 만들어 다시 쓴다) */
let reader: MultiFormatReader | null = null;
function getReader(): MultiFormatReader {
  if (!reader) {
    reader = new MultiFormatReader();
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, FORMATS],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    reader.setHints(hints);
  }
  return reader;
}

/** 밝기 배열을 시계 방향으로 90도 돌린다(가로 w·세로 h → 가로 h·세로 w) */
export function rotate90(lum: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = lum[y * w + x] ?? 0;
  }
  return out;
}

/** 밝기 배열 한 장을 두 가지 흑백 나누기 방식으로 읽어 본다. 못 읽으면 null */
function tryOnce(lum: Uint8ClampedArray, w: number, h: number): DecodedBarcode | null {
  const source: LuminanceSource = new RGBLuminanceSource(lum, w, h);
  const binarizers: Binarizer[] = [new HybridBinarizer(source), new GlobalHistogramBinarizer(source)];
  for (const b of binarizers) {
    try {
      const r = getReader().decodeWithState(new BinaryBitmap(b));
      const text = r.getText();
      if (text) return { text, format: FORMAT_NAMES[r.getBarcodeFormat()] ?? String(r.getBarcodeFormat()) };
    } catch {
      // 이 방식으로는 못 찾았다 → 다음 방식
    } finally {
      getReader().reset();
    }
  }
  return null;
}

/**
 * 회색 밝기 배열(한 칸 = 픽셀 하나, 0 검정 ~ 255 흰색)에서 바코드를 찾는다.
 * 그대로 읽어 보고, 안 되면 90도 돌려 한 번 더 읽는다. 못 찾으면 null.
 */
export function decodeLuminance(lum: Uint8ClampedArray, width: number, height: number): DecodedBarcode | null {
  if (width < 1 || height < 1 || lum.length < width * height) return null;
  return tryOnce(lum, width, height) ?? tryOnce(rotate90(lum, width, height), height, width);
}

/** RGBA 픽셀(캔버스 getImageData 결과) → 회색 밝기 배열 */
export function rgbaToLuminance(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // 사람 눈에 맞춘 밝기 비율(녹색을 크게 본다). 투명한 곳은 흰색으로 본다
    const a = (rgba[p + 3] ?? 255) / 255;
    const y = 0.299 * (rgba[p] ?? 0) + 0.587 * (rgba[p + 1] ?? 0) + 0.114 * (rgba[p + 2] ?? 0);
    out[i] = Math.round(y * a + 255 * (1 - a));
  }
  return out;
}
