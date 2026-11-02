// 이 파일이 하는 일: "사용자·권한" 화면(/admin/users, FR-003·004). 직원 목록을 보고, 직원을 추가·수정·사용 중지하고, 비밀번호를 초기화한다.
// 직원 추가 입력란은 이름·아이디·역할·직무·입사일 다섯 개뿐이다(FR-004 AC1). 임시 비밀번호는 서버가 만들어 한 번만 보여 주고, 직원은 첫 로그인 때 바꾼다.
// 마지막 관리자를 끄거나 역할을 낮추려 하면 서버가 409 LAST_ADMIN을 돌려주고, 화면은 그 안내를 보여 주며 값을 바꾸지 않는다.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { DateInput, Field, Select, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { SearchInput, Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { JOB_TYPE_LABELS, JOB_TYPES, USER_ROLE_LABELS, USER_ROLE_VALUES, type JobType, type UserRoleValue } from '../../../../shared/enums.ts';
import type { CreatedUser, TempPasswordResult, UserRow } from '../../../../shared/schemas/admin.ts';

const KEY = 'admin:users';
const ROLE_OPTIONS = USER_ROLE_VALUES.map((v) => ({ value: v, label: USER_ROLE_LABELS[v] }));
const JOB_OPTIONS = JOB_TYPES.map((v) => ({ value: v, label: JOB_TYPE_LABELS[v] }));
type StatusFilter = 'active' | 'inactive' | 'all';

/** 입력 오류를 받아 첫 번째 틀린 칸으로 포커스를 옮긴다 */
function focusInvalid(form: HTMLFormElement | null): void {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

/** 오류를 화면 문구로 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 사용자·권한 화면 */
export default function UsersPage() {
  // api.get은 응답의 data(배열)만 돌려준다
  const state = useApi<UserRow[]>(KEY, () => api.get('/api/users?status=all'));
  const [status, setStatus] = useState<StatusFilter>('active');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [issued, setIssued] = useState<{ title: string; name: string; username: string; password: string } | null>(null);

  const rows = useMemo(() => {
    const all = state.data;
    if (!all) return undefined;
    const word = q.trim().toLowerCase();
    return all.filter(
      (u) =>
        (status === 'all' || (status === 'active') === u.active) &&
        (!word || u.name.toLowerCase().includes(word) || u.username.toLowerCase().includes(word)),
    );
  }, [state.data, status, q]);

  const counts = useMemo(() => {
    const all = state.data ?? [];
    return { active: all.filter((u) => u.active).length, inactive: all.filter((u) => !u.active).length };
  }, [state.data]);

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      header: '이름',
      sortValue: (u) => u.name,
      render: (u) => <b>{u.name}</b>,
    },
    { key: 'username', header: '아이디', sortValue: (u) => u.username, render: (u) => u.username },
    {
      key: 'role',
      header: '역할',
      sortValue: (u) => USER_ROLE_VALUES.indexOf(u.role),
      render: (u) => <Chip tone={u.role === 'admin' ? 'info' : 'ghost'}>{USER_ROLE_LABELS[u.role]}</Chip>,
    },
    { key: 'jobType', header: '직무', sortValue: (u) => JOB_TYPE_LABELS[u.jobType], render: (u) => JOB_TYPE_LABELS[u.jobType] },
    { key: 'hiredOn', header: '입사일', sortValue: (u) => u.hiredOn, render: (u) => (u.hiredOn ? formatDate(u.hiredOn) : '—') },
    {
      key: 'status',
      header: '상태',
      render: (u) => (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {u.active ? <Chip tone="ok">사용 중</Chip> : <Chip tone="ghost">사용 중지</Chip>}
          {u.active && u.mustChangePw ? <Chip tone="warn">비밀번호 변경 전</Chip> : null}
        </span>
      ),
    },
    {
      key: 'manage',
      header: '관리',
      render: (u) => (
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(u);
          }}
          aria-label={`${u.name} 수정`}
        >
          수정
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="사용자·권한"
        summary="직원 계정을 추가하고 역할을 정해요. 직원 정보는 이름·아이디·역할·직무·입사일만 저장해요."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            직원 추가
          </Button>
        }
      />
      <Card>
        <Toolbar label="직원 목록 도구">
          <Segmented<StatusFilter>
            label="상태"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: `사용 중 ${counts.active}` },
              { value: 'inactive', label: `사용 중지 ${counts.inactive}` },
              { value: 'all', label: '전체' },
            ]}
          />
          <span className="grow" />
          <SearchInput label="이름이나 아이디로 찾기" placeholder="이름·아이디 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        </Toolbar>
        <DataTable<UserRow>
          caption="직원 목록"
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          rowLabel={(u) => u.name}
          loading={state.loading}
          error={state.error}
          onRetry={state.reload}
          onRowClick={(u) => setEditing(u)}
          empty={
            q || status !== 'active' ? (
              <EmptyState icon="search" title="조건에 맞는 직원이 없어요" description="검색어나 상태 조건을 바꿔 보세요." />
            ) : (
              <EmptyState
                icon="people"
                title="아직 등록한 직원이 없어요"
                description="직원을 추가하면 임시 비밀번호가 만들어져요."
                action={
                  <Button icon="plus" onClick={() => setAdding(true)}>
                    첫 직원 추가
                  </Button>
                }
              />
            )
          }
        />
      </Card>

      <CreateUserDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(u) => {
          setAdding(false);
          setIssued({ title: '직원을 추가했어요', name: u.name, username: u.username, password: u.tempPassword });
        }}
      />
      {editing ? (
        <EditUserDialog
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          onReset={(password) => {
            setIssued({ title: '비밀번호를 초기화했어요', name: editing.name, username: editing.username, password });
            setEditing(null);
          }}
        />
      ) : null}
      <TempPasswordDialog info={issued} onClose={() => setIssued(null)} />
    </>
  );
}

