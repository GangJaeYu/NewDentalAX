// 이 파일이 하는 일: inventory 모듈(거래처·품목·입출고)의 데모 데이터(database.md §11). 가상 치과 "하늘숲치과"의 거래처 5곳, 품목 약 80개,
// 최근 90일 입출고 기록을 넣는다. 날마다 쓰고(출고) 적정 재고 아래로 내려가면 다시 들여오는(입고) 흐름을 정해진 난수로 흉내 내므로 매번 같은 데이터가 나온다.
// 화면 시연을 위해 일부 품목은 일부러 부족·곧 부족·유효기간 임박·만료·단가 인상(니트릴 글러브 M 8,400원 → 8,900원) 상태로 끝나게 맞춘다.
// 거래처는 모두 가상 사업자이고(연락처는 예시 번호·example 주소), 환자 정보는 없다. scale=10이면 품목을 10배(이름 뒤 번호)로 늘린다(NFR-005).
// 모양은 server/db/seed/types.ts의 ModuleSeed다. 등록은 server/db/seed/registry.ts가 이미 해 두었다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { addDays, kstMidnight, todayKst } from '../../lib/dates.ts';
import { orderTables, seedOrdersDemo } from './orders.seed.ts';

/** 이 모듈이 소유한 업무 테이블(초기화 때 비울 대상, 가리키는 쪽부터) */
export const tables: readonly string[] = ['vendors', 'items', 'stock_moves', ...orderTables];

/** 데모 거래처 5곳(가상) */
export const DEMO_VENDORS = [
  { name: '한빛덴탈', contactName: '김도윤', phone: '02-555-0101', email: 'order@hanbit-dental.example', orderMethod: '전화·문자 주문(평일 17시 전 당일 출고)' },
  { name: '미소치재', contactName: '이서연', phone: '02-555-0202', email: 'sales@miso-dental.example', orderMethod: '온라인 몰 주문' },
  { name: '바른메디칼', contactName: '박지훈', phone: '031-555-0303', email: 'bareun@medical.example', orderMethod: '이메일 주문서 발송' },
  { name: '청정위생', contactName: '최유나', phone: '02-555-0404', email: 'clean@hygiene.example', orderMethod: '전화 주문(주 2회 배송)' },
  { name: '오피스나라', contactName: '정민호', phone: '1588-0505', email: 'b2b@officenara.example', orderMethod: '온라인 몰 정기 배송' },
] as const;

/** 데모 품목 한 개의 정의 */
interface DemoItem {
  name: string;
  category: string;
  unit: string;
  par: number;
  /** 기본 입고 단가(원) */
  price: number;
  /** DEMO_VENDORS 순번 */
  vendor: number;
  /** 유효기간 관리 품목이면 입고 뒤 유효기간까지 날 수 */
  shelf?: number;
  location: string;
  /** 끝 재고를 이 값으로 맞춘다(상태 시연용) */
  target?: number;
  /** 마지막 로트의 유효기간을 기준일 + 이 날 수로 맞춘다(음수면 지난 날짜) */
  expiryIn?: number;
  /** 마지막 입고 단가 */
  upPrice?: number;
}

const D = 540; // 보통 재료·약품의 유효기간(입고 뒤 날 수)

