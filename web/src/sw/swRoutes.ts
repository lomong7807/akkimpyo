/*
 * service worker가 요청을 어떻게 다룰지(F-120, #234 C, 설계 8.2). 다른 것을 부르지 않는 순수 함수라 node에서 테스트한다.
 * - network: 가로채지 않는다. API(/api)와 운영 확인(/actuator)은 늘 여기다. 캐시에 넣지 않으므로 사용자 데이터가 캐시에 들어갈
 *   길이 없다(security 검토 항목 3)
 * - shell: 화면 이동. 캐시의 앱 껍데기(index.html)를 준다. 연결이 없어도 앱이 열리고, 아이콘에서 입력창까지가 짧아진다
 * - precached: 미리 캐시한 빌드 결과. 캐시 먼저다
 */

/** 이 앱이 만드는 캐시 이름의 앞. 뒤에 빌드 결과 내용의 해시가 붙는다(plugins/serviceWorkerPlugin.ts) */
export const CACHE_PREFIX = 'akkimpyo-app-'

export type SwRoute = 'network' | 'shell' | 'precached'

export interface SwRequest {
  url: string
  method: string
  mode: string
}

/** 가로채지 않는 경로. 이 이름 자체이거나 그 아래다 */
const SERVER_PATHS = ['/api', '/actuator']

export function routeOf({ url, method, mode }: SwRequest, origin: string, precached: ReadonlySet<string>): SwRoute {
  if (method !== 'GET') return 'network'
  const { origin: requestOrigin, pathname, search } = new URL(url)
  if (requestOrigin !== origin) return 'network'
  if (SERVER_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return 'network'
  // 화면 주소에는 점이 든 마지막 조각(파일 이름)이 없다. 파일로 가는 이동은 그 파일로 다룬다
  if (mode === 'navigate' && !pathname.slice(pathname.lastIndexOf('/') + 1).includes('.')) return 'shell'
  if (search === '' && precached.has(pathname)) return 'precached'
  return 'network'
}
