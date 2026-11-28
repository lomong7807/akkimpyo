import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { createMemoryRouter, useLocation, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it } from 'vitest'
import { Link, NavLink } from '../src/components/Link'

/*
 * 앱의 링크(#355). react-router의 Link·NavLink 대신 공개 훅으로 만든 것이라, 앱이 쓰는 속성(to, state, replace,
 * preventScrollReset, target, NavLink의 end와 aria-current)이 react-router의 것과 같게 도는지 고정한다(architect 조건 B).
 */

function Here() {
  const location = useLocation()
  return <output aria-label="지금 주소">{`${location.pathname}${location.search}`}</output>
}

function open(element: ReactNode, path = '/home') {
  const routes: RouteObject[] = [
    {
      path: '*',
      element: (
        <>
          <Here />
          {element}
        </>
      ),
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

const link = (name: string) => screen.getByRole('link', { name })
const here = () => screen.getByLabelText('지금 주소').textContent

afterEach(cleanup)

describe('앱의 Link', () => {
  it('주소를 href로 그리고, 누르면 방문 기록에 더해 옮겨 가며 state를 넘긴다', () => {
    const router = open(
      <Link to="/transactions/new" state={{ from: 'home' }} className="row" aria-label="거래 입력">
        입력
      </Link>,
    )

    expect(link('거래 입력').getAttribute('href')).toBe('/transactions/new')
    expect(link('거래 입력').className).toBe('row')
    expect(fireEvent.click(link('거래 입력'))).toBe(false)

    expect(here()).toBe('/transactions/new')
    expect(router.state.historyAction).toBe('PUSH')
    expect(router.state.location.state).toEqual({ from: 'home' })
    router.dispose()
  })

  it('replace를 주면 방문 기록을 바꿔 쓴다', () => {
    const router = open(
      <Link to="/transactions?month=2026-10" replace>
        이전 달
      </Link>,
      '/transactions?month=2026-11',
    )

    fireEvent.click(link('이전 달'))

    expect(here()).toBe('/transactions?month=2026-10')
    expect(router.state.historyAction).toBe('REPLACE')
    router.dispose()
  })

  it('replace를 주지 않아도 지금과 같은 주소로 가면 방문 기록을 바꿔 쓴다(react-router와 같다)', () => {
    const router = open(<Link to="/home">홈</Link>)

    fireEvent.click(link('홈'))

    expect(router.state.historyAction).toBe('REPLACE')
    router.dispose()
  })

  it('preventScrollReset을 라우터에 넘긴다', () => {
    const router = open(
      <Link to="/accounts" preventScrollReset>
        계좌
      </Link>,
    )

    fireEvent.click(link('계좌'))

    expect(router.state.preventScrollReset).toBe(true)
    router.dispose()
  })

  it.each([
    ['⌘', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['가운데 단추', { button: 1 }],
  ])('%s 누름은 가로채지 않고 브라우저에 맡긴다(새 탭·새 창)', (_name, init) => {
    const router = open(<Link to="/accounts">계좌</Link>)

    expect(fireEvent.click(link('계좌'), init)).toBe(true)

    expect(here()).toBe('/home')
    router.dispose()
  })

  it('target="_blank"는 가로채지 않는다', () => {
    const router = open(
      <Link to="/accounts" target="_blank">
        계좌
      </Link>,
    )

    expect(link('계좌').getAttribute('target')).toBe('_blank')
    expect(fireEvent.click(link('계좌'))).toBe(true)

    expect(here()).toBe('/home')
    router.dispose()
  })

  it('onClick이 먼저 돌고, 그것이 기본 동작을 막으면 옮겨 가지 않는다', () => {
    const calls: string[] = []
    const router = open(
      <Link
        to="/accounts"
        onClick={(event) => {
          calls.push(event.type)
          event.preventDefault()
        }}
      >
        계좌
      </Link>,
    )

    fireEvent.click(link('계좌'))

    expect(calls).toEqual(['click'])
    expect(here()).toBe('/home')
    router.dispose()
  })

  it('ref는 링크(a)에 닿는다', () => {
    const ref = createRef<HTMLAnchorElement>()
    const router = open(
      <Link to="/accounts" ref={ref}>
        계좌
      </Link>,
    )

    expect(ref.current).toBe(link('계좌'))
    router.dispose()
  })
})

describe('앱의 NavLink', () => {
  it('end면 주소가 꼭 같을 때만 aria-current="page"다', async () => {
    const router = open(
      <NavLink to="/pending" end>
        보내지 않은 입력
      </NavLink>,
      '/pending',
    )

    expect(link('보내지 않은 입력').getAttribute('aria-current')).toBe('page')

    await act(() => router.navigate('/pending/abc'))
    expect(link('보내지 않은 입력').hasAttribute('aria-current')).toBe(false)
    router.dispose()
  })

  it('end가 없으면 그 아래 주소에서도 지금 화면이고, 다른 주소면 표시가 없다', async () => {
    const router = open(<NavLink to="/transactions">내역</NavLink>, '/transactions/abc')

    expect(link('내역').getAttribute('aria-current')).toBe('page')

    await act(() => router.navigate('/transactions-trash'))
    expect(link('내역').hasAttribute('aria-current')).toBe(false)

    await act(() => router.navigate('/home'))
    expect(link('내역').hasAttribute('aria-current')).toBe(false)
    router.dispose()
  })
})
