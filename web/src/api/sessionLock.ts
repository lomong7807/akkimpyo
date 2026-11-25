import { TIMEOUT_MS } from './http'

const LOCK_NAME = 'akkimpyo-session'

/**
 * refresh 쿠키를 바꾸는 요청을 같은 브라우저의 모든 탭에서 한 번에 하나씩 보낸다(ADR 001 결정 6).
 * Web Locks가 없는 브라우저에서는 기다리지 않고 보낸다.
 *
 * 앞 탭의 요청은 TIMEOUT_MS 안에 끝난다. 그래도 잠금이 풀리지 않으면 앞 탭이 멈춘 것으로 보고 잠금 없이 보낸다.
 * 이때 요청이 겹치는 것은 서버의 허용 시간이 받아 준다(ADR 001 결정 3).
 */
export async function withSessionLock<T>(work: () => Promise<T>): Promise<T> {
  if (!('locks' in navigator)) return work()

  const waiting = new AbortController()
  const timer = setTimeout(() => waiting.abort(), TIMEOUT_MS)
  try {
    return await navigator.locks.request(LOCK_NAME, { signal: waiting.signal }, () => {
      clearTimeout(timer)
      return work()
    })
  } catch (error) {
    if (waiting.signal.aborted) return work()
    throw error
  }
}
