import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { fetchAccounts } from '../src/features/accounts/accounts'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

const server = startMockServer()

const LEDGER = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const PATH = `/api/v1/ledgers/${LEDGER}/accounts`
const bank = {
  id: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  name: '예시은행 생활비',
  type: 'BANK',
  balance: 3210000,
  openingDate: '2026-11-01',
}
const card = { ...bank, id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: '예시카드', type: 'CARD', balance: -482300 }
const cash = { ...bank, id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', name: '지갑', type: 'CASH', balance: 0 }

function respondWith(body: unknown) {
  server.use(http.get(PATH, () => HttpResponse.json(body as object)))
}

async function errorOf(body: unknown) {
  respondWith(body)
  return fetchAccounts(LEDGER).catch((thrown: unknown) => thrown)
}

describe('계좌 목록(GET /api/v1/ledgers/{ledgerId}/accounts)', () => {
  it('받은 순서대로 이름, 종류, 잔액을 준다. 음수 잔액은 그대로다', async () => {
    respondWith({ items: [cash, card, bank] })
    const accounts = await fetchAccounts(LEDGER)
    expect(accounts.map(({ name, type, balance }) => [name, type, balance])).toEqual([
      ['지갑', 'CASH', 0],
      ['예시카드', 'CARD', -482300],
      ['예시은행 생활비', 'BANK', 3210000],
    ])
  })

  it('계좌가 없으면 빈 목록이다', async () => {
    respondWith({ items: [] })
    expect(await fetchAccounts(LEDGER)).toEqual([])
  })

  it('모르는 필드가 있어도 되고, 쓰지 않는 기준일은 읽지 않는다', async () => {
    respondWith({ added: 1, items: [{ ...bank, added: [], openingDate: undefined }] })
    expect((await fetchAccounts(LEDGER))[0].name).toBe('예시은행 생활비')
  })

  it.each([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])('안전한 정수의 끝 %d은 받는다', async (balance) => {
    respondWith({ items: [{ ...bank, balance }] })
    expect((await fetchAccounts(LEDGER))[0].balance).toBe(balance)
  })

  it.each([
    ['모르는 종류', { items: [bank, { ...card, type: 'LOAN' }] }],
    ['소문자 종류', { items: [{ ...bank, type: 'bank' }] }],
    ['객체에 원래 있는 이름의 종류', { items: [{ ...bank, type: 'constructor' }] }],
    ['종류가 없음', { items: [{ ...bank, type: undefined }] }],
    ['종류가 배열', { items: [{ ...bank, type: ['BANK'] }] }],
    ['잔액이 소수', { items: [{ ...bank, balance: 0.5 }] }],
    ['잔액이 글자', { items: [{ ...bank, balance: '3210000' }] }],
    ['잔액이 null', { items: [{ ...bank, balance: null }] }],
    ['잔액이 없음', { items: [{ ...bank, balance: undefined }] }],
    ['안전한 정수보다 큰 잔액', { items: [{ ...bank, balance: 9007199254740992 }] }],
    ['안전한 정수보다 작은 잔액', { items: [{ ...bank, balance: -9007199254740992 }] }],
    ['id가 없음', { items: [{ ...bank, id: undefined }] }],
    ['이름이 글자가 아님', { items: [{ ...bank, name: 1 }] }],
    ['계좌가 null', { items: [null] }],
    ['마지막 계좌가 깨짐', { items: [bank, card, {}] }],
    ['items가 없음', {}],
    ['items가 null', { items: null }],
    ['items가 배열이 아님', { items: { 0: bank } }],
    ['최상위 배열', [bank]],
    ['null', null],
    ['글자', 'accounts'],
  ])('약속과 다른 응답은 서버 오류로 본다: %s', async (_, body) => {
    const error = await errorOf(body)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('server')
  })

  it('빈 응답도 서버 오류로 본다', async () => {
    server.use(http.get(PATH, () => new HttpResponse(null, { status: 204 })))
    await expect(fetchAccounts(LEDGER)).rejects.toMatchObject({ kind: 'server' })
  })

  it('서버가 거부하면 그 오류를 그대로 던진다', async () => {
    server.use(http.get(PATH, () => problem(404, 'NOT_FOUND')))
    await expect(fetchAccounts(LEDGER)).rejects.toMatchObject({ kind: 'rejected', status: 404, code: 'NOT_FOUND' })
  })
})
