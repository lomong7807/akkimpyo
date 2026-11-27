import { waitFor } from '@testing-library/react'
import { enableTestClock, passPressGuard, SHIELD } from './testClock'

/*
 * 판·시트가 열리고 덮개가 걷히기를 기다리는 도우미(docs/qa/test-strategy.md 8절 2). 누름을 막는 시간은 실제로 기다리지 않고
 * 공용 시계를 보내 지나게 한다. 이 도우미를 쓰는 파일은 테스트마다 공용 시계 하나로 돈다(8절 1).
 */
enableTestClock()

/** 시트나 판이 다 열려 누르기를 받을 때까지 기다린다. 열리기는 기다리고, 여는 동안 누름을 막는 시간은 시계를 보내 지난다. */
export async function untilOpened() {
  await waitFor(() => {
    if (!document.querySelector('dialog[open]')) throw new Error('아직 열리지 않았다')
  })
  if (document.querySelector('dialog[open][data-opening]')) await passPressGuard()
  if (!document.querySelector('dialog[open]:not([data-opening])')) throw new Error('아직 여는 중이다')
}

/** 닫은 뒤의 덮개. 이어서 누른 것이 뒤 화면에 닿지 않게 한다. */
export const shield = () => document.querySelector(SHIELD)

/** 닫은 뒤의 덮개를 걷는다. 시계를 보내 누름을 막는 시간을 지나게 하고, 그래도 남으면 기다리지 않고 실패한다. */
export async function untilUnshielded() {
  if (shield()) await passPressGuard()
  if (shield()) throw new Error('아직 덮여 있다')
}
