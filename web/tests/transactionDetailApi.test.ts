import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ledgerIdOf, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { credentials, errorOf } from './support/sessionTab'
import { startTransactionDetail, trashed, type TransactionDetailServer } from './support/transactionDetail'
import { expenseOf, transferOf } from './support/transactionList'

/* 거래 상세(#15)와 삭제·복원(#38)의 요청과 응답 계약 */

const server = startMockServer()
let backend: Backend
let detail: TransactionDetailServer

const iphoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const ledgerId = ledgerIdOf('user-1')
const account = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const category = 'aaaaaaaa-0000-4000-8000-000000000002'

function lunch(changes: object = {}) {
  return expenseOf(
    { occurredOn: '2026-11-25', occurredTime: '13:05', accountId: account, categoryId: category, amount: 25000 },
    { payee: '김밥천국', memo: '팀 점심', ...changes },
  )
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
  detail = startTransactionDetail(server, backend)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('상세(GET)', () => {
  it('장부 경로의 transactions/{id}로 한 번 요청하고 거래를 준다', async () => {
    const item = lunch()
    detail.put(item)
    const tab = await openSignedInTab()
    const found = await tab.fetchTransaction(ledgerId, String(item.id))
    expect(detail.requests.get).toHaveLength(1)
    expect(detail.requests.get[0]).toMatchObject({ ledgerId, id: item.id, user: 'user-1', query: '' })
    expect(found).toMatchObject({ id: item.id, memo: '팀 점심', createdBy: { displayName: 'user-1의 이름' } })
  })

  it('UUID가 아닌 id는 요청하지 않고 읽을 수 없는 값으로 끝낸다', async () => {
    const tab = await openSignedInTab()
    const error = await errorOf(tab.fetchTransaction(ledgerId, '../me'))
    expect(error).toMatchObject({ kind: 'server' })
    expect(detail.requests.get).toEqual([])
  })

  it('없는 거래는 404 NOT_FOUND 거부다', async () => {
    const tab = await openSignedInTab()
    const error = await errorOf(tab.fetchTransaction(ledgerId, String(lunch().id)))
    expect(error).toMatchObject({ kind: 'rejected', status: 404, code: 'NOT_FOUND' })
  })

  it.each([
    ['이체', () => transferOf({ occurredOn: '2026-11-25', fromAccountId: account, toAccountId: category, amount: 1 })],
    ['작성자가 탈퇴함', () => lunch({ createdBy: null })],
    ['메모 없음', () => lunch({ memo: null })],
    ['휴지통에 있음', () => lunch({ version: 2, ...trashed('2026-11-26T03:15:00.123Z') })],
  ])('약속대로인 거래(%s)를 받는다', async (_, make) => {
    const item = make()
    detail.put(item)
    const tab = await openSignedInTab()
    expect(await tab.fetchTransaction(ledgerId, String(item.id))).toEqual(item)
  })

  it.each([
    ['다른 거래의 id', { id: '01900000-0000-7000-8000-999999999999' }],
    ['작성자 항목이 없음', { createdBy: undefined }],
    ['작성자가 글자', { createdBy: 'user-1' }],
    ['메모가 숫자', { memo: 3 }],
    ['메모 항목이 없음', { memo: undefined }],
    ['purgeAt 항목이 없음', { purgeAt: undefined }],
    ['휴지통이 아닌데 purgeAt이 있음', { purgeAt: '2026-12-26T03:15:00.123Z' }],
    ['휴지통인데 purgeAt이 없음', { deletedAt: '2026-11-26T03:15:00.123Z', purgeAt: null }],
    ['purgeAt이 시각 모양이 아님', { deletedAt: '2026-11-26T03:15:00.123Z', purgeAt: '30일 뒤' }],
    ['purgeAt에 밀리초가 없음', { deletedAt: '2026-11-26T03:15:00.123Z', purgeAt: '2026-12-26T03:15:00Z' }],
    ['purgeAt이 없는 날', { deletedAt: '2026-11-26T03:15:00.123Z', purgeAt: '2026-02-30T03:15:00.123Z' }],
    ['금액이 소수', { amount: 1.5 }],
  ])('약속과 다른 응답(%s)은 받지 않는다', async (_, changes) => {
    const item = lunch()
    detail.getResponse = () => HttpResponse.json({ ...item, ...changes })
    const tab = await openSignedInTab()
    const error = await errorOf(tab.fetchTransaction(ledgerId, String(item.id)))
    expect(error).toMatchObject({ kind: 'server' })
  })
})

describe('삭제(DELETE)', () => {
  it('version을 쿼리로, 기기 값을 헤더로 싣고 본문 없이 한 번 보낸다', async () => {
    const item = lunch({ version: 3 })
    detail.put(item)
    const tab = await openSignedInTab()
    const deleted = await tab.deleteTransaction(ledgerId, String(item.id), 3, 'user-1')
    expect(detail.requests.delete).toHaveLength(1)
    expect(detail.requests.delete[0]).toMatchObject({
      ledgerId,
      id: item.id,
      user: 'user-1',
      query: 'version=3',
      device: 'iphone.safari',
      body: null,
    })
    expect(deleted).toMatchObject({ id: item.id, version: 4 })
    expect(deleted.deletedAt).not.toBeNull()
  })

  it('UUID가 아닌 id는 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    await errorOf(tab.deleteTransaction(ledgerId, 'abc', 1, 'user-1'))
    expect(detail.requests.delete).toEqual([])
  })

  it.each([
    ['다른 사용자가 시작함', 'user-2'],
    ['시작한 사용자를 모름', undefined],
  ])('보내는 순간의 사용자가 시작한 사용자와 다르면 보내지 않는다(%s)', async (_, startedBy) => {
    const item = lunch()
    detail.put(item)
    const tab = await openSignedInTab()
    await errorOf(tab.deleteTransaction(ledgerId, String(item.id), 1, startedBy))
    expect(detail.requests.delete).toEqual([])
  })

  it('로그아웃한 뒤에는 보내지 않는다', async () => {
    const item = lunch()
    detail.put(item)
    const tab = await openSignedInTab()
    tab.logout()
    await errorOf(tab.deleteTransaction(ledgerId, String(item.id), 1, 'user-1'))
    expect(detail.requests.delete).toEqual([])
  })

  it.each([
    ['다른 거래', { id: '01900000-0000-7000-8000-999999999999' }],
    ['휴지통에 없음', { deletedAt: null }],
    ['version이 없음', { version: undefined }],
  ])('약속과 다른 응답(%s)은 받지 않는다', async (_, changes) => {
    const item = lunch()
    detail.deleteResponse = () =>
      HttpResponse.json({ ...item, version: 2, ...trashed('2026-11-26T03:15:00.123Z'), ...changes })
    const tab = await openSignedInTab()
    const error = await errorOf(tab.deleteTransaction(ledgerId, String(item.id), 1, 'user-1'))
    expect(error).toMatchObject({ kind: 'server' })
  })
})

