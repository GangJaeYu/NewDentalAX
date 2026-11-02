// 이 파일이 하는 일: 버튼 두 가지. Button(variant: primary/default/ghost/danger, size: md/sm, loading)과 IconButton(aria-label 필수, 배지 옵션).
// 화면마다 primary(채워진 청록)는 하나만 쓴다(DESIGN §5-7). 링크처럼 이동하는 버튼은 to를 주면 react-router Link로 그린다.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon, type IconName } from './Icon.tsx';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** 처리 중이면 누를 수 없고 돌아가는 표시를 보여 준다 */
  loading?: boolean;
  /** 앞에 붙일 아이콘 */
  icon?: IconName;
  /** 주면 버튼 모양의 링크(화면 이동)로 그린다 */
  to?: string;
  /** 가로로 꽉 채운다 */
  block?: boolean;
}

/** 버튼 class 이름을 만든다 */
function btnClass(variant: ButtonVariant, size: 'md' | 'sm', block: boolean, extra?: string): string {
  return ['btn', variant !== 'default' && variant, size === 'sm' && 'sm', block && 'block', extra].filter(Boolean).join(' ');
}

/** 기본 버튼 */
export function Button({ variant = 'default', size = 'md', loading = false, icon, to, block = false, className, children, disabled, type, ...rest }: ButtonProps) {
  const cls = btnClass(variant, size, block, className);
  const inner: ReactNode = (
    <>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 'md' : undefined} /> : null}
      {children}
    </>
  );
  if (to) {
    return (
      <Link className={cls} to={to}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type ?? 'button'} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {inner}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** 화면 읽기 프로그램이 읽을 이름(필수) */
  label: string;
  icon: IconName;
  /** 오른쪽 위 빨간 배지 숫자(0이거나 없으면 숨김) */
  badge?: number;
}

/** 아이콘만 있는 버튼. label이 aria-label과 툴팁이 된다 */
export function IconButton({ label, icon, badge, className, type, ...rest }: IconButtonProps) {
  return (
    <button type={type ?? 'button'} className={['iconbtn', className].filter(Boolean).join(' ')} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
      {badge ? (
        <span className="dot num" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}
