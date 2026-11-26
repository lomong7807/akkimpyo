import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ledgerIdOf, startBackend, delayed, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { credentials } from './support/sessionTab'
import { savedOf, startTransactions, type Transactions } from './support/transactions'
import { createFakeLocks, installLocks, removeLocks } from './support/webLocks'

/*
 * 쌓인 입력 보내기 한 번(F-105, ADR 006 결정 6, #235). 오래된 것부터 하나씩 보내고 응답마다 대기열의 줄을 바꾼다.
 * 응답 처리는 결정 6의 표를 줄마다 본다. 탭 사이 잠금(architect #235 B), 보낼 때 본 줄과 같을 때만 바꾸기(C),
 * 사용자 비교(D, security #79)도 본다.
 */

const server = startMockServer()
let backend: Backend
let transactions: Transactions

const NOW = '2026-11-26T12:00:00+09:00'
const T = Date.parse(NOW)
const LEDGER = ledgerIdOf('user-1')
const OTHER_LEDGER = '1ed9e700-0000-4000-8000-0000000000ff'
const id = (n: number) => `0193a000-0000-7000-8000-${String(n).padStart(12, '0')}`

function expense(n: number, fields: object = {}) {
  return {
    id: id(n),
    type: 'EXPENSE' as const,
    occurredOn: '2026-11-26',
    occurredTime: null,
    accountId: '11111111-1111-4111-8111-111111111111',
    categoryId: null,
    amount: 1000 * n,
    payee: `입력 ${n}`,
    memo: null,
    ...fields,
  }
}

const item = (n: number, { userId = 'user-1', ledgerId = LEDGER, queuedAt = T + n } = {}) => ({
  userId,
  ledgerId,
  body: expense(n),
  queuedAt,
})

/** 탭 하나. 세션, 대기열, 보내기 모듈을 새로 불러와 함께 쓴다. 저장소와 잠금은 다른 탭과 함께 쓴다. */
async function openTab({ signIn = true } = {}) {
  vi.resetModules()
  const session = await import('../src/api/session')
  const pending = await import('../src/device/pendingQueue')
  const synced = await import('../src/device/syncedAt')
  const { sendQueue, onSendFinished } = await import('../src/features/sync/sendQueue')
  const { discardPending } = await import('../src/features/pending/discardPending')
  if (signIn) await session.login(credentials)
  return { session, pending, synced, sendQueue, onSendFinished, discardPending }
}

type Tab = Awaited<ReturnType<typeof openTab>>

const states = async (tab: Tab, userId = 'user-1') =>
  (await tab.pending.pendingOf(userId)).map(({ id: rowId, state }) => [rowId, state.kind])

const sentIds = () => transactions.sent.map(({ body }) => body.id)

beforeEach(() => {
  setDeviceClock(NOW)
  installLocks(createFakeLocks())
  backend = startBackend(server)
  transactions = startTransactions(server, backend)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('보내는 순서', () => {
  it('대기인 입력을 오래된 것부터 하나씩 보내고, 받은 거래 id의 장부 경로로 보낸다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(2, { queuedAt: T + 20 }))
    await tab.pending.queueTransaction(item(1, { queuedAt: T + 10, ledgerId: OTHER_LEDGER }))
    await tab.pending.queueTransaction(item(3, { queuedAt: T + 30 }))
    await tab.sendQueue()
    expect(sentIds()).toEqual([id(1), id(2), id(3)])
    expect(transactions.sent.map(({ ledgerId }) => ledgerId)).toEqual([OTHER_LEDGER, LEDGER, LEDGER])
    expect(transactions.sent[0].body).toEqual(expense(1))
  })

  it('하나가 실패해도(서버 오류) 다음 것을 보낸다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.pending.queueTransaction(item(2))
    transactions.response = (sent) =>
      sent.body.id === id(1) ? problem(500, 'INTERNAL_ERROR') : HttpResponse.json(savedOf(sent.body), { status: 201 })
    await tab.sendQueue()
    expect(sentIds()).toEqual([id(1), id(2)])
    expect(await states(tab)).toEqual([[id(1), 'waiting']])
  })

  it('보낼 수 없음인 입력은 저절로 다시 보내지 않는다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    transactions.response = () => problem(400, 'VALIDATION_FAILED')
    await tab.sendQueue()
    await tab.sendQueue()
    expect(sentIds()).toEqual([id(1)])
    expect(await states(tab)).toEqual([[id(1), 'rejected']])
  })

  it('보낸 장부마다 알린다(그 장부의 서버 데이터를 무효로 만든다)', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1, { ledgerId: OTHER_LEDGER }))
    await tab.pending.queueTransaction(item(2))
    const onSent = vi.fn()
    await tab.sendQueue({ onSent })
    expect(onSent.mock.calls).toEqual([[OTHER_LEDGER], [LEDGER]])
  })
})

