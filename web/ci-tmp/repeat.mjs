// 임시(#292): CI의 web-test shard마다 plan.json대로 테스트 파일을 시간대별로 돌린다. ready 전에 ci-tmp/와 package.json의
// test를 되돌린다.
// - repeats: 한 프로세스에서 vitest --repeats로 되풀이한다(두 번째 회부터는 변환해 둔 모듈을 다시 쓴다)
// - processes: 프로세스를 그만큼 새로 띄워 한 번씩 돌린다(매번 처음부터 변환한다. 따로 싣는 조각이 늦게 오는 때가 이쪽이다)
// load면 그동안 전체 테스트를 되풀이해 CPU 부하를 건다.
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'

const DEADLINE_MS = 8 * 60 * 1000
const started = Date.now()
const shardArg = process.argv.find((arg) => arg.startsWith('--shard='))
const shard = shardArg ? shardArg.slice('--shard='.length).split('/')[0] : '1'
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'))[shard]
if (!plan) {
  console.log(`shard ${shard}: 할 일 없음`)
  process.exit(0)
}
console.log(`shard ${shard}: ${JSON.stringify(plan)} cpus=${availableParallelism()}`)

const children = new Set()

function vitest(args, env, quiet) {
  const child = spawn('npx', ['vitest', 'run', ...args], {
    env: { ...process.env, ...env },
    stdio: quiet ? 'ignore' : 'inherit',
    detached: true,
  })
  children.add(child)
  return new Promise((resolve) =>
    child.on('exit', (code, signal) => {
      children.delete(child)
      resolve({ code, signal })
    }),
  )
}

function stop(child) {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // 이미 끝났다
  }
}

// full이면 먼저 전체 테스트를 한 번(부하 없이) 돌려 결과를 센다(도우미를 바꾼 것이 다른 파일을 깨지 않는지)
const full = plan.full ? await vitest(['--reporter=dot', '--maxWorkers=2'], {}, false) : undefined
if (full) console.log(`[full] 전체 테스트 code=${full.code}`)

let loading = Boolean(plan.load)
let loadRounds = 0
const loader = (async () => {
  while (loading) {
    await vitest([], { TZ: plan.runs[0].tz }, true)
    if (loading) loadRounds += 1
  }
})()

let timedOut = false
const deadline = setTimeout(() => {
  timedOut = true
  console.log(`[deadline] ${DEADLINE_MS / 1000}s가 지나 멈춘다. 끝난 프로세스까지 센다`)
  for (const child of children) stop(child)
}, DEADLINE_MS)

function totals(out) {
  const byName = new Map()
  let lines = []
  try {
    lines = readFileSync(out, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    // 한 번도 끝나지 않았다
  }
  for (const line of lines) {
    const { name, runs, failed } = JSON.parse(line)
    const kept = byName.get(name) ?? { runs: 0, failed: 0 }
    byName.set(name, { runs: kept.runs + runs, failed: kept.failed + failed })
  }
  return byName
}

async function runOne({ tz, file, repeats = 0, processes = 1 }, index) {
  const out = join(tmpdir(), `attempts-${shard}-${index}.jsonl`)
  rmSync(out, { force: true })
  const exits = []
  for (let round = 0; round < processes && !timedOut; round += 1) {
    const args = [file, '--reporter=./ci-tmp/reporter.mjs']
    if (repeats > 0) args.push(`--repeats=${repeats}`)
    exits.push(await vitest(args, { TZ: tz, ATTEMPTS_OUT: out }, false))
  }
  const byName = totals(out)
  let runs = 0
  let failed = 0
  for (const [name, each] of byName) {
    runs += each.runs
    failed += each.failed
    console.log(`[total] TZ=${tz} 실패=${each.failed}/${each.runs} | ${name}`)
  }
  console.log(`[total-file] TZ=${tz} ${file} 프로세스=${exits.length}/${processes} 회(프로세스마다)=${repeats + 1} 실패=${failed}/${runs}`)
  return { exits, failed }
}

const results = await Promise.all(plan.runs.map(runOne))
clearTimeout(deadline)
loading = false
for (const child of children) stop(child)
await loader
console.log(`shard ${shard}: 끝. 부하로 전체 테스트를 다 돈 횟수=${loadRounds} 걸림=${Math.round((Date.now() - started) / 1000)}s`)
process.exit(timedOut || (full && full.code !== 0) || results.some(({ failed, exits }) => failed > 0 || exits.some(({ code }) => code !== 0)) ? 1 : 0)
