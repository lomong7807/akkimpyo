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
  const router = renderRoutes(await edit(routes), path)
  return { router, user: setupUser() }
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