describe('응답 처리(결정 6의 표)', () => {
  it.each([
    ['201', 201],
    ['200(이미 만들어짐)', 200],
  ])('%s이면 대기열에서 지우고 마지막으로 맞춘 시각을 고친다', async (_, status) => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    transactions.response = (sent) => HttpResponse.json(savedOf(sent.body), { status })
    setDeviceClock('2026-11-26T12:05:00+09:00')
    await tab.sendQueue()
    expect(await states(tab)).toEqual([])
    expect(await tab.synced.readSyncedAt('user-1')).toBe(Date.parse('2026-11-26T12:05:00+09:00'))
  })

  it.each([
    [400, 'VALIDATION_FAILED'],
    [403, 'FORBIDDEN'],
    [403, 'NO_LONGER_MEMBER'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [409, 'ID_CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
  ])('problem+json이고 code가 있는 %i(%s)이면 보낼 수 없음과 이유로 바꾼다', async (status, code) => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const fieldErrors = [{ field: 'amount', code: 'OUT_OF_RANGE' }]
    transactions.response = () => problem(status, code, { fieldErrors: [{ ...fieldErrors[0], message: '개발자용' }] })
    await tab.sendQueue()
    const [row] = await tab.pending.pendingOf('user-1')
    expect(row.state).toEqual({ kind: 'rejected', status, code, fieldErrors, at: T })
    expect(await tab.synced.readSyncedAt('user-1')).toBeUndefined()
  })

  it('current가 없는 409 ID_CONFLICT는 보낼 수 없음이고 current를 남기지 않는다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    transactions.response = () => problem(409, 'ID_CONFLICT')
    await tab.sendQueue()
    const [row] = await tab.pending.pendingOf('user-1')
    expect(row.state).not.toHaveProperty('current')
  })

  it('current가 있는 409 ID_CONFLICT도 보낼 수 없음이고 받은 current를 남긴다(선택 화면은 #239·#236)', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const current = savedOf(expense(1, { amount: 9999 }))
    transactions.response = () => problem(409, 'ID_CONFLICT', { current })
    await tab.sendQueue()
    const [row] = await tab.pending.pendingOf('user-1')
    expect(row.state).toMatchObject({ kind: 'rejected', status: 409, code: 'ID_CONFLICT', current })
  })

  it.each([
    ['서버 오류(500)', () => problem(500, 'INTERNAL_ERROR')],
    ['서버 오류(503, 본문 없음)', () => new HttpResponse(null, { status: 503 })],
    ['code가 없는 problem+json 400', () => HttpResponse.json({ title: '잘못된 요청' }, { status: 400, headers: { 'Content-Type': 'application/problem+json' } })],
    ['프록시가 낸 403(HTML)', () => new HttpResponse('<html>막힘</html>', { status: 403, headers: { 'Content-Type': 'text/html' } })],
    ['읽을 수 없는 problem+json 409', () => new HttpResponse('{', { status: 409, headers: { 'Content-Type': 'application/problem+json' } })],
    ['code가 있는 429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['code가 없는 401(프록시)', () => new HttpResponse('', { status: 401 })],
    ['본문을 읽을 수 없는 201', () => new HttpResponse('저장함', { status: 201, headers: { 'Content-Type': 'application/json' } })],
    ['약속과 다른 200', () => HttpResponse.json({ id: id(1) }, { status: 200 })],
  ])('%s이면 대기로 남긴다', async (_, respond) => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    transactions.response = respond
    await tab.sendQueue()
    expect(await states(tab)).toEqual([[id(1), 'waiting']])
  })

  it('연결 오류면 대기로 남기고, 남은 입력은 이번에 보내지 않는다(다시 연결되면 처음부터)', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.pending.queueTransaction(item(2))
    transactions.response = () => HttpResponse.error()
    await tab.sendQueue()
    expect(sentIds()).toEqual([id(1)])
    expect(await states(tab)).toEqual([
      [id(1), 'waiting'],
      [id(2), 'waiting'],
    ])
  })
})

