import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { queueOf, seedLedgerCopy, seedLogin, seedMeCopy } from './support/device'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import {
  accountField,
  accountItems,
  amount,
  categoryItems,
  errorOf,
  id,
  LAST_ACCOUNT_KEY,
  LEDGER,
  openApp,
  openFromMore,
  path,
  payee,
  pick,
  resetGlobals,
  saveButton,
  settle,
  startServer,
  typeRadio,
  type User,
} from './support/transactionScreen'
import { holdClock, passTime, releaseClock } from './support/testClock'
import type { Transactions } from './support/transactions'
import { resetViewport } from './support/viewport'

/*
 * 연결이 없을 때의 새 거래 저장(F-103, P-225, P-904, #234 B). 기기 검증을 거쳐 대기열에 쌓고, 화면을 닫고 이전 화면으로 가며
 * 토스트를 보인다. 요청 중에 연결이 끊긴 새 거래도 같은 id로 쌓는다. 서버 오류와 15초 지연은 쌓지 않는다(1A 그대로).
 */

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const queued = '기기에 저장했어요. 연결되면 보낼게요.'
const failed = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const noDevice = '연결이 없어 저장하지 못했어요. 이 브라우저에는 저장해 둘 수 없어요.'
const NOW = '2026-11-26T12:30:00+09:00'
const now = Date.parse(NOW)
const DAY = 24 * 60 * 60 * 1000

const server = startMockServer()
let backend: Backend
let transactions: Transactions

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const toastText = () => document.querySelector('[class*="region"]')?.textContent ?? ''
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
/** 이 앱의 버튼은 비활성을 aria-disabled로 알린다(초점은 받는다) */
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true'

async function fillExpense(user: User) {
  await user.click(amount())
  await user.keyboard('12000')
  await user.type(payee(), '올래국수')
}

/** 더보기에서 연 입력 화면에서 연결이 끊긴다. */
async function openOfflineForm() {
  const opened = await openFromMore()
  act(() => goOffline())
  return opened
}

describe('연결이 없을 때 저장하면', () => {
  it('요청 없이 대기열에 쌓고, 화면을 닫고 이전 화면으로 가며 토스트를 보인다', async () => {
    const opened = await openOfflineForm()
    await fillExpense(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await waitFor(() => expect(toastText()).toBe(queued))
    expect(transactions.sent).toEqual([])
    const [item, ...rest] = await queueOf('user-1')
    expect(rest).toEqual([])
    expect(item).toMatchObject({
      schema: 1,
      userId: 'user-1',
      ledgerId: LEDGER,
      queuedAt: now,
      state: { kind: 'waiting' },
      body: {
        type: 'EXPENSE',
        occurredOn: '2026-11-26',
        accountId: id.salary,
        amount: 12000,
        payee: '올래국수',
        memo: null,
        categoryId: null,
      },
    })
    expect(item.id).toMatch(UUID_V7)
    expect(item.body.id).toBe(item.id)
  })

  it('수입도 쌓는다', async () => {
    const opened = await openOfflineForm()
    await opened.user.click(typeRadio('수입'))
    await opened.user.click(amount())
    await opened.user.keyboard('3000')
    await opened.user.click(saveButton())
    await waitFor(async () => expect((await queueOf())[0]?.body).toMatchObject({ type: 'INCOME', amount: 3000 }))
  })

  it('이체도 쌓는다', async () => {
    const opened = await openOfflineForm()
    await opened.user.click(typeRadio('이체'))
    await opened.user.click(amount())
    await opened.user.keyboard('50000')
    await pick(opened.user, accountField('받는 계좌'), '비상금')
    await opened.user.click(saveButton())
    await waitFor(async () =>
      expect((await queueOf())[0]?.body).toMatchObject({
        type: 'TRANSFER',
        fromAccountId: id.salary,
        toAccountId: id.saving,
        amount: 50000,
      }),
    )
  })

  it('기기 검증(금액 범위, 필수 항목)이 먼저다. 틀리면 쌓지 않는다', async () => {
    const opened = await openOfflineForm()
    await opened.user.click(saveButton())
    expect(errorOf(amount())).toBe('1원부터 9,999,999,999원까지 입력할 수 있어요')
    await settle()
    expect(await queueOf()).toEqual([])
    expect(path(opened)).toBe('/transactions/new')
  })

  it('저장 버튼은 연결이 없어도 누를 수 있고 "연결되면 ~" 안내가 붙지 않는다', async () => {
    await openOfflineForm()
    expect(isDisabled(saveButton())).toBe(false)
    expect(document.body.textContent).not.toContain('연결되면')
  })

  it('고른 계좌를 마지막으로 쓴 계좌로 남긴다(F-102, planner Q7)', async () => {
    const opened = await openOfflineForm()
    await opened.user.click(amount())
    await opened.user.keyboard('12000')
    await pick(opened.user, accountField(), '지갑')
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe(queued))
    expect(JSON.parse(localStorage.getItem(LAST_ACCOUNT_KEY)!)).toEqual({
      userId: 'user-1',
      ledgerId: LEDGER,
      accountId: id.wallet,
    })
  })
})

