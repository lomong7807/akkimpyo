// 진단 측정(perf/run-diagnosis.sh)이 남긴 실행 계획 원문에서 숫자를 뽑는다. 원인은 해석하지 않는다.
//   node perf/summarize-diagnosis.mjs <결과 폴더>          마크다운 표
//   node perf/summarize-diagnosis.mjs --json <결과 폴더>   JSON
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE =
  /^(\s*)(?:->\s+)?(.+?)\s+\(cost=[\d.]+\.\.([\d.]+) rows=(\d+) width=\d+\)(?: \(actual time=([\d.]+)\.\.([\d.]+) rows=(\d+) loops=(\d+)\)| \(never executed\))/;
const JOIN = /^(Parallel )?(Nested Loop|Hash|Merge)( \w+)*( Join)?$/;

const isJoin = (name) => /^(Parallel )?(Nested Loop|.*Hash.* Join|.*Merge.* Join)/.test(name) && JOIN.test(name.replace(/ (Left|Right|Full|Semi|Anti)/, ''));

/** "Index Scan using 인덱스 on 테이블 별칭" 같은 노드 이름에서 종류, 테이블, 인덱스를 나눈다. */
export function describe(label) {
  const indexOnly = label.match(/^(.*?) using (\S+) on (\S+)/);
  if (indexOnly) return { kind: indexOnly[1], index: indexOnly[2], table: indexOnly[3] };
  const bitmapIndex = label.match(/^(Bitmap Index Scan) on (\S+)/);
  if (bitmapIndex) return { kind: bitmapIndex[1], index: bitmapIndex[2], table: null };
  const scan = label.match(/^(.*? Scan) on (\S+)/);
  if (scan) return { kind: scan[1], index: null, table: scan[2] };
  return { kind: label, index: null, table: null };
}

const pair = (text, name) => Number((text.match(new RegExp(`${name}=([\\d.]+)`)) || [0, 0])[1]);

/** 실행 한 번(계획 원문의 줄 목록)을 읽는다. */
export function parseRun(lines) {
  const nodes = [];
  const run = { lines, nodes, buffers: null, ioRead: 0, planning: 0, execution: 0, jit: false, workers: 0, heapBlocks: 0, heapFetches: [], tempRead: 0, tempWritten: 0, triggers: 0 };
  let inPlanning = false;
  for (const line of lines) {
    const node = line.match(NODE);
    if (node) {
      const [, indent, label, cost, est, , total, rows, loops] = node;
      nodes.push({ depth: indent.length, label, ...describe(label), cost: Number(cost), est: Number(est), total: Number(total), rows: Number(rows), loops: Number(loops), executed: rows !== undefined });
      continue;
    }
    const text = line.trim();
    if (text === 'Planning:') inPlanning = true;
    if (text.startsWith('Planning Time:')) { run.planning = Number(text.split(' ')[2]); inPlanning = false; }
    if (text.startsWith('Execution Time:')) run.execution = Number(text.split(' ')[2]);
    if (text === 'JIT:') run.jit = true;
    if (text.startsWith('Workers Launched:')) run.workers = Math.max(run.workers, Number(text.split(' ')[2]));
    if (text.startsWith('Heap Blocks:')) run.heapBlocks += pair(text, 'exact') + pair(text, 'lossy');
    if (text.startsWith('Heap Fetches:')) run.heapFetches.push({ index: nodes.at(-1).index, count: Number(text.split(' ')[2]) });
    if (text.startsWith('Trigger for constraint')) run.triggers += pair(text, 'time');
    if (inPlanning) continue;
    if (text.startsWith('Buffers:') && nodes.length === 1 && run.buffers === null) {
      run.buffers = { hit: pair(text, 'shared hit') || pair(text.replace(/temp.*/, ''), 'hit'), read: pair(text.replace(/temp.*/, ''), 'read') };
      const temp = text.match(/temp (.*)$/);
      if (temp) { run.tempRead = pair(temp[1], 'read'); run.tempWritten = pair(temp[1], 'written'); }
    }
    if (text.startsWith('I/O Timings:') && nodes.length === 1 && run.ioRead === 0) run.ioRead = pair(text.replace(/temp.*/, ''), 'shared read') || pair(text.replace(/temp.*/, ''), 'read');
  }
  run.buffers ??= { hit: 0, read: 0 };
  run.shape = nodes.map((n) => `${'  '.repeat(n.depth / 2)}${n.kind}|${n.table ?? ''}|${n.index ?? ''}`).join('\n');
  return run;
}

