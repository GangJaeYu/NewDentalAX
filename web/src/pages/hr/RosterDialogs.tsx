// 이 파일이 하는 일: 근무표 화면(/hr/roster)의 대화상자 두 개. 실장 이상만 연다(서버도 roster.edit로 막는다).
// - CellPickDialog: 칸을 누르면 열리고, 근무 유형 버튼 하나를 누르면 바로 저장된다(칸 클릭 → 유형 클릭 = 2번, FR-081 AC1). "비우기"로 칸을 지운다.
//   승인된 휴가가 있는 칸은 휴가가 우선 표시된다는 안내를 함께 보여 준다(휴가는 연차 화면에서 바꾼다).
// - ShiftTypesDialog: 근무 유형(이름·시작·끝 시각·색·인원에 셈·사용)을 고치고 새 유형을 더한다. 지우지 않고 "사용"을 끄면 칸 고르기에서 빠진다.
import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Checkbox, Field, Select, TextInput } from '../../components/Field.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { SHIFT_COLORS, SHIFT_COLOR_LABELS, rosterDateLabel, saveShiftTypesSchema, shiftTimeText, type RosterCell, type RosterCellResult, type ShiftColor, type ShiftType } from '../../../../shared/schemas/roster.ts';
import { shiftChipClass } from './rosterLib.ts';

