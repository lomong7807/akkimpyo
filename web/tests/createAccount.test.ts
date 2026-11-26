import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { createAccount, type NewAccount } from '../src/features/accounts/accounts'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

const server = startMockServer()

const LEDGER = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const PATH = `/api/v1/ledgers/${LEDGER}/accounts`
const account: NewAccount = { name: '예시카드', type: 'CARD', openingBalance: -350000, openingDate: '2026-11-26' }
const created = {
  id: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  name: '예시카드',
  type: 'CARD',
  balance: -350000,
  openingDate: '2026-11-26',
}

function respondWith(respond: () => Response) {
  const requests: { body: string; method: string }[] = []
  server.use(
    http.post(PATH, async ({ request }) => {
      requests.push({ body: await request.text(), method: request.method })
      return respond()
    }),
  )
  return requests
}

const errorOf = () => createAccount(LEDGER, account).catch((thrown: unknown) => thrown)

describe('계좌 추가(POST /api/v1/ledgers/{ledgerId}/accounts)', () => {
  it('네 필드만 보내고 받은 계좌를 준다', async () => {
    const requests = respondWith(() => HttpResponse.json(created, { status: 201 }))
    const result = await createAccount(LEDGER, account)
    expect(requests.map(({ body }) => JSON.parse(body))).toEqual([account])
    expect(result).toMatchObject({ id: created.id, name: '예시카드', type: 'CARD', balance: -350000 })
  })

  it.each([
    ['빈 본문', () => new HttpResponse(null, { status: 201 })],
    ['모르는 종류', () => HttpResponse.json({ ...created, type: 'LOAN' }, { status: 201 })],
    ['정수가 아닌 잔액', () => HttpResponse.json({ ...created, balance: 0.5 }, { status: 201 })],
    ['이름이 없는 본문', () => HttpResponse.json({ ...created, name: undefined }, { status: 201 })],
    ['목록 모양의 본문', () => HttpResponse.json({ items: [created] }, { status: 201 })],
  ])('읽을 수 없는 응답이면 서버 오류로 본다: %s', async (_, respond) => {
    respondWith(respond)
    const error = await errorOf()
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).kind).toBe('server')
  })

  it('거부되면 칸과 code를 담은 오류를 던진다', async () => {
    const fieldErrors = [{ field: 'name', code: 'DUPLICATE' }]
    respondWith(() => problem(400, 'VALIDATION_FAILED', { fieldErrors }))
    expect(await errorOf()).toMatchObject({ kind: 'rejected', status: 400, fieldErrors })
  })
})
