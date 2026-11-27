import { createContext } from 'react'

/**
 * 화면 코드를 받는 동안 그 화면의 틀을 먼저 보였다(#251, app/lazyScreen). 틀 다음에 그리는 화면은 틀을 이어받는다.
 * 전체 화면 입력은 틀과 함께 이미 올라오고 있으므로 처음부터 다시 올라오지 않는다(FullScreenForm).
 */
export const ShellShownContext = createContext(false)

/** 전체 화면 입력의 틀이 올라오기 시작한 때(performance.now) */
let riseStart = 0

export function markShellRise(): void {
  riseStart = performance.now()
}

/** 전체 화면 입력의 틀이 올라오기 시작한 뒤 지난 시간(ms) */
export function shellRiseElapsed(): number {
  return performance.now() - riseStart
}
