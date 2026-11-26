// 첫 화면 JS 크기를 기준값과 견준다(#252). CI의 `web (lint, build)`가 build 뒤에 돌린다.
//   node --experimental-vm-modules scripts/check-initial-js-size.mjs [--dist <폴더>] [--budget <파일>]
//   기본값: --dist web/dist, --budget docs/perf/budget.json (레포 루트 기준)
//
// 재는 것: <dist>/index.html이 처음 싣는 JS(<script src>, <link rel="modulepreload">)와
// 그것이 정적으로 import하는 JS. 파일마다 gzip level 9로 압축한 크기를 더한다.
// 동적 import()로 따로 싣는 화면은 넣지 않는다.
// 정적 import는 <dist>/.vite/manifest.json이 있으면 그것으로, 없으면 빌드 결과 JS를 V8로 파싱해 찾는다.
// 파싱에 쓰는 vm.SourceTextModule은 --experimental-vm-modules를 줘야 있다. 코드를 실행하지는 않는다.
//
// gzip 크기는 Node가 쓰는 zlib에 따라 조금 다르다. CI(setup-node)의 공식 Node는 자기 zlib를 넣어 만든 것이고,
// Homebrew Node는 macOS의 zlib를 쓴다. main 90597bc에서 각각 147,297, 147,203바이트였다(PR #263).
// CI와 같은 값을 보려면 공식 Node(nodejs.org 배포본)로 돌린다. 로그 첫 줄에 zlib 버전이 나온다.
//
// 종료 코드: 0 기준값 이하, 1 기준값 넘음, 2 잴 수 없음(파일 없음, 잘못된 기준값 등)
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GZIP_LEVEL = 9;
// 주소를 dist 안의 파일로 바꿀 때 쓰는 가짜 출처. 다른 출처의 주소는 dist 밖이라 잴 수 없다.
const ORIGIN = 'https://dist.invalid';
const JS_SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript']);

export class MeasureError extends Error {}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new MeasureError(`${path}를 JSON으로 읽지 못했다: ${error.message}`);
  }
}

/** 태그 하나의 속성. 값이 없는 속성은 ''. */
function attributes(tag) {
  const attrs = {};
  const body = tag.replace(/^<[^\s>]+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/** index.html이 처음 싣는 JS의 주소를 문서 순서대로. module이 거짓이면 import를 따라가지 않는다. */
export function initialScripts(html) {
  const scripts = [];
  for (const [tag, name] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(script|link)\b[^>]*>/gi)) {
    const a = attributes(tag);
    if (name.toLowerCase() === 'script') {
      const type = (a.type ?? '').trim().toLowerCase();
      if ('src' in a && JS_SCRIPT_TYPES.has(type)) scripts.push({ url: a.src, as: 'script', module: type === 'module' });
    } else if ('href' in a && (a.rel ?? '').toLowerCase().split(/\s+/).includes('modulepreload')) {
      scripts.push({ url: a.href, as: 'modulepreload', module: true });
    }
  }
  return scripts;
}

/** base(가짜 출처의 주소)를 기준으로 url을 dist 안의 경로('/assets/x.js')로 바꾼다. */
function pathOf(url, base, where) {
  let resolved;
  let path;
  try {
    resolved = new URL(url, base);
    path = decodeURIComponent(resolved.pathname);
  } catch (error) {
    throw new MeasureError(`${where}: 주소 '${url}'를 읽지 못했다: ${error.message}`);
  }
  if (resolved.origin !== ORIGIN) throw new MeasureError(`${where}: dist 밖의 JS '${url}'는 잴 수 없다`);
  return path;
}

/** manifest로 파일 하나의 정적 import를 찾는 함수. */
function manifestImports(manifest, manifestPath) {
  const byFile = new Map(Object.values(manifest).map((chunk) => [`/${chunk.file}`, chunk]));
  return (path) => {
    const chunk = byFile.get(path);
    if (!chunk) throw new MeasureError(`${manifestPath}에 '${path}'가 없다`);
    return (chunk.imports ?? []).map((key) => {
      if (!manifest[key]) throw new MeasureError(`${manifestPath}에 '${key}'(${path}의 import)가 없다`);
      return `/${manifest[key].file}`;
    });
  };
}

/** 빌드 결과 JS를 파싱해 파일 하나의 정적 import를 찾는다. 동적 import()는 나오지 않는다. */
function parsedImports(path, source) {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new MeasureError(
      '.vite/manifest.json이 없어 JS를 파싱해야 하는데 vm.SourceTextModule이 없다. ' +
        'node --experimental-vm-modules로 실행한다',
    );
  }
  let module;
  try {
    module = new vm.SourceTextModule(source, { identifier: path });
  } catch (error) {
    throw new MeasureError(`${path}를 모듈로 읽지 못했다: ${error.message}`);
  }
  const specifiers = module.moduleRequests?.map((request) => request.specifier) ?? module.dependencySpecifiers;
  return specifiers.map((specifier) => {
    // 'react' 같은 이름은 import map이 없으면 브라우저가 풀지 못한다. 빌드 결과에 나오면 잴 수 없다.
    if (!/^(\.{1,2}\/|\/)/.test(specifier) && !/^[a-z][a-z\d+.-]*:/i.test(specifier)) {
      throw new MeasureError(`${path}: 파일 주소가 아닌 import '${specifier}'를 따라갈 수 없다`);
    }
    return pathOf(specifier, `${ORIGIN}${path}`, path);
  });
}

