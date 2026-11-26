import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { ledgerIdOf, meOf, type Backend } from './support/backend'
import { goOnline } from './support/connection'
import { copyKeys, ledgerCopy, meCopy, seedLedgerCopy, seedLogin, seedMeCopy } from './support/device'
import { untilOpened, untilUnshielded } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import type { TransactionDetailServer } from './support/transactionDetail'
import { deviceNow, lunch, startEditServer, type Item } from './support/transactionEdit'
import type { TransactionList } from './support/transactionList'
import {
  accountField,
  accountItems,
  categoryField,
  categoryItems,
  LEDGER,
  openApp,
  resetGlobals,
  settle,
  type User,
} from './support/transactionScreen'
import type { Accounts } from './support/accounts'
import type { Categories } from './support/categories'

/*
 * 계좌·카테고리의 읽기용 사본(ADR 006 결정 1, P-902, #234 A2). 받을 때마다 통째로 바꾸고, 장부를 볼 수 없게 되면 그 장부의
 * 사본을 지운다(security Q4). 새 거래 입력은 사본을 먼저 쓰고 서버의 값으로 바꾼다. 읽기 화면은 사본을 쓰지 않는다(#238).
 */

const server = startMockServer()
let backend: Backend
let accounts: Accounts
let categories: Categories
let detail: TransactionDetailServer
let list: TransactionList
let put: (...items: Item[]) => void

const DAY = 24 * 60 * 60 * 1000
const OTHER_LEDGER = ledgerIdOf('other')
/** 기기의 지금(deviceNow) */
const now = Date.parse('2026-11-26T12:30:00+09:00')

/** 사본은 서버의 값과 다르게 해 어느 쪽이 보이는지 안다 */
const copiedAccounts = [{ id: '55555555-5555-4555-8555-555555555555', name: '사본의 통장', type: 'BANK', balance: 7 }]
const copiedCategories = [
  { id: 'cccccccc-0000-4000-8000-000000000001', name: '사본의 식비', kind: 'EXPENSE', system: false, children: [] },
  { id: 'cccccccc-0000-4000-8000-000000000002', name: '미분류', kind: 'EXPENSE', system: true, children: [] },
]

beforeEach(() => {
  deviceNow()
  vi.stubGlobal('scrollTo', vi.fn())
  const started = startEditServer(server)
  ;({ backend, accounts, categories, detail, list, put } = started)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(async () => {
  cleanup()
  await untilUnshielded()
  resetGlobals()
})

/** 기록, 표시, 내 정보·계좌·카테고리 사본이 모두 맞는 기기 */
async function seedDevice({ ledgerCopies = true } = {}) {
  await seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 10 * DAY })
  await seedMeCopy('user-1', meOf('user-1'), now - DAY)
  if (!ledgerCopies) return
  await seedLedgerCopy('user-1', LEDGER, 'accounts', copiedAccounts, now - DAY)
  await seedLedgerCopy('user-1', LEDGER, 'categories', copiedCategories, now - DAY)
}

/** 내가 속한 다른 장부의 사본도 둔다(그 장부는 지우지 않아야 한다). 서버의 내 정보에도 그 장부가 있다. */
async function seedOtherLedger({ stillMember = true } = {}) {
  await seedLedgerCopy('user-1', OTHER_LEDGER, 'accounts', copiedAccounts, now - DAY)
  const me = meOf('user-1')
  const other = { id: OTHER_LEDGER, name: '다른 장부', role: 'OWNER' }
  if (stillMember) backend.meResponse = () => HttpResponse.json({ ...me, ledgers: [...me.ledgers, other] })
}

/**
 * 따로 싣는 화면(#251)의 코드가 와서 그 화면이 그려질 때까지 기다린다. 기기 저장소를 읽는 도구(support/device)는 모듈을 다시
 * 불러오므로, 화면의 코드가 오기 전에 읽으면 화면이 앱과 다른 모듈(로그인하지 않은 api)을 받는다.
 */
const untilScreen = () => screen.findAllByText(/자산 합계|불러오지 못했어요|찾을 수 없어요|없는 거래/)

/** 연결 없음과 같은 실패로 연다(확인하지 못한 로그인). */
async function openOffline(path: string) {
  backend.refreshResponse = () => HttpResponse.error()
  return openApp(path)
}

function reconnect() {
  backend.refreshResponse = undefined
  backend.cookieUser = 'user-1'
  act(() => goOnline())
}

const ledgerKinds = async (ledgerId: string) =>
  (await copyKeys()).filter(([owner, scope]) => owner === 'user-1' && scope === ledgerId).map(([, , kind]) => kind)

const optionNames = () => within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)

async function openPicker(user: User, field: HTMLElement) {
  await user.click(field)
  await untilOpened()
}

