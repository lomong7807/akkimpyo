import { waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { Outlet, useLocation, type RouteObject } from 'react-router'

/*
 * 라우터가 옮긴 주소의 화면이 그려졌는지 보는 도우미(#291). 라우터(RouterProvider)는 옮길 때 주소(router.state)를 먼저 바꾸고
 * 화면은 startTransition으로 나중에 그린다. 주소가 바뀐 것이나 저장 뒤 토스트가 보이는 것은 새 화면이 그려졌다는 뜻이 아니다.
 * 부하에서는 그 사이에 앞 화면(전체 화면 입력)이 남아 있는 동안 새 화면의 요소를 바로 찾다가 실패했다.
 */

/** 라우터마다 화면에 그려진 주소의 key. 라우터는 옮길 때마다 주소에 새 key를 달고, 뒤로 가면 그 항목의 key로 돌아간다. */
const shownKeys = new WeakMap<object, { key?: string }>()

/**
 * `create`로 라우터를 만든다. 앱의 라우트를 그려진 주소를 알리는 자리로 감싸 untilShown이 이 라우터를 볼 수 있게 한다.
 * 감싸는 것은 경로가 없는 바깥 라우트라 주소의 짝과 handle은 그대로다.
 */
export function withShownLocation<Router extends object>(routes: RouteObject[], create: (routes: RouteObject[]) => Router) {
  const shown: { key?: string } = {}
  /** 그려진 주소를 적는다. layout effect는 commit 안에서 돌므로 적은 때에는 그 주소의 화면 전체가 DOM에 있다. */
  function ShownLocation() {
    const { key } = useLocation()
    useLayoutEffect(() => {
      shown.key = key
    }, [key])
    return <Outlet />
  }
  const router = create([{ element: <ShownLocation />, children: routes }])
  shownKeys.set(router, shown)
  return router
}

/**
 * 라우터의 지금 주소의 화면이 그려질 때까지 기다린다. 옮긴 뒤 새 화면의 요소를 바로 찾기 전에 쓴다.
 * 그려지기만 본다. 따로 싣는 화면(#251)이면 그 화면의 틀일 수 있고, 데이터는 그 화면의 요소로 기다린다.
 */
export async function untilShown(router: { state: { location: { key: string; pathname: string } } }) {
  const shown = shownKeys.get(router)
  if (!shown) throw new Error('untilShown: 앱 그리기 도우미(openApp 등)가 만든 라우터가 아니다')
  await waitFor(() => {
    const { key, pathname } = router.state.location
    if (shown.key !== key) throw new Error(`라우터의 주소(${pathname})가 아직 화면에 그려지지 않았다`)
  })
}
