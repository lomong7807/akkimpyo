import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { createStuckLocks, createFakeLocks, installLocks, removeLocks, SESSION_LOCK } from './support/webLocks'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()
let backend: Backend

beforeEach(() => {
  backend = startBackend(server)
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  removeLocks()
})

const RETURN_ADDRESS = 'akkimpyo-return-address'
const secret = '로그인한 사람만 보는 내용'
const loading = '불러오고 있어요.'
const failed = '불러오지 못했어요.'
const ended = '로그인이 풀렸어요. 다시 로그인해 주세요.'

const open = (path: string) => openApp(path, addScreens([{ path: '/secret', element: <main>{secret}</main> }]))
type Opened = Awaited<ReturnType<typeof open>>

const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const toLogin = () => screen.getByRole('link', { name: '로그인하러 가기' })
const loginButton = () => screen.getByRole('button', { name: '로그인' })
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search

const serverError = () => problem(500, 'INTERNAL_ERROR')
const unauthenticated = () => problem(401, 'UNAUTHENTICATED')

/** 응답이 다 오고 화면이 바뀔 만큼 기다린다. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

/** 시계를 멈춘다. 요청은 흐른다. */
const stopClock = () => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

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

async function fill(user: Opened['user']) {
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
}

async function logIn(user: Opened['user']) {
  await fill(user)
  await user.click(loginButton())
}

/** 확인하지 못한 화면을 연다. 다음 확인은 `next`로 답한다. */
async function openFailed(path: string, next?: () => Response | Promise<Response>) {
  backend.refreshResponse = serverError
  const opened = await open(path)
  await screen.findByRole('heading', { level: 1, name: failed })
  backend.refreshResponse = next
  return opened
}

describe('확인 중', () => {
  beforeEach(stopClock)

  it('300ms까지는 빈 화면이고 그 뒤 글 한 줄을 화면 낭독기에 알리며 보인다', async () => {
    backend.refreshResponse = () => new Promise(() => {})
    await open('/secret')
    const status = screen.getByRole('status')
    await pass(299)
    expect(document.body.textContent).toBe('')
    await pass(1)
    expect(document.body.textContent).toBe(loading)
    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe(loading)
  })

  it('글은 화면 가운데에 보조 글자색으로 두고 돌아가는 원과 뼈대가 없다', async () => {
    backend.refreshResponse = () => new Promise(() => {})
    await open('/secret')
    await pass(300)
    const style = getComputedStyle(screen.getByText(loading))
    expect(style.font).toBe('var(--text-body)')
    expect(style.color).toBe('var(--color-text-secondary)')
    expect(style.alignItems).toBe('center')
    expect(style.justifyContent).toBe('center')
    expect(style.flex).toBe('1 1 0%')
    expect(document.querySelector('.status-motion, svg, nav, header')).toBeNull()
  })

  it('로그인을 확인한 뒤 내 정보를 기다리는 동안에도 글이 사라졌다 나타나지 않는다', async () => {
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const me = delayed()
    backend.meResponse = me.respond
    await open('/secret')
    await pass(400)
    const text = screen.getByText(loading)
    refresh.answer(backend.issue('user-1'))
    await until(() => expect(backend.requests.me).toHaveLength(1))
    expect(screen.getByText(loading)).toBe(text)
  })

  it('15초가 지나도 결과가 없으면 "불러오지 못했어요."로 바꾼다', async () => {
    backend.refreshResponse = () => new Promise(() => {})
    installLocks(createStuckLocks())
    await open('/secret')
    await pass(14_999)
    expect(screen.queryByText(failed)).toBeNull()
    await pass(1)
    expect(screen.getByText(failed)).toBeTruthy()
    expect(retryButton().hasAttribute('aria-busy')).toBe(false)
  })
})

