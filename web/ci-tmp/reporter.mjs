// 임시(#292): --repeats의 회마다 결과를 센다. ready 전에 ci-tmp/와 package.json의 test를 되돌린다.
const tz = process.env.TZ ?? '(TZ 없음)'

function whereOf(error) {
  const stack = (error?.stacks ?? []).find(({ file }) => file.includes('/tests/'))
  return stack ? `${stack.file.slice(stack.file.indexOf('tests/'))}:${stack.line}` : ''
}

export default class AttemptsReporter {
  total = 0
  failed = 0
  started = Date.now()

  onTestRunStart() {
    this.started = Date.now()
    console.log(`[run] TZ=${tz} 시작(실제 UTC)=${new Date().toISOString()}`)
  }

  clocks = new Map()

  onUserConsoleLog(log) {
    if (!log.content.startsWith('[clock]')) return
    const kept = this.clocks.get(log.taskId) ?? []
    kept.push(log.content.trim())
    this.clocks.set(log.taskId, kept)
  }

  onTestCaseResult(testCase) {
    const attempts = testCase.attempts()
    const failed = attempts.filter(({ state }) => state === 'failed')
    this.total += attempts.length
    this.failed += failed.length
    const durations = attempts.map(({ duration }) => duration)
    const avg = Math.round(durations.reduce((sum, each) => sum + each, 0) / Math.max(1, durations.length))
    const max = Math.round(Math.max(0, ...durations))
    console.log(`[test] TZ=${tz} 실패=${failed.length}/${attempts.length} 평균=${avg}ms 최대=${max}ms | ${testCase.module.moduleId.slice(testCase.module.moduleId.indexOf('tests/'))} > ${testCase.fullName}`)
    const clocks = this.clocks.get(testCase.id) ?? []
    failed.forEach((attempt, index) => {
      const error = attempt.errors?.[0]
      const message = String(error?.message ?? '').split('\n')[0].slice(0, 300)
      console.log(
        `  [fail] TZ=${tz} 회=${attempt.repeatIndex + 1} 걸림=${Math.round(attempt.duration)}ms 시작(실제 UTC)=${new Date(attempt.startTime).toISOString()} ${whereOf(error)} ${message}`,
      )
      if (clocks[index]) console.log(`    ${clocks[index]}`)
    })
  }

  onTestRunEnd(_modules, errors, reason) {
    console.log(
      `[summary] TZ=${tz} 실패=${this.failed}/${this.total} reason=${reason} 처리되지않은오류=${errors.length} 걸림=${Math.round((Date.now() - this.started) / 1000)}s`,
    )
    for (const error of errors) console.log(`  [unhandled] ${String(error?.message ?? error).split('\n')[0]}`)
  }
}
