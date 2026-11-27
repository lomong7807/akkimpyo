import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { seedLedgerCopy, seedPending } from './support/device'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { passTime } from './support/testClock'
import { startTransactionList } from './support/transactionList'
import { id, LEDGER, openApp, resetGlobals, settle, startServer, untilDefaultAccount } from './support/transactionScreen'
import { savedOf, type Transactions } from './support/transactions'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

/*
 * 동기화 상태 표시(B-04, F-104, 00-common 6.5, #235). 이 기기에서 이 계정이 쌓은 보내지 않은 입력이 1건 이상일 때만 보인다.
 * 휴대폰은 상단 바, 넓은 화면은 사이드바 맨 아래 묶음(2-4)과 마지막으로 맞춘 시각(2-3). 더보기 맨 아래에도 맞춘 시각(M-01 (16)).
 * B-04와 사이드바 건수 줄은 누르면 보내지 않은 입력 목록(B-05)으로 간다(#236). 이름 끝에 ", 목록 보기"를 붙인다(00-common 6.5).
 * 자동 보내기에서 200이고 알릴 것이 있으면 토스트 하나(designer #235 Q1, planner P1).
 */

const server = startMockServer()
let backend: Backend
let transactions: Transactions

const NOW = '2026-11-26T12:30:00+09:00'
const now = Date.parse(NOW)

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  startTransactionList(server, backend)
  installIntersectionObserver()
  server.use(http.head('/api/v1/', () => new HttpResponse(null, { status: 404, headers: { 'X-Request-Id': 'req-probe' } })))
  // 건수를 보는 파일이라 서버가 받지 않는다. 보내기를 보는 테스트는 따로 바꾼다
  transactions.response = () => problem(503, 'INTERNAL_ERROR')
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

let count = 0
function pending(userId = 'user-1', ledgerId = LEDGER) {
  count += 1
  return {
    userId,
    ledgerId,
    queuedAt: now + count,
    body: {
      id: `0193a000-0000-7000-8000-${String(count).padStart(12, '0')}`,
      type: 'EXPENSE' as const,
      occurredOn: '2026-11-26',
      occurredTime: null,
      accountId: id.salary,
      categoryId: null,
      amount: 5000,
      payee: `입력 ${count}`,
      memo: null,
    },
  }
}

/** 보낼 수 없음으로 둔 입력을 쌓는다(앱을 열기 전에 부른다) */
async function seedRejected(item = pending()) {
  await seedPending(item)
  vi.resetModules()
  const { pendingOf, settlePending } = await import('../src/device/pendingQueue')
  const seen = (await pendingOf(item.userId)).find(({ id: rowId }) => rowId === item.body.id)!
  await settlePending(seen, { kind: 'rejected', status: 400, code: 'VALIDATION_FAILED', fieldErrors: [], at: now })
}

/** 앱이 불러 둔 대기열 모듈(앱을 연 뒤에 쌓는다. seedPending은 모듈을 다시 읽어 앱의 보내기 조각이 엇갈린다) */
async function appQueue() {
  return import('../src/device/pendingQueue')
}

async function open(path = '/home', width = 390) {
  installMatchMedia(width)
  const opened = await openApp(path)
  await screen.findByRole('navigation', { name: '주 메뉴' })
  await settle()
  setViewportWidth(width)
  return opened
}

const topBar = () => document.querySelector<HTMLElement>('header[class*="_topBar_"]')!
/** B-04. 읽히는 이름은 숨긴 글자이고 보이는 아이콘·건수는 읽히지 않는다 */
const syncStatus = () => topBar().querySelector<HTMLElement>('[class*="_syncStatus_"]')
const sidebar = () => document.querySelector<HTMLElement>('[class*="_sidebar_"]')!
const sidebarBottom = () => sidebar().querySelector<HTMLElement>('[class*="_bottom_"]')!

