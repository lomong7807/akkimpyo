import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { send } from '../src/api/http'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

const server = startMockServer()

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

function respondWith(response: () => Response | Promise<Response>) {
  server.use(http.all('*', response))
}

/** 보낸 요청을 그대로 받아 둔다. */
function captureRequest() {
  const requests: Request[] = []
  server.use(
    http.all('*', ({ request }) => {
      requests.push(request)
      return HttpResponse.json({ ok: true })
    }),
  )
  return requests
}

describe('요청', () => {
  it('같은 출처의 /api/v1 아래로 보낸다', async () => {
    const requests = captureRequest()
    await send('/me')
    expect(requests[0].url).toBe(`${window.location.origin}/api/v1/me`)
    expect(requests[0].method).toBe('GET')
  })

  it('본문은 JSON으로 보낸다', async () => {
    const requests = captureRequest()
    await send('/ledgers', { method: 'POST', body: { name: '내 가계부' } })
    expect(requests[0].method).toBe('POST')
    expect(requests[0].headers.get('Content-Type')).toBe('application/json')
    expect(await requests[0].json()).toEqual({ name: '내 가계부' })
  })

  it('본문이 없으면 Content-Type을 붙이지 않는다', async () => {
    const requests = captureRequest()
    await send('/ledgers', { method: 'POST' })
    expect(requests[0].headers.get('Content-Type')).toBeNull()
    expect(await requests[0].text()).toBe('')
  })

  it('access token은 Authorization 헤더로만 보낸다', async () => {
    const requests = captureRequest()
    await send('/me', { accessToken: 'token-1' })
    expect(requests[0].headers.get('Authorization')).toBe('Bearer token-1')
    expect(requests[0].url).not.toContain('token-1')
  })

  it('access token이 없으면 Authorization 헤더가 없다', async () => {
    const requests = captureRequest()
    await send('/me')
    expect(requests[0].headers.has('Authorization')).toBe(false)
  })

  it.each(['/auth/login', '/auth/refresh', '/auth/signup'] as const)(
    '%s에는 X-Akkimpyo-Client: web 헤더를 붙인다',
    async (path) => {
      const requests = captureRequest()
      await send(path, { method: 'POST' })
      expect(requests[0].headers.get('X-Akkimpyo-Client')).toBe('web')
    },
  )

  it.each(['/me', '/authors'] as const)('%s에는 X-Akkimpyo-Client 헤더를 붙이지 않는다', async (path) => {
    const requests = captureRequest()
    await send(path)
    expect(requests[0].headers.has('X-Akkimpyo-Client')).toBe(false)
  })
})

describe('성공 응답', () => {
  it('JSON 본문을 돌려준다', async () => {
    respondWith(() => HttpResponse.json({ items: [1] }))
    expect(await send('/ledgers')).toEqual({ items: [1] })
  })

  it('204는 본문이 없다', async () => {
    respondWith(() => new HttpResponse(null, { status: 204 }))
    expect(await send('/ledgers')).toBeUndefined()
  })

  it.each([
    ['HTML', '<!doctype html><title>아낌표</title>'],
    ['잘린 JSON', '{"accessToken":"eyJhbGciOi'],
  ])('본문이 %s이면 서버 오류로 보고, 본문을 오류에 남기지 않는다', async (_, body) => {
    respondWith(() => new HttpResponse(body, { headers: { 'Content-Type': 'application/json' } }))
    const error = await errorOf(send('/ledgers'))
    expect(error.kind).toBe('server')
    expect(error.status).toBe(200)
    expect(everythingIn(error)).not.toContain(body.slice(0, 12))
  })
})

