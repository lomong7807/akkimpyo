import { afterAll, beforeEach, vi } from 'vitest'
import { DEFAULT_NOW, setDeviceClock } from './clock'
import { installDialog, untilUnshielded } from './dialog'

// 앱을 새로 여는 테스트는 vi.resetModules()로 앱 모듈을 다시 읽는다. 시계 모듈까지 다시 읽으면 테스트가 정한 시계가 새 앱에
// 닿지 않는다. 그대로 돌려주는 mock으로 두면 resetModules가 다시 읽지 않아 한 파일 안에서 하나를 나눠 쓴다.
vi.mock(import('../../src/lib/clock'), (importOriginal) => importOriginal())

// 테스트마다 기기의 지금과 시간대를 정해 둔다. 테스트를 돌리는 기기의 시계와 시간대(TZ)를 보지 않는다(#225)
beforeEach(() => setDeviceClock(DEFAULT_NOW))

// jsdom에는 없다. 배치를 계산하지 않고 움직임이 없으므로 아무것도 하지 않는다
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {}
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.getAnimations = () => []
  installDialog()
  // 배치를 계산하지 않으므로 크기가 바뀌는 일이 없다. 바뀌었을 때를 보는 테스트는 가짜를 넣는다
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // 화면에서 빠진 뒤에도 덮개(pressGuard)는 시간이 다 될 때까지 남는다. 파일이 끝난 뒤 jsdom을 정리하고 나서 그 시계가
  // 돌면 없어진 cancelAnimationFrame을 부르다 오류가 난다(PR #210 CI). 파일을 끝내기 전에 걷힐 때까지 기다린다.
  afterAll(untilUnshielded)
}
