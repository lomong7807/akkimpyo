import { CACHE_PREFIX, routeOf } from './swRoutes'

/*
 * service worker 본체(F-120, #234 C, 설계 8.2·8.3). serviceWorker.ts가 빌드 때 넣은 목록과 캐시 이름으로 부른다.
 * - 설치: 빌드 결과를 모두 HTTP 캐시를 거치지 않고 받아 이 판의 캐시에 넣는다. 하나라도 실패하면 설치하지 않는다(앞 판을 쓴다)
 * - 활성화: 앞 판의 캐시(akkimpyo-app-*)를 지운다. 사용자 데이터가 없으므로 로그아웃 때 지울 것이 없다
 * - 받기: swRoutes대로. 받는 중에는 캐시에 새로 넣지 않는다
 * 새 판은 이 앱의 창이 모두 닫힌 뒤 다음에 열 때 쓴다(skipWaiting, clients.claim을 쓰지 않는다, architect Q9). 쓰는 중에 화면
 * 파일이 바뀌지 않고 열린 탭끼리 판이 섞이지 않는다.
 * 긴급히 끌 때는 스스로 등록을 풀고 캐시를 지우는 sw.js를 배포한다.
 */

const SHELL = '/index.html'

export function serveApp(worker: ServiceWorkerGlobalScope, precache: readonly string[], cacheName: string): void {
  const precached = new Set(precache)

  worker.addEventListener('install', (event) => {
    event.waitUntil(
      worker.caches
        .open(cacheName)
        .then((cache) => cache.addAll(precache.map((path) => new Request(urlOf(path), { cache: 'reload' })))),
    )
  })

  worker.addEventListener('activate', (event) => {
    event.waitUntil(
      worker.caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName)
              .map((name) => worker.caches.delete(name)),
          ),
        ),
    )
  })

  worker.addEventListener('fetch', (event) => {
    const { request } = event
    const route = routeOf(
      { url: request.url, method: request.method, mode: request.mode },
      worker.location.origin,
      precached,
    )
    if (route === 'network') return
    event.respondWith(fromCache(route === 'shell' ? SHELL : new URL(request.url).pathname, request))
  })

  /** 이 판의 캐시에서 준다. 없으면(브라우저가 지웠으면) 네트워크에서 받고 캐시에 넣지 않는다 */
  async function fromCache(path: string, request: Request): Promise<Response> {
    const cache = await worker.caches.open(cacheName)
    return (await cache.match(urlOf(path))) ?? worker.fetch(request)
  }

  function urlOf(path: string): string {
    return new URL(path, worker.location.origin).href
  }
}
