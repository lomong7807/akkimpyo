import type { RouteObject } from 'react-router'
import { vi } from 'vitest'
import { renderRoutes } from './renderRoutes'
import { fetchScreenCodeFirst } from './screenCode'
import { setupUser } from './testClock'

// 파일의 첫 테스트가 화면 코드를 받는 시간을 테스트 밖에서 먼저 쓴다(#291)
fetchScreenCodeFirst()

type Edit = (routes: RouteObject[]) => RouteObject[] | Promise<RouteObject[]>

/**
 * 주소 `path`로 앱을 새로 연다(새 탭이나 새로고침). 모듈을 다시 불러와 메모리의 토큰이 없는 상태로 시작한다.
 * 화면을 바꿔 넣으려면 `edit`을 준다. 앱의 모듈이 필요하면 `edit` 안에서 불러온다.
 */
export async function openApp(path: string, edit: Edit = (routes) => routes) {
  vi.resetModules()
  const { routes } = await import('../../src/app/routes')
  await preloadLoginScreen()
  const router = renderRoutes(await edit(routes), path)
  return { router, user: setupUser() }
}

/**
 * 새로 연 탭의 로그인 화면 코드를 그리기 전에 받아 둔다. 로그인 화면은 따로 싣는다(#355).
 * - 탭마다 모듈을 새로 불러오므로(vi.resetModules), 다른 탭을 연 뒤에 받으면 그 코드가 새로 불러온 모듈(다른 SessionContext)과
 *   이어져 이 탭에서 돌지 않는다.
 * - 기기에 로그인 기록이 없으면 앱이 열리자마자 로그인 화면 코드를 받는다(SessionProvider). 테스트에서는 그 변환이 같은 때 받는
 *   다른 화면 조각을 늦춰 기다림이 흔들린다.
 * 둘 다 한 판의 모듈을 나눠 쓰고 조각을 동시에 받는 브라우저에서는 생기지 않는 일이다. 받는 동안의 틀은 LazyScreens.test가 본다.
 */
export async function preloadLoginScreen() {
  const { loginScreen } = await import('../../src/app/screens')
  await loginScreen.preload()
}

/** 공통 틀 안에 화면을 더한다. */
export function addScreens(screens: RouteObject[]): (routes: RouteObject[]) => RouteObject[] {
  function add(route: RouteObject): RouteObject {
    if (!route.children) return route
    const inFrame = route.children.some((child) => child.path === '*')
    const children = inFrame ? [...screens, ...route.children] : route.children.map(add)
    return { ...route, children } as RouteObject
  }
  return (routes) => routes.map(add)
}