describe('429와 Retry-After', () => {
  function tooMany(retryAfter?: string) {
    const response = problem(429, 'TOO_MANY_REQUESTS')
    if (retryAfter !== undefined) response.headers.set('Retry-After', retryAfter)
    return response
  }

  async function rateLimited(retryAfter?: string) {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.pending.queueTransaction(item(2))
    transactions.response = () => tooMany(retryAfter)
    await tab.sendQueue()
    transactions.response = undefined
    return tab
  }

  /** 지금 시각을 `ms` 뒤로 옮겨 다시 보낸다. 보낸 요청 수를 준다 */
  async function sendAfter(tab: Tab, ms: number) {
    const before = transactions.sent.length
    setDeviceClock(new Date(T + ms).toISOString())
    await tab.sendQueue()
    return transactions.sent.length - before
  }

  it('대기로 남기고 이번 보내기를 멈춘다', async () => {
    const tab = await rateLimited('30')
    expect(sentIds()).toEqual([id(1)])
    expect(await states(tab)).toEqual([
      [id(1), 'waiting'],
      [id(2), 'waiting'],
    ])
  })

  it('Retry-After(초)가 지나기 전에는 보내지 않고, 지나면 보낸다', async () => {
    const tab = await rateLimited('30')
    expect(await sendAfter(tab, 29_000)).toBe(0)
    expect(await sendAfter(tab, 30_000)).toBe(2)
    expect(await states(tab)).toEqual([])
  })

  it('Retry-After가 HTTP 날짜여도 따른다', async () => {
    const tab = await rateLimited(new Date(T + 120_000).toUTCString())
    expect(await sendAfter(tab, 119_000)).toBe(0)
    expect(await sendAfter(tab, 120_000)).toBe(2)
  })

  it.each([
    ['없으면', undefined],
    ['읽을 수 없으면', 'soon'],
  ])('Retry-After가 %s 1분 기다린다', async (_, retryAfter) => {
    const tab = await rateLimited(retryAfter)
    expect(await sendAfter(tab, 59_000)).toBe(0)
    expect(await sendAfter(tab, 60_000)).toBe(2)
  })

  it('기다림은 15분을 넘지 않는다(architect #235 E)', async () => {
    const tab = await rateLimited('86400')
    expect(await sendAfter(tab, 15 * 60_000 - 1000)).toBe(0)
    expect(await sendAfter(tab, 15 * 60_000)).toBe(2)
  })
})

