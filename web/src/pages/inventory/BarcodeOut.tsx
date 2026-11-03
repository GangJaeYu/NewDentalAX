// 이 파일이 하는 일: 재고 화면의 "바코드로 출고" 칸(FR-130, phase-06-task-01). USB 바코드 스캐너는 키보드처럼 글자를 빠르게 치고 Enter를 누르므로,
// 입력란에서 Enter가 오면 그 바코드의 품목을 찾아 출고 대화상자(QuickOutDialog)를 수량 1로 연다. 저장하거나 닫으면 입력란을 비우고 다시 그곳에 커서를 둔다.
// 휴대폰은 "사진으로 찾기"로 카메라 사진을 받아(<input type="file" accept="image/*" capture="environment">) 이 기기 안에서 해독한다(barcodeDecode.ts).
// http 원내 주소에서는 실시간 카메라를 쓸 수 없어서(TD-017) 사진만 받는다. 없는 바코드·못 읽은 사진은 쉬운 안내를 보여 준다.
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { normalizeBarcode, type ItemRow } from '../../../../shared/schemas/inventory.ts';
import { messageOf } from './inventory-ui.tsx';
import { QuickOutDialog } from './QuickOutDialog.tsx';
import './barcode.css';

/** 안내 한 줄(종류에 따라 색과 아이콘이 다르다) */
interface Notice {
  tone: 'info' | 'error';
  text: string;
}

/** 바코드로 품목을 찾는다. 없으면 null, 그 밖의 오류는 던진다 */
async function findByBarcode(code: string): Promise<ItemRow | null> {
  try {
    return await api.get<ItemRow>(`/api/items/by-barcode?code=${encodeURIComponent(code)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** 바코드 입력란 + 사진으로 찾기 + 찾은 품목 출고 대화상자 */
export function BarcodeOut() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [item, setItem] = useState<ItemRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 바코드 글자로 품목을 찾아 출고 대화상자를 연다 */
  const lookup = async (raw: string) => {
    const value = normalizeBarcode(raw);
    if (!value) {
      setNotice({ tone: 'error', text: '바코드를 찍거나 숫자를 입력한 뒤 Enter를 눌러 주세요.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const found = await findByBarcode(value);
      if (!found) {
        setNotice({ tone: 'error', text: `"${value}" 바코드로 등록된 품목이 없어요. 실장님께 품목 수정에서 바코드를 넣어 달라고 해 주세요.` });
        inputRef.current?.select();
      } else if (!found.active) {
        setNotice({ tone: 'error', text: `${found.name}은(는) "사용 안 함" 품목이라 출고할 수 없어요.` });
        inputRef.current?.select();
      } else {
        setItem(found);
      }
    } catch (err) {
      setNotice({ tone: 'error', text: messageOf(err, '품목을 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.') });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void lookup(code);
  };

  /** 사진을 고르면 이 기기에서 해독한 뒤 같은 방법으로 찾는다 */
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 같은 사진을 다시 골라도 change가 오도록 비워 둔다
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice({ tone: 'error', text: '사진 파일만 고를 수 있어요. 바코드를 찍은 사진을 골라 주세요.' });
      return;
    }
    setBusy(true);
    setNotice({ tone: 'info', text: '사진에서 바코드를 읽는 중이에요…' });
    try {
      // 해독기는 필요할 때만 불러온다(첫 화면을 가볍게)
      const { decodeImageFile } = await import('./barcodeDecode.ts');
      const r = await decodeImageFile(file);
      if (!r) {
        setNotice({ tone: 'error', text: '사진에서 바코드를 찾지 못했어요. 바코드가 화면 가운데에 크고 또렷하게 나오도록 다시 찍어 주세요.' });
        setBusy(false);
        return;
      }
      setCode(r.text);
      setBusy(false);
      await lookup(r.text);
    } catch (err) {
      setNotice({ tone: 'error', text: messageOf(err, '사진을 읽지 못했어요. 다시 찍어 주세요.') });
      setBusy(false);
    }
  };

  /** 출고 대화상자를 닫으면 다음 스캔을 바로 받도록 입력란을 비우고 커서를 둔다 */
  const closeDialog = () => {
    setItem(null);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <section className="card pad bc-out" aria-labelledby="bc-out-title">
      <div className="body">
        <form className="bc-row" onSubmit={submit} aria-label="바코드로 출고" noValidate>
          <div className="bc-field">
            <label id="bc-out-title" htmlFor="bc-out-input" className="bc-label">
              <Icon name="box" size="sm" />
              바코드로 출고
            </label>
            <input
              ref={inputRef}
              id="bc-out-input"
              className="input"
              type="text"
              inputMode="text"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={200}
              placeholder="스캐너로 찍거나 숫자 입력 후 Enter"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-describedby="bc-out-help"
            />
          </div>
          <div className="bc-actions">
            <Button type="submit" icon="search" loading={busy}>
              찾기
            </Button>
            <label className="btn bc-photo">
              <Icon name="upload" size="sm" />
              사진으로 찾기
              <input type="file" className="sr-only" accept="image/*" capture="environment" onChange={(e) => void onPhoto(e)} disabled={busy} data-testid="barcode-photo" />
            </label>
          </div>
        </form>
        <p id="bc-out-help" className="bc-help muted">
          입력란을 누른 뒤 스캐너로 찍으면 그 품목의 출고 창이 수량 1로 열려요. 휴대폰은 &quot;사진으로 찾기&quot;로 바코드를 찍어 주세요.
        </p>
        {notice ? (
          <p className={notice.tone === 'error' ? 'form-error bc-notice' : 'form-note bc-notice'} role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="barcode-notice">
            <Icon name={notice.tone === 'error' ? 'alert' : 'search'} size="md" />
            {notice.text}
          </p>
        ) : null}
      </div>
      <QuickOutDialog open={!!item} item={item} onClose={closeDialog} />
    </section>
  );
}

export default BarcodeOut;
