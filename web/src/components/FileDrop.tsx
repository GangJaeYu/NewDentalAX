// 이 파일이 하는 일: 파일 올리기 칸(끌어다 놓기 + 눌러서 고르기). 보내기 전에 확장자·크기를 검사하고(lib/image.ts checkFile),
// shrinkPhotos를 켜면 사진을 긴 변 1600px 이하로 줄인 뒤 onFiles로 넘긴다. 문제가 있으면 칸 아래에 이유를 보여 준다.
import { useId, useState, type DragEvent } from 'react';
import { checkFile, formatBytes, isImageFile, shrinkImage, type FileRule } from '../lib/image.ts';
import { Icon } from './Icon.tsx';

interface FileDropProps extends FileRule {
  /** 칸 안 안내(예: "명세서 사진을 끌어다 놓거나 눌러서 고르세요") */
  label: string;
  /** 검사를 통과한(필요하면 줄인) 파일들 */
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  /** 사진을 줄여서 넘길지 */
  shrinkPhotos?: boolean;
}

/** 파일 놓기 칸 */
export function FileDrop({ label, onFiles, accept, maxBytes, multiple = false, shrinkPhotos = false }: FileDropProps) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list).slice(0, multiple ? undefined : 1);
    for (const f of files) {
      const why = checkFile(f, { accept, maxBytes });
      if (why) {
        setError(`${f.name}: ${why}`);
        return;
      }
    }
    setError(null);
    const out: File[] = [];
    for (const f of files) {
      if (shrinkPhotos && isImageFile(f)) {
        const blob = await shrinkImage(f);
        out.push(blob === f ? f : new File([blob], f.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
      } else out.push(f);
    }
    onFiles(out);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files);
  };

  return (
    <div className="field">
      <label
        htmlFor={id}
        className={['filedrop', over && 'over'].filter(Boolean).join(' ')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Icon name="upload" />
        <b>{label}</b>
        <span className="help">
          {accept.map((a) => a.slice(1).toUpperCase()).join('·')} · 최대 {formatBytes(maxBytes)}
        </span>
        <input
          id={id}
          className="sr-only"
          type="file"
          accept={accept.join(',')}
          multiple={multiple}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            void handle(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {error ? (
        <span className="err" id={`${id}-err`} role="alert">
          <Icon name="alert" size="sm" />
          {error}
        </span>
      ) : null}
    </div>
  );
}
