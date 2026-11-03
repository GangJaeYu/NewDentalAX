# SECURITY — 보안 점검 체크리스트

> 이 문서가 하는 일: 원문 7절(보안)과 NFR-002의 보안 항목을 실제로 점검한 결과를 남긴다. 항목마다 **점검 방법(명령·테스트 이름)**, **결과**, **증거**를 적는다.
> 점검: phase-05-task-02, 2026-11-03. 대상: `main@23885ee`에서 갈라진 작업 사본(phase-05-task-02-worker 브랜치). 결과 표기: **통과** / **고침**(결함을 찾아 고친 뒤 통과) / **한계**(받아들인 위험, 이유 기록).
> 미점검 항목: **0개**.

## 1. 요약

| 구분 | 내용 |
|---|---|
| 점검 항목 | 19개 영역(아래 2절), 모두 점검 |
| 찾아서 고친 결함 | 3건(4절) — AI 가격표 출처 주소의 `javascript:` 허용, 원내 도우미 "찾지 못함" 안내에 주민번호 앞자리 저장, 화면 CSP 위반 보고(zod eval 시험) |
| 이중 방어 보강 | 1건 — 주소만으로 권한이 정해지는데 모듈 `assertCan`으로만 막혀 있던 7개 경로를 중앙 권한 표(`API_RULES`)에 추가 |
| 의존성 취약점 | `npm audit --omit=dev` **high 0 · critical 0**(moderate 3, 도달 불가 — 2절 Q) |
| 새 횡단 테스트 | `tests/security/api-sweep.test.ts`(13건), `tests/security/exposure.test.ts`(12건), `tests/e2e/security-xss.spec.ts`(9건) |
| 받아들인 위험 | 5절 — http(암호화 없음), 사진 속 개인정보, 백업에 포함되는 암호화 키 등 |

경로 전수 점검은 서버에 **실제로 등록된 /api 경로 150개**(메서드 기준)를 서버에서 직접 뽑아(`tests/security/sweep-helpers.ts`의 `listApiRoutes`) 하나씩 부른다. 다른 태스크가 새 API를 더해도 자동으로 점검 대상이 된다.

## 2. 체크리스트

### A. 비밀번호 저장(scrypt)
- **점검 방법**
  - 코드 확인: `server/auth/password.ts` — `node:crypto` scrypt(N=2^15, r=8, p=1, 솔트 16바이트, 키 64바이트), `timingSafeEqual` 비교, 없는 아이디도 가짜 해시로 같은 시간(`verifyDummy`).
  - 테스트: `server/auth/password.test.ts` "phase-01-task-03 AC7: 해시에는 평문이 없고, 같은 비밀번호도 솔트 때문에 매번 다르며, 맞는 비밀번호만 통과한다", "phase-01-task-03 AC7: 형식이 틀린 해시는 항상 실패하고, 가짜 확인은 false다"
  - 테스트: `server/auth/auth.test.ts` "phase-01-task-03 AC7: DB 어디에도 평문 비밀번호가 없다(사용한 비밀번호 문자열로 DB 파일 바이트 검색)"
- **결과**: 통과. 첫 설정에 기본 비밀번호가 없고(사용자 0명일 때만 `/api/setup`), 임시 비밀번호 사용자는 바꾸기 전까지 다른 API가 막힌다("phase-01-task-03 범위(must_change_pw): …403 PASSWORD_CHANGE_REQUIRED다").
- **증거**: unit 게이트 로그(6절).

### B. 로그인 시도 제한(잠금)
- **점검 방법**
  - 아이디별: `server/auth/auth.test.ts` "phase-01-task-03 AC2: 틀린 비밀번호 5회 후 6번째는 맞는 비밀번호여도 423 LOCKED, 주입 시계로 15분 뒤에는 로그인된다; 감사 로그에 잠금이 남는다"
  - 기기(IP)별: **새 테스트** `tests/security/exposure.test.ts` "phase-05-task-02 점검(로그인 잠금): 한 기기에서 여러 아이디로 30번 틀리면 그 기기는 15분 동안 423이고, 다른 기기는 그대로 로그인을 시도할 수 있다"
- **결과**: 통과. 기기별 제한에는 그동안 테스트가 없어서 이번에 더했다. 없는 아이디도 똑같이 세어 아이디가 있는지 응답으로 알 수 없다.
- **증거**: unit 게이트 로그.

