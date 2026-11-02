// 이 파일이 하는 일: "거래처" 화면(/inventory/vendors, FR-053). 거래처의 상호·담당자 이름·업무용 연락처·이메일·주문 방법·메모를 본다.
// 모두 조회하고, 실장 이상은 거래처를 추가·수정하고 "사용 안 함"으로 바꾼다. 거래처는 사업자 정보라 연락처를 저장하지만 AI로 보내지 않는다.
// 품목 수는 이 거래처를 기본 거래처로 둔 사용 중 품목 수다.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Field, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { SearchInput, Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import type { VendorRow } from '../../../../shared/schemas/inventory.ts';
import { messageOf, refreshInventory, useVendors } from './inventory-ui.tsx';

type ActiveFilter = 'active' | 'inactive' | 'all';

/** 거래처 */
export default function VendorsPage() {
  const { info } = useSession();
  const canManage = can(info?.user?.role, 'vendors.manage');
  const state = useVendors('all');
  const [active, setActive] = useState<ActiveFilter>('active');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<VendorRow | 'new' | null>(null);

  const rows = useMemo(() => {
    if (!state.data) return undefined;
    const w = q.trim().toLowerCase();
    return state.data.filter(
      (v) => (active === 'all' || (active === 'active') === v.active) && (!w || [v.name, v.contactName, v.orderMethod].some((t) => (t ?? '').toLowerCase().includes(w))),
    );
  }, [state.data, active, q]);
  const counts = { active: state.data?.filter((v) => v.active).length ?? 0, inactive: state.data?.filter((v) => !v.active).length ?? 0 };

  const columns: Column<VendorRow>[] = [
    { key: 'name', header: '상호', sortValue: (v) => v.name, render: (v) => <b>{v.name}</b> },
    { key: 'contactName', header: '담당자', sortValue: (v) => v.contactName, render: (v) => v.contactName ?? <span className="muted">—</span> },
    { key: 'phone', header: '업무용 연락처', render: (v) => (v.phone ? <span className="num">{v.phone}</span> : <span className="muted">—</span>) },
    { key: 'email', header: '이메일', render: (v) => v.email ?? <span className="muted">—</span> },
    { key: 'orderMethod', header: '주문 방법', render: (v) => v.orderMethod ?? <span className="muted">—</span> },
    { key: 'itemCount', header: '품목 수', align: 'right', sortValue: (v) => v.itemCount, render: (v) => `${v.itemCount}개` },
    { key: 'active', header: '상태', render: (v) => (v.active ? <Chip tone="ok">사용 중</Chip> : <Chip tone="ghost">사용 안 함</Chip>) },
  ];

  return (
    <>
      <PageHeader
        title="거래처"
        summary="거래처 담당자와 주문 방법을 모아 둬요. 거래처 연락처는 AI로 보내지 않아요."
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              거래처 추가
            </Button>
          ) : null
        }
      />
      <Card>
        <Toolbar label="거래처 목록 도구">
          <Segmented<ActiveFilter>
            label="상태"
            value={active}
            onChange={setActive}
            options={[
              { value: 'active', label: `사용 중 ${counts.active}` },
              { value: 'inactive', label: `사용 안 함 ${counts.inactive}` },
              { value: 'all', label: '전체' },
            ]}
          />
          <span className="grow" />
          <SearchInput label="거래처 찾기" placeholder="상호·담당자 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        </Toolbar>
        <DataTable<VendorRow>
          caption="거래처 목록"
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          rowLabel={(v) => v.name}
          loading={state.loading}
          error={state.error}
          onRetry={state.reload}
          onRowClick={canManage ? (v) => setEditing(v) : undefined}
          empty={
            q || active !== 'active' ? (
              <EmptyState icon="search" title="조건에 맞는 거래처가 없어요" description="검색어나 상태 조건을 바꿔 보세요." />
            ) : (
              <EmptyState
                icon="cart"
                title="아직 등록한 거래처가 없어요"
                description={canManage ? '자주 주문하는 거래처를 등록하면 품목의 기본 거래처로 고를 수 있어요.' : '실장 이상이 거래처를 등록하면 여기에 보여요.'}
                action={
                  canManage ? (
                    <Button icon="plus" onClick={() => setEditing('new')}>
                      첫 거래처 추가
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />
      </Card>
      {editing ? <VendorDialog key={editing === 'new' ? 'new' : editing.id} vendor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/** 거래처 추가·수정 대화상자 */
function VendorDialog({ vendor, onClose }: { vendor: VendorRow | null; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: vendor?.name ?? '',
    contactName: vendor?.contactName ?? '',
    phone: vendor?.phone ?? '',
    email: vendor?.email ?? '',
    orderMethod: vendor?.orderMethod ?? '',
    memo: vendor?.memo ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setFormError(null);
    try {
      if (vendor) await api.patch<VendorRow>(`/api/vendors/${vendor.id}`, body);
      else await api.post<VendorRow>('/api/vendors', body);
      refreshInventory();
      toast.show(done);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      }
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErrors({ name: '상호를 적어 주세요.' });
      setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setErrors({});
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    await save(body, `${form.name.trim()} 거래처를 저장했어요.`);
  };

  const title = vendor ? `${vendor.name} 수정` : '거래처 추가';
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          {vendor ? (
            <Button variant={vendor.active ? 'danger' : 'default'} onClick={() => void save({ active: !vendor.active }, vendor.active ? `${vendor.name}을(를) 사용 안 함으로 바꿨어요.` : `${vendor.name}을(를) 다시 사용해요.`)}>
              {vendor.active ? '사용 안 함' : '다시 사용'}
            </Button>
          ) : null}
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="inv-vendor-form" variant="primary" loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="inv-vendor-form" ref={formRef} onSubmit={submit} noValidate aria-label={title} style={{ display: 'grid', gap: 12 }}>
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <Field label="상호" required error={errors.name}>
          <TextInput value={form.name} onChange={set('name')} maxLength={60} autoComplete="off" />
        </Field>
        <Field label="담당자 이름" error={errors.contactName}>
          <TextInput value={form.contactName} onChange={set('contactName')} maxLength={30} autoComplete="off" />
        </Field>
        <Field label="업무용 연락처" error={errors.phone} help="거래처 사무실·영업 담당 번호를 적어요.">
          <TextInput value={form.phone} onChange={set('phone')} maxLength={30} inputMode="tel" autoComplete="off" />
        </Field>
        <Field label="이메일" error={errors.email}>
          <TextInput value={form.email} onChange={set('email')} maxLength={80} inputMode="email" autoComplete="off" />
        </Field>
        <Field label="주문 방법" error={errors.orderMethod} help="예: 전화 주문, 온라인 몰, 이메일 주문서">
          <TextInput value={form.orderMethod} onChange={set('orderMethod')} maxLength={60} autoComplete="off" />
        </Field>
        <Field label="메모" error={errors.memo}>
          <TextArea value={form.memo} onChange={set('memo')} maxLength={300} rows={2} />
        </Field>
      </form>
    </Dialog>
  );
}
