import { afterEach } from 'vitest'

/*
 * 브라우저의 연결 신호를 바꾼다(#234). 앱은 navigator.onLine과 online·offline 이벤트를 그대로 읽으므로 따로 주입하지 않는다.
 * 요청이 응답 없이 실패하는 것은 msw의 HttpResponse.error()로 만든다.
 */

let online = true

Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })

afterEach(() => {
  online = true
})

/** 브라우저가 연결이 끊겼다고 알린다. */
export function goOffline(): void {
  online = false
  window.dispatchEvent(new Event('offline'))
}

/** 브라우저가 연결이 돌아왔다고 알린다. */
export function goOnline(): void {
  online = true
  window.dispatchEvent(new Event('online'))
}

/** 이벤트 없이 처음부터 연결이 없는 기기로 둔다(앱을 열기 전에 부른다). */
export function startOffline(): void {
  online = false
}
