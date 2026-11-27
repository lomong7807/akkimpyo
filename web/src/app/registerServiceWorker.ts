/**
 * service worker를 등록한다(F-120, #234 C, 설계 8.2). 배포 빌드에서만 main.tsx가 load 뒤에 부른다.
 * /sw.js는 HTTP 캐시를 거치지 않고 확인한다(updateViaCache: 'none', devops Q15). 등록하지 못해도 앱은 그대로 쓴다.
 */
export function registerServiceWorker(container: ServiceWorkerContainer = navigator.serviceWorker): void {
  void container.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
}
