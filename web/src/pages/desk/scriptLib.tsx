// 이 파일이 하는 일: 데스크 AI 화면 셋(전화 응대 스크립트·리뷰 답글·문자/안내문 템플릿)이 함께 쓰는 부품과 도우미를 둔다.
// - 보관함 목록(SavedTextLibrary): 제목·본문·분류 검색, 분류 거르기, 복사, 불러오기(템플릿), 지우기(내 문구 또는 공용 문구를 실장 이상이)
// - 보관 문구 저장 API 도우미, 병원 정보 읽기(GET /api/settings/clinic, 병원 정보 화면과 같은 key), 데모 표시 떼기
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../../components/Button.tsx';
import { Chip } from '../../components/Chip.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Select } from '../../components/Field.tsx';
import { AsyncView, EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { SearchInput, Toolbar } from '../../components/Toolbar.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import type { ClinicSettings } from '../../../../shared/schemas/admin.ts';
import { SAVED_TEXT_KIND_LABELS, type SavedText, type SavedTextKind } from '../../../../shared/desk-texts.ts';

/** 보관함 데이터 key(저장·삭제 뒤 이 key로 다시 불러온다) */
export const savedKey = (kind: SavedTextKind) => `desk:saved:${kind}`;

/** 병원 정보(병원 정보 화면 /admin/clinic과 같은 key라 거기서 고치면 함께 새로 읽힌다) */
export function useClinic() {
  return useApi<ClinicSettings>('admin:clinic', () => api.get('/api/settings/clinic'));
}

/** AI 데모 응답 앞의 "[데모 응답]" 표시와 그 뒤 빈칸을 뗀다(보관·편집할 글에는 넣지 않음) */
export function stripDemo(text: string): string {
  return text.replace(/^\s*\[데모 응답\]\s*/, '');
}

/** 새 보관 문구 입력 */
export interface SaveTextInput {
  kind: SavedTextKind;
  category: string;
  title: string;
  body: string;
  meta?: Record<string, string | string[] | null>;
  shared?: boolean;
}

/** 보관 문구를 저장한다(새로 만들기). 실패하면 화면에 보일 한국어 문구를 담은 오류를 던진다 */
export async function saveText(input: SaveTextInput): Promise<SavedText> {
  const saved = await api.post<SavedText>('/api/saved-texts', input);
  invalidate(savedKey(input.kind));
  return saved;
}

/** 오류를 화면 문구로 */
export function errorText(e: unknown, fallback = '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'): string {
  if (e instanceof ApiError) {
    const field = e.fields ? Object.values(e.fields)[0] : undefined;
    return field ?? e.message;
  }
  return fallback;
}

interface LibraryProps {
  kind: SavedTextKind;
  /** 분류 고르기 목록의 추천값(저장된 분류도 함께 보인다) */
  categories: readonly string[];
  /** 복사할 글로 바꾸기(템플릿은 병원 정보 치환 뒤 글) */
  copyText?: (t: SavedText) => string;
  /** 항목마다 덧붙일 버튼(템플릿의 "불러오기" 등) */
  extraActions?: (t: SavedText) => ReactNode;
  /** 빈 보관함 안내 */
  emptyHint: string;
}

/** 보관함 목록(검색·분류·복사·지우기) */
export function SavedTextLibrary({ kind, categories, copyText, extraActions, emptyHint }: LibraryProps) {
  const toast = useToast();
  const state = useApi<SavedText[]>(savedKey(kind), () => api.get(`/api/saved-texts?kind=${kind}`));
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [removing, setRemoving] = useState<SavedText | null>(null);

  const allCategories = useMemo(() => {
    const set = new Set<string>(categories);
    for (const t of state.data ?? []) set.add(t.category);
    return [...set];
  }, [categories, state.data]);

  const rows = useMemo(() => {
    const word = q.trim().toLowerCase();
    return (state.data ?? []).filter(
      (t) => (!category || t.category === category) && (!word || t.title.toLowerCase().includes(word) || t.body.toLowerCase().includes(word) || t.category.toLowerCase().includes(word)),
    );
  }, [state.data, q, category]);

  const remove = async () => {
    if (!removing) return;
    try {
      await api.del(`/api/saved-texts/${removing.id}`);
      invalidate(savedKey(kind));
      toast.show('보관함에서 지웠어요.');
    } catch (e) {
      toast.error(errorText(e, '지우지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
    } finally {
      setRemoving(null);
    }
  };

  const label = SAVED_TEXT_KIND_LABELS[kind];
  return (
    <div className="saved-lib">
      <Toolbar label={`${label} 보관함 도구`}>
        <SearchInput label={`${label} 검색`} placeholder="제목·내용·분류로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="분류 거르기" value={category} onChange={(e) => setCategory(e.target.value)} className="saved-cat">
          <option value="">모든 분류</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Toolbar>
      <AsyncView state={state} isEmpty={(d) => d.length === 0} empty={<EmptyState icon="inbox" title="아직 보관한 글이 없어요" description={emptyHint} />} skeletonRows={3}>
        {() =>
          rows.length === 0 ? (
            <EmptyState icon="search" title="찾는 글이 없어요" description="검색어나 분류를 바꿔 보세요." />
          ) : (
            <ul className="saved-list" aria-label={`${label} 보관함`}>
              {rows.map((t) => (
                <li key={t.id} data-testid="saved-item">
                  <div className="saved-head">
                    <b>{t.title}</b>
                    <Chip tone="info">{t.category}</Chip>
                    {t.shared ? <Chip tone="ok">공용</Chip> : <Chip>내 보관함</Chip>}
                  </div>
                  <p className="saved-body">{t.body}</p>
                  <div className="saved-foot">
                    <small className="num">
                      {t.createdBy.name} · {formatDateTime(t.updatedAt)}
                    </small>
                    <span className="grow" />
                    {extraActions?.(t)}
                    <CopyButton text={copyText ? copyText(t) : t.body} />
                    {t.canEdit ? (
                      <Button size="sm" variant="ghost" icon="close" onClick={() => setRemoving(t)} aria-label={`${t.title} 지우기`}>
                        지우기
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="보관함에서 지울까요?"
        message={removing ? `"${removing.title}"을(를) 보관함에서 지워요.${removing.shared ? ' 공용 문구라 모든 직원의 보관함에서 사라져요.' : ''}` : ''}
        confirmLabel="지우기"
        danger
      />
    </div>
  );
}