describe('요청 중에 연결이 끊기면(P-904)', () => {
  it('보낸 것과 같은 거래 id로 쌓고 화면을 닫으며 같은 토스트를 보인다', async () => {
    transactions.response = () => HttpResponse.error()
    const opened = await openFromMore()
    await fillExpense(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await waitFor(() => expect(toastText()).toBe(queued))
    const [item] = await queueOf()
    expect(transactions.sent).toHaveLength(1)
    expect(item.id).toBe(transactions.sent[0].body.id)
    expect(item.body).toEqual(transactions.sent[0].body)
  })

  it('토큰을 갱신하다 연결이 끊겨도(401 뒤 갱신이 응답 없음) 쌓는다', async () => {
    const opened = await openFromMore()
    backend.expireTokens()
    backend.refreshResponse = () => HttpResponse.error()
    await fillExpense(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe(queued))
    expect(await queueOf()).toHaveLength(1)
  })

  it('서버 오류(5xx)는 쌓지 않고 1A처럼 문구와 "다시 시도"를 보이며 값을 둔다', async () => {
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openFromMore()
    await fillExpense(opened.user)
    await opened.user.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toBe(failed)
    expect(await queueOf()).toEqual([])
    expect(amount().value).toBe('12,000')
  })

  it('15초 동안 응답이 없으면 쌓지 않고 1A처럼 문구를 보인다', async () => {
    transactions.response = delayed().respond
    const opened = await openFromMore()
    await opened.user.click(amount())
    await opened.user.keyboard('12000')
    holdClock()
    fireEvent.click(saveButton())
    await passTime(15_100)
    expect(screen.getByRole('alert').textContent).toBe(failed)
    releaseClock()
    expect(await queueOf()).toEqual([])
  })
})

describe('확인하지 못한 로그인으로 연 입력', () => {
  it('로그인 확인 없이 기록의 사용자로 쌓는다(보낼 때 인증한다)', async () => {
    await seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 10 * DAY })
    await seedMeCopy('user-1', meOf('user-1'), now - DAY)
    await seedLedgerCopy('user-1', LEDGER, 'accounts', accountItems, now - DAY)
    await seedLedgerCopy('user-1', LEDGER, 'categories', categoryItems, now - DAY)
    backend.refreshResponse = () => HttpResponse.error()
    const opened = await openApp('/transactions/new')
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    act(() => goOffline())
    await opened.user.click(amount())
    await opened.user.keyboard('12000')
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe(queued))
    expect((await queueOf('user-1'))[0]).toMatchObject({ userId: 'user-1', body: { accountId: id.salary } })
    expect(transactions.sent).toEqual([])
  })
})

describe('기기에 쌓을 수 없으면(저장소를 쓸 수 없음, designer Q8)', () => {
  it('문구와 "다시 시도"(연결이 없는 동안 비활성)를 보이고 값을 둔다. 연결이 돌아오면 누를 수 있다', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const opened = await openOfflineForm()
    await fillExpense(opened.user)
    await opened.user.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toBe(noDevice)
    expect(isDisabled(retryButton())).toBe(true)
    expect([amount().value, payee().value]).toEqual(['12,000', '올래국수'])
    expect(path(opened)).toBe('/transactions/new')
    act(() => goOnline())
    await waitFor(() => expect(isDisabled(retryButton())).toBe(false))
    await opened.user.click(retryButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
  })
})
