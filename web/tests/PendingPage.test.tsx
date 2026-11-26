import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { seedLedgerCopy, seedLogin, seedMeCopy, seedPending } from './support/device'
import { untilOpened, untilUnshielded } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { credentials } from './support/sessionTab'
import { holdClock, passTime, releaseClock } from './support/testClock'
import { toastRegion } from './support/toast'
import { startTransactionList } from './support/transactionList'
import {
  accountItems,
  categoryItems,
  id,
  LEDGER,
  openApp,
  resetGlobals,
  settle,
  startServer,
  type Opened,
} from './support/transactionScreen'
import { savedOf, type Transactions } from './support/transactions'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * B-05 보내지 않은 입력 목록(화면설계서 00-common 6.6, F-106, F-107, F-109, P-226, #236). 이 기기에서 이 계정이 쌓은 입력을
 * 오래된 순으로 보이고, 지금 보내기와 버리기를 한다. 보내기와 응답 처리는 #235의 sendQueue다(응답마다의 처리는 sendQueue.test.ts).
 * 저절로 보내기가 지금 보내기를 앞지르지 않게 화면을 숨겨 둔 채 연다(저절로 보내기는 화면이 보일 때만 보낸다). 저절로 보내기를 보는
 * 테스트만 화면을 보인다.
 */

const server = startMockServer()
let backend: Backend
let transactions: Transactions

const NOW = '2026-11-26T12:30:00+09:00'
const now = Date.parse(NOW)
const DAY = 24 * 60 * 60 * 1000

let visibility: DocumentVisibilityState = 'hidden'

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  startTransactionList(server, backend)
  installIntersectionObserver()
  // 연결이 돌아왔는지 보는 확인 요청(api/connection). 우리 서버처럼 X-Request-Id를 붙인다
  server.use(http.head('/api/v1/', () => new HttpResponse(null, { status: 404, headers: { 'X-Request-Id': 'req-probe' } })))
  visibility = 'hidden'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

let count = 0
function nextId() {
  count += 1
  return `0193a000-0000-7000-8000-${String(count).padStart(12, '0')}`
}

function expense(fields: Record<string, unknown> = {}) {
  const bodyId = nextId()
  return {
    userId: 'user-1',
    ledgerId: LEDGER,
    queuedAt: now + count,
    body: {
      id: bodyId,
      type: 'EXPENSE' as const,
      occurredOn: '2026-11-26',
      occurredTime: null,
      accountId: id.salary,
      categoryId: id.food,
      amount: 5000,
      payee: `지출 ${count}`,
      memo: null,
      ...fields,
    },
  }
}

function income(fields: Record<string, unknown> = {}) {
  const item = expense({ categoryId: id.pay, amount: 3000, ...fields })
  return { ...item, body: { ...item.body, type: 'INCOME' as const } }
}

function transfer(fields: Record<string, unknown> = {}) {
  const bodyId = nextId()
  return {
    userId: 'user-1',
    ledgerId: LEDGER,
    queuedAt: now + count,
    body: {
      id: bodyId,
      type: 'TRANSFER' as const,
      occurredOn: '2026-11-25',
      occurredTime: null,
      fromAccountId: id.salary,
      toAccountId: id.saving,
      amount: 10000,
      memo: null,
      ...fields,
    },
  }
}

type Item = ReturnType<typeof expense> | ReturnType<typeof transfer>

interface Refusal {
  status?: number
  code?: string
  fieldErrors?: { field: string; code: string }[]
  current?: unknown
}

/** 서버가 거부해 보낼 수 없음이 된 입력을 쌓는다(앱을 열기 전에 부른다) */
async function seedRejected(item: Item, { status = 400, code = 'VALIDATION_FAILED', fieldErrors = [], current }: Refusal = {}) {
  await seedPending(item)
  vi.resetModules()
  const { pendingOf, settlePending } = await import('../src/device/pendingQueue')
  const seen = (await pendingOf(item.userId)).find(({ id: rowId }) => rowId === item.body.id)!
  const rejection = { kind: 'rejected' as const, status, code, fieldErrors, at: now, ...(current !== undefined && { current }) }
  await settlePending(seen, rejection)
}

const listShown = () => document.querySelector('ul[class*="_rows_"]') ?? screen.queryByText('보낼 입력이 없어요. 모두 보냈어요.')

/** 그려질 때까지 기다린다. 화면 코드를 받는 동안의 틀에도 같은 제목이 있으므로 목록이나 데이터 없음을 기다린다(#251) */
async function untilList() {
  await waitFor(() => expect(listShown()).not.toBeNull())
}

async function openPending({ width = 390, path = '/pending' } = {}): Promise<Opened> {
  installMatchMedia(width)
  const opened = await openApp(path)
  await screen.findByRole('heading', { level: 1, name: '보내지 않은 입력' })
  await untilList()
  await settle()
  setViewportWidth(width)
  return opened
}

/** 연결 없이 연 기기(확인하지 못한 로그인). 사본은 `receivedAt`에 받은 것이다 */
async function openOffline(receivedAt: number) {
  await seedLogin({ confirmedAt: receivedAt, loggedInAt: receivedAt - 10 * DAY })
  await seedMeCopy('user-1', meOf('user-1'), receivedAt)
  await seedLedgerCopy('user-1', LEDGER, 'accounts', accountItems, receivedAt)
  await seedLedgerCopy('user-1', LEDGER, 'categories', categoryItems, receivedAt)
  backend.refreshResponse = () => HttpResponse.error()
  const opened = await openPending()
  act(() => goOffline())
  return opened
}

/**
 * 앱이 불러 둔 대기열 모듈로 읽는다. support/device의 queueOf는 모듈을 다시 읽어, 그 뒤에 앱이 따로 받는 화면·보내기 조각이 앱과
 * 다른 모듈(다른 ToastContext 등)에 묶인다.
 */
async function queueOf() {
  const { pendingOf } = await import('../src/device/pendingQueue')
  return pendingOf('user-1')
}

/** 화면을 보여 저절로 보내기가 돌게 한다 */
function show() {
  visibility = 'visible'
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

const rows = () => [...document.querySelectorAll<HTMLElement>('ul[class*="_rows_"] > li')]
const rowOf = (title: string) => screen.getByText(title).closest('li')!
const titles = () => rows().map((row) => row.querySelector('[class*="_title_"]')!.textContent)
const sendNow = () => screen.queryByRole('button', { name: '지금 보내기' })
const discardIn = (row: HTMLElement) => within(row).getByRole('button', { name: '버리기' })
const dialog = () => screen.getByRole('dialog', { name: '이 입력을 버릴까요?' })
/** 확인 창 아래의 "닫기"(보조 버튼). 바닥 시트 머리의 X도 이름이 "닫기"다 */
const closeIn = (frame: HTMLElement) => within(frame).getAllByRole('button', { name: '닫기' }).find((button) => button.textContent === '닫기')!
const toastText = () => toastRegion().textContent
const spoken = () => screen.getAllByRole('status').find((region) => /(^| )_spoken_/.test(region.className))!
const sentPayees = () => transactions.sent.map(({ body }) => body.payee)
const accept = (sent: { body: Record<string, unknown> }) => HttpResponse.json(savedOf(sent.body), { status: 201 })
const NOTHING_LEFT = '보낼 입력이 없어요. 모두 보냈어요.'
const TROUBLE = '문제가 생겨 보내지 못했어요. 잠시 후 다시 시도해 주세요.'

describe('주소와 들어오는 길', () => {
  it('/pending으로 열고, 하위 화면 상단 바 "보내지 않은 입력"과 하단 탭이 보인다. 주소로 열면 강조 탭은 더보기다(6.2)', async () => {
    await seedPending(expense())
    await openPending()
    expect(screen.getByRole('button', { name: '뒤로' })).toBeTruthy()
    const tabs = screen.getByRole('navigation', { name: '주 메뉴' })
    expect(within(tabs).getByRole('link', { name: '더보기' }).getAttribute('aria-current')).toBe('page')
    expect(within(tabs).getByRole('link', { name: '홈' }).hasAttribute('aria-current')).toBe(false)
  })

  it('상단 바의 동기화 상태 표시(B-04)를 누르면 열린다. 홈에서 들어왔으면 6.2대로 홈을 강조한다', async () => {
    await seedPending(expense({ payee: '점심' }))
    const opened = await openApp('/home')
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await opened.user.click(await screen.findByRole('link', { name: '보내지 않은 입력 1건, 목록 보기' }))
    await screen.findByRole('heading', { level: 1, name: '보내지 않은 입력' })
    await untilList()
    expect(opened.router.state.location.pathname).toBe('/pending')
    expect(titles()).toEqual(['점심'])
    const tabs = screen.getByRole('navigation', { name: '주 메뉴' })
    expect(within(tabs).getByRole('link', { name: '홈' }).getAttribute('aria-current')).toBe('page')
  })

  it('홈 최근 거래의 "보내지 않음" 줄을 누르면 거래 상세 대신 이 화면이 열린다(C-01 (10), 작성자 판단 42)', async () => {
    await seedPending(expense({ payee: '홈의 대기' }))
    const opened = await openApp('/home')
    const recent = await screen.findByRole('region', { name: '최근 거래' })
    await opened.user.click(await within(recent).findByRole('link', { name: /^홈의 대기 / }))
    await untilList()
    expect(opened.router.state.location.pathname).toBe('/pending')
  })

  it('내역(D-01)의 "보낼 수 없음" 줄도 이 화면으로 온다(0.4)', async () => {
    await seedRejected(expense({ payee: '거부된 대기' }))
    const opened = await openApp('/transactions?month=2026-11')
    await opened.user.click(await screen.findByRole('link', { name: /^거부된 대기 .*보낼 수 없음$/ }))
    await untilList()
    expect(opened.router.state.location.pathname).toBe('/pending')
  })
})

describe('(1) 마지막으로 맞춘 시각', () => {
  it('목록 위 첫 줄에 오늘이면 시각만 보인다(text-secondary, color-text-secondary)', async () => {
    await seedPending(expense())
    await openPending()
    // 앱을 열며 내 정보와 사본을 받았다(12:30)
    const line = await screen.findByText('마지막으로 맞춘 시각 12:30')
    expect(getComputedStyle(line).font).toBe('var(--text-secondary)')
    expect(getComputedStyle(line).color).toBe('var(--color-text-secondary)')
    expect(line.compareDocumentPosition(sendNow()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('자정 바로 뒤에 보면 어제 23:59에 맞춘 것은 날짜를 붙인다', async () => {
    setDeviceClock('2026-11-26T00:00:30+09:00')
    await seedPending(expense())
    await openOffline(Date.parse('2026-11-25T23:59:00+09:00'))
    expect(screen.getByText('마지막으로 맞춘 시각 11월 25일 (수) 23:59')).toBeTruthy()
  })

  it('자정 바로 뒤에 보면 오늘 00:00에 맞춘 것은 시각만이다', async () => {
    setDeviceClock('2026-11-26T00:00:30+09:00')
    await seedPending(expense())
    await openOffline(Date.parse('2026-11-26T00:00:00+09:00'))
    expect(screen.getByText('마지막으로 맞춘 시각 00:00')).toBeTruthy()
  })
})

describe('(2) 지금 보내기', () => {
  it('대기인 입력이 있으면 (1) 아래 전체 폭의 주 버튼이다', async () => {
    await seedPending(expense())
    await openPending()
    const button = sendNow()!
    expect(button.className).toMatch(/_primary_/)
    expect(getComputedStyle(button.parentElement!).display).toBe('grid')
  })

  it('보낼 수 없음만 남으면 버튼이 없다(보낼 것이 없다)', async () => {
    await seedRejected(expense())
    await openPending()
    expect(rows()).toHaveLength(1)
    expect(sendNow()).toBeNull()
  })

  it('누르면 대기인 입력을 오래된 것부터 보내고, 모두 보냈으면 토스트 "{N}건을 보냈어요"와 데이터 없음이다', async () => {
    await seedPending(expense({ payee: '먼저' }))
    await seedRejected(expense({ payee: '거부됨' }))
    await seedPending(expense({ payee: '나중' }))
    const { user } = await openPending()
    transactions.response = accept
    await user.click(sendNow()!)
    await waitFor(() => expect(toastText()).toBe('2건을 보냈어요'))
    expect(sentPayees()).toEqual(['먼저', '나중'])
    expect(titles()).toEqual(['거부됨'])
    expect(sendNow()).toBeNull()
  })

  it('보내는 동안 버튼에 처리 중 표시를 두고 버리기를 누를 수 없으며, 보낸 줄은 하나씩 사라진다', async () => {
    await seedPending(expense({ payee: '첫째' }))
    await seedPending(expense({ payee: '둘째' }))
    const { user } = await openPending()
    const first = delayed()
    const second = delayed()
    transactions.response = (sent) => (sent.body.payee === '첫째' ? first.respond() : second.respond())
    await user.click(sendNow()!)
    await first.arrived
    await waitFor(() => expect(sendNow()!.getAttribute('aria-busy')).toBe('true'))
    expect(sendNow()!.getAttribute('aria-disabled')).toBe('true')
    for (const row of rows()) expect(discardIn(row).getAttribute('aria-disabled')).toBe('true')
    first.answer(HttpResponse.json(savedOf(expense({ payee: '첫째' }).body), { status: 201 }))
    await waitFor(() => expect(titles()).toEqual(['둘째']))
    expect(sendNow()!.getAttribute('aria-busy')).toBe('true')
    await second.arrived
    second.answer(HttpResponse.json(savedOf(expense({ payee: '둘째' }).body), { status: 201 }))
    // 마지막 줄이 보내지면 바로 데이터 없음이다
    await screen.findByText(NOTHING_LEFT)
    expect(sendNow()).toBeNull()
  })

  it('일부를 서버가 거부했으면 토스트 "{N}건을 보냈고 {M}건은 보낼 수 없어요"이고 그 줄은 보낼 수 없음이 된다', async () => {
    await seedPending(expense({ payee: '받음' }))
    await seedPending(expense({ payee: '거부' }))
    const { user } = await openPending()
    transactions.response = (sent) => (sent.body.payee === '거부' ? problem(400, 'VALIDATION_FAILED') : accept(sent))
    await user.click(sendNow()!)
    await waitFor(() => expect(toastText()).toBe('1건을 보냈고 1건은 보낼 수 없어요'))
    await waitFor(() => expect(within(rowOf('거부')).getByText('보낼 수 없음')).toBeTruthy())
    expect(titles()).toEqual(['거부'])
    expect(within(rowOf('거부')).getByText('입력한 값을 저장할 수 없어요. 고쳐서 보내 주세요.')).toBeTruthy()
  })

  it('모두 거부했으면 토스트 "{M}건은 보낼 수 없어요"(designer #236 Q1)', async () => {
    await seedPending(expense({ payee: '거부' }))
    const { user } = await openPending()
    transactions.response = () => problem(409, 'ID_CONFLICT')
    await user.click(sendNow()!)
    await waitFor(() => expect(toastText()).toBe('1건은 보낼 수 없어요'))
  })

  it('지금 보내기의 건수는 토스트가 화면 읽기에 알린다(role="status")', async () => {
    await seedPending(expense())
    const { user } = await openPending()
    transactions.response = accept
    await user.click(sendNow()!)
    await waitFor(() => expect(toastText()).toBe('1건을 보냈어요'))
    expect(toastRegion().getAttribute('role')).toBe('status')
  })

  it('200이고 알릴 것이 있으면 결과 토스트가 끝난 뒤 저절로 보내기와 같은 200 알림을 보인다', async () => {
    await seedPending(expense({ payee: '이미 저장됨' }))
    const { user } = await openPending()
    transactions.response = (sent) => HttpResponse.json(savedOf(sent.body, 'user-1', { version: 2 }), { status: 200 })
    await user.click(sendNow()!)
    await waitFor(() => expect(toastText()).toBe('1건을 보냈어요'))
    await passTime(4_000)
    await waitFor(() => expect(toastText()).toBe('보낸 입력 1건은 이미 저장된 거래라 저장된 내용으로 두었어요'))
  })

  describe('보내지 못했을 때(P-226)', () => {
    it('연결이 없으면 비활성(5.1의 모양)이고 문구를 붙이지 않는다. 눌러도 보내지 않는다', async () => {
      await seedPending(expense())
      const { user } = await openPending()
      act(() => goOffline())
      await waitFor(() => expect(sendNow()!.getAttribute('aria-disabled')).toBe('true'))
      expect(sendNow()!.hasAttribute('aria-busy')).toBe(false)
      await user.click(sendNow()!)
      await settle()
      expect(transactions.sent).toEqual([])
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('보내던 중에 연결이 끊기면 남은 줄은 대기로 두고 버튼 바로 위에 끊김 문구를 보인다. "다시 시도" 버튼은 없다', async () => {
      await seedPending(expense({ payee: '첫째' }))
      await seedPending(expense({ payee: '둘째' }))
      await seedPending(expense({ payee: '셋째' }))
      const { user } = await openPending()
      transactions.response = (sent) => (sent.body.payee === '첫째' ? accept(sent) : HttpResponse.error())
      await user.click(sendNow()!)
      const message = await screen.findByRole('alert')
      expect(message.textContent).toBe('연결이 끊겨 2건을 보내지 못했어요. 연결되면 자동으로 보낼게요.')
      expect(message.compareDocumentPosition(sendNow()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(titles()).toEqual(['둘째', '셋째'])
      for (const row of rows()) expect(within(row).getByText('대기')).toBeTruthy()
      expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
      // 보낸 것은 토스트로 알린다(designer #236 Q2)
      await waitFor(() => expect(toastText()).toBe('1건을 보냈어요'))
    })

    it('서버 오류(5xx)면 버튼 위에 문제 문구를 보이고 줄은 대기로 남는다. 보낸 것이 없으면 토스트가 없다', async () => {
      await seedPending(expense({ payee: '남음' }))
      const { user } = await openPending()
      transactions.response = () => problem(503, 'INTERNAL_ERROR')
      await user.click(sendNow()!)
      expect((await screen.findByRole('alert')).textContent).toBe(TROUBLE)
      expect(within(rowOf('남음')).getByText('대기')).toBeTruthy()
      await settle()
      expect(toastText()).toBe('')
    })

    it('응답이 15초 안에 오지 않으면(지연) 같은 문구이고 줄은 대기로 남는다', async () => {
      await seedPending(expense({ payee: '느림' }))
      const { user } = await openPending()
      const late = delayed()
      transactions.response = () => late.respond()
      holdClock()
      await user.click(sendNow()!)
      await late.arrived
      await passTime(15_100)
      expect((await screen.findByRole('alert')).textContent).toBe(TROUBLE)
      releaseClock()
      expect(within(rowOf('느림')).getByText('대기')).toBeTruthy()
    })

    it('다시 누르면 문구를 지우고 그 결과로 바꾼다', async () => {
      await seedPending(expense())
      const { user } = await openPending()
      transactions.response = () => problem(500, 'INTERNAL_ERROR')
      await user.click(sendNow()!)
      await screen.findByRole('alert')
      transactions.response = accept
      await user.click(sendNow()!)
      await screen.findByText(NOTHING_LEFT)
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('저절로 보내기(F-105)와 함께', () => {
    it('이 화면을 보는 동안 저절로 보내면 줄이 사라지고 화면 읽기에 "{N}건을 보냈어요"를 알린다', async () => {
      await seedPending(expense({ payee: '저절로' }))
      await openPending()
      transactions.response = accept
      show()
      await screen.findByText(NOTHING_LEFT)
      await waitFor(() => expect(spoken().textContent).toBe('1건을 보냈어요'))
      expect(spoken().getAttribute('role')).toBe('status')
    })

    it('저절로 보내기가 서버 오류로 끝나면 버튼 위 문구가 그 결과로 바뀐다(designer #236 Q4)', async () => {
      await seedPending(expense())
      await openPending()
      transactions.response = () => problem(502, 'INTERNAL_ERROR')
      show()
      expect((await screen.findByRole('alert')).textContent).toBe(TROUBLE)
    })
  })
})

describe('(3) 입력 줄과 (4) 상태', () => {
  it('쌓인 입력마다 한 줄, 오래된 순이다. 첫 줄은 "{장부 이름} · {날짜} · {유형}"(보조 글자)이다', async () => {
    await seedPending(expense({ payee: '점심', amount: 12000 }))
    await seedPending(income({ payee: '용돈', occurredOn: '2026-11-24' }))
    await seedPending(transfer())
    await openPending()
    expect(titles()).toEqual(['점심', '용돈', '이체'])
    const metas = rows().map((row) => row.querySelector('[class*="_meta_"]')!.textContent)
    expect(metas).toEqual([
      'user-1의 장부 · 11월 26일 (목) · 지출',
      'user-1의 장부 · 11월 24일 (화) · 수입',
      'user-1의 장부 · 11월 25일 (수) · 이체',
    ])
    const meta = rows()[0].querySelector('[class*="_meta_"]')!
    expect(getComputedStyle(meta).font).toBe('var(--text-secondary)')
    expect(getComputedStyle(meta).color).toBe('var(--color-text-secondary)')
  })

  it('둘째 줄 오른쪽에 2.2의 색과 부호로 금액을 보인다', async () => {
    await seedPending(expense({ payee: '점심', amount: 12000 }))
    await seedPending(income({ payee: '용돈', amount: 3000 }))
    await seedPending(transfer({ amount: 10000 }))
    await openPending()
    const amounts = rows().map((row) => row.querySelector('[class*="_amount_"]')!.textContent)
    expect(amounts).toEqual(['12,000원', '+3,000원', '10,000원'])
  })

  it('가맹점/내용이 비었으면 카테고리 이름, 카테고리도 비웠으면 "미분류"다', async () => {
    await seedPending(expense({ payee: null, categoryId: id.dining }))
    await seedPending(expense({ payee: '', categoryId: null }))
    await openPending()
    expect(titles()).toEqual(['외식', '미분류'])
  })

  it('이체는 둘째 줄 왼쪽에 "이체", 그 아래 보조 글자 "{보내는 계좌}에서 {받는 계좌}로"다', async () => {
    await seedPending(transfer())
    await openPending()
    const [row] = rows()
    const lines = [...row.querySelectorAll('p')].map((line) => line.textContent)
    expect(lines).toEqual(['user-1의 장부 · 11월 25일 (수) · 이체', '이체10,000원', '급여통장에서 비상금으로'])
  })

  it('대기는 표시 칩 "대기", 보낼 수 없음은 오류 칩 "보낼 수 없음"이다(5.11). 대기인 줄은 누를 수 없다', async () => {
    await seedPending(expense({ payee: '대기 줄' }))
    await seedRejected(expense({ payee: '거부 줄' }))
    await openPending()
    const waitingChip = within(rowOf('대기 줄')).getByText('대기')
    expect(waitingChip.className).toMatch(/_chip_/)
    expect(waitingChip.className).not.toMatch(/_danger_/)
    const rejectedChip = within(rowOf('거부 줄')).getByText('보낼 수 없음')
    expect(rejectedChip.className).toMatch(/_danger_/)
    expect(getComputedStyle(rejectedChip).color).toBe('var(--color-danger)')
    // 줄 안에서 누를 수 있는 것은 버리기 하나다(1B 임시: 보낼 수 없음 줄도 눌러도 아무 일이 없다)
    for (const row of rows()) {
      expect(within(row).queryByRole('link')).toBeNull()
      expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual(['버리기'])
    }
  })

  it('다른 사용자가 이 기기에 쌓은 입력은 보이지 않는다', async () => {
    await seedPending({ ...expense({ payee: '남의 입력' }), userId: 'user-2' })
    await seedPending(expense({ payee: '내 입력' }))
    await openPending()
    expect(titles()).toEqual(['내 입력'])
  })
})

describe('(5) 버리기', () => {
  it('줄마다 오른쪽 끝의 위험색 글자 버튼이고, 화면 읽기에는 그 줄의 내용을 함께 읽는다', async () => {
    await seedPending(expense({ payee: '점심', amount: 12000 }))
    await openPending()
    const button = discardIn(rowOf('점심'))
    expect(button.className).toMatch(/_textDanger_/)
    const described = button.getAttribute('aria-describedby')!.split(' ').map((each) => document.getElementById(each)!.textContent)
    expect(described).toEqual(['점심', '12,000원', 'user-1의 장부 · 11월 26일 (목) · 지출'])
  })

  it('누르면 확인 창을 열고, 버리면 줄이 사라지고 토스트 "입력을 버렸어요"다', async () => {
    await seedPending(expense({ payee: '버릴 것' }))
    await seedPending(expense({ payee: '남길 것' }))
    const { user } = await openPending()
    await user.click(discardIn(rowOf('버릴 것')))
    await untilOpened()
    expect(within(dialog()).getByText('서버에 저장되지 않고 이 기기에서 사라져요')).toBeTruthy()
    const buttons = within(dialog()).getAllByRole('button').filter((button) => button.textContent !== '')
    expect(buttons.map((button) => button.textContent)).toEqual(['닫기', '버리기'])
    expect(within(dialog()).getByRole('button', { name: '버리기' }).className).toMatch(/_danger_/)
    // 위험 버튼이 있는 창의 첫 초점은 "닫기"다(5.6)
    expect(document.activeElement).toBe(closeIn(dialog()))
    await user.click(within(dialog()).getByRole('button', { name: '버리기' }))
    await waitFor(() => expect(toastText()).toBe('입력을 버렸어요'))
    expect(titles()).toEqual(['남길 것'])
    expect((await queueOf()).map(({ body }) => body.payee)).toEqual(['남길 것'])
    await untilUnshielded()
  })

  it('닫기를 누르면 아무것도 버리지 않는다', async () => {
    await seedPending(expense({ payee: '그대로' }))
    const { user } = await openPending()
    await user.click(discardIn(rowOf('그대로')))
    await untilOpened()
    await user.click(closeIn(dialog()))
    await untilUnshielded()
    expect(titles()).toEqual(['그대로'])
    expect(await queueOf()).toHaveLength(1)
  })

  it('연결이 없어도 된다(기기 안의 동작)', async () => {
    await seedPending(expense({ payee: '연결 없이' }))
    const { user } = await openPending()
    act(() => goOffline())
    await user.click(discardIn(rowOf('연결 없이')))
    await untilOpened()
    await user.click(within(dialog()).getByRole('button', { name: '버리기' }))
    await screen.findByText(NOTHING_LEFT)
    expect(await queueOf()).toEqual([])
    await untilUnshielded()
  })

  it('보낼 수 없음인 줄도 버린다', async () => {
    await seedRejected(expense({ payee: '거부 줄' }))
    const { user } = await openPending()
    await user.click(discardIn(rowOf('거부 줄')))
    await untilOpened()
    await user.click(within(dialog()).getByRole('button', { name: '버리기' }))
    await screen.findByText(NOTHING_LEFT)
    await untilUnshielded()
  })

  it('그 입력을 보내는 중이면 끝나기를 기다리고, 그사이 저장됐으면 버리지 못했다고 알린다(designer #236 Q6)', async () => {
    await seedPending(expense({ payee: '보내는 중' }))
    const { user } = await openPending()
    const answer = delayed()
    transactions.response = () => answer.respond()
    show()
    await answer.arrived
    await user.click(discardIn(rowOf('보내는 중')))
    await untilOpened()
    await user.click(within(dialog()).getByRole('button', { name: '버리기' }))
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: '버리기' }).getAttribute('aria-busy')).toBe('true'))
    answer.answer(HttpResponse.json(savedOf(expense({ payee: '보내는 중' }).body), { status: 201 }))
    await waitFor(() => expect(toastText()).toBe('이미 보내서 버리지 못했어요. 내역에서 확인해 주세요.'))
    await untilUnshielded()
  })

  it('다른 탭이 보내기를 쥔 채 15초 안에 놓지 않으면 창 안에 문구와 "다시 시도"를 보인다(designer #236 Q7)', async () => {
    await seedPending(expense({ payee: '막힘' }))
    const { user } = await openPending()
    const held = Promise.withResolvers<void>()
    void navigator.locks.request('akkimpyo-queue', {}, () => held.promise)
    await user.click(discardIn(rowOf('막힘')))
    await untilOpened()
    holdClock()
    await user.click(within(dialog()).getByRole('button', { name: '버리기' }))
    await passTime(15_000)
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('문제가 생겨 버리지 못했어요. 잠시 후 다시 시도해 주세요.')
    releaseClock()
    held.resolve()
    await user.click(within(dialog()).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(toastText()).toBe('입력을 버렸어요'))
    await untilUnshielded()
  })
})

describe('(6) 거부 이유', () => {
  it('보낼 수 없음인 줄에만 상태 칩 아래 color-danger 문구로 보인다', async () => {
    await seedPending(expense({ payee: '대기 줄' }))
    await seedRejected(expense({ payee: '계좌 삭제' }), { fieldErrors: [{ field: 'accountId', code: 'NOT_FOUND' }] })
    await openPending()
    expect(rowOf('대기 줄').querySelector('[class*="_reason_"]')).toBeNull()
    const reason = within(rowOf('계좌 삭제')).getByText('계좌가 삭제되어 보낼 수 없어요. 다른 계좌를 골라 보내 주세요.')
    expect(getComputedStyle(reason).color).toBe('var(--color-danger)')
    expect(getComputedStyle(reason).font).toBe('var(--text-secondary)')
    const chip = within(rowOf('계좌 삭제')).getByText('보낼 수 없음')
    expect(chip.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['카테고리가 삭제됨', { fieldErrors: [{ field: 'categoryId', code: 'NOT_FOUND' }] }, '카테고리가 삭제되어 보낼 수 없어요. 다른 카테고리를 골라 보내 주세요.'],
    ['그 밖의 검증 실패', { fieldErrors: [{ field: 'amount', code: 'OUT_OF_RANGE' }] }, '입력한 값을 저장할 수 없어요. 고쳐서 보내 주세요.'],
    ['current가 없는 409', { status: 409, code: 'ID_CONFLICT' }, '이미 있는 다른 거래와 겹쳐 보낼 수 없어요. 버리고 새로 입력해 주세요.'],
    ['current가 있는 409(고르기는 #280)', { status: 409, code: 'ID_CONFLICT', current: { id: 'x', version: 1 } }, '앞서 저장한 거래와 내용이 달라 보낼 수 없어요. 내역에서 확인해 주세요.'],
  ])('%s', async (_, refusal, text) => {
    await seedRejected(expense({ payee: '거부 줄' }), refusal)
    await openPending()
    expect(within(rowOf('거부 줄')).getByText(text)).toBeTruthy()
  })
})

describe('상태와 예외', () => {
  it('데이터 없음: 목록 자리에 한 줄만 보이고 버튼이 없다. (1)은 그대로다', async () => {
    await openPending()
    const empty = screen.getByText(NOTHING_LEFT)
    expect(getComputedStyle(empty).color).toBe('var(--color-text-secondary)')
    expect(empty.parentElement!.querySelectorAll('a, button')).toHaveLength(0)
    expect(sendNow()).toBeNull()
    expect(screen.getByText(/^마지막으로 맞춘 시각 /)).toBeTruthy()
  })

  it('기기 데이터라 뼈대 없이 그린다', async () => {
    await seedPending(expense())
    await openPending()
    expect(document.querySelector('[class*="_skeleton"], [class*="Skeleton"]')).toBeNull()
  })

  it('연결이 없어도 목록은 기기 데이터로 그대로 보인다(확인하지 못한 로그인)', async () => {
    await seedPending(expense({ payee: '연결 없이 쌓음' }))
    await seedPending(transfer())
    await openOffline(now - DAY)
    expect(titles()).toEqual(['연결 없이 쌓음', '이체'])
    expect(screen.getByText('급여통장에서 비상금으로')).toBeTruthy()
    expect(sendNow()!.getAttribute('aria-disabled')).toBe('true')
    expect(transactions.sent).toEqual([])
  })

  it('비로그인으로 주소에 오면 로그인(A-02)으로 보내고, 로그인 뒤 이 화면으로 돌아온다. 풀린 동안의 입력은 그대로다', async () => {
    backend.cookieUser = undefined
    await seedPending(expense({ payee: '풀린 동안' }))
    installMatchMedia(390)
    const { user, router } = await openApp('/pending')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect((await queueOf()).map(({ body }) => body.payee)).toEqual(['풀린 동안'])
    await user.type(screen.getByLabelText('이메일'), credentials.email)
    await user.type(screen.getByLabelText('비밀번호'), credentials.password)
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { level: 1, name: '보내지 않은 입력' })
    await untilList()
    expect(router.state.location.pathname).toBe('/pending')
    expect(titles()).toEqual(['풀린 동안'])
  })

  it('넓은 화면: 공통 틀 안에서 같은 배치이고 목록은 내용 폭 720px로 제한한다', async () => {
    await seedPending(expense())
    await openPending({ width: 1280 })
    const main = getComputedStyle(screen.getByRole('main'))
    expect(main.getPropertyValue('--content-width')).toBe('var(--width-content-wide)')
    expect(screen.getByRole('main').contains(sendNow())).toBe(true)
    expect(screen.getByRole('main').contains(rows()[0])).toBe(true)
  })
})
