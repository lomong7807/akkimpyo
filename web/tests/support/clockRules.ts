/*
 * web 컴포넌트 테스트의 시계 규칙 검사(docs/qa/test-strategy.md 8절 5). 대상은 공용 시계(testClock.ts)를 켜는 도우미를 import하는
 * 테스트 파일이다. 도우미끼리 불러오는 것(transactionEdit → transactionScreen → dialog)도 따라간다.
 */

/** 모듈 하나. `name`은 tests/를 기준으로 확장자를 뺀 경로다(예: support/dialog, WelcomeEntry.test). */
export interface Module {
  name: string
  source: string
}

export interface ClockViolation {
  line: number
  text: string
  rule: string
}

/** 대상 파일에서 쓰지 않는 것. 시계는 공용 시계의 도우미로만 다룬다. */
const forbidden: { pattern: RegExp; rule: string }[] = [
  { pattern: /\bvi\.useRealTimers\s*\(/, rule: '파일 중간에 진짜 시계로 바꾸지 않는다(8절 1·5). 멈춘 시계는 releaseClock으로 푼다' },
  { pattern: /\bvi\.useFakeTimers\s*\(/, rule: '시계를 다시 걸지 않는다(8절 1). 멈추려면 holdClock, 앞당기려면 passTime' },
  { pattern: /\bvi\.setSystemTime\s*\(/, rule: '날짜는 setDeviceClock, 흐른 시간은 passTime으로 맞춘다(8절 3)' },
  { pattern: /\buserEvent\.setup\s*\(/, rule: 'userEvent는 공용 시계에 이은 setupUser()로 만든다(8절 1)' },
]

/** 줄 처음의 import·export 문. 여러 줄에 걸친 import도 잡고, 글자 속의 import는 잡지 않는다 */
const importPattern = /^(?:import|export)\b[^;'"]*?(?:from\s*)?['"](\.\.?\/[^'"]+)['"]/gm

/** 이 모듈이 불러오는 tests/ 안의 모듈 이름들(상대 경로만) */
function importsOf({ name, source }: Module): string[] {
  const base = name.split('/').slice(0, -1)
  return [...source.matchAll(importPattern)].map(([, path]) => {
    const parts = [...base]
    for (const part of path.replace(/\.(tsx?|js)$/, '').split('/')) {
      if (part === '..') parts.pop()
      else if (part !== '.') parts.push(part)
    }
    return parts.join('/')
  })
}

/** 공용 시계를 켜는 모듈. enableTestClock()을 부르는 모듈과, 그것을 (거쳐) 불러오는 support 모듈이다. */
export function clockModules(support: Module[]): Set<string> {
  const found = new Set(support.filter(({ source }) => /^enableTestClock\(\)/m.test(source)).map(({ name }) => name))
  for (let grew = true; grew; ) {
    grew = false
    for (const module of support) {
      if (!found.has(module.name) && importsOf(module).some((name) => found.has(name))) {
        found.add(module.name)
        grew = true
      }
    }
  }
  return found
}

/** 이 테스트 파일이 공용 시계를 켜는 도우미를 불러오는지(8절 1의 대상인지) */
export function usesClockHelpers(test: Module, clocked: Set<string>): boolean {
  return importsOf(test).some((name) => clocked.has(name))
}

/**
 * 모든 테스트 파일과 tests/support에서 쓰지 않는 것(8절 3, #281). 테스트 데이터의 시각(남긴 때, 받은 때, 가짜 서버가 고친 때)을
 * 실제 시계로 만들면 앱이 재는 기기 시계와 섞여 날이 지나면 결과가 바뀐다. 인자가 있는 new Date(정한 시각)는 괜찮다.
 */
const realClock: { pattern: RegExp; rule: string }[] = [
  {
    pattern: /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/,
    rule: '테스트 데이터의 시각은 실제 시계(Date.now, 인자 없는 new Date)가 아니라 기기 시계(tests/support/clock의 nowOnDevice)로 만든다(8절 3)',
  },
]

function violationsOf(source: string, rules: { pattern: RegExp; rule: string }[]): ClockViolation[] {
  return source.split('\n').flatMap((text, index) =>
    rules.filter(({ pattern }) => pattern.test(text)).map(({ rule }) => ({ line: index + 1, text: text.trim(), rule })),
  )
}

/** 대상 파일에서 규칙을 어긴 줄 */
export function findClockViolations(source: string): ClockViolation[] {
  return violationsOf(source, forbidden)
}

/** 실제 시계로 시각을 만드는 줄. 모든 테스트 파일과 tests/support가 대상이다 */
export function findRealClockUses(source: string): ClockViolation[] {
  return violationsOf(source, realClock)
}
