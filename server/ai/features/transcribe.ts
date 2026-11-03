// 이 파일이 하는 일: AI 기능 "회의 녹음 받아쓰기"(FR-132, phase-06-task-03)의 입력 검사·받아쓰기 안내 글·데모 받아쓰기 글을 둔다.
// http에서는 마이크를 쓸 수 없어서(TD-017) 휴대폰 녹음 앱 파일을 올려 받는다. 실제 받아쓰기 호출·비용 기록은 server/ai/transcribe.ts가 한다.
// 입력은 서버가 받은 녹음 바이트(Buffer)라서 JSON으로 보내는 /api/ai/run으로는 이 기능을 쓸 수 없다(입력 검사에서 막힌다).
// 데모 받아쓰기 글은 환자 이야기가 없는 직원 회의 예시이고, 회의록 요약(minutes) 데모가 결정 사항·할 일을 나눌 수 있는 문장으로 썼다.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  /** 녹음 바이트(서버 안에서만 만든다) */
  audio: z.custom<Buffer>((v) => Buffer.isBuffer(v), { message: '녹음 파일은 회의록 화면에서 올려 주세요.' }),
  /** 보낼 형식(예: audio/m4a) */
  mime: z.string().min(1).max(100),
  /** 원래 파일 이름(공급자에게 보내는 이름표용) */
  name: z.string().max(200).default('meeting.m4a'),
});
export type TranscribeInput = z.output<typeof inputSchema>;

/** 받아쓰기 공급자에게 주는 회의 맥락(OpenAI prompt·Gemini 안내). 낱말을 알려 주면 치과 용어를 더 잘 받아쓴다 */
export const TRANSCRIBE_CONTEXT = '치과 원내 직원 회의 녹음입니다. 자주 나오는 말: 예약, 데스크, 치과위생사, 치과조무사, 실장, 원장, 스케일링, 멸균, 인수인계, 재고, 공지.';

/** 데모 받아쓰기 글(환자 정보 없음). 첫 줄에 데모 표시를 붙인다 */
export const DEMO_TRANSCRIPT = [
  `${DEMO_MARK} 예시 회의 녹음을 받아쓴 글입니다. 실제 녹음 내용이 아니에요.`,
  '실장: 이번 주 직원 회의 시작할게요. 먼저 오전 예약 이야기부터 해요.',
  '데스크: 오전에 예약이 몰려서 대기 시간이 길다는 말이 많아요.',
  '원장: 그럼 다음 주부터 오전 예약 간격을 30분으로 바꾸기로 하죠.',
  '치과위생사: 멸균실 소독 기록지도 새 양식으로 확정하면 좋겠어요.',
  '실장: 예약 안내 문자 문구는 데스크 담당으로 11월 6일까지 고쳐 주세요.',
  '치과위생사: 스케일링 기구 재고는 제가 11월 7일까지 확인할게요.',
  '치과조무사: 다음 주 대청소 준비물은 11월 10일까지 챙기겠습니다.',
  '원장: 오늘 정한 내용은 공지에도 올려 주세요. 수고하셨습니다.',
].join('\n');

export const transcribe: AiFeatureModule<TranscribeInput> = {
  id: 'transcribe',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: [
        baseSystem(ctx),
        '회의 녹음을 들리는 그대로 한국어로 받아씁니다. 요약하거나 내용을 지어내지 않습니다.',
        '말하는 사람이 바뀌면 줄을 바꿉니다. 직무(데스크·실장·원장 등)를 알 수 있으면 줄 앞에 "직무: "를 붙이고, 모르면 붙이지 않습니다.',
        '환자 이름·전화번호·주민등록번호 같은 개인정보가 들리면 받아쓰지 말고 [가림]으로 적습니다.',
        TRANSCRIBE_CONTEXT,
      ].join('\n'),
      user: `이 회의 녹음(${input.name})을 받아써 주세요. 받아쓴 글만 답합니다.`,
    };
  },
  demo() {
    return DEMO_TRANSCRIPT;
  },
};
