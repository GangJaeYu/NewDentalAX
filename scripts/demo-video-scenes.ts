// 이 파일이 하는 일: 시연 영상(scripts/demo-video.ts)의 장면 목록. 장면마다 제목·자막 문장·README 설명·화면 조작 순서를 적는다(영상에 음성은 없다).
// 화면 조작 선택자는 tests/e2e/*.spec.ts에서 가져왔다(가상 하늘숲치과 데모 데이터, 환자 정보 없음, AI는 데모 모드라 비용 0원).
// 실제 녹화·자막·영상 변환은 demo-video.ts가 하고, 여기서는 Demo 도우미(커서 이동·천천히 입력·머물기)만 부른다.
// 장면을 고치면 `node scripts/demo-video.ts --fast`로 빠르게 선택자만 확인한 뒤, 전체 실행으로 영상을 다시 만든다.
import type { Locator, Page } from '@playwright/test';

/** 장면이 쓰는 도우미(커서·자막이 보이게 천천히 조작한다). demo-video.ts가 만든다 */
export interface Demo {
  page: Page;
  /** 주소로 바로 가서 제목(h1)이 보일 때까지 기다린다 */
  go(path: string, heading: string | RegExp): Promise<void>;
  /** 왼쪽 주 메뉴에서 묶음 → 항목을 눌러 이동하고 제목(h1)을 기다린다(메뉴가 안 보이면 주소로 간다) */
  nav(group: string, item: string, heading: string | RegExp): Promise<void>;
  /** 커서를 대상까지 부드럽게 옮긴 뒤 누른다(물결 효과) */
  click(target: Locator): Promise<void>;
  /** 입력칸을 누르고 한 글자씩 천천히 입력한다 */
  type(target: Locator, text: string, opts?: { clear?: boolean }): Promise<void>;
  /** 커서를 대상 위로 옮겨 가리킨다(누르지 않음) */
  point(target: Locator): Promise<void>;
  /** 대상이 화면 가운데 오게 부드럽게 굴린다 */
  scrollTo(target: Locator): Promise<void>;
  /** 대상이 보일 때까지 기다린다 */
  see(target: Locator, timeoutMs?: number): Promise<void>;
  /** 화면이 바뀐 뒤 머문다(기본 1.5초) */
  dwell(ms?: number): Promise<void>;
  /** 지금 화면을 이 장면 그림으로 저장한다(자막·커서는 뺀다). 부르지 않으면 장면 끝 화면을 저장한다 */
  shot(): Promise<void>;
  /** 휴대폰 크기(390×844) 화면을 따로 찍어 녹화 화면 위에 휴대폰 모양으로 보여 준다 */
  showPhones(paths: string[]): Promise<void>;
  /** 화면 가운데 마무리 카드를 띄운다 */
  endCard(title: string, sub: string): Promise<void>;
  /** 시연용 파일 */
  files: { receiptPhoto: string; fakeM4a: () => Buffer };
}

/** 장면 하나 */
export interface DemoScene {
  /** 그림 파일 이름에 쓰는 짧은 영문 이름 */
  slug: string;
  /** 단계 제목(화면 메뉴 이름 그대로) */
  title: string;
  /** 자막 문장(한 문장씩 자막이 바뀐다, 두 줄 이내가 되게 약 70자 이하) */
  say: string[];
  /** README 설명(누가·언제·무엇을, 2~4줄) */
  doc: string[];
  run(d: Demo): Promise<void>;
}

const h1 = (page: Page, name: string | RegExp): Locator => page.getByRole('heading', { level: 1, name });
const card = (page: Page, title: string): Locator =>
  page
    .getByRole('region', { name: '오늘 현황' })
    .locator('article.card')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });

/** 시연 관리자 계정(가상) */
export const DEMO_ADMIN = { clinicName: '하늘숲치과', name: '김지현', username: 'demoadmin', password: 'Demo-Admin-2026' };

