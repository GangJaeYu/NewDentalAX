// 이 파일이 하는 일: AI 기능 "명세서 사진 읽기"(backend.md §4 receipt)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사 기본형.
// 입력 {images[{mime, data(base64)}], note?} → 응답 JSON {vendorName, date, lines[{name, qty, unitPrice, amount}], total}. 사진 업로드 라우트(재고 모듈)가 이미지를 넘긴다.
import { z } from 'zod';
import { baseSystem, demoJson, jsonOnly, optionalText, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  images: z
    .array(z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(1).max(8_000_000) }))
    .min(1, '사진을 올려 주세요.')
    .max(3),
  note: optionalText(500, '메모'),
});
const outputSchema = z.object({
  vendorName: z.string().nullable(),
  date: z.string().nullable(),
  lines: z.array(
    z.object({ name: z.string(), qty: z.number().nullable().optional(), unitPrice: z.number().nullable().optional(), amount: z.number().nullable().optional() }),
  ),
  total: z.number().nullable(),
});

export const receipt: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'receipt',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n거래명세서 사진에서 거래처 이름, 날짜(YYYY-MM-DD), 품목 줄, 합계를 읽습니다. 읽을 수 없는 값은 null로 둡니다.\n${jsonOnly('{"vendorName":"...","date":"YYYY-MM-DD","lines":[{"name":"...","qty":1,"unitPrice":0,"amount":0}],"total":0}')}`,
      user: `명세서 사진을 읽어 주세요.${input.note ? `\n메모: ${input.note}` : ''}`,
      images: input.images,
    };
  },
  demo(_input, ctx) {
    return demoJson({
      vendorName: '[데모 응답] 하늘치재상사',
      date: ctx.today,
      lines: [
        { name: '일회용 장갑(M) 100매', qty: 10, unitPrice: 6500, amount: 65000 },
        { name: '석션팁 100개', qty: 5, unitPrice: 4000, amount: 20000 },
      ],
      total: 85000,
    });
  },
};