/** 직원 추가 대화상자: 이름·아이디·역할·직무·입사일만 받는다 */
function CreateUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (u: CreatedUser) => void }) {
  const empty = { name: '', username: '', role: 'staff' as UserRoleValue, jobType: 'hygienist' as JobType, hiredOn: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const close = () => {
    setForm(empty);
    setErrors({});
    setFormError(null);
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = '이름을 적어 주세요.';
    if (!/^[A-Za-z0-9]{4,20}$/.test(form.username.trim())) errs.username = '아이디는 영문과 숫자로 4~20자로 적어 주세요.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) {
      setTimeout(() => focusInvalid(formRef.current), 0);
      return;
    }
    setBusy(true);
    try {
      const created = await api.post<CreatedUser>('/api/users', { ...form, name: form.name.trim(), username: form.username.trim(), hiredOn: form.hiredOn || null });
      invalidate(KEY);
      setForm(empty);
      onCreated(created);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        setTimeout(() => focusInvalid(formRef.current), 0);
      }
      setFormError(messageOf(err, '직원을 추가하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={close}
      title="직원 추가"
      footer={
        <>
          <Button onClick={close}>취소</Button>
          <Button type="submit" form="user-create-form" variant="primary" loading={busy}>
            추가하고 임시 비밀번호 받기
          </Button>
        </>
      }
    >
      <form id="user-create-form" ref={formRef} onSubmit={submit} noValidate aria-label="직원 추가" style={{ display: 'grid', gap: 12 }}>
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <Field label="이름" required error={errors.name}>
          <TextInput value={form.name} onChange={set('name')} autoComplete="off" maxLength={30} />
        </Field>
        <Field label="아이디" required error={errors.username} help="영문과 숫자 4~20자. 정한 뒤에는 바꿀 수 없어요.">
          <TextInput value={form.username} onChange={set('username')} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} />
        </Field>
        <Field label="역할" required error={errors.role}>
          <Select value={form.role} onChange={set('role')} options={ROLE_OPTIONS} />
        </Field>
        <Field label="직무" required error={errors.jobType}>
          <Select value={form.jobType} onChange={set('jobType')} options={JOB_OPTIONS} />
        </Field>
        <Field label="입사일" error={errors.hiredOn} help="모르면 비워 두어도 돼요.">
          <DateInput value={form.hiredOn} onChange={set('hiredOn')} />
        </Field>
        <p className="form-note">
          <Icon name="key" size="md" />
          추가하면 임시 비밀번호가 만들어져요. 직원은 처음 로그인할 때 새 비밀번호로 바꿔야 해요.
        </p>
      </form>
    </Dialog>
  );
}

/** 직원 수정 대화상자: 이름·역할·직무·입사일 수정, 사용 중지·다시 사용, 비밀번호 초기화 */
function EditUserDialog({ user, onClose, onReset }: { user: UserRow; onClose: () => void; onReset: (password: string) => void }) {
  const { info } = useSession();
  const toast = useToast();
  const isMe = info?.user?.id === user.id;
  const [form, setForm] = useState({ name: user.name, role: user.role, jobType: user.jobType, hiredOn: user.hiredOn ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'deactivate' | 'reset' | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /** 서버에 바꿀 내용을 보낸다. 실패하면 안내를 보여 주고 false */
  const send = async (body: Record<string, unknown>, done: string): Promise<boolean> => {
    setFormError(null);
    try {
      await api.patch<UserRow>(`/api/users/${user.id}`, body);
      invalidate(KEY);
      toast.show(done);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
      return false;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: '이름을 적어 주세요.' });
      setTimeout(() => focusInvalid(formRef.current), 0);
      return;
    }
    setErrors({});
    setBusy(true);
    const ok = await send({ name: form.name.trim(), role: form.role, jobType: form.jobType, hiredOn: form.hiredOn || null }, `${form.name.trim()}님 정보를 저장했어요.`);
    setBusy(false);
    if (ok) onClose();
  };

  const toggleActive = async () => {
    setConfirm(null);
    const ok = await send({ active: !user.active }, user.active ? `${user.name}님 계정을 사용 중지했어요.` : `${user.name}님 계정을 다시 쓸 수 있어요.`);
    if (ok) onClose();
  };

  const reset = async () => {
    setConfirm(null);
    setFormError(null);
    try {
      const r = await api.post<TempPasswordResult>(`/api/users/${user.id}/reset-password`, {});
      invalidate(KEY);
      onReset(r.tempPassword);
    } catch (err) {
      setFormError(messageOf(err, '비밀번호를 초기화하지 못했어요. 다시 시도해 주세요.'));
    }
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={`${user.name} (${user.username})`}
        footer={
          <>
            {user.active ? (
              <Button variant="danger" onClick={() => setConfirm('deactivate')}>
                사용 중지
              </Button>
            ) : (
              <Button onClick={() => void toggleActive()}>다시 사용</Button>
            )}
            {!isMe && user.active ? (
              <Button icon="key" onClick={() => setConfirm('reset')}>
                비밀번호 초기화
              </Button>
            ) : null}
            <span style={{ flex: 1 }} />
            <Button onClick={onClose}>취소</Button>
            <Button type="submit" form="user-edit-form" variant="primary" loading={busy}>
              저장
            </Button>
          </>
        }
      >
        <form id="user-edit-form" ref={formRef} onSubmit={submit} noValidate aria-label="직원 정보 수정" style={{ display: 'grid', gap: 12 }}>
          {formError ? (
            <div className="form-error" role="alert">
              <Icon name="alert" size="md" />
              {formError}
            </div>
          ) : null}
          {!user.active ? (
            <p className="form-note">
              <Icon name="lock" size="md" />
              사용 중지된 계정이에요. 이 직원은 로그인할 수 없어요.
            </p>
          ) : null}
          <Field label="이름" required error={errors.name}>
            <TextInput value={form.name} onChange={set('name')} autoComplete="off" maxLength={30} />
          </Field>
          <Field label="역할" required error={errors.role} help={isMe ? '본인 역할을 낮추면 이 화면을 더는 쓸 수 없어요.' : undefined}>
            <Select value={form.role} onChange={set('role')} options={ROLE_OPTIONS} />
          </Field>
          <Field label="직무" required error={errors.jobType}>
            <Select value={form.jobType} onChange={set('jobType')} options={JOB_OPTIONS} />
          </Field>
          <Field label="입사일" error={errors.hiredOn}>
            <DateInput value={form.hiredOn} onChange={set('hiredOn')} />
          </Field>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirm === 'deactivate'}
        onClose={() => setConfirm(null)}
        onConfirm={toggleActive}
        title="계정을 사용 중지할까요?"
        message={`${user.name}님은 바로 로그아웃되고, 다시 켜기 전까지 로그인할 수 없어요. 기록은 그대로 남아요.`}
        confirmLabel="사용 중지"
        danger
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        onConfirm={reset}
        title="비밀번호를 초기화할까요?"
        message={`${user.name}님의 지금 비밀번호는 더는 쓸 수 없고, 열려 있던 로그인도 끊겨요. 새 임시 비밀번호를 알려 드릴게요.`}
        confirmLabel="초기화"
      />
    </>
  );
}

