// 임시(#291): CI의 web 테스트 job 하나 안에서 같은 shard를 여러 번 돌려 실패한 테스트를 모은다. ready 전에 되돌린다.
// 돌 때마다 vitest의 결과 캐시(node_modules/.vite)를 지워, 매번 CI의 첫 실행과 같은 파일 순서로 돈다.
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const times = Number(process.env.REPEAT ?? 5)
// 함께 돌릴 CPU 부하 프로세스 수(#291의 부하 조건). 0이면 걸지 않는다
const load = Number(process.env.LOAD ?? 0)
// job 한도 10분에서 설치와 여유를 뺀 시간
const budgetMs = 8 * 60_000
const args = process.argv.slice(2)
const shard = args.find((arg) => arg.startsWith('--shard='))?.slice('--shard='.length) ?? 'all'
const started = Date.now()
const lines = []
let failedRuns = 0

for (let run = 1; run <= times; run += 1) {
  const spent = Date.now() - started
  if (run > 1 && spent + spent / (run - 1) > budgetMs) {
    lines.push(`REPEAT291 shard=${shard} stop-before-run=${run} reason=budget spent=${Math.round(spent / 1000)}s`)
    break
  }
  rmSync('node_modules/.vite', { recursive: true, force: true })
  const out = join(tmpdir(), `vitest-291-${run}.json`)
  rmSync(out, { force: true })
  rmSync(join(tmpdir(), 'lazy291.txt'), { force: true })
  const burners = Array.from({ length: load }, () => spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'ignore' }))
  const runStarted = Date.now()
  const result = spawnSync(
    'vitest',
    ['run', ...args, '--reporter=default', '--reporter=json', `--outputFile.json=${out}`],
    { stdio: 'inherit' },
  )
  const wall = Math.round((Date.now() - runStarted) / 1000)
  for (const burner of burners) burner.kill()
  const lazyFile = join(tmpdir(), 'lazy291.txt')
  if (existsSync(lazyFile)) {
    for (const line of readFileSync(lazyFile, 'utf8').split('\n').filter(Boolean)) lines.push(`${line} shard=${shard} run=${run}`)
    rmSync(lazyFile)
  }
  const failures = []
  if (existsSync(out)) {
    const report = JSON.parse(readFileSync(out, 'utf8'))
    for (const file of report.testResults) {
      const name = file.name.slice(file.name.indexOf('tests/'))
      const failedTests = file.assertionResults.filter((test) => test.status === 'failed')
      for (const test of failedTests) {
        const first = (test.failureMessages[0] ?? '').split('\n')[0].slice(0, 200)
        failures.push(`${name} > ${[...test.ancestorTitles, test.title].join(' > ')} | ${Math.round(test.duration ?? 0)}ms | ${first}`)
      }
      if (file.status === 'failed' && failedTests.length === 0) {
        failures.push(`${name} > (파일 오류) | | ${(file.message ?? '').split('\n')[0].slice(0, 200)}`)
      }
    }
  }
  if (result.status !== 0) failedRuns += 1
  lines.push(`REPEAT291 shard=${shard} load=${load} run=${run} exit=${result.status} wall=${wall}s failed=${failures.length}`)
  for (const failure of failures) lines.push(`REPEAT291-FAIL shard=${shard} run=${run} | ${failure}`)
}

const summary = lines.join('\n')
console.log(`\n${summary}`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${summary}\n\`\`\`\n`)
process.exit(failedRuns > 0 ? 1 : 0)