describe('사본을 남기는 때', () => {
  it('로그인한 상태로 계좌 목록과 카테고리를 받으면 그 사용자·장부의 사본으로 통째로 남기고 받은 시각을 적는다', async () => {
    await openApp('/transactions/new')
    await waitFor(accountField)
    await waitFor(async () => expect(await ledgerCopy('user-1', LEDGER, 'accounts')).toBeDefined())
    await waitFor(async () => expect(await ledgerCopy('user-1', LEDGER, 'categories')).toBeDefined())
    expect(await ledgerCopy('user-1', LEDGER, 'accounts')).toEqual({ data: accountItems, receivedAt: now })
    expect(await ledgerCopy('user-1', LEDGER, 'categories')).toEqual({ data: categoryItems, receivedAt: now })
  })

  it('다시 받으면 앞 사본을 남기지 않고 통째로 바꾼다', async () => {
    await seedDevice()
    accounts.items = [accountItems[1]]
    await openApp('/accounts')
    await untilScreen()
    await waitFor(async () => expect((await ledgerCopy('user-1', LEDGER, 'accounts'))?.data).toEqual([accountItems[1]]))
  })

  it('받은 목록이 약속과 다르면 사본을 바꾸지 않는다', async () => {
    await seedDevice()
    accounts.response = () => HttpResponse.json({ items: [{ id: 1 }] })
    await openApp('/accounts')
    await screen.findByText('불러오지 못했어요.')
    await settle()
    expect((await ledgerCopy('user-1', LEDGER, 'accounts'))?.data).toEqual(copiedAccounts)
  })
})

describe('장부 단위로 지우는 때(security Q4)', () => {
  it.each<[string, string, () => void]>([
    ['계좌 목록이 404', '/accounts', () => void (accounts.response = () => problem(404, 'NOT_FOUND'))],
    ['카테고리 목록이 404', '/categories', () => void (categories.response = () => problem(404, 'NOT_FOUND'))],
    ['거래 목록(내역)이 404', '/transactions?month=2026-11', () => void (list.response = () => problem(404, 'NOT_FOUND'))],
    ['장부 경로가 403 NO_LONGER_MEMBER(2단계)', '/accounts', () => void (accounts.response = () => problem(403, 'NO_LONGER_MEMBER'))],
  ])('%s이면 그 장부의 사본을 지우고, 다른 장부와 내 정보 사본은 남긴다', async (_, path, fail) => {
    await seedDevice()
    await seedOtherLedger()
    backend.cookieUser = 'user-1'
    fail()
    await openApp(path)
    await untilScreen()
    await waitFor(async () => expect(await ledgerKinds(LEDGER)).toEqual([]))
    expect(await ledgerKinds(OTHER_LEDGER)).toEqual(['accounts'])
    expect(await meCopy('user-1')).toBeDefined()
  })

  it('지우는 코드를 따로 받을 수 없어도(배포 직후, 그 순간의 끊김) 404 뒤에 그 장부의 사본을 지운다(architect)', async () => {
    // 지우기가 따로 싣는 조각이면 받기가 실패해 조용히 건너뛴다. 첫 묶음에 있어야 한다
    vi.doMock('../src/device/ledgerCopies', () => {
      throw new Error('조각을 받지 못함')
    })
    onTestFinished(() => void vi.doUnmock('../src/device/ledgerCopies'))
    await seedDevice()
    backend.cookieUser = 'user-1'
    accounts.response = () => problem(404, 'NOT_FOUND')
    await openApp('/accounts')
    await untilScreen()
    await waitFor(async () => expect(await ledgerKinds(LEDGER)).toEqual([]))
  })

  it.each<[string, string, () => void]>([
    ['403 FORBIDDEN(구성원이지만 권한이 모자람)', '/accounts', () => void (accounts.response = () => problem(403, 'FORBIDDEN'))],
    ['서버 오류', '/accounts', () => void (accounts.response = () => problem(500, 'INTERNAL_ERROR'))],
    ['거래 상세가 404(그 거래가 없을 수 있다)', `/transactions/${lunch().id}`, () => {}],
  ])('%s에는 지우지 않는다', async (_, path, fail) => {
    await seedDevice()
    backend.cookieUser = 'user-1'
    fail()
    await openApp(path)
    await screen.findAllByText(/불러오지 못했어요|찾을 수 없어요|없는 거래/)
    await settle(100)
    expect((await ledgerKinds(LEDGER)).sort()).toEqual(['accounts', 'categories'])
  })

  it('로그인이 풀려도(갱신 401) 사본을 지우지 않는다', async () => {
    await seedDevice()
    backend.cookieUser = undefined
    await openApp('/accounts')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    await settle(100)
    expect((await ledgerKinds(LEDGER)).sort()).toEqual(['accounts', 'categories'])
  })

  it('내 정보의 장부 목록에서 빠진 장부의 사본을 지운다', async () => {
    await seedDevice()
    await seedOtherLedger({ stillMember: false })
    backend.cookieUser = 'user-1'
    await openApp('/home')
    await waitFor(async () => expect(await ledgerKinds(OTHER_LEDGER)).toEqual([]))
    expect(await ledgerKinds(LEDGER)).not.toEqual([])
  })
})

