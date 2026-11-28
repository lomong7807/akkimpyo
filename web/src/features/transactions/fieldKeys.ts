import type { KeyboardEvent } from 'react'
import { isComposingKey } from './composingKey'

/* 거래 칸의 엔터(D-04 키보드 흐름). D-04 새 입력·수정과 D-05가 같이 쓴다 */

export { isComposingKey, keepComposingEnter } from './composingKey'

/** 엔터를 그 칸의 동작으로 받는지. 한글을 조합하는 중과 Ctrl·Cmd를 함께 누른 저장은 빼고 본다. */
export function isPlainEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' && !isComposingKey(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  )
}

/** 금액에서 엔터는 다음 칸으로 간다(`selector`는 양식 안의 다음 칸) */
export function enterToNext(event: KeyboardEvent<HTMLInputElement>, selector: string): void {
  if (!isPlainEnter(event)) return
  event.preventDefault()
  event.currentTarget.form?.querySelector<HTMLElement>(selector)?.focus()
}
