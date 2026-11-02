// 이 파일이 하는 일: 올린 자료 파일(txt·md·pdf·docx)에서 글을 꺼낸다(FR-070 AC1, overview §3.5). pdf는 unpdf, docx는 mammoth를 쓴다.
// 꺼내지 못하면 ExtractError에 쉬운 한국어 이유를 담아 던진다(손상된 파일·암호 PDF·글자 없는 스캔 PDF 등). 서비스는 이 이유를 kb_docs.error에 남긴다.
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

/** 꺼낼 수 있는 글의 최대 글자 수(이보다 길면 나눠서 올리게 한다) */
export const MAX_TEXT_CHARS = 300_000;

/** 글 꺼내기 실패(message는 화면에 그대로 보여 줄 쉬운 한국어) */
export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

/** 줄바꿈을 \n으로 맞추고, 줄 끝 공백과 세 줄 넘는 빈 줄을 정리한다 */
export function tidyText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00A0]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 글 파일(UTF-8)을 읽는다 */
function decodeText(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new ExtractError('글 파일을 읽지 못했어요. UTF-8로 저장한 파일인지 확인해 주세요.');
  }
}

/** PDF에서 글을 꺼낸다(쪽마다 빈 줄로 잇는다) */
async function pdfText(data: Buffer): Promise<string> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 });
    const r = await extractText(pdf, { mergePages: false });
    pages = Array.isArray(r.text) ? r.text : [String(r.text)];
  } catch (e) {
    const name = (e as { name?: string }).name ?? '';
    if (name === 'PasswordException') throw new ExtractError('암호가 걸린 PDF는 읽을 수 없어요. 암호를 푼 파일을 올려 주세요.');
    throw new ExtractError('PDF 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요. 원본 파일을 다시 저장해서 올려 주세요.');
  }
  return pages.join('\n\n');
}

/** DOCX에서 글을 꺼낸다 */
async function docxText(data: Buffer): Promise<string> {
  try {
    const r = await mammoth.extractRawText({ buffer: data });
    return r.value;
  } catch {
    throw new ExtractError('DOCX 파일을 읽지 못했어요. 파일이 손상됐을 수 있어요. 워드에서 다시 저장해서 올려 주세요.');
  }
}

/**
 * 확장자(점 포함, 소문자)에 맞게 글을 꺼내 정리한다. 글자가 없거나 너무 길면 ExtractError.
 * 예: extractKbText('.md', Buffer.from('# 규정\n내용')) → '# 규정\n내용'
 */
export async function extractKbText(ext: string, data: Buffer): Promise<string> {
  let raw: string;
  if (ext === '.txt' || ext === '.md') raw = decodeText(data);
  else if (ext === '.pdf') raw = await pdfText(data);
  else if (ext === '.docx') raw = await docxText(data);
  else throw new ExtractError('이 형식은 글을 꺼낼 수 없어요. TXT·MD·PDF·DOCX 파일을 올려 주세요.');
  const text = tidyText(raw);
  if (!text) {
    throw new ExtractError(
      ext === '.pdf' ? '파일에서 글자를 찾지 못했어요. 사진으로 스캔한 PDF는 글자를 읽을 수 없어요.' : '파일에서 글자를 찾지 못했어요. 내용이 있는 파일을 올려 주세요.',
    );
  }
  if (text.length > MAX_TEXT_CHARS) throw new ExtractError(`글이 너무 길어요(최대 ${MAX_TEXT_CHARS.toLocaleString('ko-KR')}자). 여러 파일로 나눠서 올려 주세요.`);
  return text;
}
