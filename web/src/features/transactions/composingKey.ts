import type { KeyboardEvent } from 'react'

/*
 * 한글을 조합하는 중의 엔터(D-04 키보드 흐름). 홈의 한 줄 입력칸(첫 화면 묶음)도 쓰므로 거래 칸의 다른 키 처리(fieldKeys)와 나눠 둔다.
 */

/** 한글을 조합하는 중의 키. Safari는 조합이 끝났다고 먼저 알리므로 입력기가 받은 키(keyCode 229)도 본다 */
export function isComposingKey(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

/** 엔터가 양식을 보내는 칸에서, 한글을 조합하는 중의 엔터는 글자를 끝낼 뿐이다 */
export function keepComposingEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter' && isComposingKey(event)) event.preventDefault()
}
