import type { MouseEvent } from 'react'

/**
 * 버튼을 누르는 순간 칸을 벗어난 검사로 오류 문구가 나오면 버튼이 밀려 눌리지 않는다.
 * 버튼과 링크를 누르는 동안에는 초점을 칸에 남긴다.
 */
export function keepFocusInField(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, a')) event.preventDefault()
}