### C. 세션 만료·로그아웃·쿠키
- **점검 방법**
  - `server/auth/auth.test.ts` "phase-01-task-03 AC3: 마지막 요청 8시간 1분 뒤 요청은 401이고, 8시간 전 요청은 성공하며 만료가 연장된다", "phase-01-task-03 AC3: 정확히 8시간이 지나면 만료다(경계)"
  - `server/modules/admin/admin.test.ts` "phase-01-task-05 AC4: 로그아웃·만료 때 지우는 쿠키도 발급 쿠키처럼 HttpOnly·SameSite=Strict다"
  - **새 테스트** `tests/security/api-sweep.test.ts` "phase-05-task-02 점검(세션): 로그아웃하면 그 쿠키로는 모든 경로가 401이고, 만료(8시간)된 세션도 401이다" — 공개 4개를 뺀 **모든 경로**에서 확인
  - 코드 확인: `server/auth/sessions.ts` — 무작위 32바이트 토큰, DB에는 SHA-256 해시만 저장
- **결과**: 통과. 비밀번호를 바꾸거나 관리자가 초기화하면 다른 세션이 끊긴다("phase-01-task-03 범위(FR-002 AC6): 현재 비밀번호가 맞을 때만 바뀌고, 다른 기기 세션은 끊긴다", "phase-01-task-05 AC1: 비밀번호를 초기화하면…열린 세션은 끊기며…"). 백업 복원 뒤에는 모든 세션이 지워진다(TD-014).
- **증거**: unit 게이트 로그.

### D. 인증(로그인 필요)
- **점검 방법**: **새 테스트** `tests/security/api-sweep.test.ts` "phase-05-task-02 점검(인증): 공개 4개를 뺀 모든 /api 경로는 로그인 없이 401 UNAUTHENTICATED다". 공개는 `GET /health`·`GET /session`·`POST /setup`·`POST /auth/login`뿐이다(`server/auth/guard.ts` `PUBLIC_APIS`).
- **결과**: 통과(146개 경로 모두 401).
- **증거**: unit 게이트 로그.

### E. CSRF(토큰·Origin)
- **점검 방법**
  - **새 테스트** `tests/security/api-sweep.test.ts` "phase-05-task-02 점검(CSRF): 로그인했어도 X-CSRF-Token이 없거나 틀리거나, 다른 사이트 Origin·Sec-Fetch-Site면 모든 상태 변경 요청이 403 CSRF이고 감사 로그가 늘지 않는다" — 모든 쓰기 경로 × 6가지(토큰 없음·틀린 토큰·다른 세션 토큰·다른 사이트 Origin·Referer·`Sec-Fetch-Site: cross-site`), 300회 넘게 요청
  - `server/auth/auth.test.ts` "phase-01-task-03 AC4: CSRF 헤더 없는 POST는 403 CSRF, 로그아웃 후 이전 쿠키로 요청하면 401이다", "phase-01-task-03 AC4: 로그인 요청도 다른 사이트에서 오면 403 CSRF다"
- **결과**: 통과. 쿠키는 `SameSite=Strict`라 다른 사이트 요청에는 애초에 붙지 않고, 토큰·출처 검사가 한 번 더 막는다.
- **증거**: unit 게이트 로그.

### F. 권한 표(역할 3단계)와 빠진 경로
- **점검 방법**
  - **새 테스트** `tests/security/api-sweep.test.ts` "phase-05-task-02 점검(권한 표): backend.md §3의 M·A 전용 경로를 직원이 부르면 모두 403, A 전용은 실장도 403이다" — M 전용 46개, A 전용 26개 경로를 직접 불러 확인
  - **새 테스트** "phase-05-task-02 점검(권한 표): 04-02가 보고한 /trainings·/onboarding/assignments 등 주소만으로 정해지는 M 경로가 중앙 표(API_RULES)에 있어 라우트에 닿기 전에 막힌다"
  - `server/auth/permissions.test.ts` "phase-01-task-03 AC8: 역할 × 대표 API 표 …", "phase-01-task-03 AC8: 경로 뒤 슬래시·%인코딩으로 권한 표를 피해 갈 수 없다"
- **결과**: **고침(이중 방어 보강)**. 모든 M·A 경로가 이미 403이었다(모듈 `assertCan`·`requireCap`). 다만 주소만으로 권한이 정해지는데 중앙 표에 없던 7개 경로를 `server/auth/api-permissions.ts`에 넣었다: `GET /demo/status`, `GET /onboarding/templates`, `POST /onboarding/assignments`, `DELETE /onboarding/assignments/:id`, `POST /trainings`, `PATCH /trainings/:id`, `POST /finance/monthly/summary`. 이제 본문 검사 전에 막힌다. 모듈의 `assertCan`은 그대로 둔다. 본문·작성자에 따라 달라지는 경로(공지 M·인수인계 S, 작성자 또는 M 등)는 표에 넣지 않는다(표의 원칙).
- **증거**: unit 게이트 로그.