/** 데모 품목 목록(하늘숲치과 소모품실 기준) */
export const DEMO_ITEMS: readonly DemoItem[] = [
  // 소모품 — 한빛덴탈
  { name: '니트릴 글러브 S', category: '소모품', unit: '박스', par: 6, price: 8400, vendor: 0, location: '소모품실 A-1' },
  { name: '니트릴 글러브 M', category: '소모품', unit: '박스', par: 6, price: 8400, vendor: 0, location: '소모품실 A-1', target: 2, upPrice: 8900 },
  { name: '니트릴 글러브 L', category: '소모품', unit: '박스', par: 4, price: 8400, vendor: 0, location: '소모품실 A-1' },
  { name: '라텍스 글러브 M', category: '소모품', unit: '박스', par: 3, price: 7200, vendor: 0, location: '소모품실 A-1' },
  { name: '덴탈 마스크', category: '소모품', unit: '박스', par: 8, price: 4500, vendor: 0, location: '소모품실 A-2' },
  { name: '석션 팁 (일회용)', category: '소모품', unit: '봉', par: 4, price: 4200, vendor: 0, location: '소모품실 A-3', target: 1 },
  { name: '배엽 팁', category: '소모품', unit: '봉', par: 3, price: 3800, vendor: 0, location: '소모품실 A-3' },
  { name: '에어워터 시린지 팁', category: '소모품', unit: '봉', par: 3, price: 9500, vendor: 0, location: '소모품실 A-3' },
  { name: '일회용 앞치마', category: '소모품', unit: '팩', par: 4, price: 6500, vendor: 0, location: '소모품실 A-4' },
  { name: '턱받이 (일회용)', category: '소모품', unit: '팩', par: 6, price: 5200, vendor: 0, location: '소모품실 A-4' },
  { name: '치과용 종이컵', category: '소모품', unit: '줄', par: 10, price: 2500, vendor: 0, location: '소모품실 A-4' },
  { name: '거즈 2×2', category: '소모품', unit: '팩', par: 10, price: 3200, vendor: 0, location: '소모품실 A-5' },
  { name: '코튼롤', category: '소모품', unit: '봉', par: 8, price: 2800, vendor: 0, location: '소모품실 A-5' },
  { name: '면봉', category: '소모품', unit: '봉', par: 5, price: 1500, vendor: 0, location: '소모품실 A-5' },
  { name: '일회용 미러', category: '소모품', unit: '봉', par: 3, price: 11000, vendor: 0, location: '소모품실 A-6' },
  { name: '연마컵', category: '소모품', unit: '봉', par: 3, price: 12000, vendor: 0, location: '소모품실 A-6' },
  { name: '러버댐 시트', category: '소모품', unit: '박스', par: 2, price: 28000, vendor: 0, location: '소모품실 A-6' },
  { name: '일회용 비닐 커버', category: '소모품', unit: '롤', par: 3, price: 8800, vendor: 0, location: '소모품실 A-6' },
  // 감염관리 — 청정위생
  { name: '멸균 파우치 90×260', category: '감염관리', unit: '팩', par: 5, price: 12000, vendor: 3, location: '멸균실 선반 1', target: 6 },
  { name: '멸균 파우치 135×280', category: '감염관리', unit: '팩', par: 4, price: 14500, vendor: 3, location: '멸균실 선반 1' },
  { name: '멸균 롤 100mm', category: '감염관리', unit: '롤', par: 2, price: 21000, vendor: 3, location: '멸균실 선반 1' },
  { name: '표면 소독 티슈', category: '감염관리', unit: '통', par: 6, price: 9800, vendor: 3, location: '멸균실 선반 2', shelf: D },
  { name: '손 소독제 500ml', category: '감염관리', unit: '개', par: 6, price: 6500, vendor: 3, location: '멸균실 선반 2', shelf: D },
  { name: '기구 세척제 (효소)', category: '감염관리', unit: '통', par: 2, price: 32000, vendor: 3, location: '멸균실 선반 2', shelf: D },
  { name: '멸균 인디케이터 테이프', category: '감염관리', unit: '개', par: 4, price: 7800, vendor: 3, location: '멸균실 선반 3' },
  { name: 'BI 테스트 키트', category: '감염관리', unit: '박스', par: 1, price: 65000, vendor: 3, location: '멸균실 선반 3', shelf: 365 },
  { name: '화학적 지시계 스트립', category: '감염관리', unit: '봉', par: 2, price: 18000, vendor: 3, location: '멸균실 선반 3', shelf: D },
  { name: '의료폐기물 전용 용기', category: '감염관리', unit: '개', par: 10, price: 3500, vendor: 3, location: '창고' },
  { name: '차아염소산 소독액', category: '감염관리', unit: '통', par: 2, price: 9000, vendor: 3, location: '멸균실 선반 2', shelf: 365, target: 3, expiryIn: -3 },
  { name: '기구 소독 침지액', category: '감염관리', unit: '통', par: 2, price: 24000, vendor: 3, location: '멸균실 선반 2', shelf: D },
  // 재료 — 미소치재
  { name: '복합레진 A2', category: '재료', unit: '개', par: 4, price: 32000, vendor: 1, location: '진료실 재료장 1', shelf: D, target: 6, expiryIn: 12 },
  { name: '복합레진 A3', category: '재료', unit: '개', par: 4, price: 32000, vendor: 1, location: '진료실 재료장 1', shelf: D },
  { name: '플로어블 레진 A2', category: '재료', unit: '개', par: 3, price: 28000, vendor: 1, location: '진료실 재료장 1', shelf: D },
  { name: '본딩제', category: '재료', unit: '병', par: 2, price: 45000, vendor: 1, location: '진료실 재료장 1', shelf: D },
  { name: '에칭젤', category: '재료', unit: '개', par: 3, price: 9000, vendor: 1, location: '진료실 재료장 1', shelf: D },
  { name: '글래스아이오노머 시멘트', category: '재료', unit: '세트', par: 2, price: 52000, vendor: 1, location: '진료실 재료장 2', shelf: D },
  { name: '임시 충전재', category: '재료', unit: '개', par: 3, price: 15000, vendor: 1, location: '진료실 재료장 2', shelf: D },
  { name: '레진 시멘트', category: '재료', unit: '개', par: 2, price: 68000, vendor: 1, location: '진료실 재료장 2', shelf: D },
  { name: '알지네이트 인상재', category: '재료', unit: '봉', par: 6, price: 9500, vendor: 1, location: '기공실', shelf: D, target: 7, upPrice: 10200 },
  { name: '실리콘 인상재 (퍼티)', category: '재료', unit: '세트', par: 2, price: 58000, vendor: 1, location: '기공실', shelf: D },
  { name: '실리콘 인상재 (라이트)', category: '재료', unit: '개', par: 4, price: 21000, vendor: 1, location: '기공실', shelf: D },
  { name: '치과용 석고', category: '재료', unit: 'kg', par: 10, price: 3500, vendor: 1, location: '기공실' },
  { name: '수산화칼슘 베이스', category: '재료', unit: '개', par: 2, price: 18000, vendor: 1, location: '진료실 재료장 2', shelf: D },
  { name: 'MTA', category: '재료', unit: '개', par: 1, price: 120000, vendor: 1, location: '진료실 재료장 2', shelf: D },
  { name: 'GP 콘 #25', category: '재료', unit: '박스', par: 3, price: 12000, vendor: 1, location: '진료실 재료장 3' },
  { name: '페이퍼 포인트 #25', category: '재료', unit: '박스', par: 3, price: 9000, vendor: 1, location: '진료실 재료장 3' },
  { name: '근관 세척액', category: '재료', unit: '병', par: 3, price: 7000, vendor: 1, location: '진료실 재료장 3', shelf: D },
  { name: 'EDTA 젤', category: '재료', unit: '개', par: 2, price: 14000, vendor: 1, location: '진료실 재료장 3', shelf: D },
  { name: '불소 바니시', category: '재료', unit: '개', par: 3, price: 26000, vendor: 1, location: '진료실 재료장 4', shelf: D },
  { name: '실란트', category: '재료', unit: '개', par: 2, price: 24000, vendor: 1, location: '진료실 재료장 4', shelf: D },
  { name: '연마 페이스트', category: '재료', unit: '통', par: 2, price: 16000, vendor: 1, location: '진료실 재료장 4', shelf: D },
  { name: '교정용 접착제', category: '재료', unit: '개', par: 1, price: 48000, vendor: 1, location: '진료실 재료장 4', shelf: D },
  // 약품 — 바른메디칼
  { name: '리도카인 앰플 2%', category: '약품', unit: '상자', par: 5, price: 38000, vendor: 2, location: '약품장 (잠금)', shelf: D, target: 2 },
  { name: '아티카인 카트리지', category: '약품', unit: '상자', par: 4, price: 52000, vendor: 2, location: '약품장 (잠금)', shelf: D },
  { name: '표면 마취 젤', category: '약품', unit: '개', par: 2, price: 15000, vendor: 2, location: '약품장 (잠금)', shelf: D, target: 3, expiryIn: 20 },
  { name: '콜라겐 지혈 스펀지', category: '약품', unit: '박스', par: 2, price: 42000, vendor: 2, location: '약품장', shelf: D },
  { name: '클로르헥시딘 가글', category: '약품', unit: '병', par: 4, price: 8500, vendor: 2, location: '약품장', shelf: D },
  { name: '포비돈 요오드 소독액', category: '약품', unit: '병', par: 3, price: 6800, vendor: 2, location: '약품장', shelf: D },
  { name: '생리식염수 1L', category: '약품', unit: '병', par: 10, price: 2200, vendor: 2, location: '약품장', shelf: D },
  { name: '일회용 주사기 3cc', category: '약품', unit: '박스', par: 3, price: 9800, vendor: 2, location: '약품장', shelf: D },
  { name: '봉합사 4-0', category: '약품', unit: '박스', par: 2, price: 45000, vendor: 2, location: '약품장', shelf: D },
  { name: '치과용 주사침 30G', category: '약품', unit: '박스', par: 4, price: 11000, vendor: 2, location: '약품장', shelf: D },
  // 기구 — 한빛덴탈·미소치재
  { name: '다이아몬드 버 (라운드)', category: '기구', unit: '개', par: 10, price: 3500, vendor: 0, location: '진료실 서랍 1' },
  { name: '다이아몬드 버 (테이퍼)', category: '기구', unit: '개', par: 10, price: 3500, vendor: 0, location: '진료실 서랍 1' },
  { name: '카바이드 버', category: '기구', unit: '개', par: 6, price: 4200, vendor: 0, location: '진료실 서랍 1' },
  { name: '핸드피스 오일', category: '기구', unit: '캔', par: 2, price: 18000, vendor: 0, location: '멸균실 선반 4' },
  { name: '스케일러 팁', category: '기구', unit: '개', par: 4, price: 35000, vendor: 0, location: '진료실 서랍 2' },
  { name: 'K-파일 #15', category: '기구', unit: '박스', par: 4, price: 9500, vendor: 1, location: '진료실 서랍 3' },
  { name: 'H-파일 #25', category: '기구', unit: '박스', par: 3, price: 9800, vendor: 1, location: '진료실 서랍 3' },
  { name: '교합지', category: '기구', unit: '박스', par: 3, price: 7500, vendor: 1, location: '진료실 서랍 2' },
  { name: '매트릭스 밴드', category: '기구', unit: '박스', par: 2, price: 12000, vendor: 1, location: '진료실 서랍 2' },
  { name: '나무 웨지', category: '기구', unit: '봉', par: 3, price: 6000, vendor: 1, location: '진료실 서랍 2' },
  { name: '임플란트 드릴 세척 브러시', category: '기구', unit: '봉', par: 2, price: 9000, vendor: 0, location: '멸균실 선반 4' },
  // 사무·기타 — 오피스나라
  { name: 'A4 용지', category: '사무·기타', unit: '박스', par: 2, price: 28000, vendor: 4, location: '데스크 창고' },
  { name: '영수증 감열지', category: '사무·기타', unit: '롤', par: 10, price: 1200, vendor: 4, location: '데스크 서랍' },
  { name: '프린터 토너', category: '사무·기타', unit: '개', par: 1, price: 89000, vendor: 4, location: '데스크 창고' },
  { name: '핸드타월', category: '사무·기타', unit: '박스', par: 4, price: 22000, vendor: 4, location: '창고' },
  { name: '종량제 봉투 100L', category: '사무·기타', unit: '묶음', par: 2, price: 15000, vendor: 4, location: '창고' },
  { name: '물티슈', category: '사무·기타', unit: '팩', par: 10, price: 2000, vendor: 4, location: '창고' },
  { name: '건전지 AA', category: '사무·기타', unit: '팩', par: 2, price: 6000, vendor: 4, location: '데스크 서랍' },
  { name: '라벨지', category: '사무·기타', unit: '팩', par: 1, price: 9000, vendor: 4, location: '데스크 서랍' },
  { name: '볼펜 (검정)', category: '사무·기타', unit: '박스', par: 1, price: 8000, vendor: 4, location: '데스크 서랍' },
  { name: '일회용 칫솔 세트', category: '사무·기타', unit: '박스', par: 2, price: 25000, vendor: 4, location: '창고' },
];

