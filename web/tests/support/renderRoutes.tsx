import { render } from '@testing-library/react'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'

/** 주소 `path`를 바로 연 상태로 라우터를 그린다. 돌려주는 라우터로 지금 주소를 확인한다. */
export function renderRoutes(routes: RouteObject[], path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}
