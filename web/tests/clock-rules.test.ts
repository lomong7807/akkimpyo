import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clockModules, findClockViolations, usesClockHelpers, type Module } from './support/clockRules'
import { readWebFile, webPath } from './support/webFile'

const moduleOf = (path: string): Module => ({
  name: path.replace(/^tests\//, '').replace(/\.(tsx?)$/, ''),
  source: readWebFile(path),
})

describe('시계 규칙 검사기', () => {
  const support: Module[] = [
    { name: 'support/testClock', source: 'export function enableTestClock() {}' },
    { name: 'support/dialog', source: "import { enableTestClock } from './testClock'\n\nenableTestClock()\n" },
    { name: 'support/screen', source: "import { untilOpened } from './dialog'\n" },
    { name: 'support/backend', source: "import { problem } from './problem'\n" },
  ]
  const clocked = clockModules(support)

  it('enableTestClock()을 부르는 도우미와 그것을 불러오는 도우미를 찾는다', () => {
    expect([...clocked].sort()).toEqual(['support/dialog', 'support/screen'])
  })

  it.each([
    ['dialog 도우미', "import { untilOpened } from './support/dialog'"],
    ['그것을 거치는 도우미', "import { pick } from './support/screen'"],
  ])('%s를 불러오는 파일이 대상이다', (_, source) => {
    expect(usesClockHelpers({ name: 'A.test', source }, clocked)).toBe(true)
  })

  it('공용 시계를 켜는 도우미를 불러오지 않는 파일은 대상이 아니다', () => {
    const source = "import { startBackend } from './support/backend'\nvi.useRealTimers()"
    expect(usesClockHelpers({ name: 'http.test', source }, clocked)).toBe(false)
  })

  it.each([
    ['진짜 시계로 바꾸기', '  vi.useRealTimers()'],
    ['시계를 다시 걸기', "  vi.useFakeTimers({ toFake: ['setTimeout'] })"],
    ['가짜 Date의 시각 바꾸기', '  vi.setSystemTime(Date.now() + 31_000)'],
    ['시계에 잇지 않은 userEvent', '  const user = userEvent.setup()'],
  ])('%s를 줄 번호와 함께 찾는다', (_, line) => {
    expect(findClockViolations(`it('a', () => {\n${line}\n})`)).toEqual([
      expect.objectContaining({ line: 2, text: line.trim() }),
    ])
  })

  it('공용 시계의 도우미는 허용한다', () => {
    const source = 'holdClock()\nawait passTime(300)\nreleaseClock()\nconst user = setupUser()\n// vi.useRealTimers를 쓰지 않는다'
    expect(findClockViolations(source)).toEqual([])
  })
})

describe('web/tests', () => {
  const support = globSync('tests/support/*.{ts,tsx}', { cwd: webPath('.') }).sort().map(moduleOf)
  const tests = globSync('tests/**/*.test.{ts,tsx}', { cwd: webPath('.') }).sort().map(moduleOf)
  const clocked = clockModules(support)
  const targets = tests.filter((test) => usesClockHelpers(test, clocked))

  it('공용 시계를 켜는 도우미를 찾고, 그것을 쓰는 파일을 실제로 검사한다', () => {
    expect([...clocked]).toEqual(
      expect.arrayContaining(['support/dialog', 'support/openApp', 'support/renderRoutes', 'support/transactionScreen']),
    )
    expect(targets.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['WelcomeEntry.test', 'DateField.test', 'TransactionEditPage.test']),
    )
  })

  it('공용 시계를 쓰는 파일은 시계를 따로 다루지 않는다', () => {
    const violations = targets.flatMap(({ name, source }) =>
      findClockViolations(source).map(({ line, text, rule }) => `tests/${name}:${line} ${text} — ${rule}`),
    )
    expect(violations).toEqual([])
  })
})