describe('B-04 휴대폰 상단 바', () => {
  it('0건이면 자리도 없다', async () => {
    await open()
    expect(syncStatus()).toBeNull()
  })

  it('대기만 있으면 CloudArrowUp과 "{대기 건수}건", 이름은 "보내지 않은 입력 {N}건"', async () => {
    await seedPending(pending())
    await seedPending(pending())
    await open()
    const status = await waitFor(() => syncStatus()!)
    expect(within(status).getByText('보내지 않은 입력 2건, 목록 보기')).toBeTruthy()
    const parts = status.querySelectorAll('[class*="_part_"]')
    expect(parts).toHaveLength(1)
    expect(parts[0].textContent).toBe('2건')
    expect(parts[0].getAttribute('aria-hidden')).toBe('true')
  })

  it('보낼 수 없음이 있으면 대기의 왼쪽에 WarningCircle과 "{보낼 수 없음 건수}건"(위험색), 이름에 둘째 구절', async () => {
    await seedPending(pending())
    await seedPending(pending())
    await seedRejected()
    await open()
    const status = await waitFor(() => syncStatus()!)
    expect(within(status).getByText('보내지 않은 입력 3건, 그중 보낼 수 없음 1건, 목록 보기')).toBeTruthy()
    const parts = [...status.querySelectorAll<HTMLElement>('[class*="_part_"]')]
    expect(parts.map((part) => part.textContent)).toEqual(['1건', '2건'])
    expect(parts[0].className).toMatch(/_rejected_/)
    expect(getComputedStyle(parts[0]).color).toBe('var(--color-danger)')
    expect(getComputedStyle(parts[1]).color).toBe('var(--color-text-secondary)')
  })

  it('보낼 수 없음만 있으면 그것만 보인다', async () => {
    await seedRejected()
    await open()
    const status = await waitFor(() => syncStatus()!)
    expect(within(status).getByText('보내지 않은 입력 1건, 그중 보낼 수 없음 1건, 목록 보기')).toBeTruthy()
    expect(status.querySelectorAll('[class*="_part_"]')).toHaveLength(1)
  })

  it('다른 사용자가 이 기기에 쌓은 입력은 세지 않는다', async () => {
    await seedPending(pending('user-2'))
    await open()
    expect(syncStatus()).toBeNull()
  })

  it('한 덩어리가 보내지 않은 입력 목록(B-05)으로 가는 링크이고, 누르는 자리를 44px 이상으로 잡는다(#236)', async () => {
    await seedPending(pending())
    const opened = await open()
    const status = await waitFor(() => syncStatus()!)
    expect(status.tagName).toBe('A')
    expect(screen.getByRole('link', { name: '보내지 않은 입력 1건, 목록 보기' })).toBe(status)
    const style = getComputedStyle(status)
    expect(style.minHeight).toBe('var(--size-touch)')
    expect(style.minWidth).toBe('var(--size-touch)')
    await opened.user.click(status)
    await waitFor(() => expect(opened.router.state.location.pathname).toBe('/pending'))
  })

  it('글자는 text-caption 600, 아이콘은 20px이고 돌아가는 원이 없다', async () => {
    await seedPending(pending())
    await open()
    const status = await waitFor(() => syncStatus()!)
    const part = status.querySelector<HTMLElement>('[class*="_part_"]')!
    expect(getComputedStyle(part).font).toBe('var(--text-caption)')
    expect(getComputedStyle(part).fontWeight).toBe('600')
    expect(part.querySelector('svg')!.getAttribute('class')).toMatch(/size20/)
    expect(readWebFile('src/features/sync/SyncStatus.module.css')).not.toMatch(/animation|transition/)
  })

  it('하위 화면 상단 바에서는 화면별 버튼의 왼쪽에 있다', async () => {
    await seedPending(pending())
    await open('/accounts')
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    const status = await waitFor(() => syncStatus()!)
    const action = within(topBar()).getByRole('link', { name: '추가' })
    expect(status.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('전체 화면 입력에는 없다', async () => {
    await seedPending(pending())
    installMatchMedia(390)
    await openApp('/transactions/new')
    await untilDefaultAccount()
    expect(document.querySelector('[class*="_syncStatus_"]')).toBeNull()
  })

  it('넓은 화면에는 상단 바에 없다(사이드바에 있다)', async () => {
    await seedPending(pending())
    await open('/accounts', 1280)
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    const status = await waitFor(() => syncStatus()!)
    expect(getComputedStyle(status.parentElement!).display).toBe('none')
  })
})

describe('건수가 바뀌는 때', () => {
  it('쌓을 때, 서버가 거부했을 때, 버렸을 때 바로 바뀐다', async () => {
    await seedPending(pending())
    await open()
    await waitFor(() => expect(within(syncStatus()!).getByText('보내지 않은 입력 1건, 목록 보기')).toBeTruthy())
    const queue = await appQueue()
    const second = pending()
    await queue.queueTransaction(second)
    await waitFor(() => expect(within(syncStatus()!).getByText('보내지 않은 입력 2건, 목록 보기')).toBeTruthy())
    const seen = (await queue.pendingOf('user-1')).find(({ id: rowId }) => rowId === second.body.id)!
    await queue.settlePending(seen, { kind: 'rejected', status: 400, code: 'VALIDATION_FAILED', fieldErrors: [], at: now })
    await waitFor(() => expect(within(syncStatus()!).getByText('보내지 않은 입력 2건, 그중 보낼 수 없음 1건, 목록 보기')).toBeTruthy())
    await queue.removePending('user-1', second.body.id)
    await waitFor(() => expect(within(syncStatus()!).getByText('보내지 않은 입력 1건, 목록 보기')).toBeTruthy())
  })

  it('보내면 건수가 줄고 0건이면 사라진다', async () => {
    await seedPending(pending())
    await open()
    await waitFor(() => expect(syncStatus()).not.toBeNull())
    transactions.response = (sent) => HttpResponse.json(savedOf(sent.body), { status: 201 })
    await passTime(60_000)
    await waitFor(() => expect(syncStatus()).toBeNull())
  })

  it('연결이 없어도 건수가 보이고 쌓을 때마다 는다', async () => {
    await seedPending(pending())
    await open()
    act(() => goOffline())
    await waitFor(() => expect(within(syncStatus()!).getByText('보내지 않은 입력 1건, 목록 보기')).toBeTruthy())
    await (await appQueue()).queueTransaction(pending())
    await waitFor(() => expect(within(syncStatus()!).getByText('보내지 않은 입력 2건, 목록 보기')).toBeTruthy())
  })

  it('모든 장부의 합계다', async () => {
    await seedPending(pending('user-1', '1ed9e700-0000-4000-8000-0000000000ff'))
    await seedPending(pending())
    await open()
    await waitFor(() => expect(within(syncStatus()!).getByText('보내지 않은 입력 2건, 목록 보기')).toBeTruthy())
  })
})

describe('넓은 화면 사이드바 맨 아래 묶음', () => {
  it('"보내지 않은 입력 {N}건", 보낼 수 없음이 있으면 아랫줄 "그중 보낼 수 없음 {M}건"(위험색), 그 아래 맞춘 시각', async () => {
    await seedPending(pending())
    await seedRejected()
    await open('/home', 1280)
    const bottom = sidebarBottom()
    await waitFor(() => expect(within(bottom).getByText('보내지 않은 입력 2건')).toBeTruthy())
    const rejected = within(bottom).getByText('그중 보낼 수 없음 1건')
    expect(getComputedStyle(rejected).color).toBe('var(--color-danger)')
    expect(getComputedStyle(within(bottom).getByText('보내지 않은 입력 2건')).color).toBe('var(--color-text-secondary)')
    // 맞춘 시각은 홈이 사본을 처음 남긴 뒤에 "…에 맞춤"이 된다. 건수는 기기에서 바로 읽으므로 그보다 먼저 보일 수 있다
    const lines = () => [...bottom.querySelectorAll('a > span, p')].map((line) => line.textContent)
    await waitFor(() =>
      expect(lines()).toEqual(['보내지 않은 입력 2건', '그중 보낼 수 없음 1건', expect.stringMatching(/에 맞춤$/)]),
    )
    expect(within(bottom).queryByRole('button')).toBeNull()
  })

  it('건수 줄은 보내지 않은 입력 목록(B-05)으로 가는 링크이고 이름은 B-04와 같다. 누르는 자리는 44px 이상이다(#236)', async () => {
    await seedPending(pending())
    await seedRejected()
    const opened = await open('/home', 1280)
    const bottom = sidebarBottom()
    const link = await waitFor(() => within(bottom).getByRole('link', { name: '보내지 않은 입력 2건, 그중 보낼 수 없음 1건, 목록 보기' }))
    expect(getComputedStyle(link).minHeight).toBe('var(--size-touch)')
    await opened.user.click(link)
    await waitFor(() => expect(opened.router.state.location.pathname).toBe('/pending'))
  })

  it('0건이면 건수 줄 없이 맞춘 시각만 있다', async () => {
    await open('/home', 1280)
    const bottom = sidebarBottom()
    await waitFor(() => expect(within(bottom).getByText(/에 맞춤$|아직 맞추지 않았어요/)).toBeTruthy())
    expect(bottom.querySelectorAll('p')).toHaveLength(1)
  })

  it('창 높이가 모자라 사이드바 안에서 스크롤해도 맨 아래에 붙어 늘 보인다', async () => {
    await open('/home', 1280)
    expect(getComputedStyle(sidebar()).overflowY).toBe('auto')
    const bottom = getComputedStyle(sidebarBottom())
    expect(bottom.position).toBe('sticky')
    expect(bottom.bottom).toBe('0px')
    expect(bottom.marginTop).toBe('auto')
    expect(bottom.backgroundColor).toBe('var(--color-surface)')
  })
})

describe('마지막으로 맞춘 시각(2-3)', () => {
  it('사본을 받은 시각이 오늘이면 "{시각}에 맞춤"이다(사이드바와 더보기 맨 아래)', async () => {
    await open('/more')
    await screen.findByRole('link', { name: '계좌' })
    // 앱을 열며 내 정보를 받아 사본을 남겼다(12:30)
    const more = await screen.findByText('12:30에 맞춤', { selector: 'main p' })
    expect(more.closest('a, button')).toBeNull()
    expect(getComputedStyle(more).font).toBe('var(--text-caption)')
    expect(getComputedStyle(more).color).toBe('var(--color-text-secondary)')
    // 목록 맨 아래다
    const main = screen.getByRole('main')
    expect(main.lastElementChild!.contains(more) || main.lastElementChild === more).toBe(true)
  })

  it('한 번도 맞추지 못했으면 "아직 맞추지 않았어요"(연결 없이 연 기기)', async () => {
    backend.meResponse = () => problem(503, 'INTERNAL_ERROR')
    await seedLedgerCopy('user-2', LEDGER, 'accounts', { items: [] })
    vi.resetModules()
    const { readSyncedAt } = await import('../src/device/syncedAt')
    expect(await readSyncedAt('user-1')).toBeUndefined()
    const { NEVER_SYNCED } = await import('../src/features/sync/syncedText')
    expect(NEVER_SYNCED).toBe('아직 맞추지 않았어요')
  })

  it('휴대폰 상단 바에는 없다', async () => {
    await open('/home')
    expect(within(topBar()).queryByText(/에 맞춤$/)).toBeNull()
  })

  it('보내기에 성공하면 그 시각으로 바뀐다', async () => {
    await seedPending(pending())
    await open('/more')
    await screen.findByText('12:30에 맞춤', { selector: 'main p' })
    transactions.response = (sent) => HttpResponse.json(savedOf(sent.body), { status: 201 })
    // 시계를 앞으로만 옮기고 1분 계기로 보낸다
    setDeviceClock('2026-11-26T12:31:00+09:00')
    await passTime(60_000)
    expect(await screen.findByText('12:31에 맞춤', { selector: 'main p' })).toBeTruthy()
  })
})

describe('200 알림(ADR 006 결정 3, designer #235 Q1)', () => {
  it('한 번의 자동 보내기에서 알릴 것이 있으면 끝난 뒤 건수를 넣은 토스트 하나를 보인다', async () => {
    await seedPending(pending())
    await seedPending(pending())
    await seedPending(pending())
    transactions.response = (sent) =>
      sent.body.payee === `입력 ${count - 2}`
        ? HttpResponse.json(savedOf(sent.body), { status: 201 })
        : HttpResponse.json(savedOf(sent.body, 'user-1', { version: 2 }), { status: 200 })
    await open()
    expect(await screen.findByText('보낸 입력 2건은 이미 저장된 거래라 저장된 내용으로 두었어요')).toBeTruthy()
    expect(screen.getAllByText(/이미 저장된 거래라/)).toHaveLength(1)
  })

  it('알릴 것이 없으면(201, 고쳐지지 않은 200) 토스트가 없다', async () => {
    await seedPending(pending())
    transactions.response = (sent) => HttpResponse.json(savedOf(sent.body), { status: 200 })
    await open()
    await waitFor(() => expect(syncStatus()).toBeNull())
    await settle()
    expect(screen.queryByText(/이미 저장된 거래라/)).toBeNull()
  })
})
