import { afterAll } from 'vitest'
import { installDialog, untilUnshielded } from './dialog'

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
