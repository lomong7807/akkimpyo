import { afterEach, describe, expect, it, vi } from 'vitest'

/*
 * 보내지 않은 새 거래의 대기열(ADR 006 결정 6, #234 B). 저장소는 tests/support/setup.ts가 테스트마다 비운다.
 * 모듈을 새로 불러와 탭마다 연결이 따로인 것을 흉내 낸다.
 */

async function openQueue() {
  vi.resetModules()
  return {
    queue: await import('../src/device/pendingQueue'),
    db: await import('../src/device/deviceDb'),
  }
}

const AT = Date.parse('2026-11-26T12:00:00+09:00')
const LEDGER = '1ed9e700-0000-4000-8000-000000000001'
const id = (n: number) => `0193a000-0000-7000-8000-${String(n).padStart(12, '0')}`

function expense(n: number) {
  return {
    id: id(n),
    type: 'EXPENSE' as const,
    occurredOn: '2026-11-26',
    occurredTime: null,
    accountId: '11111111-1111-4111-8111-111111111111',
    categoryId: null,
    amount: 12000,
    payee: '점심',
    memo: null,
  }
}

const item = (n: number, userId = 'user-1', queuedAt = AT) => ({ userId, ledgerId: LEDGER, body: expense(n), queuedAt })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('쌓기와 읽기', () => {
  it('항목마다 거래 id, 장부 id, 입력한 사용자 id, 쌓은 시각, 상태(대기), 보낼 요청 내용을 남긴다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    expect(await queue.pendingOf('user-1')).toEqual([
      { schema: 1, userId: 'user-1', id: id(1), ledgerId: LEDGER, queuedAt: AT, state: { kind: 'waiting' }, body: expense(1) },
    ])
  })

  it('같은 거래 id로 다시 쌓으면 한 줄로 덮어쓴다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    await queue.queueTransaction({ ...item(1), body: { ...expense(1), amount: 15000 } })
    const rows = await queue.pendingOf('user-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].body.amount).toBe(15000)
  })

  it('오래된 것부터 주고, 같은 시각이면 거래 id 순서다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(3, 'user-1', AT + 1))
    await queue.queueTransaction(item(2, 'user-1', AT))
    await queue.queueTransaction(item(1, 'user-1', AT))
    expect((await queue.pendingOf('user-1')).map((row) => row.id)).toEqual([id(1), id(2), id(3)])
  })

  it('사용자마다 나눈다. 다른 사용자의 항목은 주지 않는다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1, 'user-1'))
    await queue.queueTransaction(item(2, 'user-2'))
    expect((await queue.pendingOf('user-1')).map((row) => row.id)).toEqual([id(1)])
    expect((await queue.pendingOf('user-2')).map((row) => row.id)).toEqual([id(2)])
  })

  it.each<[string, Record<string, unknown>]>([
    ['거래 id가 UUID가 아님', { id: 'x' }],
    ['장부 id가 UUID가 아님', { ledgerId: 'x' }],
    ['쌓은 시각이 정수가 아님', { queuedAt: 1.5 }],
    ['상태를 모름', { state: { kind: 'sending' } }],
    ['본문의 거래 id가 다름', { body: expense(9) }],
    ['본문의 유형을 모름', { body: { ...expense(1), type: 'LOAN' } }],
  ])('모양이 틀린 줄(%s)은 없는 것으로 본다', async (_, broken) => {
    const { queue, db } = await openQueue()
    const row = { schema: 1, userId: 'user-1', id: id(1), ledgerId: LEDGER, queuedAt: AT, state: { kind: 'waiting' }, body: expense(1), ...broken }
    await db.transact(['queue'], 'readwrite', (transaction) => void transaction.objectStore('queue').put(row))
    expect(await queue.pendingOf('user-1')).toEqual([])
  })
})

