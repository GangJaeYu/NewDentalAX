// 이 파일이 하는 일: AI 기능 "명세서 사진 읽기"(backend.md §4 receipt, FR-122)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사.
// 입력 {images[{mime, data(base64)}], note?} → 응답 JSON {vendorName, date, lines[{name, qty, unitPrice, amount}], total}. 사진 업로드 라우트(재고 모듈 receipt.routes.ts)가 이미지를 넘긴다.
// 데모 응답은 데모 seed(하늘숲치과)의 거래처·품목과 이름이 비슷한 예시 명세서라, 화면에서 품목 후보 연결까지 그대로 시험할 수 있다.
import { z } from 'zod';
import { baseSystem, demoJson, optionalText, jsonOnly, type AiFeatureModule } from './types.ts';

/** 사진 한 장 base64 글자 수 상한(8MB 사진의 base64 ≈ 10.7M자, 여유 포함) */
const MAX_BASE64 = 11_200_000;

const inputSchema = z.object({
  images: z
    .array(z.object({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(1).max(MAX_BASE64, '사진이 너무 커요. 8MB 이하로 줄여 주세요.') }))
    .min(1, '사진을 올려 주세요.')
    .max(3),
  note: optionalText(500, '메모'),
});

/** 숫자 칸: 숫자, 숫자 글자("6,500"), 없음(null)을 받아 숫자나 null로 맞춘다 */
const numberish = z.preprocess((v) => {
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s원]/g, ''));
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  }
  return v;
}, z.number().nullable().optional());

const outputSchema = z.object({
  vendorName: z.string().nullable(),
  date: z.string().nullable(),
  lines: z
    .array(
      z.object({
        name: z.string(),
        qty: numberish,
        unitPrice: numberish,
        amount: numberish,
      }),
    )
    .max(50),
  total: numberish,
});

export const receipt: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'receipt',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: [
        baseSystem(ctx),
        '치과 재료 거래명세서·영수증 사진에서 거래처 이름, 날짜(YYYY-MM-DD), 품목 줄(품목명·수량·단가·금액), 합계를 읽습니다.',
        '금액은 원 단위 숫자로만 적고 쉼표는 빼세요. 읽을 수 없는 값은 null로 둡니다. 사진에 없는 품목을 지어내지 마세요.',
        '카드번호·사람 이름·연락처는 옮겨 적지 마세요.',
        jsonOnly('{"vendorName":"...","date":"YYYY-MM-DD","lines":[{"name":"...","qty":1,"unitPrice":0,"amount":0}],"total":0}'),
      ].join('\n'),
      user: `명세서 사진을 읽어 주세요.${input.note ? `\n메모: ${input.note}` : ''}`,
      images: input.images,
    };
  },
  demo(_input, ctx) {
    // 데모 seed의 "한빛덴탈"·"니트릴 글러브 M"·"석션 팁 (일회용)"·"거즈 2×2"와 비슷한 이름으로 적는다
    return demoJson({
      vendorName: '한빛덴탈',
      date: ctx.today,
      lines: [
        { name: '니트릴 글러브 M (100매)', qty: 10, unitPrice: 8400, amount: 84000 },
        { name: '석션팁 일회용', qty: 5, unitPrice: 4200, amount: 21000 },
        { name: '거즈 2x2 (200매)', qty: 4, unitPrice: 3200, amount: 12800 },
      ],
      total: 117800,
    });
  },
};