/** 정해진 씨앗으로 매번 같은 수를 내는 난수(0 이상 1 미만) */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 만들 입출고 한 줄 */
interface PlanMove {
  type: 'in' | 'out';
  qty: number;
  day: number;
  minute: number;
  price: number | null;
  lot: string | null;
  expiryOn: string | null;
  reason: string | null;
}

/**
 * 품목 하나의 90일 기록을 만든다. 처음에 적정의 2.5배를 들여오고, 날마다 조금씩 쓰다가 적정의 1.3배 아래로 내려가면 다음 날 2배를 들여온다.
 * 끝 재고는 target(없으면 자연스러운 값, 너무 적으면 적정의 1.6배 이상)으로 맞추고, 유효기간·단가 시연 값을 적용한다.
 */
export function planItem(item: DemoItem, seed: number, today: string): PlanMove[] {
  const rand = rng(seed);
  const moves: PlanMove[] = [];
  const dailyUse = Math.max(0.15, item.par / 9); // 대략 9일에 적정 재고만큼 쓴다
  let stock = 0;
  let reorderOn: number | null = -89;
  for (let day = -89; day <= -1; day++) {
    if (reorderOn === day) {
      const qty = Math.ceil(item.par * (day === -89 ? 2.5 : 2));
      moves.push({ type: 'in', qty, day, minute: 9 * 60 + 30 + Math.floor(rand() * 60), price: item.price, lot: null, expiryOn: null, reason: null });
      stock += qty;
      reorderOn = null;
    }
    // 일요일 쉬는 날처럼 가끔 쓰지 않는 날이 있다
    if (rand() < 0.35) continue;
    const want = Math.max(1, Math.round(dailyUse * (0.5 + rand() * 1.5)));
    const use = Math.min(stock, want);
    if (use > 0) {
      moves.push({ type: 'out', qty: use, day, minute: 10 * 60 + Math.floor(rand() * 7 * 60), price: null, lot: null, expiryOn: null, reason: null });
      stock -= use;
    }
    if (reorderOn === null && stock < item.par * 1.3) reorderOn = day + 1;
  }
  const ins = moves.filter((m) => m.type === 'in');
  const lastIn = ins[ins.length - 1];
  // 끝 재고 맞추기: 모자라면 마지막 입고 수량을 늘리고, 남으면 어제 출고 한 줄을 더한다
  const natural = stock;
  const target = item.target ?? (natural > item.par * 1.25 ? natural : Math.ceil(item.par * 1.6) + Math.floor(rand() * 3));
  if (lastIn && target > natural) {
    lastIn.qty += target - natural;
  } else if (target < natural) {
    moves.push({ type: 'out', qty: natural - target, day: -1, minute: 17 * 60 + 40, price: null, lot: null, expiryOn: null, reason: null });
  }
  // 유효기간 관리 품목: 로트 번호와 유효기간. 시연 품목은 마지막 로트가 기준일 + expiryIn이 되게 앞 로트를 더 이르게 둔다
  if (item.shelf) {
    ins.forEach((m, k) => {
      m.lot = `L${addDays(today, m.day).replace(/-/g, '').slice(2)}-${String(k + 1).padStart(2, '0')}`;
      m.expiryOn = item.expiryIn !== undefined ? addDays(today, item.expiryIn - 20 * (ins.length - 1 - k)) : addDays(today, m.day + (item.shelf ?? D));
    });
  }
  if (item.upPrice && lastIn) lastIn.price = item.upPrice;
  return moves;
}

