import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClearStaleCaret from '../src/app/ClearStaleCaret'
import { setDeviceClock } from './support/clock'
import { startGuardClock } from './support/guardClock'
import { startMockServer } from './support/mockServer'
import { amount, closeButton, openApp, path, resetGlobals, startServer, type Opened } from './support/transactionScreen'
import { resetViewport } from './support/viewport'

/*
 * #249: 초점이 있던 입력칸이 앞 화면과 함께 빠지면 문서의 선택은 그 화면이 있던 자리(공통 틀 내용 영역의 맨 앞)로 옮겨 남는다.
 * 돌아온 화면에서 그 자리는 상단 바의 첫 글자라, 커서를 옮긴 한두 프레임 안에 화면이 바뀌면 WebKit은 위치를 되살린 다음
 * 그리기에서 그 커서를 상단 바 아래로 드러내려고 화면을 43px 올린다. jsdom은 스크롤하지 않으므로 위치를 되살리는
 * 순간(window.scrollTo)에 커서가 남았는지 본다.
 */

const server = startMockServer()
let caretsAtRestore: number[]

const caret = () => document.getSelection()!

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  startGuardClock()
  caretsAtRestore = []
  vi.stubGlobal(
    'scrollTo',
    vi.fn(() => caretsAtRestore.push(caret().rangeCount)),
  )
  startServer(server)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  caret().removeAllRanges()
  resetViewport()
  resetGlobals()
})

/** 홈에서 거래 입력을 연다. WebKit은 초점을 받은 금액 칸의 자리에 커서를 두므로(jsdom은 두지 않는다) 같은 자리에 둔다. */
async function openFormFromHome() {
  const opened = await openApp('/home')
  await screen.findByRole('navigation', { name: '주 메뉴' })
  await act(() => opened.router.navigate('/transactions/new'))
  await screen.findByRole('heading', { level: 1, name: '거래 입력' })
  await waitFor(() => expect(document.activeElement).toBe(amount()))
  caret().collapse(amount().parentElement!, 0)
  caretsAtRestore = []
  return opened
}

async function untilHome(opened: Opened) {
  await waitFor(() => expect(path(opened)).toBe('/home'))
  await screen.findByRole('navigation', { name: '주 메뉴' })
}

describe('화면이 바뀌면 앞 화면에 두고 온 커서를 지운다(#249)', () => {
  it.each([
    ['Esc', (opened: Opened) => opened.user.keyboard('{Escape}')],
    ['닫기', (opened: Opened) => opened.user.click(closeButton())],
    ['브라우저 뒤로', (opened: Opened) => act(() => opened.router.navigate(-1))],
  ])('거래 입력을 %s로 닫고 홈으로 돌아오면 위치를 되살리기 전에 커서가 없다', async (_, leave) => {
    const opened = await openFormFromHome()
    expect(caret().rangeCount).toBe(1)
    await leave(opened)
    await untilHome(opened)
    expect(caretsAtRestore).toEqual([0])
    expect(caret().rangeCount).toBe(0)
  })
})

describe('지우지 않는 커서', () => {
  /** 화면 둘과 화면이 바뀌어도 남는 입력칸·글을 그린다 */
  function renderTwoScreens() {
    const router = createMemoryRouter(
      [
        {
          element: (
            <>
              <ClearStaleCaret />
              <input aria-label="남는 칸" />
              <p>남는 글</p>
              <Outlet />
            </>
          ),
          children: [
            { path: '/a', element: <p>가 화면</p> },
            { path: '/b', element: <p>나 화면</p> },
          ],
        },
      ],
      { initialEntries: ['/a'] },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  it('초점이 입력칸에 있으면 그 커서는 쓰는 중이라 남긴다', async () => {
    const router = renderTwoScreens()
    const input = screen.getByRole('textbox', { name: '남는 칸' })
    input.focus()
    caret().collapse(input.parentElement!, 0)
    await act(() => router.navigate('/b'))
    await screen.findByText('나 화면')
    expect(caret().rangeCount).toBe(1)
  })

  it('고른 글(접히지 않은 선택)은 남긴다', async () => {
    const router = renderTwoScreens()
    caret().selectAllChildren(screen.getByText('남는 글'))
    await act(() => router.navigate('/b'))
    await screen.findByText('나 화면')
    expect(caret().toString()).toBe('남는 글')
  })

  it('초점이 입력칸에 없으면 접힌 커서는 지운다', async () => {
    const router = renderTwoScreens()
    caret().collapse(screen.getByText('가 화면'), 0)
    await act(() => router.navigate('/b'))
    await screen.findByText('나 화면')
    expect(caret().rangeCount).toBe(0)
  })
})