describe('401과 갱신', () => {
  it('토큰이 만료됐으면 갱신해 한 번 다시 보내고, 성공하면 지운다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    backend.expireTokens()
    await tab.sendQueue()
    expect(transactions.sent.map(({ user }) => user)).toEqual([undefined, 'user-1'])
    expect(backend.requests.refresh).toHaveLength(1)
    expect(await states(tab)).toEqual([])
  })

  it('갱신 요청이 401이면 대기로 남긴 채 로그인을 요구하고 멈춘다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.pending.queueTransaction(item(2))
    const ended = vi.fn()
    tab.session.onSessionEnded(ended)
    backend.expireTokens()
    backend.cookieUser = undefined
    await tab.sendQueue()
    expect(ended).toHaveBeenCalledWith('ended')
    expect(sentIds()).toEqual([id(1)])
    expect(await states(tab)).toEqual([
      [id(1), 'waiting'],
      [id(2), 'waiting'],
    ])
  })

  it.each([
    ['연결 문제', () => HttpResponse.error()],
    ['서버 오류(5xx)', () => problem(500, 'INTERNAL_ERROR')],
  ])('갱신이 %s로 실패하면 대기로 남기고 로그인을 요구하지 않는다', async (_, respond) => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const ended = vi.fn()
    tab.session.onSessionEnded(ended)
    backend.expireTokens()
    backend.refreshResponse = respond
    await tab.sendQueue()
    expect(ended).not.toHaveBeenCalled()
    expect(await states(tab)).toEqual([[id(1), 'waiting']])
  })
})

describe('200의 알림(ADR 006 결정 3)', () => {
  async function noticedFor(changes: object, { removePaidBy = false } = {}) {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    transactions.response = (sent) => {
      const saved: Record<string, unknown> = savedOf(sent.body, 'user-1', changes)
      if (removePaidBy) delete saved.paidBy
      return HttpResponse.json(saved, { status: 200 })
    }
    return (await tab.sendQueue()).noticed
  }

  it.each([
    ['version이 2 이상', { version: 2 }],
    ['휴지통에 있음', { deletedAt: '2026-11-26T04:00:00Z' }],
    ['취소 상태', { status: 'CANCELED' }],
    ['지출인데 결제한 사람이 null', { paidBy: null }],
  ])('%s이면 알린다', async (_, changes) => {
    expect(await noticedFor(changes)).toBe(1)
  })

  it('고쳐지지 않은 거래의 재전송(version 1, 결제한 사람 있음)은 알리지 않는다', async () => {
    expect(await noticedFor({})).toBe(0)
  })

  it('결제한 사람 항목이 응답에 없는 것은 null과 다르다. 알리지 않는다', async () => {
    expect(await noticedFor({}, { removePaidBy: true })).toBe(0)
  })

  it('201은 알리지 않는다. 한 번의 보내기에서 알릴 건수를 모아 준다', async () => {
    const tab = await openTab()
    for (const n of [1, 2, 3]) await tab.pending.queueTransaction(item(n))
    transactions.response = (sent) =>
      sent.body.id === id(1)
        ? HttpResponse.json(savedOf(sent.body), { status: 201 })
        : HttpResponse.json(savedOf(sent.body, 'user-1', { version: 3 }), { status: 200 })
    expect(await tab.sendQueue()).toEqual({ noticed: 2, sent: 3, rejected: 0, unsent: 0 })
  })
})

describe('사용자 비교(결정 6, security #79)', () => {
  it('지금 토큰의 사용자가 쌓은 입력만 보낸다. 다른 사용자의 입력은 보내지도 지우지도 않는다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1, { userId: 'user-2' }))
    await tab.pending.queueTransaction(item(2))
    await tab.sendQueue()
    expect(sentIds()).toEqual([id(2)])
    expect(await states(tab, 'user-2')).toEqual([[id(1), 'waiting']])
  })

  it('토큰이 없으면(로그인하지 않았거나 확인하지 못한 로그인) 보내지 않는다', async () => {
    const tab = await openTab({ signIn: false })
    await tab.pending.queueTransaction(item(1))
    await tab.sendQueue()
    expect(transactions.sent).toEqual([])
    expect(backend.requests.refresh).toEqual([])
  })

  it('보내는 사이 다른 계정으로 로그인했으면 남은 입력을 보내지 않고 지우지도 않는다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.pending.queueTransaction(item(2))
    const first = delayed()
    transactions.response = (sent) => (sent.body.id === id(1) ? first.respond() : HttpResponse.json(savedOf(sent.body), { status: 201 }))
    const sending = tab.sendQueue()
    await first.arrived
    backend.loginUser = 'user-2'
    await tab.session.login(credentials)
    first.answer(HttpResponse.json(savedOf(expense(1)), { status: 201 }))
    await sending
    expect(sentIds()).toEqual([id(1)])
    // 앞 요청은 user-1의 토큰으로 서버에 저장됐으므로 지운다. 둘째는 user-1의 것이라 user-2로 보내지 않는다
    expect(await states(tab)).toEqual([[id(2), 'waiting']])
  })
})

