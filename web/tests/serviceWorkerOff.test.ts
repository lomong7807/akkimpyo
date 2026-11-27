// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { turnOffApp } from '../src/sw/turnOffApp'

/*
 * 긴급히 끄는 service worker(dist/sw-off.js, devops #52·#54, security C1 검토). 프록시가 SW_DISABLE=yes이면 /sw.js 요청에 이
 * 내용을 낸다. 기다리지 않고 바로 활성화해 이 출처의 캐시를 모두 지우고, 등록을 풀고, 맡던 창을 새로 고친다.
 * 받기(fetch)를 다루지 않아 /api·/actuator를 포함해 아무것도 가로채지 않는다. IndexedDB(보내지 않은 입력)는 건드리지 않는다.
 */

type Listener = (event: unknown) => void

function fakeWorker() {
  const listeners = new Map<string, Listener>()
  const order: string[] = []
  const names = ['akkimpyo-app-old', 'akkimpyo-app-new', 'other-cache']
  const windows = [
    { url: 'https://akkimpyo.example/home', navigate: vi.fn(async (url: string) => order.push(`navigate ${url}`)) },
    { url: 'https://akkimpyo.example/transactions/new', navigate: vi.fn(async (url: string) => order.push(`navigate ${url}`)) },
  ]
  const worker = {
    caches: {
      keys: vi.fn(async () => [...names]),
      delete: vi.fn(async (name: string) => {
        order.push(`delete ${name}`)
        return true
      }),
    },
    skipWaiting: vi.fn(async () => order.push('skipWaiting')),
    clients: {
      claim: vi.fn(async () => order.push('claim')),
      matchAll: vi.fn(async () => windows),
    },
    registration: { unregister: vi.fn(async () => order.push('unregister')) },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  }
  return { worker, listeners, order, windows }
}

function extendable() {
  const waited: Promise<unknown>[] = []
  return { event: { waitUntil: (promise: Promise<unknown>) => waited.push(promise) }, done: () => Promise.all(waited) }
}

describe('turnOffApp', () => {
  it('설치되면 기다리지 않고 바로 활성화한다', async () => {
    const fake = fakeWorker()
    turnOffApp(fake.worker as unknown as ServiceWorkerGlobalScope)
    const { event, done } = extendable()
    fake.listeners.get('install')!(event)
    await done()
    expect(fake.worker.skipWaiting).toHaveBeenCalled()
  })

  it('활성화되면 이 출처의 캐시를 모두 지우고, 등록을 풀고, 맡던 창을 새로 고친다', async () => {
    const fake = fakeWorker()
    turnOffApp(fake.worker as unknown as ServiceWorkerGlobalScope)
    const { event, done } = extendable()
    fake.listeners.get('activate')!(event)
    await done()
    expect(fake.order).toEqual([
      'delete akkimpyo-app-old',
      'delete akkimpyo-app-new',
      'delete other-cache',
      'unregister',
      'navigate https://akkimpyo.example/home',
      'navigate https://akkimpyo.example/transactions/new',
    ])
    expect(fake.worker.clients.matchAll).toHaveBeenCalledWith({ type: 'window' })
  })

  it('맡지 않던 창은 맡지 않는다(새로 고친 창이 다시 등록한 이 판이 그 창을 맡아 또 새로 고치는 고리를 막는다)', async () => {
    const fake = fakeWorker()
    turnOffApp(fake.worker as unknown as ServiceWorkerGlobalScope)
    const { event, done } = extendable()
    fake.listeners.get('activate')!(event)
    await done()
    expect(fake.worker.clients.claim).not.toHaveBeenCalled()
    expect(fake.worker.clients.matchAll).not.toHaveBeenCalledWith(expect.objectContaining({ includeUncontrolled: true }))
  })

  it('창 하나를 새로 고치지 못해도 나머지는 새로 고친다', async () => {
    const fake = fakeWorker()
    fake.windows[0].navigate.mockRejectedValueOnce(new TypeError('not controlled'))
    turnOffApp(fake.worker as unknown as ServiceWorkerGlobalScope)
    const { event, done } = extendable()
    fake.listeners.get('activate')!(event)
    await done()
    expect(fake.windows[1].navigate).toHaveBeenCalled()
  })

  it('받기를 다루지 않는다(아무것도 가로채지 않는다)', () => {
    const fake = fakeWorker()
    turnOffApp(fake.worker as unknown as ServiceWorkerGlobalScope)
    expect([...fake.listeners.keys()].sort()).toEqual(['activate', 'install'])
  })
})
