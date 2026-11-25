import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ledgerNameOf, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'
import { recordDom } from './support/recordDom'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

const server = startMockServer()
let backend: Backend

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  vi.unstubAllGlobals()
})

async function open(path: string, width = 390) {
  const media = installMatchMedia(width)
  const opened = await openApp(path)
  await screen.findByRole('main')
  await screen.findByRole('navigation', { name: '주 메뉴' })
  setViewportWidth(width)
  return { ...opened, media }
}

const menu = () => screen.getByRole('navigation', { name: '주 메뉴' })
const content = () => within(screen.getByRole('main'))
const notFound = () => screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })
const currentNames = () =>
  within(menu())
    .queryAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)

describe('더보기(M-01)', () => {
  it('공통 틀 안의 주 화면이다. 상단 바에 장부 이름이 있고 "뒤로"와 화면 제목이 없다', async () => {
    await open('/more')
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByText(ledgerNameOf('user-1'))).toBeTruthy()
    expect(bar.queryByRole('button', { name: '뒤로' })).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('1A에는 로그아웃 줄 하나만 있고 선과 자리 표시가 없다', async () => {
    await open('/more')
    expect(content().getAllByRole('listitem')).toHaveLength(1)
    expect(content().getByRole('button', { name: '로그아웃' })).toBeTruthy()
    expect(content().queryAllByRole('link')).toEqual([])
    expect(screen.getByRole('main').textContent).toBe('로그아웃')
    expect(getComputedStyle(content().getByRole('list')).marginTop).not.toBe('var(--space-24)')
  })

  it('로그아웃 줄은 본문 글자색의 목록 줄이고 화살표가 없다. 첫 줄 위는 8px이다', async () => {
    await open('/more')
    const row = content().getByRole('button', { name: '로그아웃' })
    expect(getComputedStyle(row).minHeight).toBe('var(--size-row)')
    expect(getComputedStyle(row).color).toBe('var(--color-text)')
    expect(row.querySelectorAll('svg')).toHaveLength(1)
    expect(getComputedStyle(content().getByRole('list').parentElement!).paddingTop).toBe('var(--space-8)')
  })

  it('불러오는 것이 없다', async () => {
    await open('/more')
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
    expect(backend.requests.me).toHaveLength(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 돌아온다', async () => {
    backend.cookieUser = undefined
    installMatchMedia(390)
    const { router, user } = await openApp('/more')
    await loginHeading()
    await user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('button', { name: '로그아웃' })
    expect(router.state.location.pathname).toBe('/more')
  })
})

describe('하단 탭의 더보기', () => {
  it('아이콘과 이름이 있고 누르면 더보기로 간다', async () => {
    const { router, user } = await open('/home')
    const tab = within(menu()).getByRole('link', { name: '더보기' })
    expect(tab.querySelectorAll('svg')).toHaveLength(1)
    expect(getComputedStyle(tab.querySelector('svg')!).width).toBe('var(--size-icon-24)')
    await user.click(tab)
    expect(await content().findByRole('button', { name: '로그아웃' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/more')
  })

  it.each(['/more', '/home', '/없는-주소'])('%s에서 더보기를 강조한다', async (path) => {
    await open(path)
    expect(currentNames()).toEqual(['더보기'])
  })

  it('넓은 화면의 사이드바에는 없다', async () => {
    await open('/home', 1280)
    expect(within(menu()).queryByRole('link', { name: '더보기' })).toBeNull()
  })
})

describe('넓은 화면에는 더보기가 없으므로(1A 임시) /home으로 보낸다', () => {
  it.each([1024, 1280])('폭 %dpx에서 열면 뒤로 돌아오지 않게 바꿔 간다', async (width) => {
    const { router } = await open('/more', width)
    await notFound()
    expect(router.state.location.pathname).toBe('/home')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it.each([390, 768, 1023])('폭 %dpx에서는 그대로다', async (width) => {
    const { router } = await open('/more', width)
    expect(content().getByRole('button', { name: '로그아웃' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/more')
  })

  it('좁은 화면에서 열고 넓히면 보낸다', async () => {
    const { router, media } = await open('/more', 390)
    act(() => media.resizeTo(1023))
    expect(router.state.location.pathname).toBe('/more')
    act(() => media.resizeTo(1024))
    await notFound()
    expect(router.state.location.pathname).toBe('/home')
  })

  it('더보기를 떠난 뒤에는 넓혀도 보내지 않는다', async () => {
    const { router, media } = await open('/more', 390)
    await act(() => router.navigate('/없는-주소'))
    await notFound()
    act(() => media.resizeTo(1280))
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
    expect(router.state.location.pathname).toBe('/없는-주소')
  })
})

describe.each([
  ['더보기의 로그아웃 줄', '/more', 390],
  ['사이드바의 로그아웃', '/home', 1280],
])('%s을 누르면', (_, path, width) => {
  it('확인 창 없이 이 기기만 로그아웃하고 알림 없이 /login으로 간다', async () => {
    const { router, user } = await open(path, width)
    await user.click(screen.getByRole('button', { name: '로그아웃' }))
    await loginHeading()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() => expect(backend.requests.logout).toHaveLength(1))
    expect(backend.requests.logout[0].headers.has('Authorization')).toBe(false)
    expect(sessionStorage.length).toBe(0)
  })

  it('뒤로 가도 앞 사용자의 값이 보이지 않는다', async () => {
    const { router, user } = await open('/없는-주소', width)
    await act(() => router.navigate(path))
    await user.click(await screen.findByRole('button', { name: '로그아웃' }))
    await loginHeading()
    const dom = recordDom()
    await act(() => router.navigate(-1))
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
    expect(router.state.location.pathname).toBe('/login')
    expect(dom.sawText('user-1')).toBe(false)
    expect(dom.sawElement('nav, header')).toBe(false)
  })

  it('키보드로 누를 수 있다', async () => {
    const { user } = await open(path, width)
    screen.getByRole('button', { name: '로그아웃' }).focus()
    await user.keyboard('{Enter}')
    await loginHeading()
  })
})
