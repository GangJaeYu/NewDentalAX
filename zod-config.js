// 이 파일이 하는 일: 화면 코드가 불러오기 전에 입력 검사 도구(zod)의 eval 사용을 끈다(phase-05-task-02 보안 점검).
// zod 4는 스키마를 만들 때 new Function("")으로 "eval을 쓸 수 있는지" 떠보는데, CSP(script-src 'self')가 이를 막으면서
// 브라우저에 CSP 위반 보고가 화면마다 남는다(실행은 막히고 기능 문제는 없음). zod가 읽는 전역 설정(jitless)을 먼저 켜 그 시도를 없앤다.
// 모듈 스크립트보다 먼저 실행되도록 index.html <head>에서 읽는다(인라인 스크립트는 CSP가 막으므로 외부 파일).
/* global window */
(function () {
  window.__zod_globalConfig = window.__zod_globalConfig || {};
  window.__zod_globalConfig.jitless = true;
})();
