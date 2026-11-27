import { act } from '@testing-library/react'
import { relative } from 'node:path'
import { expect, vi } from 'vitest'
import { SHIELD } from './testClock'

/** 덮개를 만든 테스트의 이름 */
const createdBy = new WeakMap<Element, string>()

/** body에 덮개가 들어오면 그때의 테스트 이름을 적어 둔다. 파일이 끝날 때 남은 덮개를 누가 남겼는지 알린다. */
export function watchShields() {
  new MutationObserver((records) => {
    const name = expect.getState().currentTestName ?? '(테스트 밖)'
    for (const { addedNodes } of records) {
      addedNodes.forEach((node) => {
        if (node instanceof Element && node.matches(SHIELD)) createdBy.set(node, name)
      })
    }
  }).observe(document.body, { childList: true })
}

/**
 * 파일을 끝내기 전에 남은 덮개를 확인한다(8절 4). 실제로 기다리지 않는다. 가짜 시계가 켜져 있으면 다음 화면과 누름을 막는 시간만큼
 * 보내 걷고, 그래도 남으면 파일과 남긴 테스트의 이름을 담아 바로 실패한다. 진짜 시계로 남은 덮개는 기다리지 않고 실패한다.
 */
export function failOnLeftShields() {
  if (vi.isFakeTimers() && document.querySelector(SHIELD)) {
    act(() => {
      vi.advanceTimersToNextFrame()
      vi.advanceTimersByTime(300)
    })
  }
  const left = [...document.querySelectorAll(SHIELD)]
  if (left.length === 0) return
  const names = [...new Set(left.map((shield) => createdBy.get(shield) ?? '(알 수 없음)'))]
  const file = relative(process.cwd(), expect.getState().testPath ?? '')
  throw new Error(`덮개가 남았다(${file}): ${names.join(', ')}`)
}
