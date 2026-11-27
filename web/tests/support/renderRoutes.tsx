import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from '../../src/app/queryClient'
import { enableTestClock } from './testClock'

// 앱을 그리는 테스트는 공용 시계 하나로 돈다(docs/qa/test-strategy.md 8절 1)
enableTestClock()

/** 주소 `path`를 바로 연 상태로 라우터를 그린다. 돌려주는 라우터로 지금 주소를 확인한다. */
export function renderRoutes(routes: RouteObject[], path: string, queryClient = createQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}
