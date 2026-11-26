import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountOf, accountsBody, startAccounts, type Accounts } from './support/accounts'
import { delayed, meOf, startBackend, type Backend } from './support/backend'
import { startCategories } from './support/categories'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { installMatchMedia } from './support/viewport'
import { createFakeLocks, installLocks, removeLocks } from './support/webLocks'

const RETURN_ADDRESS = 'akkimpyo-return-address'
const secret = '로그인한 사람만 보는 내용'
const loading = '불러오고 있어요.'
const firstTitle = '기본 카테고리를 넣어 두었어요'

const server = startMockServer()
let backend: Backend
let accounts: Accounts

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  installMatchMedia(390)
  installLocks(createFakeLocks())
  backend = startBackend(server)
  // 계좌가 하나도 없는 장부에서 시작한다
  accounts = startAccounts(server, backend)
  startCategories(server, backend)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  removeLocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const open = (path: string) => openApp(path, addScreens([{ path: '/secret', element: <main>{secret}</main> }]))
type Opened = Awaited<ReturnType<typeof open>>

const address = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const welcome = () => screen.findByRole('heading', { level: 1, name: firstTitle })
const notFound = () => screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))
const signedIn = () => void (backend.cookieUser = 'user-1')
const withRole = (role: string) => () =>
  HttpResponse.json({ ...meOf('user-1'), ledgers: [{ id: 'user-1-ledger', name: '내 가계부', role }] })

async function logIn(user: Opened['user']) {
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await user.click(screen.getByRole('button', { name: '로그인' }))
}

async function signUp(user: Opened['user']) {
  await user.type(await screen.findByLabelText('이메일'), 'new@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await user.type(screen.getByLabelText('비밀번호 확인'), 'pass1234')
  await user.type(screen.getByLabelText('표시 이름'), '이서연')
  await user.click(screen.getByRole('button', { name: '가입' }))
}

describe('로그인·가입 뒤', () => {
  it('가입하면 첫 실행 안내의 첫 장이다', async () => {
    const opened = await open('/signup')
    await signUp(opened.user)
    expect(await welcome()).toBeTruthy()
    expect(address(opened)).toBe('/welcome')
  })

  it('로그인했는데 현재 장부에 계좌가 하나도 없으면 /home 대신 /welcome으로 replace한다', async () => {
    const opened = await open('/login')
    await logIn(opened.user)
    expect(await welcome()).toBeTruthy()
    expect(address(opened)).toBe('/welcome')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(accounts.requests).toEqual(['user-1-ledger'])
  })

  it('로그인했는데 계좌가 있으면 안내 없이 /home으로 간다', async () => {
    accounts.items = [accountOf('통장', 'BANK', 0)]
    const opened = await open('/login')
    await logIn(opened.user)
    await notFound()
    expect(address(opened)).toBe('/home')
    expect(screen.queryByText(firstTitle)).toBeNull()
  })

  it('가려던 주소(복귀 주소)가 있어도 계좌가 없으면 안내가 먼저이고, 마치면 /home으로 가며 그 주소는 쓰지 않는다', async () => {
    const opened = await open('/secret?month=2026-11')
    await loginHeading()
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret?month=2026-11')
    const dom = recordDom()
    await logIn(opened.user)
    await welcome()
    expect(address(opened)).toBe('/welcome')
    expect(dom.sawText(secret)).toBe(false)
    await waitFor(() => expect(sessionStorage.getItem(RETURN_ADDRESS)).toBeNull())

    await opened.user.click(screen.getByRole('button', { name: '다음' }))
    await opened.user.click(await screen.findByRole('button', { name: '건너뛰기' }))
    await notFound()
    expect(address(opened)).toBe('/home')
    expect(dom.sawText(secret)).toBe(false)
  })

  it('가려던 주소가 있고 계좌도 있으면 그 주소로 간다', async () => {
    accounts.items = [accountOf('통장', 'BANK', 0)]
    const opened = await open('/secret')
    await loginHeading()
    await logIn(opened.user)
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(address(opened)).toBe('/secret')
  })

  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 오류', () => HttpResponse.error()],
    ['약속과 다른 응답', () => HttpResponse.json({ items: [{ id: 1 }] })],
  ])('판단 중 계좌 목록을 불러오지 못하면(%s) 안내 없이 가려던 주소로 간다', async (_, respond) => {
    accounts.response = respond
    const opened = await open('/secret')
    await loginHeading()
    await logIn(opened.user)
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(address(opened)).toBe('/secret')
    expect(screen.queryByText(firstTitle)).toBeNull()
  })

  it('판단 중 계좌 목록을 불러오지 못하면 가려던 주소가 없을 때는 /home이다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await open('/login')
    await logIn(opened.user)
    await notFound()
    expect(address(opened)).toBe('/home')
  })

  it('가입 뒤 계좌 목록을 불러오지 못하면 안내 없이 /home이다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await open('/signup')
    await signUp(opened.user)
    await notFound()
    expect(address(opened)).toBe('/home')
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })
})

