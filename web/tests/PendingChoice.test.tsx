import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { seedPending } from './support/device'
import { untilOpened, untilUnshielded } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { holdClock, passTime, releaseClock } from './support/testClock'
import { toastRegion } from './support/toast'
import { startTransactionDetail, type TransactionDetailServer } from './support/transactionDetail'
import { startTransactionList } from './support/transactionList'
import { id, LEDGER, openApp, resetGlobals, settle, startServer, type Opened } from './support/transactionScreen'
import { savedOf, type Transactions } from './support/transactions'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 보내지 않은 입력 목록(B-05)의 "비교해서 고르기"(#280, ADR 006 결정 3, N-04 모양). current가 있는 409 ID_CONFLICT로 보낼 수 없음이
 * 된 줄에서 #239의 선택 판을 열고 고른다. 문구·모양·초점은 designer #280(이슈 댓글과 D1~D6), 범위는 planner #280 P1·P2다.
 * 판 자체(비교 줄, 버튼, 처리 중, 실패 문구)는 IdConflictChoice.test.tsx가 D-04 저장에서 본다. 여기서는 대기열의 줄로 연 판과
 * 고른 뒤 그 줄의 일을 본다. 저절로 보내기가 앞지르지 않게 화면을 숨겨 둔 채 연다(저절로 보내기는 화면이 보일 때만 보낸다).
 */

const server = startMockServer()
let backend: Backend
let transactions: Transactions
let detail: TransactionDetailServer

const NOW = '2026-11-26T12:30:00+09:00'
const now = Date.parse(NOW)
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const TITLE = '이미 저장된 거래가 있어요'
const REASON = '이미 저장된 거래와 내용이 달라 보낼 수 없어요. 비교해서 골라 주세요.'
const KEPT = '저장된 내용으로 두었어요'
const SAVED = '저장했어요'
const QUEUED = '기기에 저장했어요. 연결되면 보낼게요.'
const CHANGED_ELSEWHERE = '다른 곳에서 먼저 바뀐 입력이에요. 목록에서 확인해 주세요.'
const KEEP_FAILED = '문제가 생겨 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
const SAVE_FAILED = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const SAVE_LOST = '연결이 끊겨 저장하지 못했어요. 연결되면 다시 시도해 주세요.'
const SAVE_OFFLINE = '연결되면 저장할 수 있어요'
const KEPT_NOTICE = '저장된 거래는 그대로 남아요'
const ACCOUNT_GONE = '계좌가 삭제되어 보낼 수 없어요. 다른 계좌를 골라 보내 주세요.'

let visibility: DocumentVisibilityState = 'hidden'

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  startTransactionList(server, backend)
  detail = startTransactionDetail(server, backend)
  installIntersectionObserver()
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
  vi.restoreAllMocks()
})

let count = 0
function expense(fields: Record<string, unknown> = {}) {
  count += 1
  return {
    userId: 'user-1',
    ledgerId: LEDGER,
    queuedAt: now + count,
    body: {
      id: `0193a000-0000-7000-8000-${String(count).padStart(12, '0')}`,
      type: 'EXPENSE' as const,
      occurredOn: '2026-11-26',
      occurredTime: '12:10',
      accountId: id.salary,
      categoryId: id.food,
      amount: 5000,
      payee: `지출 ${count}`,
      memo: null,
      ...fields,
    },
  }
}

type Item = ReturnType<typeof expense>
type Stored = ReturnType<typeof savedOf>

/** 서버가 거부해 보낼 수 없음이 된 입력을 쌓는다(앱을 열기 전에 부른다) */
async function seedRejected(item: Item, refusal: { status: number; code: string; current?: unknown }) {
  await seedPending(item)
  vi.resetModules()
  const { pendingOf, settlePending } = await import('../src/device/pendingQueue')
  const seen = (await pendingOf(item.userId)).find(({ id: rowId }) => rowId === item.body.id)!
  await settlePending(seen, { kind: 'rejected', fieldErrors: [], at: now, ...refusal })
}

/** 같은 id로 내용이 다르게 저장된 거래(서버에도 있다)와 그 409 ID_CONFLICT로 보낼 수 없음이 된 줄 */
async function seedConflict(item: Item, changes: object = { amount: 15000, payee: '올래국수' }): Promise<Stored> {
  const stored = savedOf(item.body, 'user-1', changes)
  detail.put(stored)
  await seedRejected(item, { status: 409, code: 'ID_CONFLICT', current: stored })
  return stored
}

