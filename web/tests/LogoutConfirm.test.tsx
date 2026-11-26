import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountOf, startAccounts } from './support/accounts'
import { startBackend, type Backend } from './support/backend'
import { copyKeys, queueOf, seedLedgerCopy, seedPending } from './support/device'
import { untilOpened, untilUnshielded } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 로그아웃(F-016, M-02 (5), #234 B). 보내지 않은 입력이 있으면 먼저 확인 창을 띄운다. 로그아웃하면 그 계정의 읽기용 사본,
 * 대기열, 남긴 쓰던 값을 지우고 "마지막으로 쓴 계좌" 기본값은 남긴다. 연결이 없어도 된다(작성자 판단 55).
 * 자리는 1A와 같은 더보기 맨 아래 줄과 사이드바 맨 아래다(#81).
 */

const server = startMockServer()
let backend: Backend

const LEDGER = '1ed9e700-0000-4000-8000-757365722d31'
const LAST_ACCOUNT = 'akkimpyo-last-account'
const NOW = Date.parse('2026-11-26T12:00:00+09:00')

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  backend = startBackend(server)
  const accounts = startAccounts(server, backend)
  accounts.items = [accountOf('통장', 'BANK', 0)]
  backend.cookieUser = 'user-1'
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(async () => {
  cleanup()
  await untilUnshielded()
  resetViewport()
  vi.unstubAllGlobals()
})

let made = 0
function pending(userId = 'user-1') {
  made += 1
  const id = `0193a000-0000-7000-8000-${String(made).padStart(12, '0')}`
  return {
    userId,
    ledgerId: LEDGER,
    queuedAt: NOW,
    body: { id, type: 'EXPENSE' as const, occurredOn: '2026-11-26', occurredTime: null, accountId: 'a', categoryId: null, amount: 1000, payee: null, memo: null },
  }
}

async function open(path: string, width = 390) {
  installMatchMedia(width)
  const opened = await openApp(path)
  await screen.findByRole('main')
  await screen.findByRole('navigation', { name: '주 메뉴' })
  setViewportWidth(width)
  return opened
}

const dialog = () => screen.queryByRole('dialog', { name: '로그아웃할까요?' })
const inDialog = (name: string) => within(dialog()!).getAllByRole('button', { name }).at(-1)!
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })

async function pressLogout(user: Awaited<ReturnType<typeof open>>['user']) {
  // 더보기는 따로 싣는 화면이라 그 코드를 받는 동안의 틀(#251)에는 버튼이 없다
  await user.click(await waitFor(() => within(screen.getByRole('main')).getByRole('button', { name: '로그아웃' })))
}

describe('보내지 않은 입력이 없으면', () => {
  it('확인 없이 로그아웃하고 로그인 화면으로 간다', async () => {
    const { user } = await open('/more')
    await pressLogout(user)
    await loginHeading()
    expect(dialog()).toBeNull()
  })

  it('다른 사용자의 보내지 않은 입력은 세지 않는다', async () => {
    await seedPending(pending('user-2'))
    const { user } = await open('/more')
    await pressLogout(user)
    await loginHeading()
    expect(await queueOf('user-2')).toHaveLength(1)
  })
})

describe('보내지 않은 입력이 있으면', () => {
  it('먼저 확인 창: 제목, 건수가 든 본문, "닫기"와 위험 버튼 "로그아웃"', async () => {
    await seedPending(pending())
    await seedPending(pending())
    const { user } = await open('/more')
    await pressLogout(user)
    await untilOpened()
    expect(dialog()).not.toBeNull()
    expect(within(dialog()!).getByText('보내지 않은 입력 2건이 이 기기에서 사라져요')).toBeTruthy()
    expect(inDialog('닫기')).toBeTruthy()
    const action = inDialog('로그아웃')
    expect(action.className).toMatch(/danger/)
  })

  it('보낼 수 없는 입력도 센다', async () => {
    await seedPending(pending())
    const second = pending()
    await seedPending(second)
    vi.resetModules()
    const { markRejected } = await import('../src/device/pendingQueue')
    await markRejected('user-1', second.body.id, { status: 400, code: 'VALIDATION_FAILED', fieldErrors: [], at: NOW })
    const { user } = await open('/more')
    await pressLogout(user)
    await untilOpened()
    expect(within(dialog()!).getByText('보내지 않은 입력 2건이 이 기기에서 사라져요')).toBeTruthy()
  })

  it('"닫기"를 누르면 로그아웃하지 않고 대기열도 그대로다', async () => {
    await seedPending(pending())
    const { user } = await open('/more')
    await pressLogout(user)
    await untilOpened()
    await user.click(inDialog('닫기'))
    await waitFor(() => expect(dialog()).toBeNull())
    expect(screen.getByRole('main').textContent).toContain('로그아웃')
    expect(backend.requests.logout).toEqual([])
    expect(await queueOf()).toHaveLength(1)
  })

  it('"로그아웃"을 누르면 그 계정의 대기열과 사본을 지우고 마지막으로 쓴 계좌 기본값은 남긴다', async () => {
    await seedPending(pending())
    await seedLedgerCopy('user-1', LEDGER, 'accounts', [], NOW)
    localStorage.setItem(LAST_ACCOUNT, JSON.stringify({ userId: 'user-1', ledgerId: LEDGER, accountId: 'x' }))
    const { user } = await open('/more')
    await pressLogout(user)
    await untilOpened()
    await user.click(inDialog('로그아웃'))
    await loginHeading()
    await waitFor(async () => expect(await queueOf()).toEqual([]))
    expect((await copyKeys()).filter(([owner]) => owner === 'user-1')).toEqual([])
    expect(localStorage.getItem(LAST_ACCOUNT)).not.toBeNull()
  })

  it('연결이 없어도 확인을 받고 로그아웃된다(작성자 판단 55)', async () => {
    await seedPending(pending())
    backend.logoutResponse = () => HttpResponse.error()
    const { user } = await open('/more')
    await pressLogout(user)
    await untilOpened()
    await user.click(inDialog('로그아웃'))
    await loginHeading()
    await waitFor(async () => expect(await queueOf()).toEqual([]))
  })

  it('넓은 화면의 사이드바 맨 아래 로그아웃도 같은 확인 창을 띄운다', async () => {
    await seedPending(pending())
    const { user } = await open('/home', 1280)
    await user.click(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('button', { name: '로그아웃' }))
    await untilOpened()
    expect(within(dialog()!).getByText('보내지 않은 입력 1건이 이 기기에서 사라져요')).toBeTruthy()
  })
})

describe('기기 저장소를 쓸 수 없으면', () => {
  it('셀 것이 없으므로 확인 없이 로그아웃한다', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const { user } = await open('/more')
    await pressLogout(user)
    await loginHeading()
    expect(dialog()).toBeNull()
  })
})
