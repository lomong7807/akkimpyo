import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewTransaction } from '../src/features/transactions/transactions'
import { ledgerIdOf, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { credentials, errorOf } from './support/sessionTab'
import { savedOf, startTransactions, type Transactions } from './support/transactions'

const server = startMockServer()
let backend: Backend
let transactions: Transactions

const iphoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const ledgerId = ledgerIdOf('user-1')
const expense: NewTransaction = {
  id: '019a5f2e-8a7d-7b60-9c11-0b9f6c1e3d52',
  type: 'EXPENSE',
  occurredOn: '2026-11-26',
  occurredTime: '12:30',
  accountId: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  categoryId: null,
  amount: 12000,
  payee: '올래국수',
  memo: null,
}
const transfer: NewTransaction = {
  id: '019a5f2e-8a7d-7b61-9c11-0b9f6c1e3d52',
  type: 'TRANSFER',
  occurredOn: '2026-11-26',
  occurredTime: null,
  fromAccountId: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  toAccountId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  amount: 450000,
  memo: '카드대금',
}

/** 탭 하나. 세션과 거래 모듈을 새로 불러와 함께 쓴다. */
async function openSignedInTab() {
  vi.resetModules()
  const session = await import('../src/api/session')
  const module = await import('../src/features/transactions/transactions')
  await session.login(credentials)
  return { ...session, ...module }
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, userAgent: iphoneSafari })
  backend = startBackend(server)
  transactions = startTransactions(server, backend)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('요청', () => {
  it.each([
    ['지출', expense],
    ['이체', transfer],
  ])('%s을 장부 경로로 한 번 보내고 본문은 계약의 필드 그대로다', async (_, transaction) => {
    const tab = await openSignedInTab()
    await tab.createTransaction(ledgerId, transaction, 'user-1')
    expect(transactions.sent).toHaveLength(1)
    expect(transactions.sent[0]).toMatchObject({ ledgerId, user: 'user-1', body: transaction })
    expect(Object.keys(transactions.sent[0].body).toSorted()).toEqual(Object.keys(transaction).toSorted())
    expect(transactions.sent[0].headers.get('Content-Type')).toBe('application/json')
  })

  it('refund와 paidBy는 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    await tab.createTransaction(ledgerId, expense, 'user-1')
    expect(transactions.sent[0].body).not.toHaveProperty('refund')
    expect(transactions.sent[0].body).not.toHaveProperty('paidBy')
  })

  it('기기 값을 X-Akkimpyo-Device 헤더에 싣는다', async () => {
    const tab = await openSignedInTab()
    await tab.createTransaction(ledgerId, expense, 'user-1')
    expect(transactions.sent[0].device).toBe('iphone.safari')
  })

  it('모르는 기기면 unknown.unknown이다', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (PlayStation 5)' })
    const tab = await openSignedInTab()
    await tab.createTransaction(ledgerId, expense, 'user-1')
    expect(transactions.sent[0].device).toBe('unknown.unknown')
  })

  it('user agent 원문은 보내지도, 저장하지도, console에 남기지도 않는다', async () => {
    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method))
    const tab = await openSignedInTab()
    await tab.createTransaction(ledgerId, expense, 'user-1')
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    const error = await errorOf(tab.createTransaction(ledgerId, expense, 'user-1'))

    const sent = transactions.sent.map(({ headers, body }) => [...headers.entries()].join() + JSON.stringify(body))
    const stored = [localStorage, sessionStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => key + storage.getItem(key)),
    )
    const consoleText = logged.flatMap((spy) => spy.mock.calls.flat().map(String))
    const errorText = [String(error), error.stack, JSON.stringify(error, Object.getOwnPropertyNames(error))]
    for (const text of [...sent, ...stored, ...consoleText, ...errorText, document.cookie, location.href]) {
      expect(text).not.toContain('AppleWebKit')
      expect(text).not.toContain('iPhone OS')
    }
  })
})