/** 앱이 불러 둔 대기열 모듈(seedRejected가 모듈을 다시 읽었다) */
async function queue() {
  return import('../src/device/pendingQueue')
}

async function queueOf() {
  return (await queue()).pendingOf('user-1')
}

const rows = () => [...document.querySelectorAll<HTMLElement>('ul[class*="_rows_"] > li')]
const rowOf = (title: string) => screen.getByText(title).closest('li')!
const titles = () => rows().map((row) => row.querySelector('[class*="_title_"]')!.textContent)
const chooseIn = (row: HTMLElement) => within(row).queryByRole('button', { name: '비교해서 고르기' })
const fixIn = (row: HTMLElement) => within(row).queryByRole('link', { name: '고쳐서 보내기' })
const discardIn = (row: HTMLElement) => within(row).getByRole('button', { name: '버리기' })
const board = () => screen.queryByRole('dialog', { name: TITLE })
const inBoard = (name: string) => within(board()!).queryAllByRole('button', { name }).at(-1)
const keepButton = () => inBoard('저장된 내용 그대로')!
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true' || (button as HTMLButtonElement).disabled
const toastText = () => toastRegion().textContent

function compareRows() {
  return [...board()!.querySelectorAll('dl > div')].map((row) => [
    row.querySelector('dt')!.textContent,
    ...[...row.querySelectorAll('dd')].map((value) => value.lastElementChild!.textContent),
  ])
}

async function openPending({ width = 390 } = {}): Promise<Opened> {
  installMatchMedia(width)
  const opened = await openApp('/pending')
  await screen.findByRole('heading', { level: 1, name: '보내지 않은 입력' })
  await waitFor(() => expect(rows().length).toBeGreaterThan(0))
  await settle()
  setViewportWidth(width)
  return opened
}

/** 그 줄의 "비교해서 고르기"(목록이 오면 생긴다)를 눌러 판을 연다 */
async function choose(opened: Opened, title: string) {
  const button = await waitFor(() => chooseIn(rowOf(title))!)
  await opened.user.click(button)
  await waitFor(() => expect(board()).toBeTruthy())
  await untilOpened()
}

