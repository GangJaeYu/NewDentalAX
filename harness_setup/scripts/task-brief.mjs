// 이 파일이 하는 일: 별도 세션 검증자(task_validation)에게 넘길 인계서를 태스크 파일에서 만들어 출력한다.
// 사용법: node harness_setup/scripts/task-brief.mjs <태스크ID> [기준 커밋] > 인계서.md
// 구현 대화·STATE/LOG의 구현 추론은 넣지 않는다. 요구·수용 기준·설계 참조·실행 방법·코드 식별만 담는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [taskId, baseRef] = process.argv.slice(2);
if (!/^phase-\d{2}-task-\d{2}$/.test(taskId || '')) {
  console.error('사용법: node harness_setup/scripts/task-brief.mjs phase-NN-task-MM [기준 커밋]');
  process.exit(2);
}
const root = process.cwd();
const ph = taskId.slice(6, 8);
const file = path.join(root, 'plan_setup', `phase-${ph}`, `phase-${ph}-tasks`, `${taskId}.md`);
const text = fs.readFileSync(file, 'utf8');
const git = (...a) => {
  const r = spawnSync('git', a, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '(git 정보 없음)';
};
const head = git('rev-parse', '--short', 'HEAD');
const changed = baseRef ? git('diff', '--stat', `${baseRef}..HEAD`) : '(기준 커밋 미지정)';
const remaining = (fs.readFileSync(path.join(root, 'plan_setup', 'STATE.md'), 'utf8').match(/loop_started_at:[^\n]*/) || ['loop_started_at: 알 수 없음'])[0];

console.log(`# task_validation 인계서 — ${taskId}

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: ${root}
- HEAD: ${head}
- 변경 범위(기준 ${baseRef || '-'}):
\`\`\`
${changed}
\`\`\`

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: \`node harness_setup/scripts/gate.mjs lint ${taskId}\` → \`unit\` → \`e2e\` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: \`$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start\` → \`GET http://localhost:18093/api/health\`
- 스크린샷: \`npm run screenshots\` (화면 태스크)

## 태스크 정의 (원문)
${text}

## 참조 문서
- 요구: docs/PRD.md (위 태스크의 FR/NFR 절)
- 설계: docs/ARCHITECTURE/ (위 "설계 근거" 절)
- 디자인: docs/DESIGN.md

## 예산
- ${remaining} (전체 24시간 중 일부). 검증은 필요한 범위만 한다.

## 반환 형식 (그대로 채워서 마지막 응답으로)
| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
- 게이트 결과: lint=…, unit=…(건수), e2e=…(건수)
- 환경 문제·판정 불가 사유:
- 재현 방법(실패 시):
`);