describe('로그인한 채 앱을 열 때', () => {
  beforeEach(signedIn)

  it.each(['/', '/home', '/welcome'])('%s로 열었고 계좌가 없으면 안내다', async (path) => {
    const opened = await open(path)
    expect(await welcome()).toBeTruthy()
    expect(address(opened)).toBe('/welcome')
  })

  it.each(['/', '/home', '/welcome'])('%s로 열었고 계좌가 있으면 /home이다', async (path) => {
    accounts.items = [accountOf('통장', 'BANK', 0)]
    const opened = await open(path)
    await notFound()
    expect(address(opened)).toBe('/home')
    // 다른 주소였으면 방문 기록을 바꿔 뒤로 가도 그 주소로 돌아오지 않는다
    expect(opened.router.state.historyAction).toBe(path === '/home' ? 'POP' : 'REPLACE')
  })

  it('둘째 장의 주소로 열어도 둘째 장이다', async () => {
    const opened = await open('/welcome?step=2')
    expect(await screen.findByRole('heading', { level: 1, name: '첫 계좌를 만들어 주세요' })).toBeTruthy()
    expect(address(opened)).toBe('/welcome?step=2')
  })

  it.each([
    ['/accounts', () => screen.findByText('계좌가 없어요. 계좌를 추가하면 잔액을 한눈에 볼 수 있어요.')],
    ['/categories', () => screen.findByRole('heading', { level: 1, name: '카테고리' })],
    ['/more', () => screen.findByRole('button', { name: '로그아웃' })],
    ['/secret', () => screen.findByText(secret)],
  ])('다른 주소 %s를 바로 열면 계좌가 없어도 안내 없이 그 화면이다', async (path, shown) => {
    const opened = await open(path)
    expect(await shown()).toBeTruthy()
    expect(address(opened)).toBe(path)
    expect(screen.queryByText(firstTitle)).toBeNull()
  })

  it('다른 주소로 연 뒤 앱 안에서 /home으로 가도 다시 정하지 않는다', async () => {
    const opened = await open('/secret')
    await screen.findByText(secret)
    await act(() => opened.router.navigate('/home'))
    await notFound()
    await settle()
    expect(address(opened)).toBe('/home')
    expect(accounts.requests).toEqual([])
  })

  it('계좌 목록을 불러오지 못하면 안내 없이 /home이다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await open('/welcome')
    await notFound()
    expect(address(opened)).toBe('/home')
  })

  it('판단에 받은 계좌 목록을 안내가 다시 받지 않는다', async () => {
    await open('/welcome')
    await welcome()
    await settle()
    expect(accounts.requests).toEqual(['user-1-ledger'])
  })
})

describe('권한', () => {
  beforeEach(signedIn)

  it('편집 가능(MEMBER)이면 안내한다', async () => {
    backend.meResponse = withRole('MEMBER')
    await open('/home')
    expect(await welcome()).toBeTruthy()
  })

  it.each(['VIEWER', 'SOMETHING_NEW', ''])('%s면 계좌가 없어도 안내하지 않고 계좌 목록도 받지 않는다', async (role) => {
    backend.meResponse = withRole(role)
    const opened = await open('/home')
    await notFound()
    await settle()
    expect(address(opened)).toBe('/home')
    expect(accounts.requests).toEqual([])
  })

  it.each(['VIEWER', 'SOMETHING_NEW'])('%s가 /welcome을 열면 /home으로 replace한다', async (role) => {
    backend.meResponse = withRole(role)
    const opened = await open('/welcome')
    await notFound()
    expect(address(opened)).toBe('/home')
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it.each(['VIEWER', 'SOMETHING_NEW'])('%s가 로그인해도 안내하지 않는다', async (role) => {
    backend.cookieUser = undefined
    backend.meResponse = withRole(role)
    const opened = await open('/login')
    await logIn(opened.user)
    await notFound()
    expect(address(opened)).toBe('/home')
  })
})

describe('정하는 동안', () => {
  beforeEach(signedIn)

  /** 시계를 멈춘 뒤 흘려보낸 시간(ms) */
  let elapsed = 0

  /** 시계를 멈춘다. 요청은 흐른다. */
  function stopClock() {
    elapsed = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  }

  async function pass(ms: number) {
    elapsed += ms
    await act(() => vi.advanceTimersByTimeAsync(ms))
  }

  /** 시계를 멈춘 채로 `check`가 될 때까지 기다린다. 시계는 한 번에 1ms씩만 흐른다. */
  async function until(check: () => unknown) {
    for (let tries = 0; tries < 200; tries += 1) {
      try {
        check()
        return
      } catch {
        await pass(1)
      }
    }
    check()
  }

  it('가려던 화면도 안내도 그리지 않고, 300ms가 지나면 "불러오고 있어요."를 보인다', async () => {
    const answer = delayed()
    accounts.response = answer.respond
    stopClock()
    const dom = recordDom()
    await open('/home')
    await until(() => expect(accounts.requests).toHaveLength(1))
    expect(elapsed).toBeLessThan(299)
    await pass(299 - elapsed)
    expect(document.body.textContent).toBe('')
    await pass(1)
    expect(document.body.textContent).toBe(loading)
    answer.answer(accountsBody())
    vi.useRealTimers()
    await welcome()
    expect(dom.sawText('찾을 수 없어요.')).toBe(false)
    expect(dom.sawElement('nav')).toBe(false)
  })

  it('내 정보를 기다리던 글이 계좌 목록을 기다리는 동안 사라졌다 나타나지 않는다', async () => {
    const me = delayed()
    backend.meResponse = me.respond
    const list = delayed()
    accounts.response = list.respond
    stopClock()
    await open('/home')
    await until(() => expect(backend.requests.me).toHaveLength(1))
    await pass(400)
    const text = screen.getByText(loading)
    me.answer(HttpResponse.json(meOf('user-1')))
    await until(() => expect(accounts.requests).toHaveLength(1))
    expect(screen.getByText(loading)).toBe(text)
    list.answer(accountsBody(accountOf('통장', 'BANK', 0)))
    vi.useRealTimers()
    await notFound()
  })

  it('300ms 안에 정하면 글을 보이지 않는다', async () => {
    const dom = recordDom()
    await open('/home')
    await welcome()
    expect(dom.sawText(loading)).toBe(false)
  })
})
