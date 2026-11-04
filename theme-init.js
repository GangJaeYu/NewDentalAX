// 이 파일이 하는 일: 화면이 그려지기 전에 저장된 밝기 설정(시스템·라이트·다크)을 <html data-theme>에 반영해 깜빡임을 막는다.
// CSP(script-src 'self') 때문에 인라인 스크립트 대신 이 외부 파일을 <head>에서 읽는다. 저장소를 못 읽으면 시스템 설정을 따른다.
/* global window, document */
(function () {
  try {
    var t = window.localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch {
    // 저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등)는 시스템 설정을 따른다
  }
})();