describe('늦은 확인', () => {
  /** 앞 탭이 잠금을 10초 쥐었다 놓아, 확인이 15초를 넘겨도 끝나지 않은 화면을 연다. */
  async function openLate() {
    const locks = createFakeLocks()
    const otherTab = Promise.withResolvers<void>()
    void locks.request(SESSION_LOCK, {}, () => otherTab.promise)
    installLocks(locks)
    const first = delayed()
    const second = delayed()
    const answers = [first, second]
    backend.refreshResponse = () => answers.shift()!.respond()
    stopClock()
    const opened = await open('/secret')
    await pass(10_000)
    otherTab.resolve()
    await first.arrived
    // 갱신은 5초 동안 답이 없어 한 번 더 보낸다
    await pass(5_000)
    await second.arrived
    expect(screen.getByText(failed)).toBeTruthy()
    return { ...opened, answer: second.answer }
  }

  it('늦게 성공하면 새로 보내지 않고 그 화면에서 바로 들어간다', async () => {
    const { answer } = await openLate()
    answer(backend.issue('user-1'))
    await until(() => screen.getByText(secret))
    expect(backend.requests.refresh).toHaveLength(2)
  })

  it('"다시 시도"를 누르면 새로 보내지 않고 진행 중인 확인을 같이 기다린다', async () => {
    const { answer } = await openLate()
    fireEvent.click(retryButton())
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    await pass(100)
    expect(backend.requests.refresh).toHaveLength(2)
    answer(backend.issue('user-1'))
    await until(() => screen.getByText(secret))
    expect(backend.requests.refresh).toHaveLength(2)
  })

  it('늦게 로그인이 필요하다고 오면 알림 없이 /login으로 보낸다', async () => {
    const opened = await openLate()
    opened.answer(unauthenticated())
    await until(loginButton)
    expect(addressOf(opened)).toBe('/login')
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret')
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('늦게 실패하면 그대로다', async () => {
    const opened = await openLate()
    opened.answer(serverError())
    await pass(100)
    expect(screen.getByText(failed)).toBeTruthy()
    expect(addressOf(opened)).toBe('/secret')
  })
})

describe('확인하지 못함', () => {
  it('안내와 "다시 시도", "로그인하러 가기"를 공통 틀 없이 위에서부터 보인다', async () => {
    await openFailed('/secret')
    expect(screen.getByRole('main').textContent).toBe(
      `${failed}잠시 후 다시 시도해 주세요.다시 시도로그인하러 가기`,
    )
    expect(toLogin().previousElementSibling).toBe(retryButton())
    expect(getComputedStyle(toLogin()).minHeight).toBe('var(--size-touch)')
    expect(getComputedStyle(toLogin()).color).toBe('var(--color-accent)')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('"다시 시도"를 누르면 화면은 그대로 두고 그 버튼만 처리 중이다', async () => {
    const refresh = delayed()
    const { user } = await openFailed('/secret', refresh.respond)
    const heading = screen.getByRole('heading', { level: 1 })
    const dom = recordDom()
    await user.click(retryButton())
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(retryButton())
    await refresh.arrived
    await settle()
    expect(screen.getByRole('heading', { level: 1 })).toBe(heading)
    expect(dom.sawElement('[role="status"]')).toBe(false)
    // 처리 중에는 다시 눌리지 않는다
    await user.click(retryButton())
    expect(backend.requests.refresh).toHaveLength(2)
    refresh.answer(backend.issue('user-1'))
    expect(await screen.findByText(secret)).toBeTruthy()
  })

  it('다시 시도해 로그인이 필요하면 알림 없이 /login으로 보내고 주소를 기억한다', async () => {
    const opened = await openFailed('/secret?month=2026-11', unauthenticated)
    await opened.user.click(retryButton())
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret?month=2026-11')
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('또 실패하면 버튼이 되돌아와 다시 누를 수 있다', async () => {
    const { user } = await openFailed('/secret', serverError)
    await user.click(retryButton())
    await waitFor(() => expect(backend.requests.refresh).toHaveLength(2))
    await waitFor(() => expect(retryButton().hasAttribute('aria-busy')).toBe(false))
    backend.refreshResponse = undefined
    backend.cookieUser = 'user-1'
    await user.click(retryButton())
    expect(await screen.findByText(secret)).toBeTruthy()
  })

  it('다시 시도한 것도 15초가 지나면 버튼을 되돌린다', async () => {
    const locks = createStuckLocks()
    await openFailed('/secret', () => new Promise(() => {}))
    installLocks(locks)
    stopClock()
    fireEvent.click(retryButton())
    await pass(14_999)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    await pass(1)
    expect(retryButton().hasAttribute('aria-busy')).toBe(false)
    expect(screen.getByText(failed)).toBeTruthy()
  })

  it('"다시 시도"는 멈춘 탭의 잠금을 빼앗지 않는다', async () => {
    const locks = createStuckLocks()
    await openFailed('/secret')
    installLocks(locks)
    stopClock()
    const lost = vi.fn()
    locks.frozenTab.catch(lost)
    fireEvent.click(retryButton())
    await pass(20_000)
    expect(backend.requests.refresh).toHaveLength(1)
    expect(lost).not.toHaveBeenCalled()
    expect(screen.getByText(failed)).toBeTruthy()
  })

  it('저절로 다시 확인하지 않는다', async () => {
    await openFailed('/secret', serverError)
    await settle()
    expect(backend.requests.refresh).toHaveLength(1)
  })
})

describe('"로그인하러 가기"', () => {
  it('가려던 주소를 기억하고 알림 없이 로그인 화면으로 가서, 로그인하면 그 주소로 돌아온다', async () => {
    const opened = await openFailed('/secret?month=2026-11')
    await opened.user.click(toLogin())
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    expect(addressOf(opened)).toBe('/login')
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret?month=2026-11')
    expect(screen.queryByText(ended)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()

    await logIn(opened.user)
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(addressOf(opened)).toBe('/secret?month=2026-11')
    expect(sessionStorage.length).toBe(0)
  })

  it('멈춘 탭 때문에 확인하지 못해도 로그인은 잠금을 빼앗아 끝낸다', async () => {
    const locks = createStuckLocks()
    installLocks(locks)
    stopClock()
    const { router } = await open('/secret')
    await pass(15_000)
    fireEvent.click(toLogin())
    await until(loginButton)
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'name@example.com' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pass1234' } })
    fireEvent.click(loginButton())
    await pass(14_900)
    expect(backend.requests.login).toHaveLength(0)
    expect(loginButton().getAttribute('aria-busy')).toBe('true')
    await pass(200)
    await until(() => screen.getByText(secret))
    expect(router.state.location.pathname).toBe('/secret')
    await expect(locks.frozenTab).rejects.toThrow()
  })

  it('다시 시도하는 동안에도 누를 수 있다', async () => {
    const refresh = delayed()
    const opened = await openFailed('/secret', refresh.respond)
    await opened.user.click(retryButton())
    await refresh.arrived
    expect(toLogin().hasAttribute('aria-disabled')).toBe(false)
    await opened.user.click(toLogin())
    expect(await screen.findByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
  })

  it('내 정보를 받지 못한 화면에는 없다', async () => {
    backend.cookieUser = 'user-1'
    backend.meResponse = serverError
    await open('/secret')
    await screen.findByRole('heading', { level: 1, name: failed })
    expect(screen.queryByRole('link', { name: '로그인하러 가기' })).toBeNull()
  })
})

describe('확인이 진행 중인 채로 로그인 화면에 오면', () => {
  /** "다시 시도"를 누르고 답을 기다리는 동안 로그인 화면으로 옮긴다. */
  async function goToLoginWhileChecking() {
    const refresh = delayed()
    const opened = await openFailed('/secret?month=2026-11', refresh.respond)
    await opened.user.click(retryButton())
    await refresh.arrived
    await opened.user.click(toLogin())
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    return { ...opened, opened, answer: refresh.answer }
  }

  it('로그인을 제출하지 않은 채 늦게 성공하면 기억한 주소로 들어간다', async () => {
    const { opened, user, answer } = await goToLoginWhileChecking()
    await fill(user)
    answer(backend.issue('user-1'))
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(addressOf(opened)).toBe('/secret?month=2026-11')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(sessionStorage.length).toBe(0)
    expect(backend.requests.login).toHaveLength(0)
  })

  it('기억한 주소가 없으면 /home으로 들어간다', async () => {
    const { opened, answer } = await goToLoginWhileChecking()
    sessionStorage.clear()
    answer(backend.issue('user-1'))
    await waitFor(() => expect(addressOf(opened)).toBe('/home'))
  })

  it('로그인을 이미 보냈으면 늦은 성공으로 옮기지 않고 로그인의 성공을 따른다', async () => {
    installLocks(createFakeLocks())
    const login = delayed()
    backend.loginResponse = login.respond
    const { opened, user, answer } = await goToLoginWhileChecking()
    await logIn(user)
    // 같은 잠금을 기다리는 동안 처리 중이고 아직 보내지 않았다
    await settle()
    expect(loginButton().getAttribute('aria-busy')).toBe('true')
    expect(backend.requests.login).toHaveLength(0)

    answer(backend.issue('user-1'))
    await login.arrived
    await settle()
    expect(addressOf(opened)).toBe('/login')
    expect(loginButton().getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByText(secret)).toBeNull()

    login.answer(backend.issue('user-2'))
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(addressOf(opened)).toBe('/secret?month=2026-11')
    expect(backend.requests.me).toEqual(['user-2'])
  })

  it('로그인을 이미 보냈으면 늦은 성공이 와도 로그인의 실패를 따른다', async () => {
    installLocks(createFakeLocks())
    backend.loginResponse = () => problem(401, 'INVALID_CREDENTIALS')
    const { opened, user, answer } = await goToLoginWhileChecking()
    await logIn(user)
    answer(backend.issue('user-1'))
    expect(await screen.findByText('이메일 또는 비밀번호가 맞지 않아요')).toBeTruthy()
    await settle()
    expect(addressOf(opened)).toBe('/login')

    // 확인은 되었으므로 그다음에 여는 로그인 앞의 화면에서는 홈으로 간다
    await user.click(screen.getByRole('link', { name: '가입' }))
    await waitFor(() => expect(addressOf(opened)).toBe('/home'))
  })

  it.each([
    ['성공', () => backend.issue('user-1')],
    ['401', unauthenticated],
    ['서버 오류', serverError],
  ])('로그인이 먼저 끝났으면 늦게 온 확인 결과(%s)는 쓰지 않는다', async (_, response) => {
    const { opened, user, answer } = await goToLoginWhileChecking()
    backend.loginUser = 'user-2'
    await logIn(user)
    const content = await screen.findByText(secret)
    answer(response())
    await settle()
    expect(screen.getByText(secret)).toBe(content)
    expect(addressOf(opened)).toBe('/secret?month=2026-11')
    expect(backend.requests.me).toEqual(['user-2'])
  })

  it.each([
    ['로그인이 필요하다고 오면(401)', unauthenticated],
    ['또 실패하면', serverError],
    ['연결이 끊기면', () => HttpResponse.error()],
  ])('%s 로그인 화면에 그대로 두고 알리지 않는다', async (_, response) => {
    const { opened, answer } = await goToLoginWhileChecking()
    answer(response())
    await settle()
    expect(addressOf(opened)).toBe('/login')
    expect(loginButton()).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret?month=2026-11')
  })

  it('그 뒤에 로그인하면 기억한 주소로 간다', async () => {
    const { opened, user, answer } = await goToLoginWhileChecking()
    answer(serverError())
    await settle()
    await logIn(user)
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(addressOf(opened)).toBe('/secret?month=2026-11')
  })
})

describe('확인하지 못한 상태에서 주소로 /login을 열면', () => {
  it('확인을 기다리지 않고 로그인 화면이 열리고, 15초가 지나도 그대로다', async () => {
    installLocks(createStuckLocks())
    stopClock()
    const opened = await open('/login')
    expect(loginButton()).toBeTruthy()
    await pass(20_000)
    expect(addressOf(opened)).toBe('/login')
    expect(loginButton()).toBeTruthy()
    expect(screen.queryByText(failed)).toBeNull()
  })

  it('앱 안에서 옮겨 가도 로그인 화면이 열린다', async () => {
    const { router } = await openFailed('/secret')
    await act(() => router.navigate('/login'))
    expect(loginButton()).toBeTruthy()
  })

  it('다시 로그인이 필요한 주소로 돌아오면 확인하지 못한 화면이다', async () => {
    const { router } = await openFailed('/secret')
    await act(() => router.navigate('/login'))
    await act(() => router.navigate('/secret'))
    expect(screen.getByText(failed)).toBeTruthy()
  })
})

describe('다른 탭의 로그인이 잠금을 빼앗으면', () => {
  /** 이 탭의 갱신이 쥔 잠금을 다른 탭이 빼앗아 `user`로 로그인한다. */
  function stealByLogin(locks: ReturnType<typeof createFakeLocks>, user: string) {
    return locks.request(SESSION_LOCK, { steal: true }, async () => {
      backend.cookieUser = user
    })
  }

  it('확인 중이던 탭은 "불러오지 못했어요."이고 로그인 풀림으로 다루지 않는다', async () => {
    const locks = createFakeLocks()
    installLocks(locks)
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const opened = await open('/secret')
    await refresh.arrived
    await stealByLogin(locks, 'user-2')
    expect(await screen.findByText(failed)).toBeTruthy()
    expect(addressOf(opened)).toBe('/secret')
    expect(sessionStorage.length).toBe(0)

    // 늦게 온 옛 응답은 쓰지 않는다
    refresh.answer(backend.issue('user-1'))
    await settle()
    expect(screen.getByText(failed)).toBeTruthy()

    // 다시 확인하면 그 브라우저의 지금 로그인으로 들어간다
    backend.refreshResponse = undefined
    await opened.user.click(retryButton())
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(backend.requests.me).toEqual(['user-2'])
  })
})