describe('복원(POST restore)', () => {
  it('본문에 version을 싣고 기기 값을 헤더로 한 번 보낸다', async () => {
    const item = lunch({ version: 4, ...trashed('2026-11-26T03:15:00.123Z') })
    detail.put(item)
    const tab = await openSignedInTab()
    const restored = await tab.restoreTransaction(ledgerId, String(item.id), 4, 'user-1')
    expect(detail.requests.restore).toHaveLength(1)
    expect(detail.requests.restore[0]).toMatchObject({
      id: item.id,
      user: 'user-1',
      query: '',
      device: 'iphone.safari',
      body: { version: 4 },
    })
    expect(restored).toMatchObject({ id: item.id, version: 5, deletedAt: null })
  })

  it('보내는 순간의 사용자가 시작한 사용자와 다르면 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    await errorOf(tab.restoreTransaction(ledgerId, String(lunch().id), 1, 'user-2'))
    expect(detail.requests.restore).toEqual([])
  })

  it('아직 휴지통에 있다는 응답은 받지 않는다', async () => {
    const item = lunch({ version: 2, ...trashed('2026-11-26T03:15:00.123Z') })
    detail.restoreResponse = () => HttpResponse.json(item)
    const tab = await openSignedInTab()
    const error = await errorOf(tab.restoreTransaction(ledgerId, String(item.id), 2, 'user-1'))
    expect(error).toMatchObject({ kind: 'server' })
  })
})

describe('거부의 뜻', () => {
  async function deleteError(response: () => Response) {
    const item = lunch()
    detail.deleteResponse = response
    const tab = await openSignedInTab()
    const error = await errorOf(tab.deleteTransaction(ledgerId, String(item.id), 1, 'user-1'))
    return { tab, error, item }
  }

  it('STALE_VERSION이고 current가 그 거래면 최신 거래를 준다', async () => {
    const latest = { ...lunch(), version: 2, amount: 30000 }
    const { tab, error } = await deleteError(() => problem(409, 'STALE_VERSION', { current: latest }))
    expect(tab.staleVersionOf(error, String(latest.id))).toEqual({ current: latest })
  })

  it('STALE_VERSION의 current가 다른 사람 휴지통 거래여도 그대로 준다', async () => {
    const latest = { ...lunch(), version: 2, ...trashed('2026-11-26T03:15:00.123Z') }
    const { tab, error } = await deleteError(() => problem(409, 'STALE_VERSION', { current: latest }))
    expect(tab.staleVersionOf(error, String(latest.id))?.current?.deletedAt).toBe('2026-11-26T03:15:00.123Z')
  })

  it.each([
    ['current가 없음', {}],
    ['current가 다른 거래', { current: { ...lunch(), id: '01900000-0000-7000-8000-999999999999' } }],
    ['current가 약속과 다름', { current: { id: 'x' } }],
  ])('STALE_VERSION인데 %s이면 최신 거래 없이 충돌이다', async (_, extension) => {
    const { tab, error, item } = await deleteError(() => problem(409, 'STALE_VERSION', extension))
    expect(tab.staleVersionOf(error, String(item.id))).toEqual({})
  })

  it('INVALID_STATE는 상태가 맞지 않는 거부다', async () => {
    const { tab, error, item } = await deleteError(() => problem(409, 'INVALID_STATE'))
    expect(tab.isInvalidState(error)).toBe(true)
    expect(tab.staleVersionOf(error, String(item.id))).toBeUndefined()
  })

  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['다른 409', () => problem(409, 'IN_USE')],
  ])('%s는 충돌도 상태 거부도 아니다', async (_, response) => {
    const { tab, error, item } = await deleteError(response)
    expect(tab.staleVersionOf(error, String(item.id))).toBeUndefined()
    expect(tab.isInvalidState(error)).toBe(false)
  })
})