describe('탭 사이(architect #235 B, C)', () => {
  it('두 탭이 함께 보내기를 시작해도 같은 입력은 한 번만 보낸다', async () => {
    const one = await openTab()
    const two = await openTab()
    await one.pending.queueTransaction(item(1))
    await one.pending.queueTransaction(item(2))
    const first = delayed()
    transactions.response = (sent) => (sent.body.id === id(1) ? first.respond() : HttpResponse.json(savedOf(sent.body), { status: 201 }))
    const sendingOne = one.sendQueue()
    await first.arrived
    await two.sendQueue()
    first.answer(HttpResponse.json(savedOf(expense(1)), { status: 201 }))
    await sendingOne
    await two.sendQueue()
    expect(sentIds()).toEqual([id(1), id(2)])
    expect(await states(one)).toEqual([])
  })

  it('잠금 기능이 없는 브라우저에서도 보낸다', async () => {
    removeLocks()
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.sendQueue()
    expect(await states(tab)).toEqual([])
    installLocks(createFakeLocks())
  })

  it('보내는 사이 다른 탭이 그 입력을 고쳐 다시 쌓았으면, 응답을 받아도 그 줄을 지우지 않는다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const first = delayed()
    transactions.response = () => first.respond()
    const sending = tab.sendQueue()
    await first.arrived
    const other = await import('../src/device/pendingQueue')
    await other.queueTransaction({ ...item(1), body: expense(1, { amount: 777 }) })
    first.answer(HttpResponse.json(savedOf(expense(1)), { status: 201 }))
    await sending
    const [row] = await tab.pending.pendingOf('user-1')
    expect(row.body.amount).toBe(777)
    expect(row.state).toEqual({ kind: 'waiting' })
  })

  it('보내는 사이 다른 탭이 보낼 수 없음으로 바꾼 줄을 응답(서버 오류)으로 덮지 않는다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const first = delayed()
    transactions.response = () => first.respond()
    const sending = tab.sendQueue()
    await first.arrived
    const [seen] = await tab.pending.pendingOf('user-1')
    await tab.pending.settlePending(seen, { kind: 'rejected', status: 403, code: 'FORBIDDEN', fieldErrors: [], at: T })
    first.answer(problem(400, 'VALIDATION_FAILED'))
    await sending
    const [row] = await tab.pending.pendingOf('user-1')
    expect(row.state).toMatchObject({ kind: 'rejected', code: 'FORBIDDEN' })
  })

  it('차례가 오기 전에 버린 입력은 보내지 않는다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.pending.queueTransaction(item(2))
    const first = delayed()
    transactions.response = (sent) => (sent.body.id === id(1) ? first.respond() : HttpResponse.json(savedOf(sent.body), { status: 201 }))
    const sending = tab.sendQueue()
    await first.arrived
    await tab.pending.removePending('user-1', id(2))
    first.answer(HttpResponse.json(savedOf(expense(1)), { status: 201 }))
    await sending
    expect(sentIds()).toEqual([id(1)])
  })
})

