// 이 파일이 하는 일: "전화 응대 스크립트" 화면(/desk/script, FR-042). 상황과 말투를 고르면 AI(script)가 병원 정보(진료시간·점심·휴진·주차·위치·보험 안내)를
// 자동으로 넣은 응대 스크립트를 만든다(AC1·AC2). 결과는 복사하거나 스크립트 보관함에 저장하고, 보관함은 검색·분류로 찾는다(AC3).
// 병원 정보는 서버가 프롬프트에 넣으므로 화면은 "자동으로 들어가는 값"을 보여 주기만 한다. 고치는 곳은 병원 정보 화면(/admin/clinic, 관리자)이다.
import { useState } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Checkbox, Field, Select, TextInput } from '../../components/Field.tsx';
import { useToast } from '../../components/Toast.tsx';
import type { AiResultView } from '../../lib/ai.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { clinicFacts, SCRIPT_CUSTOM, SCRIPT_SITUATIONS, SCRIPT_TONES } from '../../../../shared/desk-texts.ts';
import { errorText, SavedTextLibrary, saveText, stripDemo, useClinic } from './scriptLib.tsx';
import './script-ai.css';

/** 병원 정보 중 스크립트에 들어가는 값 요약 */
function ClinicFacts({ isAdmin }: { isAdmin: boolean }) {
  const clinic = useClinic();
  if (!clinic.data) return <p className="desk-note">병원 정보를 불러오는 중이에요…</p>;
  const f = clinicFacts(clinic.data);
  const rows: Array<[string, string]> = [
    ['진료시간', f.hours],
    ['점심시간', f.lunch],
    ['휴진', f.holiday || '적지 않음'],
    ['주차', f.parking || '적지 않음'],
    ['위치·교통', f.location || '적지 않음'],
    ['보험 안내', f.insurance || '적지 않음'],
  ];
  return (
    <div className="clinic-facts" data-testid="clinic-facts">
      <div className="head">
        <b>스크립트에 자동으로 들어가는 병원 정보</b>
        {isAdmin ? (
          <Button size="sm" variant="ghost" to="/admin/clinic">
            병원 정보 고치기
          </Button>
        ) : null}
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 전화 응대 스크립트 */
export default function ScriptPage() {
  const toast = useToast();
  const { info } = useSession();
  const role = info?.user?.role;
  const canShare = can(role, 'savedtexts.shared.edit');
  const [situation, setSituation] = useState<string>(SCRIPT_SITUATIONS[0]);
  const [custom, setCustom] = useState('');
  const [tone, setTone] = useState<string>(SCRIPT_TONES[0]);
  const [share, setShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFor, setSavedFor] = useState<number | null>(null);
  // 결과를 만들 때 고른 상황·말투(결과가 나온 뒤 고르기를 바꿔도 저장은 만든 때 기준)
  const [madeWith, setMadeWith] = useState<{ situation: string; category: string; tone: string } | null>(null);

  const isCustom = situation === SCRIPT_CUSTOM;
  const situationText = isCustom ? custom.trim() : situation;

  /** 결과를 보관함에 저장 */
  const save = async (r: AiResultView) => {
    setSaving(true);
    try {
      const made = madeWith ?? { situation: situationText, category: isCustom ? '기타' : situation, tone };
      await saveText({
        kind: 'script',
        category: made.category,
        title: `${made.situation || '응대'} 스크립트`.slice(0, 100),
        body: stripDemo(r.text),
        meta: { situation: made.situation, tone: made.tone },
        shared: canShare && share,
      });
      setSavedFor(r.requestId);
      toast.show('스크립트 보관함에 저장했어요.');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="전화 응대 스크립트" summary="상황과 말투를 고르면 병원 정보를 넣은 응대 스크립트를 만들어 드려요. 복사하거나 보관함에 저장해 두세요." />
      <div className="desk-cols">
        <Card title="스크립트 만들기" id="script-make">
          <div className="desk-form">
            <div className="desk-row">
              <Field label="상황">
                <Select value={situation} onChange={(e) => setSituation(e.target.value)}>
                  {SCRIPT_SITUATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={SCRIPT_CUSTOM}>{SCRIPT_CUSTOM}</option>
                </Select>
              </Field>
              <Field label="말투">
                <Select value={tone} onChange={(e) => setTone(e.target.value)} options={SCRIPT_TONES.map((t) => ({ value: t, label: t }))} />
              </Field>
            </div>
            {isCustom ? (
              <Field label="상황 직접 적기" help="비워 두면 일반 문의 응대로 만들어요.">
                <TextInput value={custom} maxLength={200} placeholder="예: 진료비 영수증 재발급 문의" onChange={(e) => setCustom(e.target.value)} />
              </Field>
            ) : null}
            <ClinicFacts isAdmin={role === 'admin'} />
            <AiPanel
              feature="script"
              label="덧붙일 내용(선택)"
              rows={3}
              placeholder="예: 이번 주 토요일은 1시까지만 진료해요"
              allowEmpty
              buildInput={(extra) => ({ situation: situationText || '일반 문의', tone, ...(extra.trim() ? { extra: extra.trim() } : {}) })}
              runLabel="스크립트 만들기"
              onResult={() => {
                setSavedFor(null);
                setMadeWith({ situation: situationText, category: isCustom ? '기타' : situation, tone });
              }}
              resultActions={(r) => (
                <>
                  {canShare ? <Checkbox label="공용으로 저장" checked={share} onChange={(e) => setShare(e.target.checked)} /> : null}
                  <Button size="sm" icon={savedFor === r.requestId ? 'check' : 'plus'} loading={saving} disabled={savedFor === r.requestId} onClick={() => void save(r)}>
                    {savedFor === r.requestId ? '저장했어요' : '보관함에 저장'}
                  </Button>
                </>
              )}
            />
          </div>
        </Card>
        <Card title="스크립트 보관함" id="script-lib">
          <SavedTextLibrary kind="script" categories={[...SCRIPT_SITUATIONS, '기타']} emptyHint="만든 스크립트를 저장하면 여기에서 찾아 쓸 수 있어요." />
        </Card>
      </div>
    </>
  );
}
