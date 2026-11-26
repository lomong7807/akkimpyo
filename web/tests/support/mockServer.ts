import { setupServer } from 'msw/node'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterAll, beforeAll, beforeEach, expect } from 'vitest'

/** 보낸 요청에 붙여, 가짜 서버가 그 요청의 핸들러를 고른 때를 알아본다. 핸들러에 닿기 전에 뗀다. */
const DISPATCH_HEADER = 'x-test-dispatch'

/** 보낸 요청이 핸들러를 고르기를 기다리는 한도(ms). 보통은 기다리지 않거나 몇 ms다. */
const DISPATCH_LIMIT_MS = 2_000

/**
 * 테스트 안의 가짜 서버. 준비하지 않은 요청은 실패로 본다.
 *
 * 테스트가 끝나면 그 테스트의 핸들러를 비우는데, 그 전에 그 테스트에서 보낸 요청이 모두 핸들러를 고를 때까지 기다린다.
 * msw는 진짜 fetch(undici)를 소켓에서 가로채므로 fetch를 부른 뒤 핸들러를 고르기까지 실제 I/O를 몇 번 거친다. 그사이 다음
 * 테스트가 시작해 핸들러를 넣으면, 화면에서 빠진 앞 테스트의 앱이 끝 무렵 보낸 요청이 다음 테스트의 핸들러에 닿아 그 테스트의
 * 요청 기록에 섞인다(#260, 부하에서 WelcomeEntry '판단에 받은 계좌 목록을 안내가 다시 받지 않는다'). 응답은 기다리지 않는다.
 */
export function startMockServer() {
  const server = setupServer()
  /** 보냈지만 아직 핸들러를 고르지 않은 요청 */
  const undispatched = new Set<string>()
  let sent = 0

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
    // 핸들러는 이 알림 바로 앞에 정해진다(msw의 요청 처리 순서)
    server.events.on('request:start', ({ request }) => {
      const id = request.headers.get(DISPATCH_HEADER)
      if (id === null) return
      undispatched.delete(id)
      request.headers.delete(DISPATCH_HEADER)
    })
    const intercepted = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const id = String((sent += 1))
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set(DISPATCH_HEADER, id)
      undispatched.add(id)
      const response = intercepted(input, { ...init, headers })
      const done = () => void undispatched.delete(id)
      response.then(done, done)
      return response
    }
  })

  // 테스트의 afterEach(화면 정리, 시계 정리)가 다 끝난 뒤에 비운다. 정리하며 보낸 요청도 그 테스트의 핸들러가 받는다
  beforeEach(({ onTestFinished }) =>
    onTestFinished(async () => {
      const started = performance.now()
      while (undispatched.size > 0) {
        if (performance.now() - started > DISPATCH_LIMIT_MS) {
          throw new Error(
            `보낸 요청 ${undispatched.size}개가 ${DISPATCH_LIMIT_MS}ms 안에 가짜 서버에 닿지 않았다: ${expect.getState().currentTestName}`,
          )
        }
        await nextTurn()
      }
      server.resetHandlers()
    }),
  )
  afterAll(() => server.close())
  return server
}