export const scenes: DemoScene[] = [
  {
    slug: 'setup',
    title: '첫 설정',
    say: ['처음 켜면 첫 설정 화면이 나옵니다.', '병원 이름과 관리자 계정을 적고, 연습용으로 데모 데이터 넣기에 체크한 뒤 시작합니다.'],
    doc: [
      '**누가·언제**: 원장님(관리자)이 서비스를 처음 켰을 때 한 번만 합니다.',
      '병원 이름, 관리자 이름, 아이디, 비밀번호를 적습니다.',
      '"데모 데이터 넣기"에 체크하면 가상의 하늘숲치과 예시 자료가 들어가서 바로 연습할 수 있습니다(나중에 관리 > 데모 데이터 초기화로 지울 수 있습니다).',
    ],
    async run(d) {
      const p = d.page;
      await d.see(h1(p, '첫 설정'));
      await d.dwell(800);
      await d.type(p.getByLabel('병원 이름'), DEMO_ADMIN.clinicName);
      await d.type(p.getByLabel('관리자 이름'), DEMO_ADMIN.name);
      await d.type(p.getByLabel('아이디'), DEMO_ADMIN.username);
      await d.type(p.getByLabel(/^비밀번호\s*\*?$/), DEMO_ADMIN.password);
      await d.type(p.getByLabel('비밀번호 확인'), DEMO_ADMIN.password);
      await d.click(p.getByRole('checkbox', { name: /데모 데이터 넣기/ }));
      await d.dwell(600);
      await d.shot();
      await d.click(p.getByRole('button', { name: '설정 마치고 시작하기' }));
      await d.see(h1(p, new RegExp(`${DEMO_ADMIN.name}님`)), 30000);
      await d.see(card(p, '재고 경고').getByRole('link', { name: /니트릴 글러브 M/ }));
    },
  },
  {
    slug: 'dashboard',
    title: '대시보드',
    say: ['대시보드입니다. 오늘 할 일, 재고 경고, 다가오는 점검 일정을 한 화면에서 봅니다.', '위쪽 숫자 칸이나 카드 항목을 누르면 해당 화면으로 바로 갑니다.'],
    doc: [
      '**누가·언제**: 모든 직원이 출근해서 가장 먼저 보는 화면입니다.',
      '오늘 할 일(체크리스트·인수인계·승인 대기), 재고 경고, 다가오는 점검·법정 의무 일정, 오늘 근무를 카드로 보여 줍니다.',
      '숫자 칸이나 카드 항목을 누르면 그 화면으로 바로 갑니다. 직원에게는 지출·발주처럼 권한이 없는 카드는 보이지 않습니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.point(p.getByRole('region', { name: '요약 숫자' }));
      await d.dwell(1200);
      await d.point(card(p, '오늘 할 일'));
      await d.dwell(1200);
      await d.point(card(p, '재고 경고'));
      await d.dwell(1200);
      await d.point(card(p, '다가오는 점검·의무 일정'));
      await d.dwell(1000);
      await d.shot();
      await d.scrollTo(card(p, '공지'));
      await d.dwell(1500);
      await d.scrollTo(p.getByRole('region', { name: '요약 숫자' }));
    },
  },
  {
    slug: 'dashboard-out',
    title: '대시보드에서 출고 기록',
    say: ['재료를 꺼내 쓸 때는 대시보드의 출고 기록 버튼을 누릅니다.', '품목을 고르고 저장하면, 세 번 클릭으로 출고가 끝납니다.'],
    doc: [
      '**누가·언제**: 직원이 재료를 꺼내 쓸 때 바로 기록합니다.',
      '대시보드의 "출고 기록" → 품목 고르기 → "저장", 세 번 클릭이면 끝납니다(수량은 기본 1).',
      '저장하면 남은 재고가 바로 안내되고, 적정 재고보다 적어지면 재고 경고에 올라갑니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.click(p.getByRole('button', { name: '출고 기록' }));
      const dialog = p.getByRole('dialog', { name: '출고 기록' });
      await d.see(dialog);
      await d.type(dialog.getByRole('searchbox', { name: '출고할 품목 찾기' }), '글러브');
      await d.click(dialog.getByRole('button', { name: /^니트릴 글러브 M 소모품/ }));
      await d.point(dialog.getByLabel('출고 수량(박스)'));
      await d.dwell(800);
      await d.click(dialog.getByRole('button', { name: '저장' }));
      await d.see(p.getByText(/니트릴 글러브 M 1박스 출고를 기록했어요/).last());
      await d.shot();
    },
  },
  {
    slug: 'board',
    title: '공지·인수인계',
    say: ['공지·인수인계 화면입니다. 공지를 열면 읽음으로 표시되고, 몇 명이 읽었는지 숫자로 보입니다.', '교대할 때 남길 말은 인수인계로 쓰고, 처리하면 처리 완료로 바꿉니다.'],
    doc: [
      '**누가·언제**: 실장님·원장님이 공지를 올리고, 직원은 출근해서 확인합니다. 교대할 때는 누구나 인수인계를 남깁니다.',
      '공지를 열면 읽음으로 표시되고, 목록에서 "읽음 몇 / 몇 명"으로 확인할 수 있습니다. 쓴 사람은 안 읽은 사람 목록도 봅니다.',
      '인수인계는 "처리 전 → 처리 완료"로 바꿔 빠뜨린 일이 없게 합니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('데스크·소통', '공지·인수인계', '공지·인수인계');
      await d.dwell(1000);
      const row = p.getByRole('row').filter({ hasText: '11월 원내 감염관리 교육 일정 안내' }).first();
      await d.click(row);
      await d.see(h1(p, '11월 원내 감염관리 교육 일정 안내'));
      await d.dwell(1500);
      await d.shot();
      await d.click(p.getByRole('button', { name: '목록으로' }));
      await d.see(h1(p, '공지·인수인계'));
      await d.dwell(800);
    },
  },
  {
    slug: 'checklist',
    title: '오픈·마감 체크리스트',
    say: ['오픈·마감 체크리스트입니다.', '아침에 할 일을 하나씩 체크하면, 누가 언제 했는지 함께 남습니다.'],
    doc: [
      '**누가·언제**: 직원이 아침 오픈·저녁 마감 때 씁니다.',
      '항목을 체크하면 체크한 사람과 시각이 함께 남고, 대시보드의 "오픈 체크리스트" 숫자도 바로 바뀝니다.',
      '항목 편집은 실장님 이상이 하고, 인쇄해서 벽에 붙일 수도 있습니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('데스크·소통', '오픈·마감 체크리스트', '오픈·마감 체크리스트');
      await d.dwell(800);
      const boxes = p.getByTestId('checklist-item').getByRole('checkbox');
      await d.click(boxes.nth(0));
      await d.dwell(700);
      await d.click(boxes.nth(1));
      await d.dwell(700);
      await d.click(boxes.nth(2));
    },
  },
  {
    slug: 'inventory',
    title: '재고 현황',
    say: ['재고 현황입니다.', '품목마다 현재 재고와 적정 재고가 보이고, 모자란 품목은 눈에 띄게 표시됩니다.'],
    doc: [
      '**누가·언제**: 실장님과 재고 담당 직원이 수시로 봅니다.',
      '품목별 현재 재고·적정 재고·보관 위치가 한 표에 있고, 적정 재고보다 적으면 표시가 붙습니다.',
      '품목을 누르면 입출고 기록과 단가 변동을 볼 수 있습니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('재고·구매', '재고 현황', '재고 현황');
      await d.dwell(1000);
      await d.point(p.getByRole('row').filter({ hasText: '니트릴 글러브 M' }).first());
      await d.dwell(1500);
    },
  },
  {
    slug: 'barcode',
    title: '바코드로 출고',
    say: ['바코드 스캐너가 있으면, 바코드로 출고 칸에 찍기만 하면 됩니다.', '그 품목의 출고 창이 수량 1로 열리고, 저장을 누르면 재고가 줄어듭니다.'],
    doc: [
      '**누가·언제**: 직원이 재료를 꺼낼 때 USB 바코드 스캐너로 찍습니다(스캐너가 없으면 숫자를 직접 쳐도 됩니다).',
      '재고 현황의 "바코드로 출고" 칸에 찍으면 그 품목 출고 창이 수량 1로 열리고, "저장"만 누르면 됩니다.',
      '휴대폰에서는 "사진으로 찾기"로 바코드 사진을 찍어도 됩니다(사진은 서버로 보내지 않습니다).',
    ],
    async run(d) {
      const p = d.page;
      const input = p.getByRole('textbox', { name: '바코드로 출고' });
      await d.type(input, '2001000000029');
      await p.keyboard.press('Enter');
      const dialog = p.getByRole('dialog', { name: '출고 기록' });
      await d.see(dialog);
      await d.dwell(1000);
      await d.point(dialog.getByLabel('출고 수량(박스)'));
      await d.dwell(1000);
      await d.shot();
      await d.click(dialog.getByRole('button', { name: '저장' }));
      await d.see(p.getByText(/니트릴 글러브 M 1박스 출고를 기록했어요/).last());
    },
  },
  {
    slug: 'orders',
    title: '발주서 만들기',
    say: ['발주서 화면에서 발주서 만들기를 누르면, 모자란 품목을 거래처별 발주서로 묶어 줍니다.', '수량을 확인한 뒤 발주하면 됩니다.'],
    doc: [
      '**누가·언제**: 실장님이 주 1~2회 발주할 때 씁니다.',
      '"발주서 만들기"를 누르면 적정 재고보다 모자란 품목을 거래처별 발주서로 묶어 줍니다.',
      '수량을 고치고 "발주함"으로 바꾸고, 물건이 오면 "입고 처리"로 재고에 더합니다. 인쇄 미리보기도 있습니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('재고·구매', '발주서', '발주서');
      await d.dwell(1000);
      await d.click(p.getByRole('button', { name: '발주서 만들기' }).first());
      await d.see(p.getByText(/발주서 \d+건을 만들었어요|만들 발주서가 없어요|모자란 품목이 없어요/));
      await d.dwell(1500);
    },
  },
  {
    slug: 'receipt',
    title: '명세서 사진으로 입고',
    say: ['물건이 오면 거래명세서 사진을 올립니다.', '환자 정보가 보이지 않는지 확인 칸에 체크하고 AI로 읽기를 누르면, 품목과 수량을 읽어 줍니다.', '읽은 내용은 저장하기 전에 고칠 수 있습니다.'],
    doc: [
      '**누가·언제**: 물건이 도착했을 때 직원이나 실장님이 씁니다.',
      '거래명세서 사진을 고르고, 환자 정보·카드번호가 보이지 않는다는 확인 칸에 체크해야 보낼 수 있습니다.',
      'AI가 읽은 품목·수량·단가에 비슷한 기존 품목이 미리 연결되고, 확인·수정한 뒤 "입고 저장"을 누릅니다. 실장님은 지출로도 함께 기록할 수 있습니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('재고·구매', '명세서 사진으로 입고', '명세서 사진으로 입고');
      await d.dwell(1000);
      await d.point(p.getByTestId('receipt-warning'));
      await p.locator('input[type="file"]').first().setInputFiles(d.files.receiptPhoto);
      await d.see(p.getByTestId('receipt-picked'));
      await d.dwell(800);
      await d.click(p.getByLabel('사진에 환자 정보·카드번호가 보이지 않는 것을 확인했어요'));
      await d.click(p.getByRole('button', { name: 'AI로 읽기' }));
      await d.see(p.getByRole('heading', { name: '2. 읽은 내용 확인·수정' }), 20000);
      await d.dwell(800);
      // 카드 제목이 잘리지 않게 제목 기준으로 굴린다
      await d.scrollTo(p.getByRole('heading', { name: '2. 읽은 내용 확인·수정' }));
      await d.dwell(1500);
    },
  },
  {
    slug: 'docs-writer',
    title: 'AI 문서 작성',
    say: ['AI 문서 작성입니다. 요점만 적고 초안 만들기를 누르면, 안내문 초안이 나옵니다.', '지금은 AI 키가 없는 데모 모드라서, 비용 없이 예시 글이 나옵니다.'],
    doc: [
      '**누가·언제**: 실장님·직원이 환자 안내문, 원내 공지문 같은 글이 필요할 때 씁니다.',
      '문서 종류를 고르고 요점만 적은 뒤 "초안 만들기"를 누르면, 오른쪽에 초안이 나오고 바로 고칠 수 있습니다.',
      '저장하면 서식 보관함에 버전과 함께 남습니다. AI 초안은 참고용이니 꼭 읽고 고쳐서 씁니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('문서·AI', 'AI 문서 작성', 'AI 문서 작성');
      await d.dwell(800);
      const panel = p.getByTestId('ai-panel-doc_writer');
      await d.type(panel.getByLabel('요점'), '임플란트 수술 후 주의사항, 거즈 2시간 물기, 음주·흡연 금지');
      await d.click(panel.getByRole('button', { name: '초안 만들기' }));
      await d.see(p.getByRole('article', { name: '문서 미리보기' }), 20000);
      await d.see(panel.getByTestId('ai-cost'), 20000);
      // 초안이 나온 뒤 화면 제목이 잘리지 않게 맨 위로
      await d.scrollTo(p.getByRole('heading', { level: 1, name: 'AI 문서 작성' }));
      await d.dwell(1500);
    },
  },
  {
    slug: 'privacy',
    title: '개인정보 보호',
    say: ['AI 입력칸에 주민등록번호 같은 개인정보를 넣으면, 바로 노란 경고가 뜹니다.', '그대로 보내려 해도 막혀서, AI로 나가지 않습니다.'],
    doc: [
      '**누가·언제**: 모든 AI 입력칸에 늘 켜져 있습니다.',
      '입력칸 위에는 "환자 개인정보 입력 금지" 빨간 안내가 늘 보이고, 전화번호·주민등록번호처럼 보이는 글을 치면 노란 경고가 뜹니다.',
      '주민등록번호·카드번호는 서버에서 막아 AI로 보내지 않고, 전화번호 등은 가린 뒤 보냅니다. (영상 속 번호는 가짜입니다.)',
    ],
    async run(d) {
      const p = d.page;
      const panel = p.getByTestId('ai-panel-doc_writer');
      await d.point(panel.getByTestId('privacy-guard'));
      await d.dwell(800);
      await d.type(panel.getByLabel('요점'), '주민번호 900101-1234567 환자 안내문', { clear: true });
      await d.see(panel.getByTestId('privacy-warning'));
      await d.dwell(1200);
      await d.click(panel.getByRole('button', { name: /초안 만들기|다시 생성/ }));
      // 서버가 막고 패널 아래에 빨간 안내(.ai-error)를 띄운다
      const blocked = panel.locator('.ai-error');
      await d.see(blocked, 15000);
      await d.scrollTo(blocked);
      await d.point(blocked);
      await d.dwell(1500);
    },
  },
  {
    slug: 'assistant',
    title: '원내 AI 도우미',
    say: ['원내 AI 도우미에게 원내 규정을 물어보면, 근거가 된 원내 문서와 함께 답해 줍니다.'],
    doc: [
      '**누가·언제**: 새로 온 직원이나 헷갈리는 규정이 있을 때 누구나 묻습니다.',
      '올려 둔 원내 문서(감염관리·멸균·재고 규정 등)에서 찾아 답하고, 근거 문서를 함께 보여 줍니다. "원문 보기"로 바로 확인합니다.',
      '문서에 없는 내용은 모른다고 답하고, 문서를 올리라고 안내합니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('문서·AI', '원내 AI 도우미', '원내 AI 도우미');
      await d.dwell(800);
      const box = p.getByLabel('질문', { exact: true });
      await d.type(box, '멸균기 B&D 테스트는 언제 해?');
      await box.press('Enter');
      await d.see(p.getByTestId('assistant-answer').first(), 20000);
      await d.dwell(1000);
      await d.point(p.getByTestId('assistant-answer').first());
      await d.dwell(1500);
    },
  },
  {
    slug: 'minutes',
    title: '회의록 요약',
    say: ['회의 녹음 파일을 올리고, 환자 이야기가 없다는 확인 칸에 체크한 뒤 받아쓰기를 누르면 글로 바뀝니다.', '정리하기를 누르면 결정 사항과 할 일이 담당자, 기한과 함께 정리됩니다.'],
    doc: [
      '**누가·언제**: 직원 회의가 끝난 뒤 실장님이 씁니다.',
      '녹음 파일(m4a 등)을 올리고 "환자 이야기가 들어간 녹음이 아닌 것을 확인했어요"에 체크한 뒤 "받아쓰기"를 누르면 회의 메모에 글이 들어갑니다. 메모를 직접 붙여 넣어도 됩니다.',
      '"정리하기"를 누르면 결정 사항과 할 일(담당·기한)이 정리되고, 할 일은 인수인계로 바로 보낼 수 있습니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('문서·AI', '회의록 요약', '회의록 요약');
      await d.dwell(800);
      const rec = p.getByRole('article', { name: '녹음 파일로 받아쓰기' });
      await d.point(rec.getByTestId('recording-warning'));
      await rec.locator('input[type=file]').setInputFiles({ name: '11월 직원회의.m4a', mimeType: 'audio/mp4', buffer: d.files.fakeM4a() });
      await d.see(rec.getByTestId('recording-picked'));
      await d.dwell(800);
      await d.click(rec.getByLabel('환자 이야기가 들어간 녹음이 아닌 것을 확인했어요'));
      await d.click(rec.getByRole('button', { name: '받아쓰기' }));
      await d.see(rec.getByTestId('recording-done'), 20000);
      await d.dwell(1500);
      await d.click(p.getByTestId('ai-panel-minutes').getByRole('button', { name: '정리하기' }));
      await d.see(p.getByTestId('minutes-result'), 20000);
      await d.dwell(800);
      await d.scrollTo(p.getByTestId('minutes-result'));
      await d.dwell(1500);
    },
  },
  {
    slug: 'adcheck',
    title: '의료광고 문구 점검',
    say: ['의료광고 문구 점검입니다.', '홍보 문구를 넣고 점검하기를 누르면, 문제가 될 수 있는 표현에 표시하고 이유와 바꿀 말을 알려 줍니다.'],
    doc: [
      '**누가·언제**: 블로그·SNS·현수막 문구를 올리기 전에 실장님이나 담당 직원이 씁니다.',
      '"최고", "100%", "할인"처럼 의료법상 문제가 될 수 있는 표현에 색을 칠하고 이유와 바꿀 말을 보여 줍니다.',
      '규칙 점검 뒤 AI가 한 번 더 살펴봅니다. 최종 판단은 사람이 합니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('문서·AI', '의료광고 문구 점검', '의료광고 문구 점검');
      await d.dwell(800);
      await d.type(p.getByRole('textbox', { name: '점검할 글' }), '국내 최고 임플란트, 100% 성공, 지금 50% 할인');
      await d.click(p.getByRole('button', { name: '점검하기' }));
      await d.see(p.getByTestId('adcheck-result'), 20000);
      await d.dwell(1000);
      await d.point(p.getByTestId('adcheck-result'));
      await d.dwell(1500);
    },
  },
  {
    slug: 'roster',
    title: '근무표 · AI 배정 제안',
    say: ['근무표에서는 한 주 근무를 한눈에 봅니다.', 'AI 배정 제안을 누르고 하루 최소 인원을 정하면, 연차를 피해서 짠 배정안을 미리 보여 줍니다.'],
    doc: [
      '**누가·언제**: 실장님이 다음 주 근무를 짤 때 씁니다.',
      '칸을 눌러 근무 유형(종일·오전·오후 등)을 바꾸고, 연차가 승인된 날은 자동으로 "연차"로 보입니다.',
      '"AI 배정 제안"에 하루 최소 인원·직무별 최소 인원을 적고 "제안 받기"를 누르면, 바뀌는 칸이 표시된 미리보기가 나옵니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('인사·근무', '근무표', '근무표');
      await d.dwell(1500);
      await d.click(p.getByRole('button', { name: 'AI 배정 제안' }));
      const dialog = p.getByRole('dialog').filter({ hasText: 'AI 배정 제안' });
      await d.see(dialog);
      await d.type(dialog.getByLabel('하루 최소 인원'), '3', { clear: true });
      await d.click(dialog.getByRole('button', { name: '제안 받기' }));
      await d.see(dialog.getByTestId('roster-suggest-preview'), 20000);
      await d.dwell(1500);
    },
  },
  {
    slug: 'roster-apply',
    title: 'AI 배정 제안 적용',
    say: ['미리보기를 확인하고 적용하기를 눌러야 근무표가 바뀝니다.', '취소하면 근무표는 그대로입니다.'],
    doc: [
      '**누가·언제**: 실장님이 AI 제안 미리보기를 확인한 뒤 결정합니다.',
      '"적용하기"를 눌러야 근무표가 바뀌고, "취소"하면 아무것도 바뀌지 않습니다.',
      '적용한 뒤에도 칸을 눌러 직접 고칠 수 있고, 인쇄용 근무표도 있습니다.',
    ],
    async run(d) {
      const p = d.page;
      const dialog = p.getByRole('dialog').filter({ hasText: 'AI 배정 제안' });
      await d.point(dialog.getByTestId('roster-suggest-preview'));
      await d.dwell(1000);
      await d.click(dialog.getByRole('button', { name: '적용하기' }));
      await d.see(p.getByText(/AI 제안을 .* 근무표에 적용했어요/));
      await d.dwell(1500);
    },
  },
  {
    slug: 'leave',
    title: '연차·휴가',
    say: ['연차·휴가 화면입니다.', '직원이 신청하면 실장님이나 원장님이 승인하고, 남은 연차가 자동으로 계산됩니다.'],
    doc: [
      '**누가·언제**: 직원은 쉬고 싶은 날을 신청하고, 실장님·원장님이 승인합니다.',
      '승인 대기 건은 대시보드 "오늘 할 일"에도 뜹니다. 승인하면 근무표에 "연차"로 들어갑니다.',
      '사람마다 쓴 연차와 남은 연차가 자동으로 계산됩니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('인사·근무', '연차·휴가', '연차·휴가');
      await d.dwell(1500);
      await d.scrollTo(p.locator('main table, .main table').first());
      await d.point(p.locator('main table, .main table').first().locator('tbody tr').first());
      await d.dwell(1500);
    },
  },
  {
    slug: 'facility',
    title: '장비·멸균기·법정 의무 일정',
    say: ['시설·법정 메뉴에서는 장비 점검, 멸균기 점검 기록, 법정 의무 일정을 관리합니다.', '기한이 다가오면 대시보드와 알림으로 미리 알려 줍니다.'],
    doc: [
      '**누가·언제**: 실장님이나 감염관리 담당 직원이 씁니다.',
      '장비 점검·유지보수: 장비별 점검 주기와 수리 기록. 멸균기 점검 기록: 매일 B&D 테스트·생물학적 표지자 결과를 남기고, 불합격이면 조치를 적습니다.',
      '법정 의무 일정: 방사선 장비 정기검사, 의료폐기물, 소방 점검 같은 일정을 기한 순으로 보여 주고 미리 알립니다.',
    ],
    async run(d) {
      await d.nav('시설·법정', '장비 점검·유지보수', '장비 점검·유지보수');
      await d.dwell(1800);
      await d.nav('시설·법정', '멸균기 점검 기록', '멸균기 점검 기록');
      await d.dwell(1800);
      await d.nav('시설·법정', '법정 의무 일정', '법정 의무 일정');
      await d.dwell(1800);
    },
  },
  {
    slug: 'finance',
    title: '지출 기록 · 월간 요약',
    say: ['지출 기록에 쓴 돈을 적어 두면,', '월간 요약에서 한 달 지출을 항목별로 보고, 지난달과 비교할 수 있습니다.'],
    doc: [
      '**누가·언제**: 원장님·실장님이 씁니다(직원에게는 보이지 않습니다).',
      '지출 기록: 재료비·공과금 등 쓴 돈을 적고 영수증 사진을 붙입니다. 입고 처리에서 지출로 함께 기록할 수도 있습니다.',
      '월간 요약: 항목별 지출과 지난달 비교, 재고·근무 지표를 한 장으로 봅니다.',
    ],
    async run(d) {
      await d.nav('운영 지표', '지출 기록', '지출 기록');
      await d.dwell(2000);
      await d.nav('운영 지표', '월간 요약', '월간 요약');
      await d.dwell(1500);
      // 데모 날짜(11/2)는 달 초라 이번 달 기록이 거의 없으므로, 지난달(10월)로 넘겨 한 달 전체 모습을 보여 준다
      await d.click(d.page.getByRole('button', { name: '이전 달' }));
      await d.see(d.page.getByText('2026년 10월 지출 합계'));
      await d.dwell(2000);
    },
  },
  {
    slug: 'admin-ai',
    title: 'AI 설정·예산 · 사용량',
    say: ['AI 설정·예산에는 AI 키를 넣는 칸과 월 예산 칸이 있습니다. 키가 없으면 비용 없는 데모 모드로 동작합니다.', 'AI 사용량·비용 화면에서는 기능별로 얼마나 썼는지 봅니다.'],
    doc: [
      '**누가·언제**: 원장님(관리자)만 들어올 수 있습니다.',
      'AI 설정·예산: AI 회사 키를 넣는 칸, 월 예산, 기능별 사용 여부를 정합니다. 키를 넣지 않으면 비용 0원인 데모 모드로 동작합니다(이 영상도 데모 모드입니다).',
      '월 예산을 다 쓰면 AI 요청이 멈추고 쉬운 안내가 나옵니다. AI 사용량·비용에서 기능별·사람별 사용 금액을 봅니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('관리', 'AI 설정·예산', 'AI 설정·예산');
      await d.dwell(1000);
      await d.point(p.getByLabel('월 예산(원)'));
      await d.dwell(1800);
      await d.shot();
      await d.nav('관리', 'AI 사용량·비용', 'AI 사용량·비용');
      await d.dwell(2000);
    },
  },
  {
    slug: 'backup',
    title: '백업·복원',
    say: ['백업·복원 화면입니다.', '지금 백업을 누르면 바로 백업 파일이 만들어집니다. 매일 자동 백업도 됩니다.'],
    doc: [
      '**누가·언제**: 원장님(관리자)이 씁니다. 자동 백업은 매일 저절로 됩니다.',
      '"지금 백업"을 누르면 바로 백업이 만들어지고, 목록에서 내려받거나 그 시점으로 복원할 수 있습니다.',
      '복원하기 전에는 한 번 더 확인을 묻습니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('관리', '백업·복원', '백업·복원');
      await d.dwell(1000);
      await d.click(p.getByRole('button', { name: '지금 백업' }));
      await d.see(p.getByText('백업을 만들었어요').first(), 20000);
      await d.dwell(1500);
    },
  },
  {
    slug: 'audit',
    title: '활동 기록',
    say: ['활동 기록에는 누가 언제 무엇을 했는지가 남습니다.', '설정 변경이나 백업 같은 중요한 일도 모두 확인할 수 있습니다.'],
    doc: [
      '**누가·언제**: 원장님(관리자)이 필요할 때 확인합니다.',
      '로그인, 설정 변경, 백업, 데이터 수정 같은 일을 누가 언제 했는지 시간 순서로 보여 줍니다.',
    ],
    async run(d) {
      await d.nav('관리', '활동 기록', '활동 기록');
      await d.dwell(2500);
    },
  },
  {
    slug: 'phone',
    title: '휴대폰 화면',
    say: ['휴대폰에서도 같은 주소로 들어와 쓸 수 있습니다.', '화면이 휴대폰 크기에 맞게 바뀌고, 아래쪽 메뉴로 자주 쓰는 화면에 바로 갑니다.'],
    doc: [
      '**누가·언제**: 직원이 진료실·창고에서 휴대폰으로 씁니다(같은 와이파이 안).',
      '대시보드와 재고 화면이 휴대폰 크기에 맞게 바뀌고, 아래쪽 메뉴(홈·재고·AI·근무)로 바로 갑니다.',
      '홈 화면에 추가하면 앱처럼 열 수 있습니다.',
    ],
    async run(d) {
      await d.showPhones(['/', '/inventory']);
      await d.dwell(2500);
    },
  },
  {
    slug: 'dark-mode',
    title: '어둡게 보기',
    say: ['오른쪽 위 버튼으로 어둡게 보기를 켤 수 있습니다.', '이상으로 치과 원내 AX 서비스의 사용 흐름을 살펴보았습니다. 감사합니다.'],
    doc: [
      '**누가·언제**: 누구나 눈이 편한 쪽을 고릅니다(기기마다 따로 기억합니다).',
      '오른쪽 위 달 모양 버튼("어둡게 보기")을 누르면 어두운 화면으로, 해 모양 버튼("밝게 보기")을 누르면 밝은 화면으로 바뀝니다.',
    ],
    async run(d) {
      const p = d.page;
      await d.nav('', '대시보드', /님/);
      await d.dwell(1000);
      await d.click(p.getByRole('button', { name: '어둡게 보기' }));
      await d.dwell(2500);
      await d.shot();
      await d.endCard('치과 원내 AX', '화면으로 보는 사용 흐름 · 가상 하늘숲치과 데모 데이터');
      await d.dwell(3000);
    },
  },
];
