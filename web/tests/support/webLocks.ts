export const SESSION_LOCK = 'akkimpyo-session'

type Callback = () => Promise<unknown>

interface Request {
  callback: Callback
  resolve(value: unknown): void
  reject(reason: unknown): void
}

const abortError = () => new DOMException('잠금을 잃음', 'AbortError')

/**
 * 브라우저 Web Locks의 배타 잠금을 규격의 순서대로 흉내 낸다(jsdom에는 없다. https://w3c.github.io/web-locks/ 4절).
 * 탭 여러 개를 흉내 내려면 모듈을 다시 불러와도 같은 객체를 쓴다.
 */
export function createFakeLocks() {
  const states = new Map<string, { held?: Request; queue: Request[] }>()

  function stateOf(name: string) {
    if (!states.has(name)) states.set(name, { queue: [] })
    return states.get(name)!
  }

  function processQueue(name: string) {
    const state = stateOf(name)
    if (state.held || state.queue.length === 0) return
    const granted = state.queue.shift()!
    state.held = granted
    void Promise.resolve()
      .then(granted.callback)
      .then(granted.resolve, granted.reject)
      .then(() => {
        // 빼앗긴 잠금은 이미 쥔 것이 아니다
        if (state.held !== granted) return
        state.held = undefined
        processQueue(name)
      })
  }

  return {
    request(name: string, options: LockOptions, callback: Callback): Promise<unknown> {
      const { signal, steal } = options
      if (signal && steal) return Promise.reject(new DOMException('함께 쓸 수 없음', 'NotSupportedError'))
      const { promise, resolve, reject } = Promise.withResolvers<unknown>()
      const request = { callback, resolve, reject }
      const state = stateOf(name)
      signal?.addEventListener('abort', () => {
        const index = state.queue.indexOf(request)
        // 이미 얻은 잠금에는 영향이 없다
        if (index < 0) return
        state.queue.splice(index, 1)
        reject(abortError())
        processQueue(name)
      })
      if (steal) {
        state.held?.reject(abortError())
        state.held = undefined
        state.queue.unshift(request)
      } else {
        state.queue.push(request)
      }
      processQueue(name)
      return promise
    },
  }
}

type FakeLocks = Pick<ReturnType<typeof createFakeLocks>, 'request'>

/** 앞 탭이 멈춰 세션 잠금을 쥐고 놓지 않는 상태로 시작한다. `requested`는 이 탭이 잠금을 처음 부를 때 끝난다. */
export function createStuckLocks() {
  const locks = createFakeLocks()
  const requested = Promise.withResolvers<void>()
  const frozenTab = locks.request(SESSION_LOCK, {}, () => new Promise(() => {}))
  frozenTab.catch(() => {})
  const request: FakeLocks['request'] = (name, options, callback) => {
    requested.resolve()
    return locks.request(name, options, callback)
  }
  return { request, requested: requested.promise, frozenTab }
}

export function installLocks(locks: FakeLocks): void {
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
}

export function removeLocks(): void {
  Reflect.deleteProperty(navigator, 'locks')
}
