// 이 파일이 하는 일: 입력란 묶음 Field(레이블·도움말·오류·필수 표시)와 입력 부품(TextInput·PasswordInput·TextArea·Select·DateInput·NumberInput·Checkbox).
// 레이블은 htmlFor로 입력과 연결하고, 도움말·오류는 aria-describedby로 이어 화면 읽기 프로그램이 함께 읽게 한다(NFR-007 AC3).
// 아이디는 React useId로 만든다(http 환경이라 crypto.randomUUID는 쓰지 않음).
import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon.tsx';

interface FieldCtx {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}
const Ctx = createContext<FieldCtx | null>(null);

interface FieldProps {
  label: ReactNode;
  /** 입력 아래 작은 도움말 */
  help?: ReactNode;
  /** 오류 문구(있으면 빨간 글씨 + aria-invalid) */
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** 레이블·도움말·오류를 입력란과 연결한다. 안에 TextInput 등 입력 부품을 하나 넣는다 */
export function Field({ label, help, error, required = false, children, className }: FieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, helpId].filter(Boolean).join(' ') || undefined;
  return (
    <Ctx.Provider value={{ id, describedBy, invalid: !!error, required }}>
      <div className={['field', className].filter(Boolean).join(' ')}>
        <label htmlFor={id}>
          {label}
          {required ? (
            <span className="req" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
        {children}
        {error ? (
          <span className="err" id={errId}>
            <Icon name="alert" size="sm" />
            {error}
          </span>
        ) : null}
        {help ? (
          <span className="help" id={helpId}>
            {help}
          </span>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}

/** Field 안이면 id·aria 속성을 붙인다 */
function useFieldProps() {
  const f = useContext(Ctx);
  if (!f) return {};
  return {
    id: f.id,
    'aria-describedby': f.describedBy,
    'aria-invalid': f.invalid || undefined,
    required: f.required || undefined,
  };
}

/** 한 줄 글 입력 */
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...useFieldProps()} {...props} />;
}

/** 비밀번호 입력 */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="password" {...useFieldProps()} {...props} />;
}

/** 여러 줄 글 입력 */
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...useFieldProps()} {...props} />;
}

/** 고르기 목록. options를 주거나 children으로 option을 넣는다 */
export function Select({ options, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options?: ReadonlyArray<{ value: string; label: string }> }) {
  return (
    <select {...useFieldProps()} {...props}>
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );
}

/** 날짜 입력(YYYY-MM-DD) */
export function DateInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="date" {...useFieldProps()} {...props} />;
}

/** 숫자 입력(휴대폰에서 숫자 자판) */
export function NumberInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="number" inputMode="decimal" className="num" {...useFieldProps()} {...props} />;
}

/** 체크 상자 + 설명 */
export function Checkbox({ label, hint, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="checkline">
      <input type="checkbox" {...props} />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}