describe('건수, 보낼 수 없음, 지우기(#235, #236이 쓴다)', () => {
  const rejection = { status: 400, code: 'VALIDATION_FAILED', fieldErrors: [{ field: 'amount', code: 'OUT_OF_RANGE' }], at: AT }

  it('사용자의 대기와 보낼 수 없음을 따로 센다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    await queue.queueTransaction(item(2))
    await queue.queueTransaction(item(3, 'user-2'))
    const [, second] = await queue.pendingOf('user-1')
    await queue.settlePending(second, { kind: 'rejected', ...rejection })
    expect(await queue.countPending('user-1')).toEqual({ waiting: 1, rejected: 1 })
    expect(await queue.countPending('user-2')).toEqual({ waiting: 1, rejected: 0 })
  })

  it('보낼 수 없음으로 바꾸면 이유와 받은 current를 남긴다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    const conflict = { status: 409, code: 'ID_CONFLICT', fieldErrors: [], current: { id: id(1), version: 1 }, at: AT }
    const [seen] = await queue.pendingOf('user-1')
    expect(await queue.settlePending(seen, { kind: 'rejected', ...conflict })).toBe(true)
    expect((await queue.pendingOf('user-1'))[0].state).toEqual({ kind: 'rejected', ...conflict })
  })

  it('보내기에 성공하면 그 항목만 지운다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    await queue.queueTransaction(item(2))
    const [first] = await queue.pendingOf('user-1')
    expect(await queue.settlePending(first, { kind: 'sent' })).toBe(true)
    expect((await queue.pendingOf('user-1')).map((row) => row.id)).toEqual([id(2)])
  })

  it('보낼 때 본 줄과 지금 줄이 다르면(다른 탭이 고쳐 쌓음) 지우지도 바꾸지도 않는다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    const [seen] = await queue.pendingOf('user-1')
    await queue.queueTransaction({ ...item(1), body: { ...expense(1), amount: 15000 } })
    expect(await queue.settlePending(seen, { kind: 'sent' })).toBe(false)
    expect(await queue.settlePending(seen, { kind: 'rejected', ...rejection })).toBe(false)
    const [now] = await queue.pendingOf('user-1')
    expect(now.body.amount).toBe(15000)
    expect(now.state).toEqual({ kind: 'waiting' })
  })

  it('그사이 다른 탭이 보낼 수 없음으로 바꿨으면 지우지 않는다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    const [seen] = await queue.pendingOf('user-1')
    await queue.settlePending(seen, { kind: 'rejected', ...rejection })
    expect(await queue.settlePending(seen, { kind: 'sent' })).toBe(false)
    expect(await queue.countPending('user-1')).toEqual({ waiting: 0, rejected: 1 })
  })

  it('그사이 버린 항목은 되살리지 않는다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    const [seen] = await queue.pendingOf('user-1')
    await queue.removePending('user-1', id(1))
    expect(await queue.settlePending(seen, { kind: 'rejected', ...rejection })).toBe(false)
    expect(await queue.pendingOf('user-1')).toEqual([])
  })

  it('보내기 직전에 그 항목을 다시 읽는다. 없거나 모양이 틀리면 없다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    expect(await queue.readPending('user-1', id(1))).toEqual((await queue.pendingOf('user-1'))[0])
    expect(await queue.readPending('user-2', id(1))).toBeUndefined()
    expect(await queue.readPending('user-1', id(2))).toBeUndefined()
  })

  it('버리기는 그 항목만 지운다', async () => {
    const { queue } = await openQueue()
    await queue.queueTransaction(item(1))
    await queue.queueTransaction(item(2))
    await queue.removePending('user-1', id(1))
    expect((await queue.pendingOf('user-1')).map((row) => row.id)).toEqual([id(2)])
  })

  it('저장소를 쓸 수 없으면 쌓기가 실패한다(부른 쪽이 문구를 보인다)', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const { queue, db } = await openQueue()
    await expect(queue.queueTransaction(item(1))).rejects.toBeInstanceOf(db.DeviceUnavailable)
  })
})

describe('바뀜 알림', () => {
  it('같은 탭과 다른 탭에 대기열이 바뀌었다는 것만 알린다(security: 내용은 싣지 않는다)', async () => {
    const sent: unknown[] = []
    const watcher = new BroadcastChannel('akkimpyo-device')
    watcher.onmessage = ({ data }) => sent.push(data)
    const { queue } = await openQueue()
    const here = vi.fn()
    const stop = queue.onPendingChanged(here)
    await queue.queueTransaction(item(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(here).toHaveBeenCalled()
    expect(sent).toEqual([{ changed: 'queue' }])
    stop()
    watcher.close()
  })

  it('다른 탭이 쌓으면 이 탭에 알린다', async () => {
    const { queue } = await openQueue()
    const here = vi.fn()
    const stop = queue.onPendingChanged(here)
    const other = new BroadcastChannel('akkimpyo-device')
    other.postMessage({ changed: 'queue' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(here).toHaveBeenCalledTimes(1)
    other.postMessage({ changed: 'something-else' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(here).toHaveBeenCalledTimes(1)
    stop()
    other.close()
  })
})
