// 이 파일이 하는 일: 로그인 화면(/login, FR-002). 아이디·비밀번호로 로그인하고, 성공하면 ?next=로 받은 원래 화면(없으면 대시보드)으로 간다.
// 틀리면 서버 문구("아이디 또는 비밀번호가 맞지 않습니다")만 보여 주고, 5번 틀려 잠기면 남은 시간을 안내한다. 임시 비밀번호면 비밀번호 바꾸기로 보낸다.
// 키보드만으로 끝낼 수 있다: 아이디 → Tab → 비밀번호 → Enter(또는 Tab → 로그인 버튼).
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { loginSchema, type LoginResult } from '../../../../shared/schemas/auth.ts';
import { Button } from '../../components/Button.tsx';
import { Field, PasswordInput, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { safeNext, useSession } from '../../lib/session.tsx';
import { AuthLayout, fieldErrors, focusFirstInvalid } from './AuthLayout.tsx';

/** 로그인 화면 */
export default function LoginPage() {
  const { info, signedIn, expired } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await api.post<LoginResult>('/api/auth/login', parsed.data);
      signedIn(r);
      navigate(r.user.mustChangePw ? '/change-password' : next, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError || err instanceof Error ? err.message : '로그인하지 못했어요. 다시 시도해 주세요.');
      setForm((f) => ({ ...f, password: '' }));
    } finally {
      setBusy(false);
    }
  };

  const showExpired = expired || next !== '/';
  return (
    <AuthLayout title="로그인" lead="원내 업무 계정으로 로그인해 주세요." brand={info?.clinicName} foot="비밀번호를 잊었으면 원장님(관리자)께 초기화를 부탁해 주세요.">
      <form ref={formRef} className="auth-form" onSubmit={submit} noValidate aria-label="로그인">
        {showExpired && !formError ? (
          <div className="form-note" role="status">
            <Icon name="lock" size="md" />
            로그인이 필요해요. 로그인하면 보던 화면으로 돌아가요.
          </div>
        ) : null}
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <Field label="아이디" error={errors.username}>
          <TextInput
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
        </Field>
        <Field label="비밀번호" error={errors.password}>
          <PasswordInput value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" block loading={busy}>
          로그인
        </Button>
      </form>
    </AuthLayout>
  );
}
