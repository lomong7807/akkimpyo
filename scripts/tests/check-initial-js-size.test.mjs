// scripts/check-initial-js-size.mjs의 테스트. CI의 `web (lint, build)`가 크기 검사 단계에서 같이 돌린다.
//   node --test scripts/tests/check-initial-js-size.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-initial-js-size.mjs');
const PARSE_FLAGS = ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning'];

// 빌드 결과를 흉내 낸다.
//   index.html → entry(script), shared(modulepreload)
//   entry → shared(정적), lazy(동적, 크다)
//   shared → deep(정적, index.html에는 없다)
const FILES = {
  'assets/entry.js':
    'const __vite__mapDeps=(i)=>i.map(x=>"assets/lazy.js");\n' +
    'import{s as e}from"./shared.js";' +
    'const t=()=>import("./lazy.js");' +
    'const u=`import"./not-an-import.js"`;' +
    'console.log(e,t,u,"entry ".repeat(200));\n',
  'assets/shared.js': 'import{d as e}from"./deep.js";export const s=e+"shared ".repeat(100);\n',
  'assets/deep.js': 'export const d="deep ".repeat(50);\n',
  'assets/lazy.js': `export default ${JSON.stringify('lazy '.repeat(20000))};\n`,
};
const INITIAL = ['assets/entry.js', 'assets/shared.js', 'assets/deep.js'];
const GZIP = Object.fromEntries(
  Object.entries(FILES).map(([file, text]) => [file, gzipSync(Buffer.from(text), { level: 9 }).length]),
);
const TOTAL = INITIAL.reduce((sum, file) => sum + GZIP[file], 0);

const n = (value) => value.toLocaleString('en-US');

function fixture(t, { manifest = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'initial-js-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dist = join(dir, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(
    join(dist, 'index.html'),
    [
      '<!doctype html><html><head>',
      '<!-- <script type="module" src="/assets/lazy.js"></script> -->',
      '<script type="module" crossorigin src="/assets/entry.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/shared.js">',
      '<link rel="stylesheet" href="/assets/style.css">',
      '</head><body></body></html>',
    ].join('\n'),
  );
  for (const [file, text] of Object.entries(FILES)) writeFileSync(join(dist, file), text);
  if (manifest) {
    mkdirSync(join(dist, '.vite'));
    writeFileSync(
      join(dist, '.vite', 'manifest.json'),
      JSON.stringify({
        'index.html': { file: 'assets/entry.js', isEntry: true, imports: ['_shared.js'], dynamicImports: ['src/lazy.ts'] },
        '_shared.js': { file: 'assets/shared.js', imports: ['_deep.js'] },
        '_deep.js': { file: 'assets/deep.js' },
        'src/lazy.ts': { file: 'assets/lazy.js', isDynamicEntry: true, imports: ['index.html'] },
      }),
    );
  }
  return { dir, dist };
}

function check({ dir, dist }, budget, flags = PARSE_FLAGS) {
  const budgetFile = join(dir, 'budget.json');
  const summaryFile = join(dir, 'summary.md');
  writeFileSync(budgetFile, JSON.stringify({ initialJsGzipBytes: budget }));
  writeFileSync(summaryFile, '');
  const run = spawnSync(process.execPath, [...flags, SCRIPT, '--dist', dist, '--budget', budgetFile], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile },
  });
  return { status: run.status, log: run.stdout + run.stderr, summary: readFileSync(summaryFile, 'utf8') };
}

test('기준값 이하면 통과한다. 정적 import는 따라가고 동적 import는 넣지 않는다', (t) => {
  const result = check(fixture(t), TOTAL);

  assert.equal(result.status, 0, result.log);
  assert.match(result.log, new RegExp(`합계 3개: .* gzip ${n(TOTAL)}바이트`));
  assert.match(result.log, /통과: 여유 0바이트/);
  for (const file of INITIAL) assert.match(result.log, new RegExp(`${file} .* ${n(GZIP[file])}$`, 'm'));
  assert.doesNotMatch(result.log, /lazy\.js|not-an-import/);
  assert.doesNotMatch(result.log, /::error/);
  assert.match(result.summary, /통과: 여유 0바이트/);
});

test('기준값을 넘으면 실패하고, 잰 크기·기준값·파일별 크기를 로그와 job summary에 남긴다', (t) => {
  const result = check(fixture(t), TOTAL - 1);

  assert.equal(result.status, 1, result.log);
  for (const text of [result.log, result.summary]) {
    assert.match(text, new RegExp(`gzip ${n(TOTAL)}바이트`));
    assert.match(text, new RegExp(`기준값 ${n(TOTAL - 1)}바이트`));
    assert.match(text, /실패: 기준값을 1바이트 넘었다/);
    for (const file of INITIAL) assert.match(text, new RegExp(`${file}.*${n(GZIP[file])}`));
  }
  assert.match(result.log, /^::error title=첫 화면 JS 크기::.*perf 검토/m);
});

test('.vite/manifest.json이 있으면 JS를 파싱하지 않고 manifest로 정적 import를 찾는다', (t) => {
  const result = check(fixture(t, { manifest: true }), TOTAL - 1, []);

  assert.equal(result.status, 1, result.log);
  assert.match(result.log, /정적 import: \.vite\/manifest\.json/);
  assert.match(result.log, new RegExp(`합계 3개: .* gzip ${n(TOTAL)}바이트`));
  assert.doesNotMatch(result.log, /lazy\.js/);
});