/** index.html이 처음 싣는 JS와 그것이 정적으로 import하는 JS를 모두 찾아 파일마다 잰다. */
export function measureInitialJs(dist) {
  const htmlPath = join(dist, 'index.html');
  if (!existsSync(htmlPath)) throw new MeasureError(`${htmlPath}가 없다. 먼저 build한다`);
  const starts = initialScripts(readFileSync(htmlPath, 'utf8'));
  if (starts.length === 0) throw new MeasureError(`${htmlPath}에서 처음 싣는 JS를 찾지 못했다`);

  const manifestPath = join(dist, '.vite', 'manifest.json');
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
  const importsOf = manifest ? manifestImports(manifest, manifestPath) : parsedImports;

  const files = new Map();
  const queue = [];
  const add = (path, from, module) => {
    if (files.has(path)) return;
    const file = join(dist, path);
    if (relative(dist, file).startsWith('..')) throw new MeasureError(`${from}가 싣는 ${path}가 dist 밖이다`);
    let source;
    try {
      source = readFileSync(file);
    } catch (error) {
      throw new MeasureError(`${from}가 싣는 ${path}를 dist에서 읽지 못했다: ${error.code ?? error.message}`);
    }
    files.set(path, {
      file: path.replace(/^\//, ''),
      from,
      raw: source.length,
      gzip: gzipSync(source, { level: GZIP_LEVEL }).length,
    });
    if (module) queue.push({ path, source });
  };

  for (const start of starts) add(pathOf(start.url, `${ORIGIN}/index.html`, 'index.html'), start.as, start.module);
  while (queue.length > 0) {
    const { path, source } = queue.shift();
    for (const imported of importsOf(path, source.toString('utf8'))) add(imported, '정적 import', true);
  }

  const list = [...files.values()].sort((a, b) => b.gzip - a.gzip || a.file.localeCompare(b.file));
  return {
    method: manifest ? '.vite/manifest.json' : 'JS 파싱',
    files: list,
    raw: list.reduce((sum, f) => sum + f.raw, 0),
    gzip: list.reduce((sum, f) => sum + f.gzip, 0),
  };
}

/** 기준값 파일에서 바이트 수를 읽는다. */
export function readBudget(budgetPath) {
  if (!existsSync(budgetPath)) throw new MeasureError(`기준값 파일 ${budgetPath}가 없다`);
  const bytes = readJson(budgetPath)?.initialJsGzipBytes;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new MeasureError(`${budgetPath}의 initialJsGzipBytes가 양의 정수가 아니다: ${JSON.stringify(bytes)}`);
  }
  return bytes;
}

const n = (value) => value.toLocaleString('en-US');