### G. 저장형 XSS(사용자 입력이 다시 보이는 모든 화면)
- **점검 방법**
  - **새 E2E** `tests/e2e/security-xss.spec.ts`(Edge 실제 브라우저)
    1. 데모 데이터를 넣고 서버를 멈춘 뒤, DB의 사람이 적는 글 칸 **42종 596줄** 끝에 `<img onerror>`·`<script>`·`<b>`·`<svg onload>` 문자열을 붙인다(공지·인수인계, 문서·버전, 원내 매뉴얼, 리뷰·스크립트 문구, 광고 점검 규칙, 채용·교육·온보딩, 품목·거래처·발주, 장비·멸균·법정 업무, 지출, 직원 이름, 알림, 감사 기록 포함).
    2. `web/src/routes.tsx`에 등록된 **47개 화면 전부**(대시보드·상세·인쇄 포함)를 연다.
    3. 화면마다 HTML로 바뀐 요소(`[data-xss]`) 0개, 스크립트 실행(`window.__xss`) 없음, 대화상자 없음, **CSP 위반 보고 0건**을 확인한다.
    - 테스트 이름: "phase-05-task-02 점검(XSS): 대시보드·데스크·알림 / 재고 / 문서·마케팅 / 인사 / 시설·재무 / 관리 / 인쇄 화면에서 저장된 스크립트가 HTML로 해석·실행되지 않는다", "phase-05-task-02 점검(XSS): 모든 화면이 점검 묶음에 들어 있고, 주요 화면에서는 스크립트 문자열이 글자 그대로 보였다"(45/47 화면에서 글자 그대로 보임 = 빈 시험 아님)
  - **새 테스트** `tests/security/exposure.test.ts` "phase-05-task-02 점검(XSS): 화면 코드에 dangerouslySetInnerHTML·innerHTML·outerHTML·insertAdjacentHTML·document.write·eval·new Function이 없다", "phase-05-task-02 점검(XSS): 화면의 바깥 링크(href)는 서버가 http(s)만 받은 값이다(법정 업무 출처·AI 가격 출처)"
  - 기존: `tests/e2e/docs-writer.spec.ts` "phase-03-task-06 AC5: <script>가 든 본문을 저장해도 미리보기·인쇄에서 실행되지 않는다(XSS)", `web/src/pages/docs/docsLib.test.ts` "phase-03-task-06 AC5: 미리보기 해석기는 <script>·<img onerror>를 태그가 아닌 글자로 남긴다", 린트 `react/no-danger`
- **결과**: **고침 2건 후 통과**
  - AI 모델 가격표의 출처 주소(`sourceUrl`)가 `z.url()`이라 `javascript:`·`data:` 주소도 받았다. 화면이 이 값을 `<a href>`로 쓰므로 http(s)만 받게 고쳤다(`server/ai/pricing.ts`). 관리자만 고칠 수 있고 React 19·CSP가 실행을 막지만, 서버에서 한 번 더 막는다. 법정 업무 출처는 이미 http(s)만 받았다.
  - 화면마다 CSP `script-src eval` 위반 보고가 있었다. 원인은 zod 4가 스키마를 만들 때 `new Function("")`으로 eval 가능 여부를 떠보는 코드(`Button-*.js` 묶음 안 zod)였다. 실행은 CSP가 막고 zod는 다른 방법으로 동작해 기능 문제는 없었지만, 진짜 공격과 구분하기 어렵게 만든다. zod가 읽는 전역 설정 `jitless`를 모듈보다 먼저 켜는 `web/public/zod-config.js`를 `web/index.html` `<head>`에 걸어 위반 보고를 0으로 만들었다.
- **증거**: e2e 게이트 로그(6절). 실행 출력의 `[security-xss]` 줄에 바꾼 칸 목록과 글자 그대로 보인 화면 목록이 있다.

