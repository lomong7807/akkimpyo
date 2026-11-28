import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { nowOnDevice, setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { copyKeys, forgetUser, ledgerCopy, seedLedgerCopy, seedLogin, seedMeCopy } from './support/device'
import { untilUnshielded } from './support/dialog'
import { wallTimeNow } from '../src/lib/clock'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { deviceNow, startEditServer } from './support/transactionEdit'
import { credentials } from './support/sessionTab'
import { expenseOf, pageOf, type TransactionList } from './support/transactionList'
import { id, LEDGER, openApp, resetGlobals, settle } from './support/transactionScreen'

/*
 * 기기에 남기는 장부의 최근 한 달 내역(P-902, ADR 006 결정 1, #238). 홈을 열면 받아 그 사용자·장부의 사본으로 통째로 남긴다.
 * 남기는 규칙과 지우는 때는 계좌·카테고리 사본(#234, LedgerCopies)과 같다: 보낼 때와 받은 뒤의 사용자가 같을 때만 남기고,
 * 로그아웃·장부를 볼 수 없게 됨에 지운다.
 */

const server = startMockServer()
let backend: Backend
let list: TransactionList

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  deviceNow()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, list } = startEditServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(async () => {
  cleanup()
  await untilUnshielded()
  resetGlobals()
})

// 임시(#292 CI 재현): 실패한 회의 기기 시계를 적는다. 뒤에 건 afterEach가 먼저 돌아 정리 전의 시계를 읽는다. ready 전에 되돌린다
let clockAtEnd = ''
afterEach(() => {
  clockAtEnd = `기기의 지금=${new Date(nowOnDevice()).toISOString()} 기기 시간대로 본 지금=${JSON.stringify(wallTimeNow())} 프로세스 시간대=${Intl.DateTimeFormat().resolvedOptions().timeZone}`
})
beforeEach(({ onTestFailed }) => onTestFailed(() => console.log(`[clock] ${clockAtEnd}`)))

const spend = (occurredOn: string, payee: string) =>
  expenseOf({ occurredOn, accountId: id.salary, categoryId: id.food, amount: 1000, payee })

/** 기록, 표시, 내 정보 사본이 맞는 기기 */
async function seedDevice() {
  const at = nowOnDevice()
  await seedLogin({ confirmedAt: at - DAY, loggedInAt: at - 10 * DAY })
  await seedMeCopy('user-1', meOf('user-1'), at - DAY)
}

async function openHome() {
  backend.cookieUser = 'user-1'
  const opened = await openApp('/home')
  await screen.findByRole('heading', { level: 1, name: '홈' })
  return opened
}

const lastMonthOf = async (userId = 'user-1') => (await ledgerCopy(userId, LEDGER, 'transactions')) as
  | { data: { from: string; to: string; items: { payee: string }[]; months: { month: string }[] }; receivedAt: number }
  | undefined

const payees = async () => (await lastMonthOf())?.data.items.map(({ payee }) => payee)