describe('보내기 한 번의 결과(B-05 지금 보내기, #236)', () => {
  it('보낸 건수, 서버가 거부한 건수를 준다. 모두 끝났으면 멈춘 까닭이 없다', async () => {
    const tab = await openTab()
    for (const n of [1, 2, 3]) await tab.pending.queueTransaction(item(n))
    transactions.response = (sent) =>
      sent.body.id === id(2) ? problem(400, 'VALIDATION_FAILED') : HttpResponse.json(savedOf(sent.body), { status: 201 })
    expect(await tab.sendQueue({ byUser: true })).toEqual({ noticed: 0, sent: 2, rejected: 1, unsent: 0 })
  })

  it('보내던 중 연결이 끊기면 그 줄과 남은 대기 건수를 주고 까닭은 connection이다', async () => {
    const tab = await openTab()
    for (const n of [1, 2, 3, 4]) await tab.pending.queueTransaction(item(n))
    transactions.response = (sent) =>
      sent.body.id === id(2) ? HttpResponse.error() : HttpResponse.json(savedOf(sent.body), { status: 201 })
    expect(await tab.sendQueue({ byUser: true })).toEqual({ noticed: 0, sent: 1, rejected: 0, unsent: 3, stopped: 'connection' })
    expect(await states(tab)).toEqual([
      [id(2), 'waiting'],
      [id(3), 'waiting'],
      [id(4), 'waiting'],
    ])
  })

  it('서버 오류(5xx)면 그 줄은 대기로 남고 다음 줄을 보낸다. 까닭은 trouble이다', async () => {
    const tab = await openTab()
    for (const n of [1, 2]) await tab.pending.queueTransaction(item(n))
    transactions.response = (sent) =>
      sent.body.id === id(1) ? problem(503, 'INTERNAL_ERROR') : HttpResponse.json(savedOf(sent.body), { status: 201 })
    expect(await tab.sendQueue({ byUser: true })).toEqual({ noticed: 0, sent: 1, rejected: 0, unsent: 1, stopped: 'trouble' })
  })

  it('서버 오류 뒤에 연결이 끊기면 까닭은 connection이고 둘 다 센다', async () => {
    const tab = await openTab()
    for (const n of [1, 2, 3]) await tab.pending.queueTransaction(item(n))
    transactions.response = (sent) => (sent.body.id === id(1) ? problem(500, 'INTERNAL_ERROR') : HttpResponse.error())
    expect(await tab.sendQueue({ byUser: true })).toMatchObject({ sent: 0, unsent: 3, stopped: 'connection' })
  })

  it('429면 남은 줄을 보내지 않고 trouble이다. 기다리는 동안 다시 누르면 보내지 않고 trouble이다', async () => {
    const tab = await openTab()
    for (const n of [1, 2]) await tab.pending.queueTransaction(item(n))
    transactions.response = () => problem(429, 'TOO_MANY_REQUESTS')
    expect(await tab.sendQueue({ byUser: true })).toMatchObject({ sent: 0, unsent: 2, stopped: 'trouble' })
    transactions.response = undefined
    expect(await tab.sendQueue({ byUser: true })).toMatchObject({ sent: 0, stopped: 'trouble' })
    expect(sentIds()).toEqual([id(1)])
  })

  it('토큰이 없으면(확인하지 못한 로그인) 지금 보내기는 trouble로 끝난다', async () => {
    const tab = await openTab({ signIn: false })
    await tab.pending.queueTransaction(item(1))
    expect(await tab.sendQueue({ byUser: true })).toMatchObject({ sent: 0, stopped: 'trouble' })
    expect(transactions.sent).toEqual([])
  })

  it('끝날 때마다 사용자가 눌렀는지와 함께 알린다. 다른 탭이 보내는 중이라 건너뛴 저절로 보내기는 알리지 않는다', async () => {
    const one = await openTab()
    const two = await openTab()
    await one.pending.queueTransaction(item(1))
    const finished: [number, boolean][] = []
    one.onSendFinished((result, byUser) => finished.push([result.sent, byUser]))
    two.onSendFinished((result, byUser) => finished.push([result.sent, byUser]))
    const first = delayed()
    transactions.response = () => first.respond()
    const sending = two.sendQueue()
    await first.arrived
    await one.sendQueue()
    first.answer(HttpResponse.json(savedOf(expense(1)), { status: 201 }))
    await sending
    await one.sendQueue({ byUser: true })
    expect(finished).toEqual([
      [1, false],
      [0, true],
    ])
  })
})