describe('오류 응답', () => {
  it('problem+json의 값을 타입 있는 오류로 돌려준다', async () => {
    respondWith(() =>
      problem(400, 'VALIDATION_FAILED', {
        fieldErrors: [{ field: 'lines[0].amount', code: 'OUT_OF_RANGE', message: '개발자가 읽는 글' }],
      }),
    )
    const error = await errorOf(send('/ledgers'))
    expect(error).toMatchObject({
      kind: 'rejected',
      status: 400,
      code: 'VALIDATION_FAILED',
      requestId: 'req-example-1',
    })
    expect(error.fieldErrors).toEqual([{ field: 'lines[0].amount', code: 'OUT_OF_RANGE' }])
    expect(error.current).toBeUndefined()
  })

  it('수정 충돌의 current를 담는다', async () => {
    respondWith(() => problem(409, 'STALE_VERSION', { current: { id: 'a', version: 4 } }))
    const error = await errorOf(send('/ledgers'))
    expect(error).toMatchObject({ kind: 'rejected', status: 409, current: { id: 'a', version: 4 } })
    expect(error.fieldErrors).toEqual([])
  })

  it('detail, title, message는 화면 문구로 쓰지 않으므로 담지 않는다', async () => {
    respondWith(() =>
      problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'a', code: 'REQUIRED', message: '서버가 쓴 문장' }] }),
    )
    const everything = everythingIn(await errorOf(send('/ledgers')))
    expect(everything).not.toContain('개발자가 읽는 한 줄')
    expect(everything).not.toContain('상태 문구')
    expect(everything).not.toContain('서버가 쓴 문장')
  })

  it.each([
    [400, 'rejected'],
    [401, 'rejected'],
    [404, 'rejected'],
    [429, 'rejected'],
    [500, 'server'],
    [502, 'server'],
    [504, 'server'],
  ])('모르는 code이면 상태 %d로 종류를 정한다: %s', async (status, kind) => {
    respondWith(() => problem(status, 'SOMETHING_NEW'))
    expect(await errorOf(send('/ledgers'))).toMatchObject({ kind, status })
  })

  it.each([
    ['HTML', '<html>Bad Gateway</html>', 'text/html'],
    ['빈 본문', '', 'application/problem+json'],
    ['읽을 수 없는 JSON', '{"code":', 'application/problem+json'],
    ['객체가 아닌 JSON', '"문자열"', 'application/problem+json'],
    ['null', 'null', 'application/problem+json'],
    ['다른 형식의 JSON', '{"code":"INVALID_CREDENTIALS"}', 'application/json'],
    ['형이 틀린 값', '{"code":1,"fieldErrors":"x","requestId":{}}', 'application/problem+json'],
  ])('본문이 %s이면 상태만으로 처리한다', async (_, body, contentType) => {
    respondWith(() => new HttpResponse(body, { status: 502, headers: { 'Content-Type': contentType } }))
    const error = await errorOf(send('/ledgers'))
    expect(error).toMatchObject({ kind: 'server', status: 502, fieldErrors: [] })
    expect(error.code).toBeUndefined()
    expect(error.requestId).toBeUndefined()
  })

  it('charset이 붙은 problem+json도 읽는다', async () => {
    respondWith(
      () =>
        new HttpResponse('{"code":"NOT_FOUND"}', {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json;charset=UTF-8' },
        }),
    )
    expect((await errorOf(send('/ledgers'))).code).toBe('NOT_FOUND')
  })

  it('형식이 맞지 않는 fieldErrors 항목은 버린다', async () => {
    respondWith(() =>
      problem(400, 'VALIDATION_FAILED', {
        fieldErrors: [null, 'x', { field: 'email' }, { field: 'email', code: 'REQUIRED' }],
      }),
    )
    expect((await errorOf(send('/ledgers'))).fieldErrors).toEqual([{ field: 'email', code: 'REQUIRED' }])
  })
})

describe('응답을 받지 못함', () => {
  it('서버에 닿지 못하면 연결 오류다', async () => {
    respondWith(() => HttpResponse.error())
    const error = await errorOf(send('/ledgers'))
    expect(error.kind).toBe('connection')
    expect(error.status).toBeUndefined()
  })

  it('본문을 받다가 끊기면 연결 오류다', async () => {
    respondWith(() => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"items":'))
          controller.error(new TypeError('끊김'))
        },
      })
      return new HttpResponse(body, { headers: { 'Content-Type': 'application/json' } })
    })
    expect((await errorOf(send('/ledgers'))).kind).toBe('connection')
  })
})

describe('지연', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('15초 동안 응답이 없으면 지연 오류다', async () => {
    respondWith(() => new Promise<Response>(() => {}))
    let settled = false
    const result = errorOf(send('/ledgers')).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).kind).toBe('timeout')
  })

  it('본문이 15초 안에 끝나지 않아도 지연 오류다', async () => {
    respondWith(() => new HttpResponse(new ReadableStream(), { headers: { 'Content-Type': 'application/json' } }))
    const result = errorOf(send('/ledgers'))
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await result).kind).toBe('timeout')
  })

  it('응답을 받으면 시계를 멈춘다', async () => {
    respondWith(() => HttpResponse.json({}))
    await send('/ledgers')
    expect(vi.getTimerCount()).toBe(0)
  })
})

function everythingIn(error: ApiError): string {
  return [String(error), error.stack, JSON.stringify(error, Object.getOwnPropertyNames(error)), String(error.cause)].join()
}
