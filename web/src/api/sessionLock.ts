import { ApiError } from './apiError'
import { TIMEOUT_MS } from './http'

const LOCK_NAME = 'akkimpyo-session'

/**
 * refresh 쿠키를 바꾸는 요청을 같은 브라우저의 모든 탭에서 한 번에 하나씩 보낸다(ADR 001 결정 6).
 * `work`는 잠금을 빼앗기면 중단되는 신호를 받는다. 빼앗긴 뒤에 온 응답은 쓰지 않는다.
 *
 * 앞 탭의 요청은 TIMEOUT_MS 안에 끝난다(갱신은 5초씩 두 번까지, 로그인은 15초). 그보다 오래 기다리면 앞 탭이 잠금을 쥔 채 멈춘 것으로 본다.
 * - fail(갱신): 보내지 않고 지연 오류로 끝낸다. 앞 탭의 갱신이 서버에 닿았다면 이 탭의 쿠키는 옛것일 수 있고,
 *   허용 시간(회전 시각부터 10초, 결정 3)이 지난 옛 쿠키는 재사용으로 걸려 로그인 전체가 폐기된다.
 * - steal(로그인): 잠금을 빼앗는다. 옛 쿠키를 쓰지 않으므로 겹쳐도 안전하고, 빼앗지 않으면 로그인한 뒤의 갱신도 막힌다.
 *
 * 잠금 기능이 없거나 막힌 브라우저에서는 잠금 없이 보낸다.
 */
export async function withSessionLock<T>(
  whenStuck: 'fail' | 'steal',
  work: (lost: AbortSignal) => Promise<T>,
): Promise<T> {
  const lost = new AbortController()
  if (!('locks' in navigator)) return work(lost.signal)

  const waiting = new AbortController()
  const timer = setTimeout(() => waiting.abort(), TIMEOUT_MS)
  let granted = false
  function run() {
    granted = true
    return work(lost.signal)
  }

  try {
    return await navigator.locks.request(LOCK_NAME, { signal: waiting.signal }, run).catch((error) => {
      if (granted || whenStuck === 'fail' || !isAbortError(error)) throw error
      return navigator.locks.request(LOCK_NAME, { steal: true }, run)
    })
  } catch (error) {
    if (isAbortError(error)) {
      // 기다리다 그만두었거나 다른 탭의 로그인이 잠금을 빼앗았다
      lost.abort()
      throw ApiError.timeout()
    }
    if (!granted) return await work(lost.signal)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
