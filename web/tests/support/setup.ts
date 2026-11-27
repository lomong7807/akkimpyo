// jsdom에는 IndexedDB가 없다. 규격대로 도는 가짜를 전역에 둔다(devDependency, #234)
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, expect, vi } from 'vitest'
import { connection } from '../../src/api/connection'
import { DEFAULT_NOW, setDeviceClock } from './clock'
import { reconnectStaticApp } from './staticConnection'
import { installDialog } from './dialogElement'
import { failOnLeftShields, watchShields } from './shieldCheck'

// 테스트마다 기기 저장소를 비운다. 한 테스트 안에서 여는 탭들은 같은 저장소를 함께 쓴다
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

// 앱을 새로 여는 테스트는 vi.resetModules()로 앱 모듈을 다시 읽는다. 시계 모듈까지 다시 읽으면 테스트가 정한 시계가 새 앱에
// 닿지 않는다. 그대로 돌려주는 mock으로 두면 resetModules가 다시 읽지 않아 한 파일 안에서 하나를 나눠 쓴다.
vi.mock(import('../../src/lib/clock'), (importOriginal) => importOriginal())

// 임시(#291): 화면 코드를 받는 데 걸린 시간(src/app/lazyScreen)을 파일마다 첫 테스트와 나머지로 나눠 찍는다. ready 전에 되돌린다
const lazyByTest: number[][] = []
let lazySeen = 0
afterEach(() => {
  const all = (globalThis as { __lazy291?: number[] }).__lazy291 ?? []
  lazyByTest.push(all.slice(lazySeen))
  lazySeen = all.length
})
afterAll(() => {
  const fetches = (globalThis as { __fetch291?: number[] }).__fetch291 ?? []
  if (fetches.length > 0) {
    const later = fetches.slice(3).sort((a, b) => a - b)
    const file = (expect.getState().testPath ?? '').replace(/^.*\/tests\//, 'tests/')
    appendFileSync(
      join(tmpdir(), 'lazy291.txt'),
      `FETCH291 ${file} first3=[${fetches.slice(0, 3).join(',')}] later n=${later.length} p50=${later[Math.floor(later.length / 2)] ?? '-'} max=${later.at(-1) ?? '-'}\n`,
    )
  }
  const firstWith = lazyByTest.findIndex((loads) => loads.length > 0)
  if (firstWith < 0) return
  const rest = lazyByTest.slice(firstWith + 1).flat().sort((a, b) => a - b)
  const file = (expect.getState().testPath ?? '').replace(/^.*\/tests\//, 'tests/')
  const pick = (q: number) => rest[Math.min(rest.length - 1, Math.floor(rest.length * q))] ?? '-'
  appendFileSync(
    join(tmpdir(), 'lazy291.txt'),
    `LAZY291 ${file} firstTest#${firstWith + 1}=[${lazyByTest[firstWith].join(',')}] rest n=${rest.length} p50=${pick(0.5)} p90=${pick(0.9)} max=${rest.at(-1) ?? '-'}\n`,
  )
})

// 테스트마다 기기의 지금과 시간대를 정해 둔다. 테스트를 돌리는 기기의 시계와 시간대(TZ)를 보지 않는다(#225)
beforeEach(() => setDeviceClock(DEFAULT_NOW))

// 앱 모듈을 정적으로 불러온 파일은 연결 판단(api/connection) 하나를 테스트끼리 나눠 쓴다. 테스트가 연결을 끊었으면 그 테스트가
// 되돌린다(goOnline 등). 남아 있으면 다음 테스트를 '연결 없음'으로 시작하게 하고, 화면이 판단을 잘못 남기는 버그도 가리므로
// 테스트 이름과 함께 실패한다. 다음 테스트를 위해 되돌린 뒤에 실패한다. 앞 정리가 실패해도 돌도록 onTestFinished로 건다(qa #289, #274).
// 앱을 새로 여는 테스트(vi.resetModules)는 새 모듈을 받으므로 이것과 상관없다
beforeEach(({ onTestFinished }) =>
  onTestFinished(() => {
    if (typeof window === 'undefined' || connection() === 'online') return
    reconnectStaticApp()
    throw new Error(`연결 판단이 '없음'으로 남았다: ${expect.getState().currentTestName}. 연결을 끊은 테스트는 끝에서 되돌린다`)
  }),
)

// jsdom에는 없다. 배치를 계산하지 않고 움직임이 없으므로 아무것도 하지 않는다
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.getAnimations = () => []
  installDialog()
  keepUnchangedStyles()
  // jsdom에는 없다. 브라우저가 한가해지지 않는 것으로 둔다. 공통 틀이 화면 코드를 미리 받으면(#251) 그 불러오기가 테스트가 끝난
  // 뒤에도 이어져 다음 테스트의 시계를 늦춘다. 미리 받기를 보는 테스트는 가짜를 넣는다
  window.requestIdleCallback ??= () => 0
  window.cancelIdleCallback ??= () => {}
  // 배치를 계산하지 않으므로 크기가 바뀌는 일이 없다. 바뀌었을 때를 보는 테스트는 가짜를 넣는다
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // 화면에서 빠진 뒤에도 덮개(pressGuard)는 시간이 다 될 때까지 남는다. 파일이 끝난 뒤 jsdom을 정리하고 나서 그 시계가
  // 돌면 없어진 cancelAnimationFrame을 부르다 오류가 난다(PR #210 CI). 파일을 끝내기 전에 남은 덮개를 확인한다.
  // 기다리지 않는다. 가짜 시계면 보내 걷고, 그래도 남으면 남긴 테스트의 이름을 담아 바로 실패한다(8절 4)
  watchShields()
  afterAll(failOnLeftShields)
}

/**
 * `<style>`에 지금과 같은 글을 다시 넣으면 그대로 둔다. 앱을 새로 여는 테스트(vi.resetModules)는 CSS 모듈을 다시 읽을 때마다
 * vitest가 같은 CSS를 그 모듈의 `<style>`에 다시 넣고(updateStyle), jsdom은 그때마다 스타일시트를 다시 파싱한다.
 * 계좌 추가 테스트에서 이 일이 CPU 7.1초 중 0.7초였고, 같은 글을 두면 0.3초다(남은 것은 vitest가 그 `<style>`을 찾는 일).
 * 글이 다르면(화면 폭을 바꾸거나 되돌릴 때 등) 그대로 넣는다. 스타일시트를 CSSOM으로 고치는 테스트는 없다.
 */
function keepUnchangedStyles() {
  const textContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!
  Object.defineProperty(HTMLStyleElement.prototype, 'textContent', {
    configurable: true,
    enumerable: textContent.enumerable,
    get: textContent.get,
    set(this: HTMLStyleElement, css: string | null) {
      if (textContent.get!.call(this) !== (css ?? '')) textContent.set!.call(this, css)
    },
  })
}
