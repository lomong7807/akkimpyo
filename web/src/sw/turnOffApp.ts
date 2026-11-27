/*
 * 긴급히 끄는 service worker(dist/sw-off.js, devops #52·#54, security C1 검토). 프록시가 SW_DISABLE=yes이면 /sw.js 요청에 이
 * 내용을 낸다. 브라우저가 /sw.js를 다시 받을 때(앱을 열거나 화면을 옮길 때) 새 판으로 설치된다.
 * - 설치: 기다리지 않고 바로 활성화한다(앞 판의 창이 열려 있어도)
 * - 활성화: 이 출처의 Cache Storage를 모두 지우고, 등록을 풀고, 맡던 창(앞 판이 맡던 창은 바로 활성화하면 이 판으로 넘어온다)을
 *   새로 고친다. 새로 고친 창은 service worker 없이 네트워크에서 새 화면을 받는다
 * 맡지 않던 창은 맡지 않는다(clients.claim 없음). 새로 고친 창의 앱이 /sw.js를 다시 등록하면 이 판이 또 설치되는데, 그때 그 창을
 * 맡으면 또 새로 고쳐 끝없이 새로 고친다(실제 브라우저 확인). 맡지 않으면 다시 설치된 판은 캐시를 비우고 등록만 푼다.
 * 받기(fetch)를 다루지 않으므로 /api·/actuator를 포함해 아무것도 가로채지 않는다. IndexedDB(보내지 않은 입력, 쓰던 값, 사본)는
 * 지우지 않는다. 기기 데이터를 지우는 것은 사용자가 로그아웃한 경우뿐이다(00-common 4.1).
 */

export function turnOffApp(worker: ServiceWorkerGlobalScope): void {
  worker.addEventListener('install', (event) => {
    event.waitUntil(worker.skipWaiting())
  })

  worker.addEventListener('activate', (event) => {
    event.waitUntil(turnOff())
  })

  async function turnOff() {
    const names = await worker.caches.keys()
    await Promise.all(names.map((name) => worker.caches.delete(name)))
    await worker.registration.unregister()
    const windows = await worker.clients.matchAll({ type: 'window' })
    // 새로 고치지 못한 창은 다음에 열 때 service worker 없이 열린다
    await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => null)))
  }
}