describe('줄의 "비교해서 고르기"', () => {
  it('current가 있는 409 줄은 "고쳐서 보내기" 자리에 "비교해서 고르기"(글자 버튼, color-accent)가 있고 그 다음이 "버리기"다. 이유는 고르라는 문구다', async () => {
    const item = expense({ payee: '점심', amount: 12000 })
    await seedConflict(item)
    await openPending()
    const row = rowOf('점심')
    const button = await waitFor(() => chooseIn(row)!)
    expect(button.className).toMatch(/_text_/)
    expect(getComputedStyle(button).color).toBe('var(--color-accent)')
    expect(fixIn(row)).toBeNull()
    expect(within(row).getAllByRole('button').map((each) => each.textContent)).toEqual(['비교해서 고르기', '버리기'])
    expect(within(row).getByText(REASON)).toBeTruthy()
    const described = button.getAttribute('aria-describedby')!.split(' ').map((each) => document.getElementById(each)!.textContent)
    expect(described).toEqual(['점심', '12,000원', 'user-1의 장부 · 11월 26일 (목) · 지출'])
  })

  it('current가 없는 409 줄은 그대로 "고쳐서 보내기"다', async () => {
    await seedRejected(expense({ payee: '겹친 id' }), { status: 409, code: 'ID_CONFLICT' })
    await openPending()
    const row = rowOf('겹친 id')
    expect(fixIn(row)).toBeTruthy()
    expect(chooseIn(row)).toBeNull()
  })

  it('그 장부의 계좌·카테고리를 사본에서도 서버에서도 얻지 못하면 이유와 "버리기"만 있다(planner #280 P2)', async () => {
    server.use(http.get('/api/v1/ledgers/:ledgerId/accounts', () => problem(500, 'INTERNAL_ERROR')))
    await seedConflict(expense({ payee: '목록 없음' }))
    await openPending()
    await settle()
    const row = rowOf('목록 없음')
    expect(within(row).getAllByRole('button').map((each) => each.textContent)).toEqual(['버리기'])
    expect(fixIn(row)).toBeNull()
    expect(within(row).getByText(REASON)).toBeTruthy()
  })

  it('누르면 선택 판이 열리고 처음 초점은 판 제목이다. 저장된 내용과 내 입력의 다른 항목만 줄로 보인다', async () => {
    await seedConflict(expense({ payee: '점심', amount: 12000 }), { amount: 15000, payee: '올래국수' })
    const opened = await openPending()
    await choose(opened, '점심')
    expect(document.activeElement).toBe(within(board()!).getByRole('heading', { name: TITLE }))
    expect(compareRows()).toEqual([
      ['금액', '15,000원', '12,000원'],
      ['가맹점/내용', '올래국수', '점심'],
    ])
    const buttons = [...board()!.querySelectorAll('[class*="actions"] button')].map((button) => button.textContent)
    expect(buttons).toEqual(['저장된 내용 그대로', '내 입력으로 고치기'])
  })

  it('줄의 다른 자리를 눌러도 판이 열린다', async () => {
    await seedConflict(expense({ payee: '줄 누르기' }))
    const opened = await openPending()
    await waitFor(() => expect(chooseIn(rowOf('줄 누르기'))).toBeTruthy())
    await opened.user.click(rowOf('줄 누르기').querySelector('[class*="_meta_"]')!)
    await waitFor(() => expect(board()).toBeTruthy())
  })

  it('키보드: 엔터로 열고, 고르지 않고 Esc로 닫으면 초점이 그 줄의 "비교해서 고르기"로 돌아온다. 줄은 그대로다', async () => {
    await seedConflict(expense({ payee: '키보드' }))
    const opened = await openPending()
    const button = await waitFor(() => chooseIn(rowOf('키보드'))!)
    button.focus()
    await opened.user.keyboard('{Enter}')
    await waitFor(() => expect(board()).toBeTruthy())
    await untilOpened()
    await opened.user.keyboard('{Escape}')
    await waitFor(() => expect(board()).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(chooseIn(rowOf('키보드'))))
    expect(await queueOf()).toHaveLength(1)
    expect(detail.requests.update).toHaveLength(0)
  })

  it('지금 보내기 처리 중에는 "비교해서 고르기"와 줄 누르기가 막힌다(designer #280 D6)', async () => {
    await seedPending(expense({ payee: '대기 줄' }))
    await seedConflict(expense({ payee: '고를 줄' }))
    const answer = delayed()
    transactions.response = answer.respond
    const opened = await openPending()
    const button = await waitFor(() => chooseIn(rowOf('고를 줄'))!)
    await opened.user.click(screen.getByRole('button', { name: '지금 보내기' }))
    await answer.arrived
    expect(isDisabled(chooseIn(rowOf('고를 줄'))!)).toBe(true)
    fireEvent.click(rowOf('고를 줄').querySelector('[class*="_meta_"]')!)
    fireEvent.click(button)
    await settle()
    expect(board()).toBeNull()
    answer.answer(HttpResponse.json(savedOf(transactions.sent[0].body), { status: 201 }))
    await waitFor(() => expect(titles()).toEqual(['고를 줄']))
  })
})

