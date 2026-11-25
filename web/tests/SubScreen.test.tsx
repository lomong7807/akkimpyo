import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createBrowserRouter, Link, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MainScreen, SubScreen } from '../src/components/Screen'

const routes: RouteObject[] = [
  {
    path: '/accounts',
    element: (
      <MainScreen>
        <p>계좌 목록</p>
        <Link to="/accounts/1">계좌 1</Link>
      </MainScreen>
    ),
  },
  {
    path: '/accounts/:id',
    element: (
      <SubScreen title="계좌 상세" parent="/accounts">
        <Link to="/accounts/1?month=2026-10" replace>
          이전 달
        </Link>
      </SubScreen>
    ),
  },
  { path: '/home', element: <p>홈</p> },
]

// "뒤로"는 브라우저 방문 기록을 보므로 실제 history를 쓰는 라우터로 확인한다.
function open(path: string) {
  window.history.replaceState(null, '', path)
  const router = createBrowserRouter(routes)
  render(<RouterProvider router={router} />)
  return router
}

const back = () => fireEvent.click(screen.getByRole('button', { name: '뒤로' }))

afterEach(cleanup)

describe('하위 화면의 "뒤로"', () => {
  it('앞서 본 화면이 있으면 방문 기록에서 한 칸 돌아간다', async () => {
    const router = open('/accounts')
    fireEvent.click(screen.getByRole('link', { name: '계좌 1' }))
    await screen.findByRole('heading', { name: '계좌 상세' })
    back()
    await screen.findByText('계좌 목록')
    expect(router.state.historyAction).toBe('POP')
    router.dispose()
  })

  it('주소를 바로 열어 앞선 기록이 없으면 상위 화면으로 간다', async () => {
    const router = open('/accounts/1')
    back()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/accounts'))
    expect(router.state.historyAction).toBe('REPLACE')
    router.dispose()
  })

  it('바로 연 화면 안에서 주소의 달만 바꿨어도 상위 화면으로 간다', async () => {
    const router = open('/accounts/1')
    fireEvent.click(screen.getByRole('link', { name: '이전 달' }))
    await vi.waitFor(() => expect(router.state.location.search).toBe('?month=2026-10'))
    back()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/accounts'))
    router.dispose()
  })
})
