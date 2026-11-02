// 이 파일이 하는 일: 비밀번호 바꾸기 화면(/change-password, FR-002 AC6). 현재 비밀번호가 맞을 때만 새 비밀번호(8자 이상, 확인 일치)로 바꾼다.
// 관리자가 초기화한 임시 비밀번호로 들어온 사용자는 다른 화면을 쓰기 전에 여기서 먼저 바꿔야 한다(서버가 다른 API를 403으로 막음).
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { changePasswordSchema } from '../../../../shared/schemas/auth.ts';
import { Button } from '../../components/Button.tsx';
import { Field, PasswordInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { AuthLayout, fieldErrors, focusFirstInvalid } from './AuthLayout.tsx';

/** 비밀번호 바꾸기 화면 */
export default function ChangePasswordPage() {
  const { info, passwordChanged, logout } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mustChange = !!info?.user?.mustChangePw;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = changePasswordSchema.safeParse({ current: form.current, next: form.next });
    const errs = parsed.success ? {} : fieldErrors(parsed.error);
    if (!errs.next && form.next !== form.confirm) errs.confirm = '새 비밀번호 확인이 맞지 않아요. 같은 비밀번호를 한 번 더 적어 주세요.';
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length > 0) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/auth/password', parsed.data);
      passwordChanged();
      toast.show('비밀번호를 바꿨어요.');
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        focusFirstInvalid(formRef.current);
      }
      setFormError(err instanceof Error ? err.message : '비밀번호를 바꾸지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="비밀번호 바꾸기"
      lead={mustChange ? '임시 비밀번호로 로그인했어요. 계속하려면 새 비밀번호로 바꿔 주세요.' : '지금 비밀번호를 확인한 뒤 새 비밀번호로 바꿔요.'}
      brand={info?.clinicName}
    >
      <form ref={formRef} className="auth-form" onSubmit={submit} noValidate aria-label="비밀번호 바꾸기">
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <Field label="현재 비밀번호" required error={errors.current}>
          <PasswordInput value={form.current} onChange={set('current')} autoComplete="current-password" autoFocus />
        </Field>
        <Field label="새 비밀번호" required error={errors.next} help="8자 이상, 지금 비밀번호와 다르게">
          <PasswordInput value={form.next} onChange={set('next')} autoComplete="new-password" />
        </Field>
        <Field label="새 비밀번호 확인" required error={errors.confirm}>
          <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </Field>
        <Button type="submit" variant="primary" block loading={busy}>
          비밀번호 바꾸기
        </Button>
        {mustChange ? (
          <Button variant="ghost" block onClick={() => void logout()}>
            로그아웃
          </Button>
        ) : (
          <Button variant="ghost" block to="/">
            대시보드로 돌아가기
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
