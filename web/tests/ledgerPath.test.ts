import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { createAccount, fetchAccounts } from '../src/features/accounts/accounts'
import { fetchCategories } from '../src/features/categories/categories'
import { ledgerPath } from '../src/features/me/ledgerPath'
import { createTransaction } from '../src/features/transactions/transactions'
import { startMockServer } from './support/mockServer'

const server = startMockServer()
const LEDGER = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'

let requests: string[] = []

beforeEach(() => {
  requests = []
  server.use(
    http.all('*', ({ request }) => {
      requests.push(new URL(request.url).pathname)
      return HttpResponse.json({ items: [] })
    }),
  )
})

describe('장부 경로', () => {
  it('UUID 모양의 장부 id로 /ledgers/{id}/{자원}을 만든다', () => {
    expect(ledgerPath(LEDGER, 'accounts')).toBe(`/ledgers/${LEDGER}/accounts`)
    expect(ledgerPath(LEDGER.toUpperCase(), 'transactions')).toBe(`/ledgers/${LEDGER.toUpperCase()}/transactions`)
  })

  it.each(['', 'user-1-ledger', '../me', `${LEDGER}/../../me`, `${LEDGER}?x=1`, `${LEDGER}#`, ' ' + LEDGER, '%2e%2e'])(
    '%j는 UUID가 아니라 경로를 만들지 않고 읽을 수 없는 값으로 실패한다',
    (ledgerId) => {
      expect(() => ledgerPath(ledgerId, 'accounts')).toThrow(ApiError)
      try {
        ledgerPath(ledgerId, 'accounts')
      } catch (error) {
        expect(error).toMatchObject({ kind: 'server' })
      }
    },
  )
})

const newAccount = { name: '급여통장', type: 'BANK', openingBalance: 0, openingDate: '2026-11-26' } as const
const expense = {
  id: '019a5f2e-8a7d-7b60-9c11-0b9f6c1e3d52',
  type: 'EXPENSE',
  occurredOn: '2026-11-26',
  occurredTime: null,
  accountId: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  categoryId: null,
  amount: 1,
  payee: null,
  memo: null,
} as const

describe.each([
  ['계좌 목록', (ledgerId: string) => fetchAccounts(ledgerId)],
  ['계좌 추가', (ledgerId: string) => createAccount(ledgerId, newAccount)],
  ['카테고리 목록', (ledgerId: string) => fetchCategories(ledgerId)],
  ['거래 만들기', (ledgerId: string) => createTransaction(ledgerId, expense, 'user-1')],
])('%s', (_, call) => {
  it('장부 id가 UUID가 아니면 요청하지 않고 실패한다', async () => {
    await expect(call('../../me')).rejects.toMatchObject({ name: 'ApiError', kind: 'server' })
    await expect(call('user-1-ledger')).rejects.toMatchObject({ name: 'ApiError' })
    expect(requests).toEqual([])
  })
})

describe('UUID 장부 id', () => {
  it('계좌와 카테고리는 그 장부 경로로 보낸다', async () => {
    vi.stubGlobal('navigator', navigator)
    await fetchAccounts(LEDGER)
    await fetchCategories(LEDGER)
    expect(requests).toEqual([`/api/v1/ledgers/${LEDGER}/accounts`, `/api/v1/ledgers/${LEDGER}/categories`])
  })
})
