import type { MouseEvent } from 'react'
import styles from './keyboardBridge.module.css'

/** 새 화면이 초점을 가져가지 않으면 이만큼 뒤에 걷는다. 걷으면 올라온 키보드도 내려간다. */
const HOLD_MS = 1000

/**
 * 누르는 순간 화면 키보드를 올려 둔다(화면설계서 D-04 구현 메모). iPhone Safari는 사용자가 누른 그 처리 안에서 입력칸에
 * 초점을 줘야 키보드를 올리고, 화면이 바뀐 뒤에 준 초점으로는 올리지 않는다. 그래서 누른 처리 안에서 보이지 않는 숫자 칸에
 * 먼저 초점을 주고, 열린 화면이 금액 칸으로 초점을 옮기면 올라온 키보드가 그대로 이어진다. 초점이 떠나면 칸을 걷는다.
 * 새 창으로 여는 누르기(Ctrl, Cmd, Shift, Alt)에는 하지 않는다.
 */
export function holdKeyboard(event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const bridge = document.createElement('input')
  bridge.type = 'text'
  bridge.inputMode = 'numeric'
  bridge.tabIndex = -1
  bridge.className = styles.bridge
  bridge.setAttribute('aria-hidden', 'true')
  bridge.dataset.keyboardBridge = ''
  const release = () => bridge.remove()
  bridge.addEventListener('blur', release, { once: true })
  window.setTimeout(release, HOLD_MS)
  document.body.append(bridge)
  bridge.focus({ preventScroll: true })
}