describe('"저장된 내용 그대로"', () => {
  it('보내지 않고 그 줄을 지운다. 토스트 "저장된 내용으로 두었어요", 초점은 다음 줄의 버리기다', async () => {
    await seedConflict(expense({ payee: '첫째' }))
    await seedConflict(expense({ payee: '둘째' }))
    const opened = await openPending()
    await choose(opened, '첫째')
    await opened.user.click(keepButton())
    await waitFor(() => expect(toastText()).toBe(KEPT))
    await waitFor(() => expect(titles()).toEqual(['둘째']))
    await waitFor(() => expect(document.activeElement).toBe(discardIn(rowOf('둘째'))))
    expect(detail.requests.update).toHaveLength(0)
    expect(transactions.sent).toHaveLength(0)
    expect((await queueOf()).map(({ body }) => body.payee)).toEqual(['둘째'])
  })

  it('다른 탭이 대기열 잠금을 15초 넘게 놓지 않으면 버튼 위에 문구, 주 버튼 글자는 그대로이고 초점은 "저장된 내용 그대로"다(designer #280 D3)', async () => {
    await seedConflict(expense({ payee: '막힘' }))
    const opened = await openPending()
    await choose(opened, '막힘')
    const held = Promise.withResolvers<void>()
    void navigator.locks.request('akkimpyo-queue', {}, () => held.promise)
    holdClock()
    await opened.user.click(keepButton())
    await passTime(15_000)
    expect((await within(board()!).findByRole('alert')).textContent).toBe(KEEP_FAILED)
    expect(inBoard('내 입력으로 고치기')).toBeTruthy()
    expect(inBoard('다시 시도')).toBeUndefined()
    expect(document.activeElement).toBe(keepButton())
    releaseClock()
    held.resolve()
    await opened.user.click(keepButton())
    await waitFor(() => expect(toastText()).toBe(KEPT))
    await untilUnshielded()
  })

  it('판을 연 사이 다른 탭이 그 줄을 버렸으면 판을 닫고 "다른 곳에서 먼저 바뀐 입력이에요"(designer #280 D4)', async () => {
    const item = expense({ payee: '버려진 줄' })
    await seedConflict(item)
    const opened = await openPending()
    await choose(opened, '버려진 줄')
    await act(async () => (await queue()).removePending('user-1', item.body.id))
    await opened.user.click(keepButton())
    await waitFor(() => expect(toastText()).toBe(CHANGED_ELSEWHERE))
    expect(board()).toBeNull()
  })
})

