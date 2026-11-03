// 이 파일이 하는 일: 대화상자 Dialog, 옆에서 열리는 서랍 Drawer(태블릿·휴대폰 상세 편집, 휴대폰 "더보기" 메뉴), 위험한 작업 확인 ConfirmDialog.
// 브라우저 기본 <dialog>의 showModal()을 써서 바깥을 누를 수 없게 하고(포커스 가두기), Esc로 닫히며, 닫으면 원래 버튼으로 포커스가 돌아간다.
// 내용은 showModal() 뒤에 그려서 입력칸의 autoFocus가 동작한다(없으면 첫 버튼에 포커스).
// ConfirmDialog는 requireText를 주면 그 문구를 똑같이 입력해야 확인 버튼이 눌린다(되돌릴 수 없는 작업용).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconButton, Button } from './Button.tsx';
import { Field, TextInput } from './Field.tsx';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** 아래 버튼 줄 */
  footer?: ReactNode;
  /** 넓은 대화상자 */
  wide?: boolean;
  /** 'dialog'(가운데) 또는 'drawer'(오른쪽 서랍), 'drawer-left'(왼쪽 서랍) */
  kind?: 'dialog' | 'drawer' | 'drawer-left';
}

/** 가운데 대화상자 또는 서랍 */
export function Dialog({ open, onClose, title, children, footer, wide, kind = 'dialog' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 내용은 showModal() 뒤에 그린다. 닫힌 <dialog> 안에서는 React autoFocus가 포커스를 주지 못하고, 뒤이은 showModal()이
  // 첫 버튼(닫기)으로 포커스를 옮겨 버려서 키보드 사용자가 입력칸까지 다시 Tab을 눌러야 했다(phase-05-task-03 키보드 점검에서 발견).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
    setShown(open);
  }, [open]);

  // 내용이 그려진 뒤: autoFocus 칸이 포커스를 가져갔으면 그대로 두고, 아니면 예전처럼 첫 번째 누를 수 있는 요소(닫기 버튼)에 둔다
  useEffect(() => {
    const d = ref.current;
    if (!d || !shown) return;
    const active = document.activeElement;
    if (active === d || !d.contains(active)) d.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
  }, [shown]);

  const cls = kind === 'dialog' ? ['dialog', wide && 'wide'].filter(Boolean).join(' ') : ['drawer', kind === 'drawer-left' && 'left'].filter(Boolean).join(' ');
  return (
    <dialog
      ref={ref}
      className={cls}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        // 바깥 어두운 부분(=dialog 자신)을 누르면 닫는다
        if (e.target === ref.current) onCloseRef.current();
      }}
    >
      {open && shown ? (
        <>
          <div className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <IconButton icon="close" label="닫기" onClick={() => onCloseRef.current()} />
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

/** 오른쪽(또는 왼쪽)에서 열리는 서랍 */
export function Drawer(props: Omit<DialogProps, 'kind' | 'wide'> & { side?: 'right' | 'left' }) {
  const { side = 'right', ...rest } = props;
  return <Dialog {...rest} kind={side === 'left' ? 'drawer-left' : 'drawer'} />;
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** 확인을 누르면 부른다. Promise면 끝날 때까지 버튼이 처리 중으로 바뀐다 */
  onConfirm: () => void | Promise<void>;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** 위험한 작업이면 빨간 확인 버튼 */
  danger?: boolean;
  /** 이 문구를 그대로 입력해야 확인할 수 있다(예: "초기화") */
  requireText?: string;
}

/** 확인 대화상자 */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = '확인', danger, requireText }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !requireText || typed.trim() === requireText;

  const close = () => {
    setTyped('');
    onClose();
  };
  const confirm = async () => {
    if (!ok) return;
    setBusy(true);
    try {
      await onConfirm();
      setTyped('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button onClick={close}>취소</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={confirm} disabled={!ok} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div>{message}</div>
      {requireText ? (
        <Field label={`확인을 위해 "${requireText}"를 입력해 주세요`}>
          <TextInput className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
      ) : null}
    </Dialog>
  );
}