/** 오류를 화면 문구로(서버 한국어 문구 그대로, 없으면 기본 문구) */
export function rosterError(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

interface CellPickProps {
  target: { userId: number; name: string; date: string; cell: RosterCell | undefined } | null;
  types: readonly ShiftType[];
  onClose: () => void;
  onSaved: (r: RosterCellResult, label: string) => void;
}

/** 칸 근무 유형 고르기 */
export function CellPickDialog({ target, types, onClose, onSaved }: CellPickProps) {
  const [saving, setSaving] = useState<number | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = target?.cell?.shiftTypeId ?? null;
  const leave = target?.cell?.leave;

  const save = async (shiftTypeId: number | null, label: string) => {
    if (!target) return;
    setSaving(shiftTypeId ?? 'clear');
    setError(null);
    try {
      const r = await api.put<RosterCellResult>('/api/roster/cell', { userId: target.userId, date: target.date, shiftTypeId });
      onSaved(r, label);
    } catch (err) {
      setError(rosterError(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setSaving(null);
    }
  };

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <Dialog open={target !== null} onClose={close} title={target ? `${target.name} · ${rosterDateLabel(target.date)}` : '근무 고르기'}>
      <p className="muted" id="roster-pick-help">
        근무 유형을 누르면 바로 저장돼요.
      </p>
      {leave ? (
        <p className="form-note" data-testid="roster-pick-leave">
          승인된 {leave.label}가 있는 날이에요. 근무표에는 {leave.fullDay ? `"${leave.label}"가 먼저 보이고 근무 인원에서 빠져요` : '근무와 함께 보여요'}. 휴가는 연차·휴가 화면에서 바꿔요.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="roster-pick" role="group" aria-label="근무 유형" aria-describedby="roster-pick-help">
        {types
          .filter((t) => t.active)
          .map((t) => (
            <button key={t.id} type="button" aria-pressed={current === t.id} disabled={saving !== null} onClick={() => void save(t.id, t.label)}>
              <span className={shiftChipClass(t.colorToken)}>{t.label}</span>
              <small>{shiftTimeText(t) || (t.countsAsWork ? '시간 없음' : '근무 인원에 안 셈')}</small>
            </button>
          ))}
        <button type="button" className="clear" aria-pressed={false} disabled={saving !== null || (current === null && !leave)} onClick={() => void save(null, '빈칸')}>
          <b>비우기</b>
          <small>근무 유형 지우기</small>
        </button>
      </div>
    </Dialog>
  );
}

interface TypeRow {
  key: string;
  id?: number;
  label: string;
  startTime: string;
  endTime: string;
  colorToken: ShiftColor;
  countsAsWork: boolean;
  active: boolean;
}

function toRows(types: readonly ShiftType[]): TypeRow[] {
  return types.map((t) => ({
    key: `t${t.id}`,
    id: t.id,
    label: t.label,
    startTime: t.startTime ?? '',
    endTime: t.endTime ?? '',
    colorToken: t.colorToken,
    countsAsWork: t.countsAsWork,
    active: t.active,
  }));
}

const COLOR_OPTIONS = SHIFT_COLORS.map((c) => ({ value: c, label: SHIFT_COLOR_LABELS[c] }));

interface ShiftTypesProps {
  open: boolean;
  types: readonly ShiftType[];
  onClose: () => void;
  onSaved: (types: ShiftType[]) => void;
}

/** 근무 유형 관리 */
export function ShiftTypesDialog({ open, types, onClose, onSaved }: ShiftTypesProps) {
  const [rows, setRows] = useState<TypeRow[]>(() => toRows(types));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seq, setSeq] = useState(0);

  const patch = (key: string, p: Partial<TypeRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const add = () => {
    setRows((rs) => [...rs, { key: `n${seq}`, label: '', startTime: '', endTime: '', colorToken: 'info', countsAsWork: true, active: true }]);
    setSeq((n) => n + 1);
  };

  const save = async () => {
    const payload = {
      items: rows.map((r) => ({
        ...(r.id !== undefined ? { id: r.id } : {}),
        label: r.label,
        startTime: r.startTime.trim() || null,
        endTime: r.endTime.trim() || null,
        colorToken: r.colorToken,
        countsAsWork: r.countsAsWork,
        active: r.active,
      })),
    };
    const parsed = saveShiftTypesSchema.safeParse(payload);
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[i.path.join('.')] ??= i.message;
      setFields(f);
      setError(Object.keys(f).some((k) => k.split('.').length > 2) ? '빨간 글자로 표시한 칸을 고쳐 주세요.' : (Object.values(f)[0] ?? '입력값을 확인해 주세요.'));
      return;
    }
    setSaving(true);
    setFields({});
    setError(null);
    try {
      const saved = await api.put<ShiftType[]>('/api/shift-types', parsed.data);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(rosterError(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setSaving(false);
    }
  };

  const fieldErr = (idx: number, name: string) => fields[`items.${idx}.${name}`] ?? null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="근무 유형 관리"
      wide
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            저장하기
          </Button>
        </>
      }
    >
      <p className="muted">시간이 없는 유형(휴무 등)은 시작·끝 시각을 비워 두세요. 쓰지 않는 유형은 "사용"을 끄면 칸 고르기에서 빠지고, 지난 근무표에는 그대로 남아요.</p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="roster-types" data-testid="shift-types">
        {rows.map((r, idx) => (
          <div className="row" key={r.key} role="group" aria-label={`근무 유형 ${idx + 1}${r.label ? ` ${r.label}` : ''}`}>
            <Field label="이름" error={fieldErr(idx, 'label')} required>
              <TextInput value={r.label} maxLength={10} onChange={(e) => patch(r.key, { label: e.target.value })} />
            </Field>
            <Field label="시작 시각" error={fieldErr(idx, 'startTime')}>
              <TextInput type="time" value={r.startTime} onChange={(e) => patch(r.key, { startTime: e.target.value })} />
            </Field>
            <Field label="끝 시각" error={fieldErr(idx, 'endTime')}>
              <TextInput type="time" value={r.endTime} onChange={(e) => patch(r.key, { endTime: e.target.value })} />
            </Field>
            <Field label="색">
              <Select value={r.colorToken} options={COLOR_OPTIONS} onChange={(e) => patch(r.key, { colorToken: e.target.value as ShiftColor })} />
            </Field>
            <Checkbox label="인원에 셈" checked={r.countsAsWork} onChange={(e) => patch(r.key, { countsAsWork: e.target.checked })} />
            <Checkbox label="사용" checked={r.active} onChange={(e) => patch(r.key, { active: e.target.checked })} />
          </div>
        ))}
      </div>
      <div>
        <Button icon="plus" size="sm" onClick={add} disabled={rows.length >= 20}>
          유형 추가
        </Button>
      </div>
    </Dialog>
  );
}