describe('"내 입력으로 고치기"', () => {
  it('그 줄의 장부로 저장된 거래의 version과 내 입력을 보내고, 저장되면 줄을 지우고 "저장했어요"', async () => {
    const item = expense({ payee: '고칠 것', amount: 12000 })
    await seedConflict(item)
    const opened = await openPending()
    await choose(opened, '고칠 것')
    await opened.user.click(inBoard('내 입력으로 고치기')!)
    await waitFor(() => expect(toastText()).toBe(SAVED))
    expect(board()).toBeNull()
    expect(detail.requests.update).toHaveLength(1)
    const [sent] = detail.requests.update
    expect(sent.ledgerId).toBe(LEDGER)
    expect(sent.id).toBe(item.body.id)
    expect(sent.user).toBe('user-1')
    expect(sent.body).toMatchObject({ version: 1, amount: 12000, payee: '고칠 것', accountId: id.salary, categoryId: id.food })
    await waitFor(async () => expect(await queueOf()).toEqual([]))
    await waitFor(() => expect(screen.getByText('보낼 입력이 없어요. 모두 보냈어요.')).toBeTruthy())
  })

  it('그사이 또 고쳐졌으면(409 STALE_VERSION) 판을 새 저장된 내용으로 다시 그리고 초점은 판 제목이다. 다시 누르면 새 version으로 보낸다', async () => {
    const item = expense({ payee: '또 고침', amount: 12000 })
    const stored = await seedConflict(item, { amount: 15000 })
    const opened = await openPending()
    await choose(opened, '또 고침')
    detail.put({ ...stored, version: 2, amount: 17000 })
    await opened.user.click(inBoard('내 입력으로 고치기')!)
    await waitFor(() => expect(compareRows()).toEqual([['금액', '17,000원', '12,000원']]))
    await waitFor(() => expect(document.activeElement).toBe(within(board()!).getByRole('heading', { name: TITLE })))
    const [row] = await queueOf()
    expect(row.state).toMatchObject({ kind: 'rejected', code: 'ID_CONFLICT', current: { version: 2, amount: 17000 } })
    await opened.user.click(inBoard('내 입력으로 고치기')!)
    await waitFor(() => expect(toastText()).toBe(SAVED))
    expect(detail.requests.update.map(({ body }) => (body as { version: number }).version)).toEqual([1, 2])
  })

  it('새 저장된 내용이 내 입력과 같으면 저장에 성공한 것이다', async () => {
    const item = expense({ payee: '같아짐' })
    const stored = await seedConflict(item, { amount: 15000 })
    const opened = await openPending()
    await choose(opened, '같아짐')
    detail.put({ ...stored, version: 2, amount: item.body.amount })
    await opened.user.click(inBoard('내 입력으로 고치기')!)
    await waitFor(() => expect(toastText()).toBe(SAVED))
    expect(detail.requests.update).toHaveLength(1)
    expect(await queueOf()).toEqual([])
  })

  it('서버가 칸으로 거부하면 판을 닫고 그 줄을 그 거부의 보낼 수 없음으로 바꾼다. 토스트 없이 초점은 그 줄의 "고쳐서 보내기"다(designer #280 D1)', async () => {
    const item = expense({ payee: '거부됨' })
    await seedConflict(item)
    detail.updateResponse = () => problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'accountId', code: 'NOT_FOUND' }] })
    const opened = await openPending()
    await choose(opened, '거부됨')
    await opened.user.click(inBoard('내 입력으로 고치기')!)
    await waitFor(() => expect(board()).toBeNull())
    await waitFor(() => expect(within(rowOf('거부됨')).getByText(ACCOUNT_GONE)).toBeTruthy())
    await waitFor(() => expect(document.activeElement).toBe(fixIn(rowOf('거부됨'))))
    expect(toastText()).toBe('')
    const [row] = await queueOf()
    expect(row).toMatchObject({ id: item.body.id, state: { kind: 'rejected', status: 400, code: 'VALIDATION_FAILED' } })
  })

  it('연결이 없으면 비활성이고 그 위에 "연결되면 저장할 수 있어요"', async () => {
    await seedConflict(expense({ payee: '연결 없음' }))
    const opened = await openPending()
    await choose(opened, '연결 없음')
    goOffline()
    await waitFor(() => expect(isDisabled(inBoard('내 입력으로 고치기')!)).toBe(true))
    expect(within(board()!).getByText(SAVE_OFFLINE)).toBeTruthy()
  })

  it('요청 중에 연결이 끊기면 판 안에 문구, 줄은 그대로다', async () => {
    await seedConflict(expense({ payee: '끊김' }))
    detail.updateResponse = () => HttpResponse.error()
    const opened = await openPending()
    await choose(opened, '끊김')
    await opened.user.click(inBoard('내 입력으로 고치기')!)
    expect((await within(board()!).findByRole('alert')).textContent).toBe(SAVE_LOST)
    expect((await queueOf())[0].state).toMatchObject({ code: 'ID_CONFLICT' })
  })

  it('처리 중에는 판이 닫히지 않는다. 서버 오류면 판 안에 문구와 "다시 시도", 누르면 같은 수정을 다시 보낸다', async () => {
    await seedConflict(expense({ payee: '서버 오류' }))
    const answer = delayed()
    detail.updateResponse = answer.respond
    const opened = await openPending()
    await choose(opened, '서버 오류')
    await opened.user.click(inBoard('내 입력으로 고치기')!)
    await answer.arrived
    expect(inBoard('내 입력으로 고치기')!.getAttribute('aria-busy')).toBe('true')
    expect(isDisabled(keepButton())).toBe(true)
    fireEvent.keyDown(board()!, { key: 'Escape' })
    await settle()
    expect(board()).toBeTruthy()
    answer.answer(problem(500, 'INTERNAL_ERROR'))
    expect((await within(board()!).findByRole('alert')).textContent).toBe(SAVE_FAILED)
    expect(document.activeElement).toBe(inBoard('다시 시도'))
    detail.updateResponse = undefined
    await opened.user.click(inBoard('다시 시도')!)
    await waitFor(() => expect(toastText()).toBe(SAVED))
    expect(detail.requests.update.map(({ body }) => body)).toEqual([detail.requests.update[0].body, detail.requests.update[0].body])
  })
})

