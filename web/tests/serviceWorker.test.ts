// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serveApp } from '../src/sw/serveApp'
import { CACHE_PREFIX } from '../src/sw/swRoutes'

/*
 * service worker 본체(F-120, #234 C, 설계 8.2·8.3). 설치 때 빌드 결과를 모두 미리 캐시하고, 활성화 때 앞 판의 캐시를 지운다.
 * 받는 중에는 캐시에 새로 넣지 않는다(사용자 데이터가 캐시에 들어갈 길이 없다, security 검토 항목 3).
 * 새 판은 다음에 열 때 쓴다(skipWaiting, clients.claim 없음, Q9).
 */

const ORIGIN = 'https://akkimpyo.example'
const CACHE = `${CACHE_PREFIX}new`
const PRECACHE = ['/index.html', '/assets/index-abc.js', '/manifest.webmanifest']

type Listener = (event: unknown) => void

class FakeCache {
  readonly entries = new Map<string, Response>()
  readonly addAll = vi.fn(async (requests: Request[]) => {
    for (const request of requests) this.entries.set(new URL(request.url).pathname, new Response(`cached ${request.url}`))
  })
  readonly put = vi.fn()
  readonly add = vi.fn()

  async match(path: string) {
    return this.entries.get(new URL(path, ORIGIN).pathname)
  }
}

function fakeWorker() {
  const listeners = new Map<string, Listener>()
  const stores = new Map<string, FakeCache>()
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new FakeCache())
      return stores.get(name)!
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  }
  const worker = {
    location: { origin: ORIGIN },
    caches,
    fetch: vi.fn(async (request: Request) => new Response(`network ${request.url}`)),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  }
  return { worker, listeners, stores, caches }
}

function extendable() {
  const waited: Promise<unknown>[] = []
  return { event: { waitUntil: (promise: Promise<unknown>) => waited.push(promise) }, done: () => Promise.all(waited) }
}

function fetchEvent(path: string, { method = 'GET', mode = 'cors' as RequestMode } = {}) {
  const request = new Request(new URL(path, ORIGIN), { method })
  Object.defineProperty(request, 'mode', { value: mode })
  let response: Promise<Response> | undefined
  return {
    event: { request, respondWith: (value: Promise<Response>) => (response = value) },
    response: () => response,
  }
}

let fake: ReturnType<typeof fakeWorker>

beforeEach(() => {
  fake = fakeWorker()
  serveApp(fake.worker as unknown as ServiceWorkerGlobalScope, PRECACHE, CACHE)
})

async function install() {
  const { event, done } = extendable()
  fake.listeners.get('install')!(event)
  await done()
}

describe('설치', () => {
  it('빌드 결과를 모두 HTTP 캐시를 거치지 않고 받아 이 판의 캐시에 넣는다', async () => {
    await install()
    const cache = fake.stores.get(CACHE)!
    const requests = cache.addAll.mock.calls[0][0]
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(PRECACHE)
    expect(requests.every((request) => request.cache === 'reload')).toBe(true)
  })

  it('하나라도 받지 못하면 설치하지 않는다(앞 판을 계속 쓴다)', async () => {
    fake.caches.open.mockResolvedValueOnce(
      Object.assign(new FakeCache(), { addAll: vi.fn().mockRejectedValue(new TypeError('failed')) }),
    )
    await expect(install()).rejects.toThrow('failed')
  })

  it('기다리는 판을 바로 쓰지 않는다(다음에 열 때, Q9)', async () => {
    await install()
    expect(fake.worker.skipWaiting).not.toHaveBeenCalled()
  })
})

describe('활성화', () => {
  it('앞 판의 캐시만 지우고 이 판과 이름이 다른 캐시는 남긴다', async () => {
    await fake.caches.open(`${CACHE_PREFIX}old`)
    await fake.caches.open(CACHE)
    await fake.caches.open('other-cache')
    const { event, done } = extendable()
    fake.listeners.get('activate')!(event)
    await done()
    expect([...fake.stores.keys()].sort()).toEqual([CACHE, 'other-cache'].sort())
    expect(fake.worker.clients.claim).not.toHaveBeenCalled()
  })
})

describe('받기', () => {
  beforeEach(install)

  it('화면 이동은 연결이 있어도 캐시의 앱 껍데기(index.html)를 준다', async () => {
    const { event, response } = fetchEvent('/transactions/new', { mode: 'navigate' })
    fake.listeners.get('fetch')!(event)
    expect(await (await response())!.text()).toBe(`cached ${ORIGIN}/index.html`)
    expect(fake.worker.fetch).not.toHaveBeenCalled()
  })

  it('미리 캐시한 파일은 캐시에서 준다', async () => {
    const { event, response } = fetchEvent('/assets/index-abc.js')
    fake.listeners.get('fetch')!(event)
    expect(await (await response())!.text()).toBe(`cached ${ORIGIN}/assets/index-abc.js`)
  })

  it('캐시에 없으면(지워졌으면) 네트워크에서 받고 캐시에 넣지 않는다', async () => {
    fake.stores.get(CACHE)!.entries.clear()
    const { event, response } = fetchEvent('/home', { mode: 'navigate' })
    fake.listeners.get('fetch')!(event)
    expect(await (await response())!.text()).toBe(`network ${ORIGIN}/home`)
    expect(fake.stores.get(CACHE)!.put).not.toHaveBeenCalled()
  })

  it.each([
    ['API 조회', '/api/v1/me', 'GET', 'cors'],
    ['API로 가는 화면 이동', '/api/v1/', 'GET', 'navigate'],
    ['API 저장', '/api/v1/ledgers/l1/transactions', 'POST', 'cors'],
    ['운영 확인', '/actuator/health', 'GET', 'cors'],
    ['미리 캐시하지 않은 파일', '/sw.js', 'GET', 'cors'],
  ] as const)('%s는 가로채지 않는다', (_, path, method, mode) => {
    const { event, response } = fetchEvent(path, { method, mode })
    fake.listeners.get('fetch')!(event)
    expect(response()).toBeUndefined()
  })

  it('받는 중에는 어떤 응답도 캐시에 넣지 않는다', async () => {
    for (const [path, mode] of [['/home', 'navigate'], ['/assets/index-abc.js', 'cors'], ['/api/v1/me', 'cors']] as const) {
      const { event, response } = fetchEvent(path, { mode })
      fake.listeners.get('fetch')!(event)
      await response()
    }
    const cache = fake.stores.get(CACHE)!
    expect(cache.put).not.toHaveBeenCalled()
    expect(cache.add).not.toHaveBeenCalled()
    expect(cache.addAll).toHaveBeenCalledTimes(1)
  })
})
