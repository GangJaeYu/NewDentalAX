// 이 파일이 하는 일: 화면 디자인 시스템·정적 파일 검사(phase-01-task-04). 파일을 직접 읽어야 해서 web/ 밖(tests/)에 둔다. tokens.css가 docs/DESIGN.md §2 표의 라이트·다크 값과 똑같은지,
// Pretendard가 프로젝트 안 파일로만 걸려 있는지(AC5: 인터넷 없이도 글꼴), 홈 화면 추가용 매니페스트·아이콘(FR-091)과
// 엄격한 CSP(style-src·script-src 'self')를 깨는 인라인 스크립트·<style>·style 속성 문자열이 없는지 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** CSS 블록 안 "--이름: 값" 선언을 모두 꺼낸다 */
function declsIn(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[(m[1] ?? '').toLowerCase()] = (m[2] ?? '').trim();
  return out;
}

/** DESIGN §2 표에서 { 토큰: [라이트, 다크] }를 뽑는다(경고 줄처럼 "a / b" 두 토큰을 한 줄에 쓴 경우 포함) */
function designTokens(): Record<string, [string, string]> {
  const md = read('docs/DESIGN.md');
  const sec = md.split('## 2.')[1]?.split('## 3.')[0] ?? '';
  const out: Record<string, [string, string]> = {};
  for (const line of sec.split('\n')) {
    if (!line.startsWith('| `--')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const names = [...(cells[1] ?? '').matchAll(/`(--[a-z0-9-]+)`/g)].map((m) => m[1] as string);
    const light = (cells[2] ?? '').split('/').map((s) => s.trim());
    const dark = (cells[3] ?? '').split('/').map((s) => s.trim());
    names.forEach((n, i) => {
      out[n] = [light[i] ?? '', dark[i] ?? ''];
    });
  }
  return out;
}

describe('디자인 토큰(DESIGN §2)', () => {
  const css = read('web/src/styles/tokens.css');
  const light = declsIn(css.split('@media')[0] ?? '');
  const darkBlock = css.split(':root[data-theme="dark"]')[1]?.split('}')[0] ?? '';
  const dark = declsIn(darkBlock);
  const sysDarkBlock = css.split('prefers-color-scheme: dark')[1]?.split('}\n}')[0] ?? '';
  const sysDark = declsIn(sysDarkBlock);

  it('phase-01-task-04 범위: tokens.css의 라이트·다크 색이 DESIGN §2 표 값과 같다(시스템 다크 설정에도 같은 값)', () => {
    const design = designTokens();
    expect(Object.keys(design).length).toBeGreaterThanOrEqual(15);
    for (const [name, [l, d]] of Object.entries(design)) {
      expect(light[name]?.toUpperCase(), `${name} 라이트`).toBe(l.toUpperCase());
      expect(dark[name]?.toUpperCase(), `${name} 다크`).toBe(d.toUpperCase());
      expect(sysDark[name]?.toUpperCase(), `${name} 시스템 다크`).toBe(d.toUpperCase());
    }
  });

  it('phase-01-task-04 범위: 반지름 6/10/12, 카드 안쪽 18, 목록 줄 40, 카드 사이 16, 상단바 56, 메뉴 232, 본문 최대 1720', () => {
    expect(light['--r-sm']).toBe('6px');
    expect(light['--r-md']).toBe('10px');
    expect(light['--r-lg']).toBe('12px');
    expect(light['--pad']).toBe('18px');
    expect(light['--row']).toBe('40px');
    expect(light['--gap']).toBe('16px');
    expect(light['--top-h']).toBe('56px');
    expect(light['--side']).toBe('232px');
    expect(light['--content-max']).toBe('1720px');
    expect(light['--font']).toMatch(/^"Pretendard Variable"/);
  });
});

describe('글꼴(AC5)', () => {
  it('phase-01-task-04 AC5: Pretendard는 프로젝트 안 /fonts 파일로만 걸려 있고 파일과 라이선스가 있다(외부 글꼴 주소 없음)', () => {
    const base = read('web/src/styles/base.css');
    expect(base).toMatch(/font-family:\s*"Pretendard Variable"/);
    const urls = [...base.matchAll(/url\("?([^")]+)"?\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u === '/fonts/PretendardVariable.woff2')).toBe(true);
    const font = path.join(ROOT, 'web/public/fonts/PretendardVariable.woff2');
    expect(fs.statSync(font).size).toBeGreaterThan(1_000_000);
    expect(fs.readFileSync(font).subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(read('web/public/fonts/OFL.txt')).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    for (const f of fs.readdirSync(path.join(ROOT, 'web/src/styles')).filter((x: string) => x.endsWith('.css'))) {
      expect(read(`web/src/styles/${f}`), f).not.toMatch(/https?:\/\//);
    }
    expect(read('web/index.html')).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});

describe('홈 화면 추가(FR-091)', () => {
  /** PNG 파일의 가로·세로 */
  function pngSize(p: string): [number, number] {
    const b = fs.readFileSync(path.join(ROOT, p));
    expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }

  it('phase-01-task-04 범위: 매니페스트에 이름·시작 주소·standalone·아이콘(192·512)이 있고 아이콘 파일 크기가 맞다', () => {
    const m = JSON.parse(read('web/public/manifest.webmanifest')) as { name: string; start_url: string; display: string; icons: Array<{ src: string; sizes: string }> };
    expect(m.name).toBeTruthy();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    for (const icon of m.icons) {
      const [w, h] = pngSize(`web/public${icon.src}`);
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(pngSize('web/public/icons/apple-touch-icon.png')).toEqual([180, 180]);
    const html = read('web/index.html');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toMatch(/<meta name="theme-color"/);
  });
});

describe('CSP(style-src·script-src self)', () => {
  /** 폴더 아래 파일 모두 */
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else out.push(rel);
    }
    return out;
  }

  it('phase-01-task-04 범위: index.html에 인라인 스크립트·<style>·style 속성이 없고, 화면 코드에 <style> 태그·인라인 이벤트 문자열이 없다', () => {
    const html = read('web/index.html');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(m[1], '스크립트는 src로만').toMatch(/src=/);
      expect((m[2] ?? '').trim()).toBe('');
    }
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
    const files = walk('web/src').filter((f) => f.endsWith('.tsx'));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/<style[\s>]/);
      expect(src, f).not.toMatch(/setAttribute\(\s*['"]style['"]/);
      expect(src, f).not.toMatch(/javascript:/);
    }
  });
});