describe('수정(PUT)', () => {
  const update = {
    type: 'EXPENSE',
    occurredOn: '2026-11-24',
    occurredTime: null,
    accountId: account,
    categoryId: null,
    amount: 30000,
    payee: '김밥나라',
    memo: null,
    version: 1,
  } as const

  it('본문에 거래 id 없이 version을 싣고 기기 값을 헤더로 한 번 보내 바뀐 거래를 준다', async () => {
    const item = lunch()
    detail.put(item)
    const tab = await openSignedInTab()
    const saved = await tab.updateTransaction(ledgerId, String(item.id), update, 'user-1')
    expect(detail.requests.update).toHaveLength(1)
    expect(detail.requests.update[0]).toMatchObject({
      ledgerId,
      id: item.id,
      user: 'user-1',
      query: '',
      device: 'iphone.safari',
    })
    expect(detail.requests.update[0].body).toEqual(update)
    expect(saved).toMatchObject({ id: item.id, version: 2, amount: 30000, payee: '김밥나라', occurredTime: null })
  })

  it('이체는 보내는 계좌와 받는 계좌로 보낸다', async () => {
    const item = transferOf({ occurredOn: '2026-11-25', fromAccountId: account, toAccountId: category, amount: 1 })
    detail.put(item)
    const tab = await openSignedInTab()
    const transfer = {
      type: 'TRANSFER',
      occurredOn: '2026-11-25',
      occurredTime: '09:00',
      fromAccountId: category,
      toAccountId: account,
      amount: 2,
      memo: '바꿈',
      version: 1,
    } as const
    await tab.updateTransaction(ledgerId, String(item.id), transfer, 'user-1')
    expect(detail.requests.update[0].body).toEqual(transfer)
  })

  it('UUID가 아닌 id는 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    await errorOf(tab.updateTransaction(ledgerId, '../me', update, 'user-1'))
    expect(detail.requests.update).toEqual([])
  })

  it.each([
    ['다른 사용자가 시작함', 'user-2'],
    ['시작한 사용자를 모름', undefined],
  ])('보내는 순간의 사용자가 시작한 사용자와 다르면 보내지 않는다(%s)', async (_, startedBy) => {
    const item = lunch()
    detail.put(item)
    const tab = await openSignedInTab()
    await errorOf(tab.updateTransaction(ledgerId, String(item.id), update, startedBy))
    expect(detail.requests.update).toEqual([])
  })

  it('로그아웃한 뒤에는 보내지 않는다', async () => {
    const item = lunch()
    detail.put(item)
    const tab = await openSignedInTab()
    tab.logout()
    await errorOf(tab.updateTransaction(ledgerId, String(item.id), update, 'user-1'))
    expect(detail.requests.update).toEqual([])
  })

  it.each([
    ['다른 거래', { id: '01900000-0000-7000-8000-999999999999' }],
    ['휴지통에 있음', trashed('2026-11-26T03:15:00.123Z')],
    ['메모 항목이 없음', { memo: undefined }],
    ['version이 없음', { version: undefined }],
    ['금액이 글자', { amount: '30000' }],
  ])('약속과 다른 응답(%s)은 받지 않는다', async (_, changes) => {
    const item = lunch()
    detail.updateResponse = () => HttpResponse.json({ ...item, version: 2, ...changes })
    const tab = await openSignedInTab()
    const error = await errorOf(tab.updateTransaction(ledgerId, String(item.id), update, 'user-1'))
    expect(error).toMatchObject({ kind: 'server' })
  })

  it('낡은 version이면 409 STALE_VERSION이고 최신 거래(current)를 준다', async () => {
    const item = lunch({ version: 3 })
    detail.put(item)
    const tab = await openSignedInTab()
    const error = await errorOf(tab.updateTransaction(ledgerId, String(item.id), update, 'user-1'))
    expect(tab.staleVersionOf(error, String(item.id))).toEqual({ current: item })
  })

  it('version이 맞는데 휴지통에 있으면 409 INVALID_STATE다', async () => {
    const item = lunch(trashed('2026-11-26T03:15:00.123Z'))
    detail.put(item)
    const tab = await openSignedInTab()
    const error = await errorOf(tab.updateTransaction(ledgerId, String(item.id), update, 'user-1'))
    expect(tab.isInvalidState(error)).toBe(true)
  })
})
