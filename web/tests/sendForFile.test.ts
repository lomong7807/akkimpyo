import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { sendForFile } from '../src/api/fileRequest'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { reconnectStaticApp } from './support/staticConnection'

/* 파일로 받는 응답(내보내기 #240). 보내는 쪽은 send와 같고(api/http), 본문을 글자가 아닌 Blob으로 받는다. */

const server = startMockServer()

afterEach(() => vi.restoreAllMocks())

function respondWith(response: () => Response | Promise<Response>) {
  server.use(http.all('*', response))
}

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('성공 응답', () => {
  it('본문을 바이트 그대로 Blob으로, Content-Disposition을 글자로 준다', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xef, 0xbb, 0xbf])
    respondWith(
      () =>
        new HttpResponse(bytes, {
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="a.xlsx"' },
        }),
    )
    const { status, file, disposition } = await sendForFile('/ledgers/x/exports', { accessToken: 'token' })
    expect(status).toBe(200)
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(bytes)
    expect(disposition).toBe('attachment; filename="a.xlsx"')
  })

  it('204는 파일이 없다', async () => {
    respondWith(() => new HttpResponse(null, { status: 204 }))
    expect(await sendForFile('/ledgers/x/exports')).toEqual({ status: 204, file: undefined, disposition: null })
  })

  it('access token은 Authorization 헤더로만 보낸다', async () => {
    const requests: Request[] = []
    server.use(
      http.all('*', ({ request }) => {
        requests.push(request)
        return new HttpResponse('a')
      }),
    )
    await sendForFile('/ledgers/x/exports?format=csv', { accessToken: 'token-a' })
    expect(requests[0].headers.get('Authorization')).toBe('Bearer token-a')
    expect(requests[0].url).toBe(`${window.location.origin}/api/v1/ledgers/x/exports?format=csv`)
    expect(requests[0].method).toBe('GET')
  })
})

describe('오류 응답', () => {
  it('problem+json을 send와 같이 타입 있는 오류로 던진다', async () => {
    respondWith(() =>
      problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'to', code: 'NOT_ALLOWED', message: '개발자 글' }] }),
    )
    const error = await errorOf(sendForFile('/ledgers/x/exports'))
    expect([error.kind, error.status, error.code]).toEqual(['rejected', 400, 'VALIDATION_FAILED'])
    expect(error.fieldErrors).toEqual([{ field: 'to', code: 'NOT_ALLOWED' }])
  })

  it('5xx는 서버 오류다', async () => {
    respondWith(() => new HttpResponse('<html>', { status: 502 }))
    expect((await errorOf(sendForFile('/ledgers/x/exports'))).kind).toBe('server')
  })
})

describe('응답을 받지 못함', () => {
  afterEach(reconnectStaticApp)

  it('본문을 받다가 끊기면 연결 오류다', async () => {
    respondWith(() => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.error(new TypeError('끊김'))
        },
      })
      return new HttpResponse(body)
    })
    expect((await errorOf(sendForFile('/ledgers/x/exports'))).kind).toBe('connection')
  })
})

describe('지연', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('머리글만 오고 파일이 15초 안에 다 오지 않아도 지연 오류다', async () => {
    vi.stubGlobal('fetch', async (_: string, { signal }: { signal: AbortSignal }) => {
      const body = new ReadableStream({
        start: (controller) => signal.addEventListener('abort', () => controller.error(signal.reason)),
      })
      return new Response(body)
    })
    const result = errorOf(sendForFile('/ledgers/x/exports'))
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await result).kind).toBe('timeout')
  })
})
