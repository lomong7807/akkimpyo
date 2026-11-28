// 임시(#292): CI의 web-test shard마다 plan.json대로 테스트 파일을 시간대별로 --repeats 돌린다. load면 그동안 전체 테스트를
// 되풀이해 CPU 부하를 건다. ready 전에 ci-tmp/와 package.json의 test를 되돌린다.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DEADLINE_MS = 8 * 60 * 1000
const started = Date.now()
const shardArg = process.argv.find((arg) => arg.startsWith('--shard='))
const shard = shardArg ? shardArg.slice('--shard='.length).split('/')[0] : '1'
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'))[shard]
if (!plan) {
  console.log(`shard ${shard}: 할 일 없음`)
  process.exit(0)
}
console.log(`shard ${shard}: ${JSON.stringify(plan)} cpus=${(await import('node:os')).availableParallelism()}`)

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
  console.log(`[deadline] ${DEADLINE_MS / 1000}s가 지나 멈춘다. 위에 찍힌 [test] 줄까지가 결과다`)
  for (const child of children) stop(child)
}, DEADLINE_MS)

const results = await Promise.all(
  plan.runs.map(({ tz, file, repeats }) =>
    vitest([file, `--repeats=${repeats}`, '--reporter=./ci-tmp/reporter.mjs'], { TZ: tz }, false),
  ),
)
clearTimeout(deadline)
loading = false
for (const child of children) stop(child)
await loader
console.log(`shard ${shard}: 끝. 부하로 전체 테스트를 다 돈 횟수=${loadRounds} 걸림=${Math.round((Date.now() - started) / 1000)}s 결과=${JSON.stringify(results)}`)
process.exit(timedOut || results.some(({ code }) => code !== 0) ? 1 : 0)