describe('유형이 다를 때 "새 거래로 저장"', () => {
  async function seedOtherType(item: Item) {
    const stored = savedOf({ ...item.body, type: 'TRANSFER', fromAccountId: id.salary, toAccountId: id.saving })
    detail.put(stored)
    await seedRejected(item, { status: 409, code: 'ID_CONFLICT', current: stored })
  }

  it('주 버튼은 "새 거래로 저장"이고 그 위에 "저장된 거래는 그대로 남아요". 누르면 새 UUID v7로 만들고 줄을 지운다', async () => {
    const item = expense({ payee: '다른 유형', amount: 12000 })
    await seedOtherType(item)
    const opened = await openPending()
    await choose(opened, '다른 유형')
    expect(inBoard('내 입력으로 고치기')).toBeUndefined()
    expect(within(board()!).getByText(KEPT_NOTICE)).toBeTruthy()
    await opened.user.click(inBoard('새 거래로 저장')!)
    await waitFor(() => expect(toastText()).toBe(SAVED))
    expect(transactions.sent).toHaveLength(1)
    const [sent] = transactions.sent
    expect(sent.ledgerId).toBe(LEDGER)
    expect(sent.user).toBe('user-1')
    expect(sent.body.id).toMatch(UUID_V7)
    expect(sent.body.id).not.toBe(item.body.id)
    expect(sent.body).toMatchObject({ type: 'EXPENSE', amount: 12000, payee: '다른 유형' })
    expect(detail.requests.update).toHaveLength(0)
    expect(await queueOf()).toEqual([])
  })

  it('서버 오류 뒤의 다시 시도는 같은 새 id로 보낸다', async () => {
    await seedOtherType(expense({ payee: '다시 시도' }))
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openPending()
    await choose(opened, '다시 시도')
    await opened.user.click(inBoard('새 거래로 저장')!)
    expect((await within(board()!).findByRole('alert')).textContent).toBe(SAVE_FAILED)
    transactions.response = undefined
    await opened.user.click(inBoard('다시 시도')!)
    await waitFor(() => expect(toastText()).toBe(SAVED))
    expect(transactions.sent.map(({ body }) => body.id)).toEqual([transactions.sent[0].body.id, transactions.sent[0].body.id])
  })

  it('연결이 없어도 누를 수 있고, 누르면 판을 닫고 그 줄을 원래 자리의 새 id 대기로 바꾼다. 초점은 그 줄의 버리기다(designer #280 D2)', async () => {
    await seedPending(expense({ payee: '앞 줄' }))
    const item = expense({ payee: '연결 없이' })
    await seedOtherType(item)
    await seedPending(expense({ payee: '뒤 줄' }))
    const opened = await openPending()
    await choose(opened, '연결 없이')
    goOffline()
    await settle()
    expect(isDisabled(inBoard('새 거래로 저장')!)).toBe(false)
    await opened.user.click(inBoard('새 거래로 저장')!)
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    expect(transactions.sent).toHaveLength(0)
    const rowsNow = await queueOf()
    expect(rowsNow.map(({ body }) => body.payee)).toEqual(['앞 줄', '연결 없이', '뒤 줄'])
    const changed = rowsNow[1]
    expect(changed.id).toMatch(UUID_V7)
    expect(changed.id).not.toBe(item.body.id)
    expect(changed.state).toEqual({ kind: 'waiting' })
    expect(changed.body).toMatchObject({ id: changed.id, type: 'EXPENSE', payee: '연결 없이' })
    await waitFor(() => expect(document.activeElement).toBe(discardIn(rowOf('연결 없이'))))
  })

  it('요청 중에 연결이 끊겨도 새 id의 대기로 바꾼다', async () => {
    await seedOtherType(expense({ payee: '끊김' }))
    transactions.response = () => HttpResponse.error()
    const opened = await openPending()
    await choose(opened, '끊김')
    await opened.user.click(inBoard('새 거래로 저장')!)
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    const [row] = await queueOf()
    expect(row.state).toEqual({ kind: 'waiting' })
    expect(row.id).toBe(transactions.sent[0].body.id)
  })

  it('서버가 칸으로 거부하면 새 id의 줄을 그 거부의 보낼 수 없음으로 바꾸고 초점은 그 줄의 "고쳐서 보내기"다(designer #280 D1)', async () => {
    await seedOtherType(expense({ payee: '새 id 거부' }))
    transactions.response = () => problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'accountId', code: 'NOT_FOUND' }] })
    const opened = await openPending()
    await choose(opened, '새 id 거부')
    await opened.user.click(inBoard('새 거래로 저장')!)
    await waitFor(() => expect(within(rowOf('새 id 거부')).getByText(ACCOUNT_GONE)).toBeTruthy())
    const [row] = await queueOf()
    expect(row.id).toBe(transactions.sent[0].body.id)
    expect(row.state).toMatchObject({ kind: 'rejected', status: 400, code: 'VALIDATION_FAILED' })
    await waitFor(() => expect(document.activeElement).toBe(fixIn(rowOf('새 id 거부'))))
    expect(fixIn(rowOf('새 id 거부'))!.getAttribute('href')).toBe(`/pending/${row.id}/edit`)
  })
})
