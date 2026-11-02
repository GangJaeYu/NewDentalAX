// 이 파일이 하는 일: "저장했어요" 같은 짧은 알림(토스트)을 화면 오른쪽 아래에 띄운다(role=status, 화면 읽기 프로그램이 읽음).
// 앱 맨 바깥에 ToastProvider를 두고, 화면에서는 const toast = useToast(); toast.show('저장했어요') / toast.error('...')로 쓴다. 4초 뒤 저절로 사라진다.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

interface ToastItem {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

interface ToastApi {
  show: (text: string) => void;
  error: (text: string) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {}, error: () => {} });

/** 토스트를 띄울 수 있게 앱을 감싼다 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (text: string, tone: ToastItem['tone']) => {
      seq.current += 1;
      const id = seq.current;
      setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(() => ({ show: (t) => push(t, 'info'), error: (t) => push(t, 'error') }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            <Icon name={t.tone === 'error' ? 'alert' : 'check'} size="md" />
            <span>{t.text}</span>
            <button type="button" onClick={() => remove(t.id)} aria-label="알림 닫기">
              <Icon name="close" size="sm" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** 토스트 띄우기 */
export function useToast(): ToastApi {
  return useContext(Ctx);
}
