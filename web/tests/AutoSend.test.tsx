import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { seedPending } from './support/device'
import { passTime, startGuardClock } from './support/guardClock'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { credentials } from './support/sessionTab'
import { expenseOf, startTransactionList, type TransactionList } from './support/transactionList'
import { id, LEDGER, openApp, resetGlobals, settle, startServer } from './support/transactionScreen'
import { savedOf, type Transactions } from './support/transactions'
import { resetViewport } from './support/viewport'

/*
 * 쌓인 입력을 저절로 보내는 계기(F-105, ADR 006 결정 6, #235). 앱을 열 때, 연결이 돌아왔을 때, 화면이 다시 보일 때, 열려 있는
 * 동안 1분마다 보낸다. 1분 계기는 화면이 보이고 연결이 있을 때만 돈다(architect #235). 응답마다의 처리는 sendQueue.test.ts가 본다.
 */

const server = startMockServer()
let backend: Backend
let transactions: Transactions
let list: TransactionList

const NOW = '2026-11-26T12:30:00+09:00'
const now = Date.parse(NOW)

beforeEach(() => {
  setDeviceClock(NOW)
  startGuardClock()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  list = startTransactionList(server, backend)
  installIntersectionObserver()
  // 연결이 돌아왔는지 보는 확인 요청(api/connection). 우리 서버처럼 X-Request-Id를 붙인다
  server.use(http.head('/api/v1/', () => new HttpResponse(null, { status: 404, headers: { 'X-Request-Id': 'req-probe' } })))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

let count = 0
function pending(payee: string, userId = 'user-1') {
  count += 1
  return {
    userId,
    ledgerId: LEDGER,
    queuedAt: now + count,
    body: {
      id: `0193a000-0000-7000-8000-${String(count).padStart(12, '0')}`,
      type: 'EXPENSE' as const,
      occurredOn: '2026-11-26',
      occurredTime: null,
      accountId: id.salary,
      categoryId: null,
      amount: 5000,
      payee,
      memo: null,
    },
  }
}

/**
 * 앱을 연 뒤에 쌓는다. 앱이 불러 둔 대기열 모듈을 그대로 쓴다. support/device의 seedPending은 모듈을 다시 읽어, 그 뒤에 앱이
 * 따로 받는 보내기 조각이 로그인하지 않은 새 세션 모듈에 묶인다.
 */
async function queueInApp(item: ReturnType<typeof pending>) {
  const { queueTransaction } = await import('../src/device/pendingQueue')
  await queueTransaction(item)
}

/** 앱이 불러 둔 대기열 모듈로 읽는다(위와 같은 까닭) */
async function queueOf(userId = 'user-1') {
  const { pendingOf } = await import('../src/device/pendingQueue')
  return pendingOf(userId)
}

const sentPayees = () => transactions.sent.map(({ body }) => body.payee)
const failSending = () => void (transactions.response = () => problem(500, 'INTERNAL_ERROR'))
/** 서버가 받으면 목록에도 보이게 한다 */
const acceptSending = () =>
  void (transactions.response = (sent) => {
    const saved = savedOf(sent.body)
    list.months.set('2026-11', [...(list.months.get('2026-11') ?? []), saved])
    return HttpResponse.json(saved, { status: 201 })
  })

async function openHome() {
  const opened = await openApp('/home')
  await screen.findByRole('heading', { level: 1, name: '홈' })
  await settle()
  return opened
}

const chipOf = (payee: string) => within(screen.getByText(payee).closest('li')!).queryByText('보내지 않음')

describe('계기', () => {
  it('앱을 열면 쌓인 입력을 오래된 것부터 보내고 대기열에서 지운다', async () => {
    await seedPending(pending('첫째'))
    await seedPending(pending('둘째'))
    await openHome()
    await waitFor(() => expect(sentPayees()).toEqual(['첫째', '둘째']))
    await waitFor(async () => expect(await queueOf()).toEqual([]))
  })

  it('보내기에 성공하면 홈의 그 줄에서 "보내지 않음"이 사라진다(그 장부의 서버 데이터를 다시 받는다)', async () => {
    failSending()
    list.months.set('2026-11', [expenseOf({ occurredOn: '2026-11-25', accountId: id.salary, amount: 1000, payee: '서버의 거래' })])
    await seedPending(pending('대기 점심'))
    await openHome()
    await waitFor(() => expect(chipOf('대기 점심')).not.toBeNull())
    acceptSending()
    await passTime(60_000)
    await waitFor(() => expect(chipOf('대기 점심')).toBeNull())
    expect(screen.getByText('대기 점심')).toBeTruthy()
  })

  it('열려 있는 동안 1분마다 다시 보낸다(서버 오류로 남은 입력)', async () => {
    failSending()
    await seedPending(pending('남은 입력'))
    await openHome()
    await waitFor(() => expect(sentPayees()).toEqual(['남은 입력']))
    await passTime(59_000)
    await settle()
    expect(sentPayees()).toEqual(['남은 입력'])
    acceptSending()
    await passTime(1_000)
    await waitFor(() => expect(sentPayees()).toEqual(['남은 입력', '남은 입력']))
    await waitFor(async () => expect(await queueOf()).toEqual([]))
  })

  it('연결이 끊긴 동안에는 1분 계기에 보내지 않고, 연결이 돌아오면 바로 보낸다', async () => {
    await openHome()
    act(() => goOffline())
    await queueInApp(pending('끊긴 동안'))
    await passTime(60_000)
    await settle()
    expect(sentPayees()).toEqual([])
    act(() => goOnline())
    await waitFor(() => expect(sentPayees()).toEqual(['끊긴 동안']))
  })

  it('요청이 연결 문제로 실패한 뒤 확인 요청으로 연결이 돌아온 것을 알면 보낸다', async () => {
    transactions.response = () => HttpResponse.error()
    await seedPending(pending('끊겼던 입력'))
    await openHome()
    await waitFor(() => expect(sentPayees()).toEqual(['끊겼던 입력']))
    transactions.response = undefined
    // 확인 요청은 5초 뒤에 간다(api/connection)
    await passTime(5_000)
    await waitFor(() => expect(sentPayees()).toEqual(['끊겼던 입력', '끊겼던 입력']))
    await waitFor(async () => expect(await queueOf()).toEqual([]))
  })

  describe('화면이 숨은 동안', () => {
    let state: DocumentVisibilityState = 'visible'

    beforeEach(() => {
      state = 'visible'
      vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
    })

    function show(next: DocumentVisibilityState) {
      state = next
      act(() => void document.dispatchEvent(new Event('visibilitychange')))
    }

    it('1분 계기에 보내지 않고, 다시 보이면 한 번 보낸다', async () => {
      failSending()
      await seedPending(pending('숨은 탭'))
      await openHome()
      await waitFor(() => expect(sentPayees()).toEqual(['숨은 탭']))
      show('hidden')
      await passTime(120_000)
      await settle()
      expect(sentPayees()).toEqual(['숨은 탭'])
      acceptSending()
      show('visible')
      await waitFor(() => expect(sentPayees()).toEqual(['숨은 탭', '숨은 탭']))
    })
  })

  it('로그인이 풀려도 지우지 않고, 같은 계정으로 다시 로그인하면 보내기를 이어 간다', async () => {
    backend.cookieUser = undefined
    await seedPending(pending('풀린 동안'))
    const { user } = await openApp('/home')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(sentPayees()).toEqual([])
    expect(await queueOf()).toHaveLength(1)
    await user.type(screen.getByLabelText('이메일'), credentials.email)
    await user.type(screen.getByLabelText('비밀번호'), credentials.password)
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await waitFor(() => expect(sentPayees()).toEqual(['풀린 동안']))
  })

  it('다른 계정으로 로그인하면 앞 사용자의 입력은 보내지 않는다', async () => {
    await seedPending(pending('앞 사용자', 'user-2'))
    await openHome()
    await settle(100)
    expect(sentPayees()).toEqual([])
    expect(await queueOf('user-2')).toHaveLength(1)
  })
})