describe('남기는 때', () => {
  it('홈을 열면 오늘을 포함한 지난 31일을 받아 그 사용자·장부의 사본으로 남기고 받은 시각을 적는다', async () => {
    list.months.set('2026-11', [spend('2026-11-26', '오늘'), spend('2026-11-01', '이달 초')])
    list.months.set('2026-10', [spend('2026-10-27', '31일째'), spend('2026-10-26', '32일째')])
    await openHome()
    await waitFor(async () => expect(await payees()).toEqual(['오늘', '이달 초', '31일째']))
    const kept = (await lastMonthOf())!
    expect(kept.data.from).toBe('2026-10-27')
    expect(kept.data.to).toBe('2026-11-26')
    expect(kept.data.months.map(({ month }) => month)).toEqual(['2026-10', '2026-11'])
    expect(kept.receivedAt).toBe(nowOnDevice())
  })

  it('받는 코드(따로 싣는 조각)가 홈을 그린 뒤에 와도 그 탭의 로그인으로 받아 남긴다(#292)', async () => {
    // 조각을 붙잡아 두고 그동안 기기의 사본을 읽어, 부하로 조각이 홈 제목보다 늦게 오는 때를 매번 만든다. 사본을 읽는 도우미가
    // 앱이 열린 뒤에 앱 모듈을 다시 읽으면(vi.resetModules) 늦게 온 조각이 화면과 다른 모듈(토큰이 없는 세션)과 이어져 받기를
    // 보내지 않는다(support/device)
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    vi.doMock('../src/features/transactions/fetchLastMonth', async (importOriginal) => {
      await gate
      return importOriginal()
    })
    onTestFinished(() => void vi.doUnmock('../src/features/transactions/fetchLastMonth'))
    list.months.set('2026-11', [spend('2026-11-26', '오늘')])
    await openHome()
    expect(await lastMonthOf()).toBeUndefined()
    await act(async () => release())
    await waitFor(async () => expect(await payees()).toEqual(['오늘']))
  })

  it.each([
    ['Asia/Seoul', '2026-11-27', '2026-10-28'],
    ['UTC', '2026-11-26', '2026-10-27'],
    ['America/Los_Angeles', '2026-11-26', '2026-10-27'],
    ['Pacific/Kiritimati', '2026-11-27', '2026-10-28'],
    ['Pacific/Pago_Pago', '2026-11-26', '2026-10-27'],
  ])('저장 범위는 기기의 시간대로 본 오늘부터 센다(%s)', async (timeZone, to, from) => {
    // UTC 2026-11-26 23:30. 서울·Kiritimati는 이미 27일이다
    setDeviceClock('2026-11-26T23:30:00Z', timeZone)
    list.months.set('2026-11', [spend('2026-11-26', '26일')])
    await openHome()
    await waitFor(async () => expect((await lastMonthOf())?.data.to).toBe(to))
    expect((await lastMonthOf())!.data.from).toBe(from)
    expect(await payees()).toEqual(['26일'])
  })

  it('다시 받으면 앞 사본을 남기지 않고 통째로 바꾼다', async () => {
    await seedDevice()
    await seedLedgerCopy(
      'user-1',
      LEDGER,
      'transactions',
      { from: '2026-10-26', to: '2026-11-25', items: [spend('2026-11-20', '앞 사본')], days: [], months: [], truncated: false },
      nowOnDevice() - DAY,
    )
    list.months.set('2026-11', [spend('2026-11-26', '새로 받음')])
    await openHome()
    await waitFor(async () => expect(await payees()).toEqual(['새로 받음']))
  })

  it('쪽을 받는 사이 같은 탭에서 다른 계정으로 로그인했으면 다음 쪽을 그 계정으로 보내지 않고 어느 사용자의 사본도 남기지 않는다(#234 A2)', async () => {
    list.months.set(
      '2026-11',
      Array.from({ length: 60 }, (_, index) => spend('2026-11-20', `user-1의 거래 ${index}`)),
    )
    const firstPage = delayed()
    list.response = (sent) => (sent.month === null && sent.cursor === null ? firstPage.respond() : undefined)
    vi.resetModules()
    const session = await import('../src/api/session')
    const { fetchKeepingCopy } = await import('../src/features/me/ledgerCopy')
    const { fetchLastMonth } = await import('../src/features/transactions/fetchLastMonth')
    await session.login(credentials)
    const fetching = fetchKeepingCopy(LEDGER, 'transactions', () =>
      fetchLastMonth(LEDGER, '2026-11-26', { sender: { startedBy: 'user-1' } }),
    ).catch((error: unknown) => error)
    await firstPage.arrived
    backend.loginUser = 'user-2'
    await session.login(credentials)
    list.response = undefined
    firstPage.answer(HttpResponse.json(pageOf(null, list.months.get('2026-11')!, 0, 50)))
    expect(await fetching).toBeInstanceOf(Error)
    await settle(100)
    expect(list.requests.filter(({ cursor }) => cursor !== null)).toEqual([])
    expect(await lastMonthOf('user-1')).toBeUndefined()
    expect(await lastMonthOf('user-2')).toBeUndefined()
  })

  it('받지 못하면(서버 오류) 앞 사본을 그대로 둔다', async () => {
    await seedDevice()
    const before = { from: '2026-10-26', to: '2026-11-25', items: [spend('2026-11-20', '앞 사본')], days: [], months: [], truncated: false }
    await seedLedgerCopy('user-1', LEDGER, 'transactions', before, nowOnDevice() - DAY)
    list.response = (sent) => (sent.month === null && sent.limit === '50' ? problem(500, 'INTERNAL_ERROR') : undefined)
    await openHome()
    await settle(200)
    expect(await payees()).toEqual(['앞 사본'])
  })

  it('사본을 읽기만 하고 다시 쓰지 않는다: 새 사본을 남겨 읽어 둔 사본을 다시 읽어도 받기와 쓰기가 이어지지 않는다', async () => {
    list.months.set('2026-11', [spend('2026-11-26', '오늘')])
    await openHome()
    await waitFor(async () => expect(await payees()).toEqual(['오늘']))
    const receivedAt = (await lastMonthOf())!.receivedAt
    const requests = list.requests.length
    await settle(300)
    expect(list.requests).toHaveLength(requests)
    expect((await lastMonthOf())!.receivedAt).toBe(receivedAt)
    // 연결이 끊겨도 읽어 둔 사본(받은 것과 같은 값)을 보인다
    act(() => goOffline())
    expect(await screen.findAllByText('12:30 기준')).not.toHaveLength(0)
  })
})

describe('지우는 때', () => {
  const kinds = async () =>
    (await copyKeys()).filter(([owner, scope, kind]) => owner === 'user-1' && scope === LEDGER && kind !== 'gone').map(([, , kind]) => kind)

  it('최근 한 달 목록이 404(장부를 볼 수 없게 됨)이면 그 장부의 사본을 모두 지운다(security Q4)', async () => {
    await seedDevice()
    await seedLedgerCopy('user-1', LEDGER, 'transactions', { from: '2026-10-27', to: '2026-11-26', items: [], days: [], months: [], truncated: false })
    list.response = (sent) => (sent.month === null && sent.limit === '50' ? problem(404, 'NOT_FOUND') : undefined)
    await openHome()
    await waitFor(async () => expect(await kinds()).not.toContain('transactions'))
  })

  it('로그아웃(F-016)이 지우는 그 사용자의 기기 데이터에 최근 한 달도 들어간다', async () => {
    await seedDevice()
    await seedLedgerCopy('user-1', LEDGER, 'transactions', { from: '2026-10-27', to: '2026-11-26', items: [], days: [], months: [], truncated: false })
    await seedLedgerCopy('user-2', LEDGER, 'transactions', { from: '2026-10-27', to: '2026-11-26', items: [], days: [], months: [], truncated: false })
    // 로그아웃이 부르는 지우기(device/userData)와 같다
    await forgetUser('user-1')
    expect(await lastMonthOf('user-1')).toBeUndefined()
    expect(await lastMonthOf('user-2')).toBeDefined()
  })
})
