import { act, cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startBackend } from './support/backend'
import { goOffline, goOnline } from './support/connection'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()

function Broken(): never {
  throw new Error('화면 코드의 예외')
}

/** 앱의 라우트에서 틀이 같은 화면 하나를 예외를 던지는 화면으로 바꾼다. */
function breakScreen(route: RouteObject, path: string): RouteObject {
  if (route.path === path) return { ...route, element: <Broken /> } as RouteObject
  return { ...route, children: route.children?.map((child) => breakScreen(child, path)) } as RouteObject
}

async function openBroken(path: string, at: string) {
  startBackend(server).cookieUser = path === '/login' ? undefined : 'user-1'
  await openApp(at, (routes) => routes.map((route) => breakScreen(route, path)))
  await screen.findByRole('heading', { level: 1, name: '불러오지 못했어요.' })
}

beforeEach(() => {
  // React와 react-router는 잡은 예외를 console에 적는다
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal('scrollTo', vi.fn())
})

describe.each([
  ['공통 틀이 없는 화면', '/login', '/login'],
  ['공통 틀이 있는 화면', '*', '/어떤-주소'],
])('%s의 코드가 예외를 던지면', (_, path, at) => {
  it('영어 기본 화면 대신 F-907의 문구를 보인다', async () => {
    await openBroken(path, at)
    expect(screen.getByRole('heading', { level: 1, name: '불러오지 못했어요.' })).toBeTruthy()
    expect(screen.getByRole('main').textContent).toBe('불러오지 못했어요.잠시 후 다시 시도해 주세요.다시 시도')
  })

  it('예외의 글자를 보이지 않는다', async () => {
    await openBroken(path, at)
    expect(document.body.textContent).not.toContain('화면 코드의 예외')
    expect(screen.getByRole('main').textContent).not.toMatch(/[a-z]{3,}/i)
  })

  it('"다시 시도"를 누르면 새로고침한다', async () => {
    const reload = vi.fn()
    await openBroken(path, at)
    vi.stubGlobal('location', { ...window.location, reload })
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

it('공통 틀이 있는 화면에서 연결이 없으면 버튼 없이 "연결되면 자동으로 불러올게요."이고, 연결이 돌아오면 저절로 새로고침한다(#238)', async () => {
  const reload = vi.fn()
  await openBroken('*', '/어떤-주소')
  vi.stubGlobal('location', { ...window.location, reload })
  act(() => goOffline())
  expect(screen.getByRole('main').textContent).toBe('불러오지 못했어요.연결되면 자동으로 불러올게요.')
  expect(reload).not.toHaveBeenCalled()
  act(() => goOnline())
  expect(reload).toHaveBeenCalledTimes(1)
})


it('공통 틀이 있는 화면에서는 내용 자리만 바뀌고 틀은 그대로 보인다', async () => {
  await openBroken('*', '/어떤-주소')
  expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
})

it('공통 틀이 없는 화면에서는 틀 없이 보인다', async () => {
  await openBroken('/login', '/login')
  expect(screen.queryByRole('navigation')).toBeNull()
})