/** 파일 하나를 실행별로 나눈다. 실행 앞뒤의 "io <바이트>"로 그 실행이 블록 장치에서 읽은 바이트를 구한다. */
export function parseFile(path) {
  const runs = [];
  let current = [];
  let lastIo = null;
  let pending = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const io = line.match(/^io (\d+)$/);
    if (io) {
      if (pending) pending.diskBytes = Number(io[1]) - lastIo;
      pending = null;
      lastIo = Number(io[1]);
      continue;
    }
    const plans = line.match(/^plans generic=(\d+) custom=(\d+)$/);
    if (plans) {
      runs.at(-1).generic = Number(plans[1]);
      runs.at(-1).custom = Number(plans[2]);
      continue;
    }
    if (line === '' && current.length === 0) continue;
    current.push(line);
    if (line.startsWith('Execution Time:')) {
      pending = parseRun(current);
      runs.push(pending);
      current = [];
    }
  }
  return runs;
}

/** 10번이면 앞의 3번을 버린 7번으로 센다. 그보다 적으면 모두 센다. */
export function counted(runs) {
  return runs.length >= 10 ? runs.slice(-7) : runs;
}

export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], median: sorted[Math.floor((sorted.length - 1) / 2)], max: sorted.at(-1), n: sorted.length };
}

export function medianRun(runs) {
  const sorted = [...runs].sort((a, b) => a.execution - b.execution);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** 집계나 정렬에 들어가기 직전의 조인(가장 위의 조인 노드) */
export function topJoin(run) {
  return run.nodes.find((n) => isJoin(n.kind));
}

export function summary(path) {
  const all = parseFile(path);
  const runs = counted(all);
  const mid = medianRun(runs);
  const seq = [...new Set(mid.nodes.filter((n) => /Seq Scan$/.test(n.kind)).map((n) => n.table))];
  const indexes = [...new Set(mid.nodes.filter((n) => n.index).map((n) => `${n.index}${/Index Only/.test(n.kind) ? '(index only)' : ''}`))];
  const joins = [...new Set(mid.nodes.filter((n) => isJoin(n.kind)).map((n) => n.kind))];
  return {
    path,
    runs: all.length,
    n: runs.length,
    time: stats(runs.map((r) => r.execution)),
    io: stats(runs.map((r) => r.ioRead)),
    hit: stats(runs.map((r) => r.buffers.hit)),
    read: stats(runs.map((r) => r.buffers.read)),
    disk: runs.every((r) => r.diskBytes !== undefined) ? stats(runs.map((r) => r.diskBytes)) : null,
    temp: [mid.tempRead, mid.tempWritten],
    mid,
    shapes: new Set(runs.map((r) => r.shape)).size,
    seq,
    indexes,
    joins,
    parallel: mid.workers,
    jit: runs.filter((r) => r.jit).length,
    join: topJoin(mid),
    heapFetches: mid.heapFetches,
    heapBlocks: mid.heapBlocks,
  };
}

export const ms = (value) => (value >= 100 ? value.toFixed(1) : value.toFixed(3)).replace(/\B(?=(\d{3})+(?!\d))(?<!\.\d*)/g, ',');
export const num = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const range = (s) => (s.min === s.max ? num(s.min) : `${num(s.min)}~${num(s.max)}`);
export const estActual = (node) => (node ? `${num(node.est)} / ${num(node.rows)}${node.loops > 1 ? ` ×${num(node.loops)}` : ''}` : '없음');

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.endsWith('.txt') && readFileSync(path, 'utf8').includes('Execution Time:')) yield path;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args[0] === '--json';
  const root = json ? args[1] : args[0];
  if (!root) throw new Error('결과 폴더를 준다');
  const rows = [...walk(root)].map((path) => ({ name: relative(root, path).replace(/\.txt$/, ''), ...summary(path) }));
  if (json) {
    console.log(JSON.stringify(rows.map(({ mid, ...rest }) => rest), null, 1));
  } else {
    console.log('| 파일 | n | 최소 / 중앙 / 최대 (ms) | I/O 읽기 중앙 (ms) | 버퍼 hit / read | 블록 장치 읽기 중앙 (MB) | 조인 | 인덱스 | Seq Scan | 작업자 | 조인 예상 / 실제 | Heap Fetches |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      console.log(
        `| ${r.name} | ${r.n} | ${ms(r.time.min)} / ${ms(r.time.median)} / ${ms(r.time.max)} | ${ms(r.io.median)} | ${range(r.hit)} / ${range(r.read)} | ${r.disk ? (r.disk.median / 1048576).toFixed(1) : ''} | ${r.joins.join('<br>')} | ${r.indexes.join('<br>')} | ${r.seq.join('<br>') || '없음'} | ${r.parallel} | ${estActual(r.join)} | ${r.heapFetches.map((h) => `${h.index}: ${num(h.count)}`).join('<br>')} |`,
      );
    }
  }
}
