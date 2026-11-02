// 이 파일이 하는 일: 올릴 파일을 보내기 전에 확인하고(확장자·크기), 사진은 긴 변 기준으로 줄여 용량을 낮춘다(FileDrop·명세서 사진 입고에서 사용).
// 크기 계산(fitSize)과 파일 검사(checkFile)는 순수 함수라 단위 테스트한다. 실제 축소(shrinkImage)는 브라우저 캔버스를 쓴다.

/** 가로·세로를 비율을 지키며 긴 변이 maxSide 이하가 되게 줄인다(이미 작으면 그대로) */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxSide || long <= 0) return { width, height };
  const r = maxSide / long;
  return { width: Math.max(1, Math.round(width * r)), height: Math.max(1, Math.round(height * r)) };
}

/** 바이트 수를 읽기 쉬운 크기로("2.5MB") */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
}

/** 파일 검사 조건 */
export interface FileRule {
  /** 허용 확장자(점 포함, 소문자). 예: ['.jpg', '.png', '.pdf'] */
  accept: readonly string[];
  /** 최대 크기(바이트) */
  maxBytes: number;
}

/** 파일 이름·크기를 검사해 문제가 있으면 한국어 이유를, 괜찮으면 null을 돌려준다 */
export function checkFile(file: { name: string; size: number }, rule: FileRule): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!rule.accept.includes(ext)) {
    return `${rule.accept.map((a) => a.slice(1).toUpperCase()).join('·')} 파일만 올릴 수 있어요.`;
  }
  if (file.size > rule.maxBytes) {
    return `파일이 너무 커요(${formatBytes(file.size)}). ${formatBytes(rule.maxBytes)} 이하로 올려 주세요.`;
  }
  if (file.size === 0) return '빈 파일이에요. 다른 파일을 골라 주세요.';
  return null;
}

/** 사진인지(확장자·형식 기준) */
export function isImageFile(file: { name: string; type?: string }): boolean {
  return (file.type ?? '').startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(file.name);
}

/**
 * 사진을 긴 변 maxSide(기본 1600px) 이하 JPEG로 줄인다. 이미 작고 JPEG면 원본을 돌려준다.
 * 브라우저가 읽지 못하는 형식이면 원본을 그대로 돌려준다(서버가 다시 검사한다).
 */
export async function shrinkImage(file: File, opts: { maxSide?: number; quality?: number } = {}): Promise<Blob> {
  const maxSide = opts.maxSide ?? 1600;
  const quality = opts.quality ?? 0.85;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const size = fitSize(bitmap.width, bitmap.height, maxSide);
  if (size.width === bitmap.width && file.type === 'image/jpeg') {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality));
}