describe('지금 보내기와 탭 사이 잠금(#236)', () => {
  it('다른 탭이 보내는 중이면 건너뛰지 않고 끝나기를 기다렸다가 남은 것을 보낸다', async () => {
    const one = await openTab()
    const two = await openTab()
    await one.pending.queueTransaction(item(1))
    await one.pending.queueTransaction(item(2))
    const first = delayed()
    let secondTries = 0
    transactions.response = (sent) => {
      if (sent.body.id === id(1)) return first.respond()
      secondTries += 1
      // 다른 탭이 보낼 때는 서버 오류로 대기에 남고, 이 탭이 기다렸다가 다시 보내면 받는다
      return secondTries === 1 ? problem(503, 'INTERNAL_ERROR') : HttpResponse.json(savedOf(sent.body), { status: 201 })
    }
    const auto = two.sendQueue()
    await first.arrived
    const now = one.sendQueue({ byUser: true })
    first.answer(HttpResponse.json(savedOf(expense(1)), { status: 201 }))
    await auto
    expect(await now).toEqual({ noticed: 0, sent: 1, rejected: 0, unsent: 0 })
    expect(sentIds()).toEqual([id(1), id(2), id(2)])
    expect(await states(one)).toEqual([])
  })

  it('다른 탭이 잠금을 쥔 채 15초 안에 놓지 않으면 보내지 않고 trouble로 끝난다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const held = Promise.withResolvers<void>()
    void navigator.locks.request('akkimpyo-queue', {}, () => held.promise)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const sending = tab.sendQueue({ byUser: true })
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await sending).toMatchObject({ sent: 0, stopped: 'trouble' })
    } finally {
      vi.useRealTimers()
      held.resolve()
    }
    expect(transactions.sent).toEqual([])
  })
})

describe('버리기(F-109, #236)', () => {
  it('그 줄을 지운다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    await tab.pending.queueTransaction(item(2))
    expect(await tab.discardPending('user-1', id(1))).toBe('discarded')
    expect(await states(tab)).toEqual([[id(2), 'waiting']])
  })

  it('그 줄을 보내는 중이면 응답을 기다렸다가, 서버가 받았으면 지울 것이 없어 gone이다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const first = delayed()
    transactions.response = () => first.respond()
    const sending = tab.sendQueue()
    await first.arrived
    const discarding = tab.discardPending('user-1', id(1))
    first.answer(HttpResponse.json(savedOf(expense(1)), { status: 201 }))
    await sending
    expect(await discarding).toBe('gone')
    expect(await states(tab)).toEqual([])
  })

  it('보내는 중에 받은 응답이 서버 오류면 대기로 남은 그 줄을 지운다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const first = delayed()
    transactions.response = () => first.respond()
    const sending = tab.sendQueue()
    await first.arrived
    const discarding = tab.discardPending('user-1', id(1))
    first.answer(problem(500, 'INTERNAL_ERROR'))
    await sending
    expect(await discarding).toBe('discarded')
    expect(await states(tab)).toEqual([])
  })

  it('보낼 수 없음인 줄도 지운다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    transactions.response = () => problem(400, 'VALIDATION_FAILED')
    await tab.sendQueue()
    expect(await tab.discardPending('user-1', id(1))).toBe('discarded')
    expect(await states(tab)).toEqual([])
  })

  it('다른 탭이 잠금을 쥔 채 15초 안에 놓지 않으면 지우지 않고 QueueBusy를 던진다', async () => {
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    const held = Promise.withResolvers<void>()
    void navigator.locks.request('akkimpyo-queue', {}, () => held.promise)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const discarding = tab.discardPending('user-1', id(1)).catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(15_000)
      expect((await discarding) as Error).toMatchObject({ name: 'QueueBusy' })
    } finally {
      vi.useRealTimers()
      held.resolve()
    }
    expect(await states(tab)).toEqual([[id(1), 'waiting']])
  })

  it('잠금 기능이 없는 브라우저에서도 지운다', async () => {
    removeLocks()
    const tab = await openTab()
    await tab.pending.queueTransaction(item(1))
    expect(await tab.discardPending('user-1', id(1))).toBe('discarded')
    installLocks(createFakeLocks())
  })
})