function verdict(result, budget) {
  const margin = budget - result.gzip;
  return margin >= 0
    ? `통과: 여유 ${n(margin)}바이트`
    : `실패: 기준값을 ${n(-margin)}바이트 넘었다`;
}

// 한글은 터미널에서 두 칸을 차지한다. 로그의 표를 맞추는 데만 쓴다.
const width = (text) => [...text].reduce((sum, ch) => sum + (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(ch) ? 2 : 1), 0);
const pad = (text, size, right) => (right ? ' '.repeat(size - width(text)) + text : text + ' '.repeat(size - width(text)));

/** 로그에 남길 표. */
export function formatLog(result, budget, budgetName) {
  const rows = [['파일', '어디서', '원래', 'gzip'], ...result.files.map((f) => [f.file, f.from, n(f.raw), n(f.gzip)])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => width(row[i]))));
  const line = (row) => row.map((cell, i) => pad(cell, widths[i], i >= 2)).join('  ').trimEnd();
  return [
    `첫 화면 JS (파일마다 gzip level ${GZIP_LEVEL}, zlib ${process.versions.zlib}, 정적 import: ${result.method})`,
    ...rows.map(line),
    `합계 ${result.files.length}개: 원래 ${n(result.raw)}, gzip ${n(result.gzip)}바이트`,
    `기준값 ${n(budget)}바이트(${budgetName}) → ${verdict(result, budget)}`,
  ].join('\n');
}

/** job summary에 남길 마크다운. */
export function formatSummary(result, budget, budgetName) {
  return [
    `### 첫 화면 JS 크기`,
    '',
    `**${verdict(result, budget)}** — gzip ${n(result.gzip)}바이트 / 기준값 ${n(budget)}바이트(\`${budgetName}\`)`,
    '',
    `파일마다 gzip level ${GZIP_LEVEL}(zlib ${process.versions.zlib})로 압축한 크기. 정적 import를 찾은 방법: ${result.method}. 동적 import는 넣지 않는다.`,
    '',
    '| 파일 | 어디서 | 원래 | gzip |',
    '|---|---|---:|---:|',
    ...result.files.map((f) => `| \`${f.file}\` | ${f.from} | ${n(f.raw)} | ${n(f.gzip)} |`),
    `| **합계 ${result.files.length}개** | | **${n(result.raw)}** | **${n(result.gzip)}** |`,
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { dist: join(ROOT, 'web', 'dist'), budget: join(ROOT, 'docs', 'perf', 'budget.json') };
  for (let i = 0; i < argv.length; i += 2) {
    const [name, value] = [argv[i], argv[i + 1]];
    if ((name !== '--dist' && name !== '--budget') || value === undefined) {
      throw new MeasureError(`알 수 없는 인자 ${name}. 쓰는 법: [--dist <폴더>] [--budget <파일>]`);
    }
    options[name.slice(2)] = resolve(value);
  }
  return options;
}

/** 재고 견준다. 종료 코드를 돌려준다. */
export function main(argv = process.argv.slice(2), env = process.env) {
  const annotate = (message) => {
    if (env.GITHUB_ACTIONS === 'true') console.log(`::error title=첫 화면 JS 크기::${message}`);
  };
  try {
    const options = parseArgs(argv);
    const budget = readBudget(options.budget);
    const inRepo = relative(ROOT, options.budget);
    const budgetName = inRepo.startsWith('..') ? options.budget : inRepo;
    const result = measureInitialJs(options.dist);
    console.log(formatLog(result, budget, budgetName));
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, formatSummary(result, budget, budgetName));
    if (result.gzip <= budget) return 0;
    annotate(
      `gzip ${n(result.gzip)}바이트가 기준값 ${n(budget)}바이트(${budgetName})를 ${n(result.gzip - budget)}바이트 넘었다. ` +
        '파일별 크기는 이 단계의 로그와 job summary에 있다. 기준값을 바꾸려면 perf 검토를 받는다',
    );
    return 1;
  } catch (error) {
    if (!(error instanceof MeasureError)) throw error;
    console.error(`잴 수 없다: ${error.message}`);
    annotate(`잴 수 없다: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
