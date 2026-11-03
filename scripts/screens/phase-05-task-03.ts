// 이 파일이 하는 일: phase-05-task-03(최종 화면 점검) 스크린샷 화면 목록. 다른 태스크 목록에 없던 "없는 주소" 안내 화면을 더한다.
// scripts/screenshots.ts가 자동으로 더한다. 권한 없음·비밀번호 변경 화면은 관리자 로그인으로 찍을 수 없어 E2E(final-screens.spec.ts)에서 axe·390px로 확인한다.
import type { ShotPage } from './types.ts';

export const pages: ShotPage[] = [{ name: 'not-found', url: '/no-such-page', state: 'user', ready: '찾는 화면이 없어요' }];