### H. SQL 인젝션(검색어·정렬 열·필터, 모든 목록 API)
- **점검 방법**
  - **새 테스트** `tests/security/api-sweep.test.ts`
    - "phase-05-task-02 AC3: ' OR 1=1 -- 같은 인젝션 문자열을 검색어로 넣어도 모든 목록 API가 정상 응답(200, 길이 초과는 400 한국어)이고, 없는 검색어보다 결과가 많아지지 않는다(데이터 노출 없음)" — 모든 GET 경로 × 검색 칸 5종(`q·search·keyword·tag·folder`) × 인젝션 13종. "항상 참" 문자열은 결과 수가 **없는 검색어와 같아야** 하고, 특수 글자(`*`·`"` 등)는 전체보다 많으면 안 된다. 검색어가 실제로 결과를 줄이는 API가 6개 이상인지도 확인한다(빈 시험 방지).
    - "phase-05-task-02 AC3: 정렬·필터 칸(sort·order·status·kind·from·to·page 등)에 인젝션 문자열을 넣어도 500이 없고, 표·사용자 수·DB 무결성이 그대로다" — 정렬·필터 칸 28종, 5천 회 넘게 요청한 뒤 표 목록·사용자 수·`PRAGMA integrity_check`
    - "phase-05-task-02 AC3: 인젝션 문자열로 저장한 글은 값 그대로 저장·조회되고, 검색어로 다시 찾아도 그 글만 나온다"
    - "phase-05-task-02 AC3: 원내 도우미 질문(전문 검색 FTS MATCH)에 인젝션·FTS 연산자 문자열을 넣어도 500이 없다"
  - **새 정적 검사** `tests/security/exposure.test.ts` "phase-05-task-02 점검(SQL): 서버 코드에서 요청 값(req.*)을 SQL 글에 직접 붙이는 곳이 없다"
  - 기존: `server/db/index.test.ts` "phase-01-task-02 AC1: all/get/run은 배열·이름 매개변수를 바인딩하고, 인젝션 문자열은 값으로만 저장된다"
  - 코드 확인: SQL에 `${…}`로 글을 붙이는 곳을 모두 읽었다. 붙는 것은 고정 조건 글(`where.join(' AND ')`), 자리표시자 목록(`?, ?, ?`), 고정 열 이름 표(`FIELD_COLUMNS`·`map`·`col`)뿐이고, 값은 모두 `?`·`:이름` 바인딩이다. 열 이름이 입력 키에서 오는 곳(장비·법정 업무·지출·품목 수정)은 zod가 모르는 키를 지우므로 표에 있는 열만 들어간다.
- **결과**: 통과(수용 기준 AC3 충족). `' OR 1=1 --`는 검색을 하는 모든 API에서 200이고 결과는 없는 검색어와 같다(데이터 노출 없음). 긴 UNION 문자열 등 길이 제한을 넘는 값은 400과 한국어 안내다.
- **증거**: unit 게이트 로그.

### I. 입력 검증(zod)
- **점검 방법**
  - **새 테스트** `tests/security/api-sweep.test.ts` "phase-05-task-02 점검(입력 검증): 모든 상태 변경 API에 깨진 JSON·배열·문자열·너무 긴 값·__proto__를 보내도 500이 없고, 4xx 오류는 한국어 안내다" — 관리자 권한으로 모든 쓰기 경로 × 6가지 본문(400회 넘게), 프로토타입 오염 없음 확인
  - **새 정적 검사** `tests/security/exposure.test.ts` "phase-05-task-02 점검(입력 검증): 라우트는 req.body·req.query·req.params를 parseInput(zod) 없이 읽지 않는다(검토한 예외만 허용)" — 예외 5곳은 코드를 읽고 다음 줄에서 검사하는 것을 확인(백업 이름 정규식, multipart/JSON 겸용 2곳, 모르는 키 거부 1곳, CSV 형식 비교 1곳)
  - 기존: `server/security/security.test.ts` "phase-01-task-03 범위(NFR-002 AC5): 잘못된 입력은 400 VALIDATION과 항목별 한국어 이유로 바뀐다", "…JSON이 아닌 본문·빈 본문도 400 한국어 응답이다"
- **결과**: 통과.
- **증거**: unit 게이트 로그.

### J. 보안 헤더(CSP 등)
- **점검 방법**
  - **새 테스트** `tests/security/api-sweep.test.ts` "phase-05-task-02 점검(보안 헤더): 모든 경로의 응답(성공·401·403·400·404)에 CSP·nosniff·frame-ancestors·Referrer-Policy·COOP가 있다" — 모든 경로 × (로그인 없음·직원)
  - 기존: `server/security/security.test.ts` "phase-01-task-03 AC6: 모든 응답에 CSP·nosniff·frame-ancestors·Referrer-Policy 헤더가 있다"(화면 파일·SPA 폴백·404 포함), "phase-01-task-03 AC6: API 응답은 저장되지 않게 no-store를 붙인다"; `tests/e2e/auth-api.spec.ts` "phase-01-task-03 AC6: 보안 헤더(CSP)가 걸린 상태로 첫 화면이 오류 없이 열린다"
