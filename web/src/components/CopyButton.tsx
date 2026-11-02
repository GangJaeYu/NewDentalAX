// 이 파일이 하는 일: 글을 클립보드로 복사하는 버튼. http 원내 접속에서도 되도록 lib/clipboard.ts의 대체 경로를 쓴다(TD-017).
// 복사하면 버튼 글자가 잠깐 "복사했어요"로 바뀌고, 실패하면 토스트로 직접 선택해 복사하라고 안내한다.
import { useState } from 'react';
import { copyText } from '../lib/clipboard.ts';
import { Button } from './Button.tsx';
import { useToast } from './Toast.tsx';

/** 복사 버튼 */
export function CopyButton({ text, label = '복사', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  const onClick = async () => {
    const ok = await copyText(text);
    if (ok) {
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } else {
      toast.error('복사하지 못했어요. 글을 직접 선택해 복사해 주세요.');
    }
  };
  return (
    <Button size={size} icon={done ? 'check' : 'copy'} onClick={onClick}>
      {done ? '복사했어요' : label}
    </Button>
  );
}