describe('새 거래 입력은 사본을 먼저 쓴다', () => {
  it('확인하지 못한 로그인으로 열면 사본의 계좌가 바로 기본값이고, 고르기에 사본의 계좌와 카테고리가 보인다', async () => {
    await seedDevice()
    const { user } = await openOffline('/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    // 뼈대 없이 처음 그릴 때부터 사본의 기본 계좌다. 그 전의 화면 코드를 받는 동안의 틀(#251)에는 칸이 없다
    expect((await waitFor(accountField)).textContent).toContain('사본의 통장')
    await openPicker(user, accountField())
    expect(optionNames()).toEqual(['사본의 통장'])
    await user.keyboard('{Escape}')
    await openPicker(user, categoryField())
    expect(optionNames()).toContain('사본의 식비')
  })

  it('연결이 있으면 사본으로 먼저 열고 서버의 목록이 오면 그것으로 바꾼다', async () => {
    await seedDevice()
    const answer = Promise.withResolvers<Response>()
    accounts.response = () => answer.promise
    backend.cookieUser = 'user-1'
    const { user } = await openApp('/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(() => expect(accountField().textContent).toContain('사본의 통장'))
    answer.resolve(HttpResponse.json({ items: accountItems }))
    await settle(100)
    await openPicker(user, accountField())
    expect(optionNames()).toContain('급여통장')
    expect(optionNames()).not.toContain('사본의 통장')
  })

  it('서버의 목록을 받는 중에도 고르기 칸은 받는 중 표시 대신 사본의 목록을 보인다(architect)', async () => {
    await seedDevice()
    accounts.response = () => new Promise(() => {})
    categories.response = () => new Promise(() => {})
    backend.cookieUser = 'user-1'
    const { user } = await openApp('/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(() => expect(accountField().textContent).toContain('사본의 통장'))
    await openPicker(user, accountField())
    expect(optionNames()).toEqual(['사본의 통장'])
    expect(screen.queryByText('불러오고 있어요')).toBeNull()
    await user.keyboard('{Escape}')
    await openPicker(user, categoryField())
    expect(optionNames()).toContain('사본의 식비')
  })

  it('다른 사용자의 사본은 쓰지 않는다', async () => {
    await seedDevice({ ledgerCopies: false })
    await seedLedgerCopy('user-2', LEDGER, 'accounts', copiedAccounts, now - DAY)
    await openOffline('/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(accountField)
    await settle(100)
    expect(accountField().textContent).not.toContain('사본의 통장')
  })

  it('읽기 화면(계좌 목록)은 사본을 쓰지 않는다(#238)', async () => {
    await seedDevice()
    await openOffline('/accounts')
    await screen.findByText('불러오지 못했어요.')
    expect(document.body.textContent).not.toContain('사본의 통장')
  })
})

describe('확인하지 못한 채 연 상세·수정은 확인된 뒤 그 사용자로 보낸다', () => {
  it('상세에서 삭제', async () => {
    const item = lunch()
    put(item)
    await seedDevice()
    const { user } = await openOffline(`/transactions/${item.id}`)
    await screen.findByText('불러오지 못했어요.')
    reconnect()
    await screen.findByText('날짜·시각')
    const main = screen.getByRole('main')
    await user.click(within(main).getByRole('button', { name: '삭제' }))
    await untilOpened()
    const dialog = screen.getByRole('dialog', { name: '이 거래를 삭제할까요?' })
    await user.click(within(dialog).getAllByRole('button', { name: '삭제' }).at(-1)!)
    await waitFor(() => expect(detail.requests.delete.map((sent) => sent.user)).toEqual(['user-1']))
    expect(detail.items.get(String(item.id))?.deletedAt).not.toBeNull()
  })

  it('수정에서 저장', async () => {
    const item = lunch()
    put(item)
    await seedDevice()
    const { user } = await openOffline(`/transactions/${item.id}/edit`)
    await screen.findByText('불러오지 못했어요.')
    reconnect()
    await screen.findByRole('heading', { level: 1, name: '거래 수정' })
    const memo = await screen.findByLabelText<HTMLTextAreaElement>('메모 (선택)')
    await user.clear(memo)
    await user.type(memo, '고친 메모')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(detail.requests.update.map((sent) => sent.user)).toEqual(['user-1']))
  })
})