/** 임시 비밀번호 안내(한 번만 보여 준다) */
function TempPasswordDialog({ info, onClose }: { info: { title: string; name: string; username: string; password: string } | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!info}
      onClose={onClose}
      title={info?.title ?? ''}
      footer={
        <Button variant="primary" onClick={onClose}>
          확인했어요
        </Button>
      }
    >
      {info ? (
        <>
          <p>
            <b>{info.name}</b>님에게 아래 아이디와 임시 비밀번호를 전해 주세요. 처음 로그인하면 새 비밀번호로 바꾸게 돼요.
          </p>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', alignItems: 'center', margin: 0 }}>
            <dt className="muted">아이디</dt>
            <dd style={{ margin: 0 }}>
              <b>{info.username}</b>
            </dd>
            <dt className="muted">임시 비밀번호</dt>
            <dd style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code data-testid="temp-password" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.04em' }}>
                {info.password}
              </code>
              <CopyButton text={info.password} label="복사" />
            </dd>
          </dl>
          <p className="form-note">
            <Icon name="lock" size="md" />이 창을 닫으면 임시 비밀번호를 다시 볼 수 없어요. 잊어버렸다면 비밀번호를 다시 초기화해 주세요.
          </p>
        </>
      ) : null}
    </Dialog>
  );
}