- **결과**: 통과. CSP: `default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, 그 밖에 `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`. 인라인 스크립트가 없어(`theme-init.js`·`zod-config.js`는 외부 파일) `'unsafe-inline'`이 필요 없다.
- **증거**: unit·e2e 게이트 로그.

### K. 원내망 제한(IPv4-mapped 포함)
- **점검 방법**
  - **새 테스트** `tests/security/api-sweep.test.ts` "phase-05-task-02 점검(원내망): 관리자 쿠키가 있어도 외부 주소(8.8.8.8·::ffff:8.8.8.8·2001:db8::1)에서 온 모든 요청은 403 NETWORK_BLOCKED다" — 모든 경로 × 4개 주소(16진 표기 IPv4-mapped `::ffff:7f00:1`도 막힘 = 알 수 없는 표기는 막는 쪽)
  - 기존: `server/security/security.test.ts` "phase-01-task-03 AC5: 원격 주소 8.8.8.8로 흉내 낸 요청은 403 NETWORK_BLOCKED…", "…주소 판별 표(사설망·루프백·링크로컬·IPv6는 허용, 공인 주소는 거부)", "…이중 스택(::)으로 들어오는 IPv4-mapped·IPv6 주소도 같은 규칙으로 판별한다…", "…X-Forwarded-For로 원내 주소를 흉내 내도 막힌다", "…config.json의 allowExternal: true면 외부 주소도 허용된다"
- **결과**: 통과. 프록시를 쓰지 않으므로 `X-Forwarded-For`는 믿지 않는다.
- **증거**: unit 게이트 로그.

### L. 파일 업로드(확장자·매직 넘버·크기·HTML·SVG 거부, attachment)
- **점검 방법**
  - **새 테스트** `tests/security/exposure.test.ts` "phase-05-task-02 점검(업로드): 파일을 받는 모든 API가 HTML·SVG·확장자만 바꾼 실행 파일(.pdf·.jpg·.png)·.exe를 4xx로 거부하고 업로드 폴더·files 표에 아무것도 남기지 않는다" — 파일을 받는 7개 API(문서 보관함·원내 매뉴얼·명세서 사진·지출 증빙·장비 기록·교육 증빙·품목 CSV) × 위험 파일 10종
  - **새 테스트** "phase-05-task-02 점검(업로드): 정상 PDF는 올라가고, 내려받을 때 attachment·nosniff·원래 MIME으로 온다(브라우저가 열지 않음)" — 파일 이름의 따옴표·줄바꿈이 헤더를 깨지 못함도 확인
  - 기존: `server/modules/docs/docs.test.ts` "phase-03-task-06 AC4: checkUpload은 쓰임새별 확장자·매직 넘버·크기(사진 8MB)를 함께 본다", "phase-03-task-06 AC4: 확장자만 바꾼 실행 파일·HTML·SVG도 415, 정상 PDF는 uploads/YYYY/MM/<무작위>.pdf로 저장되고 첨부 파일로 내려받는다"; `server/modules/inventory/receipt.test.ts` "phase-04-task-08 AC2: 긴 변 1600px를 넘는 4000×3000 사진은 413…"; 저장 경로 탈출 방지(`storedFilePath`)
- **결과**: 통과. 저장 이름은 무작위 ID이고 원래 이름은 DB에만 둔다. 내려받기는 모두 `sendAttachment`(attachment·nosniff·no-store)를 거친다. 백업 zip 이름은 정규식으로 검사한다.
- **증거**: unit 게이트 로그.

### M. CSV 수식 주입
- **점검 방법**
  - **새 테스트** `tests/security/exposure.test.ts` "phase-05-task-02 점검(CSV): 품목·거래처·입출고·지출·멸균·감사 기록의 글자 칸에 =HYPERLINK·+·-·@ 수식을 넣어도, 모든 CSV 내려받기의 칸이 수식으로 시작하지 않는다" — CSV 내려받기 8곳 전부를 papaparse로 다시 읽어 칸마다 확인, 막힌 수식 칸이 20개 넘게 나왔는지(빈 시험 방지)
  - 기존: `server/modules/admin/admin.test.ts` "phase-01-task-05 AC5: CSV 칸은 쉼표·따옴표를 감싸고, 수식으로 시작하는 값은 실행되지 않게 막는다"; `server/modules/facility/sterilizer.test.ts` "phase-04-task-03 AC4: CSV 칸이 =, +, -, @로 시작하면 수식으로 실행되지 않게 작은따옴표를 붙인다"
- **결과**: 통과. 모든 CSV는 `server/lib/csv.ts`의 `toCsv` 한 곳을 거친다(음수 숫자는 그대로).
- **증거**: unit 게이트 로그.

### N. API 키 암호화·마스킹·로그 미기록
- **점검 방법**
  - **새 테스트** `tests/security/exposure.test.ts` "phase-05-task-02 점검(API 키): 세 공급자 키를 저장한 뒤 관리자·직원으로 모든 GET API를 불러도 응답·헤더에 키 원문이 없고, DB에는 암호문만 있다" — 모든 GET 경로 × 2개 역할, 키 원문과 "끝 4자리를 뺀 앞부분" 둘 다 검색, DB·WAL 파일 바이트 검색
  - 기존: `server/ai/gateway.test.ts` "phase-02-task-02 AC6: /api/ai/settings 응답·HTML·로그 파일·DB 파일 어디에도 키 원문이 없고 끝 4자리 가림만 보인다", "phase-02-task-02 AC6: 설정 변경 감사 로그에는 키가 아니라 바뀐 공급자 이름만 남는다"; `server/ai/units.test.ts` "phase-02-task-02 AC6: AES-GCM으로 암호화·복호화하고 secret.key(32바이트)를 데이터 폴더에 만든다, 가림은 끝 4자리만"; `server/db/audit-log.test.ts` "phase-01-task-02 AC2: detail의 비밀번호·토큰·키 항목은 저장 전에 가린다…"
- **결과**: 통과. 공급자 호출은 서버에서만 하고, 키는 브라우저로 내려가지 않는다.
- **증거**: unit 게이트 로그.

### O. 감사 로그 변경 불가
- **점검 방법**: `server/db/audit-log.test.ts` "phase-01-task-02 AC2: audit_log에 UPDATE를 실행하면 오류가 나고 행이 그대로 남는다", "…DELETE를 실행하면 오류가 나고 행이 그대로 남는다", "…트랜잭션 안에서 지우려 해도 되돌려지고 앞서 쓴 기록도 남는다"; `tests/e2e/backup-reset.spec.ts` "phase-02-task-05 AC5·AC6: 초기화는 확인 문구가 맞아야 실행되고, 실행 뒤 업무 데이터는 비며 관리자·설정·감사 로그·AI 사용 기록이 남고…"; 코드 확인: `001_core.sql`의 `audit_log_no_update`·`audit_log_no_delete` 트리거, 감사 기록을 지우는 API 없음(`grep "DELETE FROM audit_log"` 0건)
- **결과**: 통과. 새 CSRF 점검은 거부된 요청이 감사 로그를 늘리지 않는 것도 확인한다.
- **한계**: DB 파일을 직접 고치는 것(서버 PC에 접근한 사람)은 막을 수 없다. 백업 보관이 그 대비다.
- **증거**: unit·e2e 게이트 로그.

### P. 개인정보 필터 우회(AI 입력 경로마다 gateway를 거치는지)
- **점검 방법**
  - **새 정적 검사** `tests/security/exposure.test.ts` "phase-05-task-02 점검(개인정보 필터): 공급자 호출 코드(server/ai/providers)는 게이트웨이(server/ai/gateway.ts)만 불러 쓴다" — 그리고 게이트웨이가 보낼 글 전체(`[prompt.system, prompt.user]`)를 `filterTexts`로 검사하는지
  - **새 테스트** "phase-05-task-02 점검(개인정보 필터): 글을 받는 13개 AI 기능 모두(/api/ai/run·/api/ai/stream)에서 주민번호가 든 입력은 422 AI_PII_BLOCKED이고 가짜 공급자에게 요청이 하나도 가지 않는다" — 기능마다 입력 스키마를 읽어 **모든 글 칸(자유 이름 칸 포함)**에 주민번호를 넣은 입력을 만든다
  - **새 테스트** "phase-05-task-02 점검(개인정보 필터): 모듈 AI 경로(원내 도우미 질문·광고 점검 AI 2차)도 주민번호가 든 글을 공급자에게 보내지 않는다" — 원내 도우미는 근거 문서 조각까지 프롬프트에 들어간 뒤 검사된다
  - 기존: `server/ai/gateway.test.ts` "phase-02-task-02 AC5: 주민번호가 든 입력은 422 AI_PII_BLOCKED이고 가짜 서버에 요청이 가지 않는다", "…전화번호는 [전화번호]로 가려진 채 전송되고…", "…공급자 응답에 든 전화번호도 저장·표시 전에 가린다"; `server/privacy/filter.test.ts`(phase-02-task-01 AC2~AC4)
- **결과**: **고침 1건 후 통과**. 원내 도우미가 근거를 찾지 못했을 때 만드는 안내 문구가 **가리기 전 질문**으로 만들어져, 주민번호 앞 6자리(예: `"직원 주민번호 900101"`)가 대화 기록(`assistant_messages`)에 저장됐다. 질문 줄은 가린 뒤 저장되고 있었다. 안내도 가린 질문으로 만들게 고쳤다(`server/modules/assistant/service.ts`). 공급자로 나간 것은 아니다.
- **한계**: 명세서 사진(`receipt`)은 그림이라 글자 필터로 검사할 수 없다(5절).
- **증거**: unit 게이트 로그.

### Q. 의존성 취약점(`npm audit --omit=dev`)
- **점검 방법**: `npm audit --omit=dev` (2026-11-03, Node 24.13.0, npm 11.6.2)
- **결과**: 통과(수용 기준 AC1 충족). **high 0, critical 0**, moderate 3.
  - moderate 3건은 모두 `@fastify/static@10.1.8 → glob@13.0.6 → minimatch@10.2.6` 한 줄기다(GHSA-3g3m-2fjr-6pw4 AbortSignal 취소 우회, GHSA-g3hv-75wg-m249 globparts 증폭).
  - **도달 불가**: `@fastify/static`은 `wildcard: false`일 때만 glob을 부르는데, 우리는 `wildcard: true`(`server/app.ts`)라 glob이 실행되지 않는다. 고정 패턴(`**/**`)만 쓰고 사용자 입력도 들어가지 않는다.
  - 고치려면 `npm audit fix --force`가 `@fastify/static@6`(큰 버전 내림)을 깔아야 해서 하지 않았다. 의존성 추가·변경은 이 태스크 범위 밖(TD-023)이다. `@fastify/static`에 고친 판이 나오면 올린다.
  - 개발 도구까지 포함한 `npm audit`은 moderate 16, high·critical 0이다(eslint·autocannon 등, 설치 PC에서 실행되지 않음).
- **증거**: `harness_setup/evidence/phase-05-task-02/npm-audit-omit-dev.txt`(전체 출력과 `--json` 요약)

### R. 스키마에 환자 정보 없음
- **점검 방법**: `tests/schema-privacy.test.ts`(NFR-001, 모든 마이그레이션 적용 뒤 열 이름 검사)
- **결과**: 통과. 이번 점검은 테이블·입력란을 추가하지 않았다.
- **증거**: unit 게이트 로그.

### S. 외부 공개 시 위험(README로 넘길 문구)
- **점검 방법**: 설계(TD-007·008·014·017)와 실제 설정을 읽고 정리했다.
- **결과**: 5절에 README에 그대로 옮길 문구를 적었다(README는 phase-05-task-04 담당).
- **증거**: 이 문서 5절.

## 3. 새로 만든 점검 도구

| 파일 | 내용 |
|---|---|
| `tests/security/sweep-helpers.ts` | 데모 데이터를 넣은 테스트 서버, 등록된 모든 /api 경로 뽑기(`listApiRoutes`), 경로 칸 채우기 |
| `tests/security/api-sweep.test.ts` | 인증·세션·CSRF·헤더·원내망·권한 표·SQL 인젝션·입력 검증 전수 점검(13건) |
| `tests/security/exposure.test.ts` | API 키·CSV 수식·업로드·기기별 로그인 제한·AI 개인정보 경로·정적 검사(12건) |
| `tests/e2e/security-xss.spec.ts` | 저장형 XSS 전 화면 점검(9건, Playwright의 testDir가 tests/e2e라 여기 둔다) |

다시 돌리는 방법: `node harness_setup/scripts/gate.mjs unit phase-05-task-02`, `node harness_setup/scripts/gate.mjs e2e phase-05-task-02`, 의존성은 `npm audit --omit=dev`.

## 4. 고친 결함

| # | 결함 | 위험 | 고친 파일 | 확인 테스트 |
|---|---|---|---|---|
| 1 | AI 모델 가격표 출처 주소(`sourceUrl`)가 `javascript:`·`data:` 주소를 받음 | 관리자 화면 링크로 스크립트 주소가 들어갈 수 있음(React 19·CSP가 실행은 막음) | `server/ai/pricing.ts`(http·https만) | "phase-05-task-02 점검(XSS): 화면의 바깥 링크(href)는 서버가 http(s)만 받은 값이다…" |
| 2 | 원내 도우미 "찾지 못함" 안내 문구를 가리기 전 질문으로 만들어 대화 기록에 저장 | 주민번호 앞 6자리 같은 개인정보 일부가 DB에 남음 | `server/modules/assistant/service.ts`(가린 질문으로 안내) | "phase-05-task-02 점검(개인정보 필터): 모듈 AI 경로(원내 도우미 질문·광고 점검 AI 2차)도 …" |
| 3 | 모든 화면에서 CSP `script-src eval` 위반 보고(zod 4의 eval 가능 여부 시험) | 기능 문제는 없지만 진짜 공격 보고와 섞여 감지가 어려워짐 | `web/public/zod-config.js`(새 파일), `web/index.html`(스크립트 한 줄) | "phase-05-task-02 점검(XSS): … 화면에서 저장된 스크립트가 HTML로 해석·실행되지 않는다"(CSP 위반 0건 조건) |
| 보강 | 주소만으로 정해지는 M·A 경로 7개가 중앙 권한 표에 없음 | 지금은 모듈이 막지만, 나중에 라우트를 고칠 때 빠질 수 있음 | `server/auth/api-permissions.ts`(7줄 추가) | "phase-05-task-02 점검(권한 표): 04-02가 보고한 …" |

## 5. 받아들인 위험과 README로 넘길 문구(외부 공개 시 위험)

아래 문구는 README의 "보안·주의" 절에 그대로 옮긴다(phase-05-task-04).

- **이 프로그램은 병원 안 네트워크 전용입니다.** 원내 와이파이·유선망 밖(인터넷)에서 오는 접속은 서버가 막습니다(403). 공유기의 "포트 포워딩"이나 "DMZ"로 8090 포트를 인터넷에 열지 마세요.
- **`data/config.json`의 `allowExternal: true`는 켜지 마세요.** 켜면 원내망 제한이 꺼져 인터넷 어디서나 로그인 화면에 닿을 수 있습니다. 이 프로그램은 http(암호화 없음)라서 외부에 열면 비밀번호와 업무 내용이 그대로 지나갑니다. 원외 접속이 꼭 필요하면 병원 VPN을 먼저 설치하고, VPN 안에서만 접속하세요.
- **연결은 암호화되지 않습니다(http).** 같은 원내망 안에서 다른 사람이 통신을 엿볼 수 있으므로, 병원 와이파이에는 강한 비밀번호(WPA2/WPA3)를 걸고 손님용 와이파이와 나누세요. (사용자 결정 TD-017: http 유지)
- **백업 폴더에는 API 키를 푸는 열쇠(`secret.key`)도 들어 있습니다.** 다른 PC로 복원해도 키를 다시 넣지 않게 하기 위해서입니다. 백업 폴더나 내려받은 zip을 USB·메일·클라우드로 원내 밖에 옮길 때는 잠긴 곳에 보관하세요. 잃어버렸다면 관리 화면에서 AI 키를 바로 바꾸세요(공급자 사이트에서 옛 키 삭제).
- **서버 PC의 `data` 폴더 자체가 모든 기록입니다.** 서버 PC에는 Windows 로그인 비밀번호를 걸고, 직원 공용 계정으로 쓰지 마세요. 파일을 직접 고치는 것은 프로그램이 막을 수 없습니다(감사 로그 변경 금지는 프로그램 안에서만 지켜집니다).
- **사진 속 개인정보는 자동으로 가려지지 않습니다.** 명세서 사진을 AI로 읽을 때 글자 필터는 사진 속 글을 검사할 수 없습니다. 환자 이름·연락처가 찍힌 종이는 찍지 마세요.
- **환자 개인정보는 어디에도 입력하지 마세요.** AI 입력은 주민번호·카드번호를 막고 전화번호·이메일을 가리지만, 이름처럼 규칙으로 알아볼 수 없는 정보는 걸러지지 않습니다.
- **처음 실행할 때 Windows 방화벽 허용 창**이 뜨면 "개인 네트워크"만 허용하세요("공용 네트워크"는 허용하지 않기).
- **업데이트**: 새 판을 받을 때는 `npm audit --omit=dev`로 high·critical 취약점이 0인지 확인하는 것이 좋습니다(개발 PC에서).

## 6. 게이트 결과(이 점검 커밋 기준)

| 게이트 | 판정 | 로그 |
|---|---|---|
| lint | PASS — tsc-server 299, tsc-web 155, eslint 432, headers 470(main@b3c8546 병합 뒤) | `harness_setup/evidence/runs/2026-11-03T00-26-29-564Z-phase-05-task-02-lint.log` |
| unit | PASS — 757건(새 보안 테스트 25건 포함). 앞서 실패하던 05-01 성능 단언은 main@b3c8546에서 성능 모드(PERF_STRICT=1, `npm run perf`)로 옮겨졌다 | `harness_setup/evidence/runs/2026-11-03T00-26-58-953Z-phase-05-task-02-unit.log` |
| e2e | PASS — 253건(새 `security-xss.spec.ts` 9건 포함) | `harness_setup/evidence/runs/2026-11-03T00-09-58-784Z-phase-05-task-02-e2e.log` |

게이트 판정·건수는 이 태스크의 worker_done 보고와 `plan_setup/LOG.md`(조정자가 옮김)에도 적는다. task_validation은 별도 세션이 수행한다.
