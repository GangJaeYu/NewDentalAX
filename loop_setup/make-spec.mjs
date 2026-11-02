// 이 파일이 하는 일: 조정자가 Orca 구현 워커에게 넘길 지시문(spec)을 태스크 ID·슬롯·기준 커밋으로 만들어 loop_setup/specs/에 저장한다.
// 사용법: node loop_setup/make-spec.mjs <태스크ID> <슬롯0-3> [추가 메모 파일]
// 검증 워커 지시문은 harness_setup/scripts/task-brief.mjs가 만든다(구현 추론을 넣지 않기 위해 분리).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const [taskId, slotArg, notePath] = process.argv.slice(2);
if (!/^phase-\d{2}-task-\d{2}$/.test(taskId || '') || !/^[0-3]$/.test(slotArg || '')) {
  console.error('사용법: node loop_setup/make-spec.mjs phase-NN-task-MM <슬롯0-3> [메모파일]');
  process.exit(2);
}
const slot = +slotArg;
const root = process.cwd();
const ph = taskId.slice(6, 8);
const taskRel = `plan_setup/phase-${ph}/phase-${ph}-tasks/${taskId}.md`;
const base = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const state = fs.readFileSync(path.join(root, 'plan_setup/STATE.md'), 'utf8');
const deadline = (state.match(/deadline: ([^`\s]+)/) || [])[1] || '알 수 없음';
const note = notePath ? fs.readFileSync(notePath, 'utf8') : '';

const spec = `# 구현 워커 지시문 — ${taskId}

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@${base}에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

## 먼저 읽을 것
1. \`CLAUDE.md\`(문서 포인터·금지 사항)
2. 태스크 정의: \`${taskRel}\` — frontmatter의 acceptance_criteria가 완료 기준이다
3. \`plan_setup/PLAN.md\` §3 공유 파일 규칙(어기지 말 것)
4. \`harness_setup/HARNESS.md\`와 \`harness_setup/quality_gates/*.md\`(게이트 계약)
5. 태스크의 "설계 근거"에 적힌 \`docs/ARCHITECTURE/\` 절, 관련 \`docs/PRD.md\` FR/NFR, \`docs/TRD.md\` TD
6. 화면이 있으면 \`docs/DESIGN.md\`(승인 기준: 청록 A + 기본 밀도)와 \`docs/design/preview.html\`, 기준선 \`harness_setup/evidence/design-baseline/\`

## 해야 할 일
- 태스크 "범위"를 구현한다. 수용 기준마다 이를 확인하는 테스트를 만든다. 테스트 이름에 \`${taskId} AC<번호>\`를 넣는다(비화면: vitest, 화면·흐름: Playwright).
- 모든 새 소스 파일 첫 5줄 안에 \`이 파일이 하는 일:\` 한국어 주석, 주요 함수에 쉬운 한국어 설명을 단다. 화면·오류 문구는 쉬운 한국어로 쓴다.
- 의존성: \`package-lock.json\`이 있으면 시작할 때 \`npm ci\`. 새 런타임 의존성 추가는 금지(TD-023). 꼭 필요하면 추가하지 말고 보고에 "변경 요청"으로 적는다. (phase-01-task-01만 예외로 TD-023 목록 전체를 설치한다.)
- \`web/dist/\`는 git에 넣지 않는다(.gitignore). e2e 전에 필요하면 빌드만 한다.
- 포트·데이터: 이 워커는 **슬롯 ${slot}**이다. E2E는 \`E2E_PORT=${18090 + slot}\`, 수동 서버는 \`PORT=${18190 + slot}\`, 데이터는 작업 사본 안 \`.tmp/\`만 쓴다. 실제 \`data/\` 폴더나 8090 포트를 쓰지 않는다.
- 무거운 작업(e2e·스크린샷·npm ci)은 한 번에 하나씩 실행한다.

## 검사 (모두 PASS여야 커밋·보고)
\`\`\`
node harness_setup/scripts/gate.mjs lint ${taskId}
node harness_setup/scripts/gate.mjs unit ${taskId}
node harness_setup/scripts/gate.mjs e2e ${taskId}
\`\`\`
- 앞이 FAIL이면 고친 뒤 lint부터 다시 돌린다. 0건 통과·skip·flaky·--fix·스냅샷 갱신·기준 낮추기는 금지다.
- 화면 태스크는 \`npm run screenshots\`(있다면)로 해당 화면을 4너비×2테마로 찍고 직접 열어 DESIGN §5와 기준선을 대조한다. 확인한 파일과 문제를 보고에 적는다.
- 같은 방식으로 3번 실패하면 관찰·가설을 정리하고 다른 전략으로 바꾼다.

## 커밋
- 너의 브랜치에만 커밋한다: \`git add -A && git commit -m "feat(${taskId}): <요약>"\`. push·merge·rebase main 금지.
- 고치지 말 것: \`plan_setup/STATE.md\`, \`plan_setup/LOG.md\`, 태스크 파일의 status, \`PROGRESS.md\`, \`docs/DECISIONS.md\`(결정은 보고에 적으면 조정자가 옮긴다), 다른 태스크 소유 파일, PLAN.md §3의 공유 파일(네 태스크가 소유자가 아니면).

## 금지
실제 LLM API 호출(키 사용), git push, 이 작업 사본 밖 파일 수정, 시스템 전역 설정 변경, 다른 프로세스 종료(네가 띄운 것만 종료), 환자 정보 필드 추가.

## 보고 (worker_done, 이 형식 그대로)
- 커밋: <해시> (브랜치 이름)
- 게이트: lint=<판정·단계 건수>, unit=<판정·건수>, e2e=<판정·건수> (gate.mjs 로그 경로)
- 수용 기준 자체 확인: | AC# | 결과 | 근거(테스트 이름·관찰) |
- 화면 확인(해당 시): 확인한 스크린샷 파일·발견 문제·수정
- 결정(DECISIONS 후보): 날짜·결정·이유
- 변경 요청(공유 파일·의존성): 없으면 "없음"
- 미해결·한계: 없으면 "없음"
결과가 실패여도 같은 형식으로 보고하고 outcome을 실패로 표시한다. 조정자에게 결정이 꼭 필요하면 \`ask\`를 쓰되, 합의 문서(PRD 자율운영 합의)로 답할 수 있는 것은 스스로 정한다.

## 예산
전체 Loop 마감 ${deadline}. 이 태스크는 가능하면 3시간 안에 끝낸다. 길어지면 진행분을 커밋하고 남은 일을 보고한다.
${note ? `\n## 조정자 메모\n${note}\n` : ''}`;

const outDir = path.join(root, 'loop_setup', 'specs');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${taskId}.md`);
fs.writeFileSync(out, spec);
console.log(path.relative(root, out));
