import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, ledgerIdOf, ledgerNameOf, meOf, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()
let backend: Backend

beforeEach(() => {
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
})

afterEach(cleanup)

const failed = '불러오지 못했어요.'

/** 화면의 훅이 하듯 현재 장부와 내 정보를 쓰는 화면 */
async function meScreen(): Promise<RouteObject> {
  const { useCurrentLedger } = await import('../src/features/me/CurrentLedgerContext')
  const { useMe } = await import('../src/features/me/useMe')
  const { MainScreen } = await import('../src/components/Screen')

  function MeScreen() {
    const ledger = useCurrentLedger()
    const me = useMe()
    return (
      <MainScreen>
        <p>{`${me.data?.displayName} / ${ledger.id} / ${ledger.role}`}</p>
        <button type="button" onClick={() => void me.refetch()}>
          새로 받기
        </button>
      </MainScreen>
    )
  }
  return { path: '/me-screen', element: <MeScreen /> }
}

const open = () => openApp('/me-screen', async (routes) => addScreens([await meScreen()])(routes))
const content = () => screen.findByText(`user-1의 이름 / ${ledgerIdOf('user-1')} / OWNER`)
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

describe('내 정보', () => {
  it('로그인한 뒤 받은 표시 이름과 현재 장부 id를 화면의 훅이 쓴다', async () => {
    await open()
    expect(await content()).toBeTruthy()
    expect(within(screen.getByRole('banner')).getByText(ledgerNameOf('user-1'))).toBeTruthy()
  })

  it('로그인한 동안 한 번만 받고, 새로고침하면 다시 받는다', async () => {
    await open()
    await content()
    await settle()
    window.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(backend.requests.me).toEqual(['user-1'])
    cleanup()
    await open()
    expect(await content()).toBeTruthy()
    expect(backend.requests.me).toEqual(['user-1', 'user-1'])
  })

  it('현재 장부는 목록의 첫 장부다', async () => {
    const [first] = meOf('user-1').ledgers
    backend.meResponse = () =>
      HttpResponse.json({ ...meOf('user-1'), ledgers: [first, { id: 'other', name: '둘째 장부', role: 'MEMBER' }] })
    await open()
    expect(await content()).toBeTruthy()
    expect(screen.queryByText('둘째 장부')).toBeNull()
  })

  it('장부 이름은 글자로만 그린다', async () => {
    const name = '<img src=x onerror=alert(1)>'
    backend.meResponse = () =>
      HttpResponse.json({ ...meOf('user-1'), ledgers: [{ id: ledgerIdOf('user-1'), name, role: 'OWNER' }] })
    await open()
    await content()
    expect(within(screen.getByRole('banner')).getByText(name)).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })

  it('저장소에 남기지 않는다', async () => {
    await open()
    await content()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('내 정보를 받지 못하면', () => {
  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 오류', () => HttpResponse.error()],
    ['장부가 하나도 없음', () => HttpResponse.json({ ...meOf('user-1'), ledgers: [] })],
    ['장부 목록이 깨짐', () => HttpResponse.json({ ...meOf('user-1'), ledgers: { items: [] } })],
    ['갱신한 뒤에도 401', () => problem(401, 'UNAUTHENTICATED')],
  ])('%s: 예외 없이 보호된 화면 대신 오류와 "다시 시도"만 보인다', async (_, respond) => {
    backend.meResponse = respond
    const consoleError = vi.spyOn(console, 'error')
    const dom = recordDom()
    const { router } = await open()
    await screen.findByRole('heading', { level: 1, name: failed })
    expect(screen.getByRole('main').textContent).toBe(`${failed}잠시 후 다시 시도해 주세요.다시 시도`)
    expect(router.state.location.pathname).toBe('/me-screen')
    expect(dom.sawElement('nav, header')).toBe(false)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('"다시 시도"를 누르면 화면은 그대로 두고 그 버튼만 처리 중이며, 받으면 들어간다', async () => {
    backend.meResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    const heading = await screen.findByRole('heading', { level: 1, name: failed })
    const me = delayed()
    backend.meResponse = me.respond
    await user.click(retryButton())
    await me.arrived
    await settle()
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    await user.click(retryButton())
    expect(backend.requests.me).toHaveLength(2)

    me.answer(HttpResponse.json(meOf('user-1')))
    expect(await content()).toBeTruthy()
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('또 실패하면 버튼이 되돌아온다', async () => {
    backend.meResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    await screen.findByRole('heading', { level: 1, name: failed })
    await user.click(retryButton())
    await waitFor(() => expect(backend.requests.me).toHaveLength(2))
    await waitFor(() => expect(retryButton().hasAttribute('aria-busy')).toBe(false))
    expect(screen.getByText(failed)).toBeTruthy()
  })

  it('저절로 다시 받지 않는다', async () => {
    backend.meResponse = () => problem(500, 'INTERNAL_ERROR')
    await open()
    await screen.findByRole('heading', { level: 1, name: failed })
    await settle()
    expect(backend.requests.me).toHaveLength(1)
  })

  it('이미 받은 뒤 다시 받다가 실패하면 보던 화면을 그대로 둔다', async () => {
    const { user } = await open()
    await content()
    backend.meResponse = () => problem(500, 'INTERNAL_ERROR')
    await user.click(screen.getByRole('button', { name: '새로 받기' }))
    await waitFor(() => expect(backend.requests.me).toHaveLength(2))
    await settle()
    expect(await content()).toBeTruthy()
    expect(screen.queryByText(failed)).toBeNull()
  })
})