/** 데모 거래처·품목·90일 기록을 넣는다 */
export function seedDemo(db: Db, ctx: SeedContext): void {
  const now = ctx.clock.now();
  const nowIso = now.toISOString();
  const today = todayKst(ctx.clock);
  const scale = Math.max(1, Math.floor(ctx.scale || 1));
  // 기록을 남긴 사람: 출고는 직원, 입고는 실장(없으면 아무 사용 중 계정, 그것도 없으면 비움)
  const staff = db.all<{ id: number }>("SELECT id FROM users WHERE active = 1 AND role = 'staff' ORDER BY id").map((u) => u.id);
  const managers = db.all<{ id: number }>("SELECT id FROM users WHERE active = 1 AND role IN ('manager', 'admin') ORDER BY role DESC, id").map((u) => u.id);
  const outUsers = staff.length ? staff : managers;
  const inUsers = managers.length ? managers : staff;
  const at = (day: number, minute: number) => new Date(kstMidnight(addDays(today, day)).getTime() + minute * 60000).toISOString();

  db.tx(() => {
    const vendorIds = DEMO_VENDORS.map((v) => {
      db.run(
        'INSERT OR IGNORE INTO vendors (name, contact_name, phone, email, order_method, memo, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)',
        [v.name, v.contactName, v.phone, v.email, v.orderMethod, nowIso, nowIso],
      );
      return db.get<{ id: number }>('SELECT id FROM vendors WHERE name = ?', [v.name])?.id ?? null;
    });
    let seq = 0;
    for (let copy = 0; copy < scale; copy++) {
      DEMO_ITEMS.forEach((item, idx) => {
        seq += 1;
        const name = copy === 0 ? item.name : `${item.name} (${copy + 1})`;
        const vendorId = vendorIds[item.vendor] ?? null;
        const r = db.run(
          'INSERT INTO items (name, category, unit, par_level, track_expiry, default_vendor_id, location, memo, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)',
          [name, item.category, item.unit, item.par, item.shelf ? 1 : 0, vendorId, item.location, at(-90, 9 * 60), nowIso],
        );
        const itemId = r.lastInsertRowid;
        const plan = planItem(item, 1000 + idx * 7919 + copy * 104729, today);
        plan.forEach((m, k) => {
          const users = m.type === 'in' ? inUsers : outUsers;
          db.run(
            'INSERT INTO stock_moves (item_id, type, qty, unit_price, vendor_id, lot, expiry_on, reason, order_id, moved_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
            [itemId, m.type, m.qty, m.price, m.type === 'in' ? vendorId : null, m.lot, m.expiryOn, m.reason, at(m.day, m.minute), users.length ? (users[(seq + k) % users.length] ?? null) : null],
          );
        });
      });
    }
  });
  // 발주서 데모(phase-03-task-02, orders.seed.ts)
  seedOrdersDemo(db, ctx);
}
