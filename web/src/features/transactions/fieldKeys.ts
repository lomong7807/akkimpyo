import type { KeyboardEvent } from 'react'

/* 거래 칸의 엔터(D-04 키보드 흐름). D-04 새 입력·수정과 D-05가 같이 쓴다 */

/** 한글을 조합하는 중의 키. Safari는 조합이 끝났다고 먼저 알리므로 입력기가 받은 키(keyCode 229)도 본다 */
export function isComposingKey(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

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

/** 가맹점/내용의 엔터는 양식을 보내 저장한다. 한글을 조합하는 중의 엔터는 글자를 끝낼 뿐이다 */
export function keepComposingEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter' && isComposingKey(event)) event.preventDefault()
}