describe('보내는 사용자', () => {
  it('저장을 시작한 사용자와 지금 사용자가 다르면 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    const error = await errorOf(tab.createTransaction(ledgerId, expense, 'user-2'))
    // 모듈을 새로 불러온 탭이라 클래스가 다르다
    expect(error).toMatchObject({ name: 'ApiError' })
    expect(transactions.sent).toEqual([])
  })

  it('시작한 사용자를 모르면 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    await errorOf(tab.createTransaction(ledgerId, expense, undefined))
    expect(transactions.sent).toEqual([])
  })

  it('로그아웃한 뒤에는 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    tab.logout()
    await errorOf(tab.createTransaction(ledgerId, expense, 'user-1'))
    expect(transactions.sent).toEqual([])
  })

  it('토큰이 만료돼 갱신하는 사이 다른 계정의 로그인이 쿠키를 바꿨으면 그 계정으로 다시 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    backend.expireTokens()
    backend.cookieUser = 'user-2'
    await errorOf(tab.createTransaction(ledgerId, expense, 'user-1'))
    expect(transactions.sent.map(({ user }) => user)).toEqual([undefined])
  })

  it('토큰이 만료됐으면 같은 사용자로 갱신해 한 번 더 보낸다', async () => {
    backend.cookieUser = 'user-1'
    const tab = await openSignedInTab()
    backend.expireTokens()
    const result = await tab.createTransaction(ledgerId, expense, 'user-1')
    expect(result.created).toBe(true)
    expect(transactions.sent.map(({ user }) => user)).toEqual([undefined, 'user-1'])
  })
})

describe('성공', () => {
  it('201은 새로 만든 것이다', async () => {
    const tab = await openSignedInTab()
    const result = await tab.createTransaction(ledgerId, expense, 'user-1')
    expect(result.created).toBe(true)
    expect(result.transaction).toMatchObject({ id: expense.id, version: 1, status: 'POSTED' })
  })

  it('200은 같은 id를 다시 보낸 것이고 성공이다', async () => {
    transactions.response = ({ body, user }) => HttpResponse.json(savedOf(body, user), { status: 200 })
    const tab = await openSignedInTab()
    const result = await tab.createTransaction(ledgerId, expense, 'user-1')
    expect(result.created).toBe(false)
  })

  it.each([
    ['빈 객체', {}],
    ['배열', [savedOf(expense as never)]],
    ['null', null],
    ['id가 없음', savedOf(expense as never, 'user-1', { id: undefined })],
    ['모르는 유형', savedOf(expense as never, 'user-1', { type: 'REFUND' })],
    ['모르는 상태', savedOf(expense as never, 'user-1', { status: 'DONE' })],
    ['version이 글자', savedOf(expense as never, 'user-1', { version: '1' })],
    ['version이 0', savedOf(expense as never, 'user-1', { version: 0 })],
    ['version이 소수', savedOf(expense as never, 'user-1', { version: 1.5 })],
    ['deletedAt이 없음', savedOf(expense as never, 'user-1', { deletedAt: undefined })],
    ['paidBy가 글자', savedOf(expense as never, 'user-1', { paidBy: 'user-1' })],
  ])('읽을 수 없는 본문(%s)은 서버 오류다', async (_, body) => {
    transactions.response = () => HttpResponse.json(body, { status: 201 })
    const tab = await openSignedInTab()
    const error = await errorOf(tab.createTransaction(ledgerId, expense, 'user-1'))
    expect(error).toMatchObject({ kind: 'server', status: 201 })
  })

  it.each([202, 204])('201과 200이 아닌 성공 상태(%d)는 약속과 다른 응답이다', async (status) => {
    transactions.response = ({ body }) =>
      status === 204 ? new HttpResponse(null, { status }) : HttpResponse.json(savedOf(body), { status })
    const tab = await openSignedInTab()
    const error = await errorOf(tab.createTransaction(ledgerId, expense, 'user-1'))
    expect(error).toMatchObject({ kind: 'server', status })
  })
})

