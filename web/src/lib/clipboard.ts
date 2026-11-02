// 이 파일이 하는 일: 글을 클립보드로 복사한다. 원내 접속은 http라서 navigator.clipboard를 쓸 수 없는 경우가 많아(TD-017)
// 그때는 숨긴 입력칸을 만들어 document.execCommand('copy')로 복사하는 대체 경로를 쓴다. CopyButton이 이 함수를 쓴다.

/** 글을 복사한다. 성공하면 true */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 권한이 없으면 아래 대체 경로로
  }
  return legacyCopy(text);
}

/** http 환경용 대체 복사: 화면 밖 textarea를 골라 execCommand('copy') */
export function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.className = 'sr-only';
  document.body.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.();
  return ok;
}
