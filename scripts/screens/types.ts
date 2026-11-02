// 이 파일이 하는 일: 스크린샷 화면 목록 항목의 모양(타입). 각 태스크는 scripts/screens/<태스크ID>.ts에서 `export const pages: ShotPage[]`를 내보내면 scripts/screenshots.ts가 자동으로 더한다(병렬 작업 때 PAGES 병합 충돌을 없애려고, 2026-11-02 조정자).
import type { Page } from '@playwright/test';

export interface ShotPage {
  name: string;
  url: string;
  state: 'setup' | 'anon' | 'user';
  /** 화면이 다 그려졌다고 볼 글자 */
  ready: string;
  /** 찍기 전에 할 일(예시 데이터 넣기, 버튼 누르기 등) */
  action?: (page: Page) => Promise<void>;
}
