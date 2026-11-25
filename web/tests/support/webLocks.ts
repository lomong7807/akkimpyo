type Callback = () => Promise<unknown>

/**
 * 브라우저 Web Locks의 배타 잠금만 흉내 낸다(jsdom에는 없다). 부른 순서대로 하나씩 내준다.
 * 탭 여러 개를 흉내 내려면 모듈을 다시 불러와도 같은 객체를 쓴다.
 */
export function createFakeLocks() {
  const tails = new Map<string, Promise<unknown>>()

  async function request(name: string, { signal }: { signal: AbortSignal }, callback: Callback): Promise<unknown> {
    const previous = tails.get(name) ?? Promise.resolve()
    const givenUp = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('기다리기를 그만둠', 'AbortError')))
    })
    const granted = Promise.race([previous, givenUp])
    const held = granted.then(callback)
    tails.set(name, Promise.all([previous, held.catch(() => undefined)]))
    return held
  }

  return { request }
}

/** 앞 탭이 멈춰 영영 내주지 않는 잠금 */
export function createStuckLocks() {
  const locks = createFakeLocks()
  return {
    request(name: string, options: { signal: AbortSignal }, callback: Callback) {
      void locks.request(name, { signal: new AbortController().signal }, () => new Promise(() => {}))
      return locks.request(name, options, callback)
    },
  }
}

export function installLocks(locks: ReturnType<typeof createFakeLocks>): void {
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
}

export function removeLocks(): void {
  Reflect.deleteProperty(navigator, 'locks')
}
