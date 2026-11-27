import { useLayoutEffect } from 'react'
import styles from './pressGuard.module.css'

/**
 * 열거나 닫은 뒤 손가락과 마우스를 받지 않는 시간. 휴대폰의 두 번 두드리기 간격이 대개 이 안이다.
 * 칸을 두 번 누르면 둘째 누름이 막 열린 가림막이나 달력에 닿고, 날짜를 두 번 누르면 층이 사라진 뒤 화면에 닿는다.
 * 움직임이 없거나 줄인 때에도 같다. Esc와 키보드는 바로 받는다.
 */
const PRESS_GUARD_MS = 300

/**
 * 열린 것이 닫히면 이어서 누른 것이 뒤 화면에 닿지 않게 덮는다. 닫는 버튼이 다른 화면으로 보내 통째로 빠질 때도 같다.
 */
export function usePressShield(open: boolean) {
  useLayoutEffect(() => {
    if (!open) return
    unshieldPage()
    return shieldPage
  }, [open])
}

/** 덮은 것을 걷는다. */
let unshieldPage = () => {}

/**
 * 누름을 막는 시간 동안 화면 전체를 덮는다.
 * 연 화면이 바뀌어도 남고, 움직이는 조상이 있으면 화면을 다 덮지 못하므로 body에 바로 둔다.
 */
function shieldPage() {
  unshieldPage()
  const shield = document.createElement('div')
  shield.className = styles.shield
  ignorePresses(shield)
  document.body.append(shield)
  const cancel = afterPressGuard(() => unshieldPage())
  unshieldPage = () => {
    cancel()
    shield.remove()
  }
}

/**
 * 이 요소에서 시작한 누르기를 없던 것으로 한다. 초점도 옮기지 않는다.
 * 손가락은 떼는 자리의 것을 누른 것이 되므로 시작할 때 막아야 한다. 리액트는 그때 막을 수 없게 듣는다.
 */
export function ignorePresses(element: HTMLElement, active = () => true) {
  function ignore(event: Event) {
    if (active()) event.preventDefault()
  }
  element.addEventListener('touchstart', ignore)
  element.addEventListener('mousedown', ignore)
  return () => {
    element.removeEventListener('touchstart', ignore)
    element.removeEventListener('mousedown', ignore)
  }
}

/** 지금 바뀐 것이 화면에 나온 때부터 누름을 막는 시간이 지나면 부른다. */
export function afterPressGuard(callback: () => void) {
  let timer: number | undefined
  const frame = requestAnimationFrame(() => {
    timer = window.setTimeout(callback, PRESS_GUARD_MS)
  })
  return () => {
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
  }
}