describe('다시 보낸 거래의 알림(ADR 006 결정 3)', () => {
  const base = savedOf(expense as never)
  const transferBase = savedOf(transfer as never)

  async function noticeFor(status: 200 | 201, body: object) {
    transactions.response = () => HttpResponse.json(body, { status })
    const tab = await openSignedInTab()
    return tab.needsResendNotice(await tab.createTransaction(ledgerId, expense, 'user-1'))
  }

  it.each([
    ['그대로인 거래', base, false],
    ['고쳐진 거래(version 2)', { ...base, version: 2 }, true],
    ['여러 번 고쳐진 거래', { ...base, version: 9 }, true],
    ['휴지통에 있는 거래', { ...base, deletedAt: '2026-11-26T04:00:00.000Z' }, true],
    ['취소된 거래', { ...base, status: 'CANCELED' }, true],
    ['승인 대기 거래', { ...base, status: 'PENDING' }, false],
    ['결제한 사람이 탈퇴한 지출', { ...base, paidBy: null }, true],
    ['결제한 사람이 탈퇴한 수입', { ...base, type: 'INCOME', paidBy: null }, true],
    ['결제한 사람 항목이 없는 지출', Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'paidBy')), false],
    ['이체(결제한 사람이 늘 null)', transferBase, false],
  ])('200으로 받은 %s: 알림 %s', async (_, body, expected) => {
    expect(await noticeFor(200, body)).toBe(expected)
  })

  it('201이면 어떤 값이어도 알리지 않는다', async () => {
    expect(await noticeFor(201, { ...base, version: 2, status: 'CANCELED', paidBy: null })).toBe(false)
  })

  it('보낸 내용과 받은 내용이 달라도 그것만으로는 알리지 않는다', async () => {
    expect(await noticeFor(200, { ...base, amount: 99, payee: '다른 가맹점', memo: '다름' })).toBe(false)
  })
})

describe('같은 id로 만들 수 없음(409 ID_CONFLICT)', () => {
  const savedId = '019a5f2e-8a7d-7b60-9c11-0b9f6c1e3d52'

  async function conflictFor(response: () => Response) {
    transactions.response = response
    const tab = await openSignedInTab()
    return tab.idConflictOf(await errorOf(tab.createTransaction(ledgerId, expense, 'user-1')))
  }

  it('current가 있으면 앞서 저장한 거래의 id를 준다', async () => {
    expect(await conflictFor(() => problem(409, 'ID_CONFLICT', { current: savedOf(expense as never) }))).toEqual({
      savedId,
    })
  })

  it('대문자 id는 소문자로 준다', async () => {
    const current = savedOf(expense as never, 'user-1', { id: savedId.toUpperCase() })
    expect(await conflictFor(() => problem(409, 'ID_CONFLICT', { current }))).toEqual({ savedId })
  })

  it.each([
    ['current가 없음', {}],
    ['current가 null', { current: null }],
    ['current가 글자', { current: savedId }],
    ['id가 UUID가 아님', { current: { id: '../../me' } }],
    ['id가 없음', { current: { version: 1 } }],
  ])('%s이면 id가 없는 거부다', async (_, extension) => {
    expect(await conflictFor(() => problem(409, 'ID_CONFLICT', extension))).toEqual({})
  })

  it.each([
    ['다른 409', () => problem(409, 'STALE_VERSION', { current: savedOf(expense as never) })],
    ['400', () => problem(400, 'VALIDATION_FAILED', { fieldErrors: [] })],
    ['500', () => problem(500, 'INTERNAL_ERROR')],
  ])('%s는 ID_CONFLICT가 아니다', async (_, response) => {
    expect(await conflictFor(response)).toBeUndefined()
  })
})
