import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { seedLedgerCopy, seedLogin, seedMeCopy, seedPending } from './support/device'
import { untilOpened } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { passTime } from './support/testClock'
import { toastRegion } from './support/toast'
import { startTransactionList } from './support/transactionList'
import {
  accountField,
  accountItems,
  amount,
  categoryField,
  categoryItems,
  closeButton,
  discardQuestion,
  errorOf,
  heading,
  id,
  LEDGER,
  memo,
  openApp,
  path,
  payee,
  pick,
  resetGlobals,
  saveButton,
  settle,
  startServer,
  time,
  type Opened,
  type User,
} from './support/transactionScreen'
import { savedOf, type Transactions } from './support/transactions'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 보낼 수 없는 입력 고쳐서 다시 보내기(F-108, B-05 (7), D-04 (33), P-226, ADR 006 결정 3·6, #237).
 * 보내지 않은 입력 목록(B-05)의 보낼 수 없음 줄에서 그 입력을 채운 거래 입력(D-04)을 열고, 저장하면 그 줄을 대기로 바꿔 바로 보낸다.
 * 문구와 모양은 화면설계서와 designer #237 D1~D9, 주소·없는 입력·쓰던 값은 planner #237 P1~P3, 같은 id와 보내기는 architect #237
 * A1·A2다. 보내기와 응답 처리는 #235의 sendQueue(sendQueue.test.ts), 줄 바꾸기는 refilePending(pendingQueue.test.ts)이 본다.
 * 저절로 보내기가 앞지르지 않게 화면을 숨겨 둔 채 연다(저절로 보내기는 화면이 보일 때만 보낸다).
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
      occurredTime: '12:10',
      accountId: id.salary,
      categoryId: id.food,
      amount: 5000,
      payee: `지출 ${count}`,
      memo: '팀 점심',
      ...fields,
    },
  }
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

const accountGone = { fieldErrors: [{ field: 'accountId', code: 'NOT_FOUND' }] }
const categoryGone = { fieldErrors: [{ field: 'categoryId', code: 'NOT_FOUND' }] }
const takenId = { status: 409, code: 'ID_CONFLICT' }

/** 서버가 거부해 보낼 수 없음이 된 입력을 쌓는다(앱을 열기 전에 부른다) */
async function seedRejected(item: Item, { status = 400, code = 'VALIDATION_FAILED', fieldErrors = [], current }: Refusal = {}) {
  await seedPending(item)
  vi.resetModules()
  const { pendingOf, settlePending } = await import('../src/device/pendingQueue')
  const seen = (await pendingOf(item.userId)).find(({ id: rowId }) => rowId === item.body.id)!
  const rejection = { kind: 'rejected' as const, status, code, fieldErrors, at: now, ...(current !== undefined && { current }) }
  await settlePending(seen, rejection)
  return item
}

/** 앱이 불러 둔 대기열 모듈로 읽는다(support/device의 queueOf는 모듈을 다시 읽는다) */
async function queueOf() {
  const { pendingOf } = await import('../src/device/pendingQueue')
  return pendingOf('user-1')
}

const fixPath = (item: Item) => `/pending/${item.body.id}/edit`
const listShown = () => document.querySelector('ul[class*="_rows_"]') ?? screen.queryByText('보낼 입력이 없어요. 모두 보냈어요.')
const rows = () => [...document.querySelectorAll<HTMLElement>('ul[class*="_rows_"] > li')]
const rowOf = (title: string) => screen.getByText(title).closest('li')!
const titles = () => rows().map((row) => row.querySelector('[class*="_title_"]')!.textContent)
const fixIn = (row: HTMLElement) => within(row).queryByRole('link', { name: '고쳐서 보내기' })
const discardIn = (row: HTMLElement) => within(row).getByRole('button', { name: '버리기' })
const sendNow = () => screen.queryByRole('button', { name: '지금 보내기' })
const band = () => screen.queryByText(/^보내지 못한 이유: /)
const toastText = () => toastRegion().textContent
const spoken = () => screen.getAllByRole('status').find((region) => /(^| )_spoken_/.test(region.className))!
const accept = (sent: { body: Record<string, unknown> }) => HttpResponse.json(savedOf(sent.body), { status: 201 })
const FIXED = '고쳐서 다시 보낼게요'
const CHANGED_ELSEWHERE = '다른 곳에서 먼저 바뀐 입력이에요. 목록에서 확인해 주세요.'
const UNPLACED = '입력한 값을 저장할 수 없어요. 고쳐서 보내 주세요.'
const SAVE_TROUBLE = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'

/** 화면 코드를 받는 동안의 틀에도 같은 제목이 있으므로 목록이나 데이터 없음을 기다린다(#251) */
async function untilList() {
  await waitFor(() => expect(listShown()).not.toBeNull())
}

async function openPending({ width = 390 } = {}): Promise<Opened> {
  installMatchMedia(width)
  const opened = await openApp('/pending')
  await screen.findByRole('heading', { level: 1, name: '보내지 않은 입력' })
  await untilList()
  await settle()
  setViewportWidth(width)
  return opened
}

/** 고쳐서 보내기로 연 거래 입력. 띠와 칸이 나올 때까지 기다린다 */
async function untilFixForm() {
  await waitFor(() => expect(band()).not.toBeNull())
  await screen.findByRole('textbox', { name: /^금액/ })
  await settle()
}

async function openFix(item: Item, { width = 390 } = {}): Promise<Opened> {
  installMatchMedia(width)
  const opened = await openApp(fixPath(item))
  await untilFixForm()
  setViewportWidth(width)
  return opened
}

/** 목록에서 그 줄의 고쳐서 보내기를 눌러 연다 */
async function fixFromList(title: string): Promise<Opened> {
  const opened = await openPending()
  await opened.user.click(fixIn(rowOf(title))!)
  await untilFixForm()
  return opened
}

/** 계좌 고르기 판에서 고른다 */
async function pickAccount(user: User, name: string, label = '계좌') {
  await pick(user, accountField(label), name)
}

/** 열린 확인 창 */
async function openedDialog(name: string) {
  await untilOpened()
  return screen.getByRole('dialog', { name })
}

async function backToList(opened: Opened) {
  await waitFor(() => expect(path(opened)).toBe('/pending'))
  await untilList()
}

/** 화면을 보여 저절로 보내기가 돌게 한다 */
function show() {
  visibility = 'visible'
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

describe('B-05 보낼 수 없음 줄의 동작(7)', () => {
  it('셋째 줄 오른쪽에 "고쳐서 보내기"(글자 버튼, color-accent), 그 다음 오른쪽 끝에 "버리기"가 있다. 화면 읽기에는 그 줄의 내용을 함께 읽는다', async () => {
    const item = await seedRejected(expense({ payee: '점심', amount: 12000 }), accountGone)
    await openPending()
    const row = rowOf('점심')
    const fix = fixIn(row)!
    expect(fix.getAttribute('href')).toBe(fixPath(item))
    expect(fix.className).toMatch(/_text_/)
    expect(getComputedStyle(fix).color).toBe('var(--color-accent)')
    expect(fix.compareDocumentPosition(discardIn(row)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const described = fix.getAttribute('aria-describedby')!.split(' ').map((each) => document.getElementById(each)!.textContent)
    expect(described).toEqual(['점심', '12,000원', 'user-1의 장부 · 11월 26일 (목) · 지출'])
  })

  it('대기 줄과 current가 있는 409 줄에는 없다(대기는 누를 수 없고, current가 있으면 #280의 비교해서 고르기 자리다)', async () => {
    await seedPending(expense({ payee: '대기 줄' }))
    await seedRejected(expense({ payee: '같은 id' }), { ...takenId, current: { id: 'saved', version: 1 } })
    await openPending()
    for (const title of ['대기 줄', '같은 id']) {
      expect(fixIn(rowOf(title))).toBeNull()
      expect(within(rowOf(title)).getAllByRole('button').map((button) => button.textContent)).toEqual(['버리기'])
    }
  })

  it('"고쳐서 보내기"를 누르면 그 입력을 채운 거래 입력(D-04)을 연다', async () => {
    const item = await seedRejected(expense({ payee: '고칠 것', amount: 12000 }), accountGone)
    const opened = await fixFromList('고칠 것')
    expect(path(opened)).toBe(fixPath(item))
    expect(heading()).toBeTruthy()
    expect([amount().value, payee().value]).toEqual(['12,000', '고칠 것'])
  })

  it('보낼 수 없음인 줄 전체를 눌러도 같다. 버리기를 누르면 열지 않고 버리기 확인 창이다', async () => {
    const item = await seedRejected(expense({ payee: '줄 누르기' }), accountGone)
    const opened = await openPending()
    await opened.user.click(discardIn(rowOf('줄 누르기')))
    await openedDialog('이 입력을 버릴까요?')
    expect(path(opened)).toBe('/pending')
    await opened.user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '이 입력을 버릴까요?' })).toBeNull())
    await opened.user.click(within(rowOf('줄 누르기')).getByText('보낼 수 없음'))
    await untilFixForm()
    expect(path(opened)).toBe(fixPath(item))
  })

  it('대기인 줄은 눌러도 아무 일이 없다', async () => {
    await seedPending(expense({ payee: '대기 줄' }))
    const opened = await openPending()
    await opened.user.click(screen.getByText('대기 줄'))
    await settle()
    expect(path(opened)).toBe('/pending')
  })

  it('지금 보내기 처리 중에는 버리기처럼 고쳐서 보내기와 줄 누르기를 막는다(designer #237 D5)', async () => {
    await seedPending(expense({ payee: '보내는 줄' }))
    await seedRejected(expense({ payee: '거부 줄' }), accountGone)
    const opened = await openPending()
    const late = delayed()
    transactions.response = () => late.respond()
    await opened.user.click(sendNow()!)
    await late.arrived
    const fix = fixIn(rowOf('거부 줄'))!
    await waitFor(() => expect(fix.getAttribute('aria-disabled')).toBe('true'))
    await opened.user.click(fix)
    await opened.user.click(screen.getByText('거부 줄'))
    await settle()
    expect(path(opened)).toBe('/pending')
    late.answer(HttpResponse.json(savedOf(expense({ payee: '보내는 줄' }).body), { status: 201 }))
    await waitFor(() => expect(fixIn(rowOf('거부 줄'))!.hasAttribute('aria-disabled')).toBe(false))
  })
})

describe('거래 입력(D-04) 열기와 보내지 못한 이유(33)', () => {
  it('화면 이름 "거래 입력" 바로 아래에 위험색 글자의 한 줄 띠를 보인다(text-secondary, designer #237 D9). 전체 화면이라 하단 탭이 없다', async () => {
    const item = await seedRejected(expense(), accountGone)
    await openFix(item)
    const shown = band()!
    expect(shown.textContent).toBe('보내지 못한 이유: 계좌가 삭제되었어요')
    expect(getComputedStyle(shown).color).toBe('var(--color-danger)')
    expect(getComputedStyle(shown).font).toBe('var(--text-secondary)')
    expect(heading().compareDocumentPosition(shown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 칸보다 앞이다
    expect(shown.compareDocumentPosition(amount()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
  })

  it('계좌가 삭제됐으면 계좌를 비우고 오류를 붙인 채 열며, 초점은 계좌 칸이다', async () => {
    const item = await seedRejected(expense(), accountGone)
    await openFix(item)
    expect(accountField().textContent).not.toContain('급여통장')
    expect(errorOf(accountField())).toBe('고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.')
    expect(document.activeElement).toBe(accountField())
  })

  it('카테고리가 삭제됐으면 카테고리를 비우고(미분류) 오류를 붙인 채 열며, 초점은 카테고리 칸이다', async () => {
    const item = await seedRejected(expense(), categoryGone)
    await openFix(item)
    expect(band()!.textContent).toBe('보내지 못한 이유: 카테고리가 삭제되었어요')
    expect(categoryField().textContent).toContain('미분류')
    expect(errorOf(categoryField())).toBe('고른 카테고리가 삭제되었어요. 다시 골라 주세요.')
    expect(document.activeElement).toBe(categoryField())
  })

  it('검증 실패면 서버가 알려 준 칸에 검증 오류 문구를 붙이고 초점은 그 칸이다', async () => {
    const item = await seedRejected(expense({ payee: '긴 가맹점' }), { fieldErrors: [{ field: 'payee', code: 'TOO_LONG' }] })
    await openFix(item)
    expect(band()!.textContent).toBe('보내지 못한 이유: 입력한 값을 저장할 수 없어요')
    expect(errorOf(payee())).toBe('100자까지 쓸 수 있어요')
    expect(document.activeElement).toBe(payee())
  })

  it('서버가 칸을 알려 주지 않으면 저장 버튼 바로 위에 문구를 보이고, 초점은 금액 칸이다(designer #237 D3·D4)', async () => {
    const item = await seedRejected(expense())
    await openFix(item)
    const message = screen.getByText(UNPLACED)
    expect(message.closest('p')!.compareDocumentPosition(saveButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(getComputedStyle(message.closest('p')!).color).toBe('var(--color-danger)')
    expect(document.activeElement).toBe(amount())
  })

  it('current가 없는 409는 띠만 있고 저장 위 문구가 없으며, 초점은 금액 칸이다', async () => {
    const item = await seedRejected(expense(), takenId)
    await openFix(item)
    expect(band()!.textContent).toBe('보내지 못한 이유: 이미 있는 다른 거래와 겹쳤어요')
    expect(screen.queryByText(UNPLACED)).toBeNull()
    expect(document.activeElement).toBe(amount())
  })

  it('쌓은 값을 모두 채우고, 값을 채운 입력이라 "더 보기"를 펼친 채 연다', async () => {
    const item = await seedRejected(expense({ payee: '점심', amount: 12000, occurredTime: '12:10', memo: '팀 점심' }), categoryGone)
    await openFix(item)
    expect([amount().value, payee().value, time().value, memo().value]).toEqual(['12,000', '점심', '12:10', '팀 점심'])
    expect(accountField().textContent).toContain('급여통장')
    expect(screen.getByRole('radio', { name: '지출' }).getAttribute('aria-checked')).toBe('true')
  })

  it('이체는 이체 칸으로 연다. 받는 계좌가 삭제됐으면 받는 계좌를 비운다', async () => {
    const item = await seedRejected(transfer(), { fieldErrors: [{ field: 'toAccountId', code: 'NOT_FOUND' }] })
    await openFix(item)
    expect(screen.getByRole('radio', { name: '이체' }).getAttribute('aria-checked')).toBe('true')
    expect(accountField('보내는 계좌').textContent).toContain('급여통장')
    expect(errorOf(accountField('받는 계좌'))).toBe('고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.')
    expect(document.activeElement).toBe(accountField('받는 계좌'))
  })

  it.each([
    ['이 기기에 없는 입력', async () => expense()],
    ['current가 있는 409(#280)', async () => seedRejected(expense(), { ...takenId, current: { id: 'saved', version: 1 } })],
  ])('고칠 수 없는 주소(%s)는 찾을 수 없음(N-01)이다(planner #237 P2)', async (_, make) => {
    const item = await make()
    installMatchMedia(390)
    await openApp(fixPath(item))
    await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
    expect(band()).toBeNull()
  })

  it('대기인 입력의 주소는 대기 줄을 고치지 않고 찾을 수 없음이다', async () => {
    const item = expense()
    await seedPending(item)
    installMatchMedia(390)
    await openApp(fixPath(item))
    await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
  })

  it('UUID 모양이 아닌 주소도 찾을 수 없음이다', async () => {
    installMatchMedia(390)
    await openApp('/pending/not-an-id/edit')
    await screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
  })

  it('1B 임시: 넓은 화면에서도 목록 오른쪽 칸 없이 한 칸으로 연다(#244에서 맞춘다)', async () => {
    const item = await seedRejected(expense(), accountGone)
    await openFix(item, { width: 1280 })
    expect(heading()).toBeTruthy()
    expect(listShown()).toBeNull()
  })
})

describe('저장', () => {
  it('저장하면 그 줄은 원래 순서 자리에서 대기로 바뀌고, 목록으로 돌아가 토스트 "고쳐서 다시 보낼게요"를 보이며 바로 보낸다', async () => {
    await seedRejected(expense({ payee: '앞' }), { fieldErrors: [{ field: 'amount', code: 'OUT_OF_RANGE' }] })
    const item = await seedRejected(expense({ payee: '고칠 것' }), accountGone)
    await seedRejected(expense({ payee: '뒤' }), { fieldErrors: [{ field: 'amount', code: 'OUT_OF_RANGE' }] })
    const opened = await fixFromList('고칠 것')
    const late = delayed()
    transactions.response = () => late.respond()
    await pickAccount(opened.user, '비상금')
    await opened.user.click(saveButton())
    await backToList(opened)
    expect(toastText()).toBe(FIXED)
    expect(titles()).toEqual(['앞', '고칠 것', '뒤'])
    expect(within(rowOf('고칠 것')).getByText('대기')).toBeTruthy()
    const queued = await queueOf()
    expect(queued.map(({ body, state, queuedAt }) => [body.payee, state.kind, queuedAt])).toEqual([
      ['앞', 'rejected', item.queuedAt - 1],
      ['고칠 것', 'waiting', item.queuedAt],
      ['뒤', 'rejected', item.queuedAt + 1],
    ])
    // 같은 거래 id로 고친 값을 보낸다(architect #237 A1)
    await late.arrived
    expect(transactions.sent.map(({ body }) => [body.id, body.accountId])).toEqual([[item.body.id, id.saving]])
    late.answer(HttpResponse.json(savedOf(transactions.sent[0].body), { status: 201 }))
    await waitFor(() => expect(titles()).toEqual(['앞', '뒤']))
    // 보낸 건수는 저절로 보내기처럼 화면 읽기에 알린다(designer #237 D6)
    await waitFor(() => expect(spoken().textContent).toBe('1건을 보냈어요'))
  })

  it('보낸 본문은 고친 값이다. 쌓은 시각과 장부, 사용자는 그대로다', async () => {
    const item = await seedRejected(expense({ payee: '점심', amount: 12000 }), { fieldErrors: [{ field: 'amount', code: 'OUT_OF_RANGE' }] })
    const opened = await openFix(item)
    transactions.response = accept
    await opened.user.clear(amount())
    await opened.user.type(amount(), '13000')
    await opened.user.click(saveButton())
    await backToList(opened)
    await waitFor(() => expect(rows()).toEqual([]))
    expect(transactions.sent).toHaveLength(1)
    expect(transactions.sent[0].body).toEqual({
      id: item.body.id,
      type: 'EXPENSE',
      occurredOn: '2026-11-26',
      occurredTime: '12:10',
      accountId: id.salary,
      categoryId: id.food,
      amount: 13000,
      payee: '점심',
      memo: '팀 점심',
    })
  })

  it('current가 없는 409로 보낼 수 없던 입력은 새 거래 id로 보낸다(ADR 006 결정 3)', async () => {
    const item = await seedRejected(expense({ payee: '겹친 id' }), takenId)
    const opened = await openFix(item)
    const late = delayed()
    transactions.response = () => late.respond()
    await opened.user.click(saveButton())
    await backToList(opened)
    const [queued] = await queueOf()
    expect(queued.id).not.toBe(item.body.id)
    expect(queued.body.id).toBe(queued.id)
    expect(queued.queuedAt).toBe(item.queuedAt)
    await late.arrived
    expect(transactions.sent.map(({ body }) => body.id)).toEqual([queued.id])
    late.answer(accept(transactions.sent[0]))
    await waitFor(() => expect(rows()).toEqual([]))
  })

  it('다시 거부되면 그 줄이 새 이유로 보낼 수 없음이다', async () => {
    const item = await seedRejected(expense({ payee: '또 거부' }), accountGone)
    const opened = await openFix(item)
    transactions.response = () => problem(400, 'VALIDATION_FAILED', { fieldErrors: [{ field: 'categoryId', code: 'NOT_FOUND' }] })
    await pickAccount(opened.user, '비상금')
    await opened.user.click(saveButton())
    await backToList(opened)
    await waitFor(() =>
      expect(within(rowOf('또 거부')).getByText('카테고리가 삭제되어 보낼 수 없어요. 다른 카테고리를 골라 보내 주세요.')).toBeTruthy(),
    )
    expect(within(rowOf('또 거부')).getByText('보낼 수 없음')).toBeTruthy()
  })

  it('서버 오류로 보내지 못하면 그 줄은 대기로 남고 지금 보내기 위에 문구를 보인다', async () => {
    await seedRejected(expense({ payee: '서버 오류' }), accountGone)
    // 목록이 떠 있는 동안 끝난 보내기만 버튼 위 문구를 바꾼다(#236). 목록에서 연다
    const opened = await fixFromList('서버 오류')
    const late = delayed()
    transactions.response = () => late.respond()
    await pickAccount(opened.user, '비상금')
    await opened.user.click(saveButton())
    await backToList(opened)
    await late.arrived
    late.answer(problem(503, 'INTERNAL_ERROR'))
    expect((await screen.findByRole('alert')).textContent).toBe('문제가 생겨 보내지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(within(rowOf('서버 오류')).getByText('대기')).toBeTruthy()
  })

  it('200이고 알릴 것이 있으면 "고쳐서 다시 보낼게요" 뒤에 저절로 보내기와 같은 200 알림을 보인다', async () => {
    const item = await seedRejected(expense({ payee: '이미 저장됨' }), accountGone)
    const opened = await openFix(item)
    transactions.response = (sent) => HttpResponse.json(savedOf(sent.body, 'user-1', { version: 2 }), { status: 200 })
    await pickAccount(opened.user, '비상금')
    await opened.user.click(saveButton())
    await backToList(opened)
    expect(toastText()).toBe(FIXED)
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    await passTime(4_000)
    await waitFor(() => expect(toastText()).toBe('보낸 입력 1건은 이미 저장된 거래라 저장된 내용으로 두었어요'))
  })

  it('연결이 없으면 대기로 남고 보내지 않는다. 연결되면 저절로 보낸다', async () => {
    const item = await seedRejected(expense({ payee: '연결 없이 고침' }), accountGone)
    const opened = await openFix(item)
    act(() => goOffline())
    await pickAccount(opened.user, '비상금')
    await opened.user.click(saveButton())
    await backToList(opened)
    expect(toastText()).toBe(FIXED)
    expect(within(rowOf('연결 없이 고침')).getByText('대기')).toBeTruthy()
    await settle()
    expect(transactions.sent).toEqual([])
    transactions.response = accept
    show()
    act(() => goOnline())
    await waitFor(() => expect(transactions.sent.map(({ body }) => body.accountId)).toEqual([id.saving]))
    await waitFor(() => expect(rows()).toEqual([]))
  })

  it('연결 없이 연 기기(확인하지 못한 로그인)에서도 기기 사본으로 열고 고쳐 대기로 넣는다', async () => {
    const item = await seedRejected(expense({ payee: '사본으로' }), accountGone)
    await seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 10 * DAY })
    await seedMeCopy('user-1', meOf('user-1'), now - DAY)
    await seedLedgerCopy('user-1', LEDGER, 'accounts', accountItems, now - DAY)
    await seedLedgerCopy('user-1', LEDGER, 'categories', categoryItems, now - DAY)
    backend.refreshResponse = () => HttpResponse.error()
    const opened = await openFix(item)
    act(() => goOffline())
    await pickAccount(opened.user, '지갑')
    await opened.user.click(saveButton())
    await backToList(opened)
    const [queued] = await queueOf()
    expect([queued.state.kind, queued.body.accountId]).toEqual(['waiting', id.wallet])
    expect(transactions.sent).toEqual([])
  })

  it('기기에서 먼저 검증한다. 비운 계좌를 고르지 않고 저장하면 "계좌를 골라 주세요"이고 저장하지 않는다(기본 계좌로 채우지 않는다)', async () => {
    const item = await seedRejected(expense(), accountGone)
    const opened = await openFix(item)
    await opened.user.click(saveButton())
    await settle()
    expect(errorOf(accountField())).toBe('계좌를 골라 주세요')
    expect(document.activeElement).toBe(accountField())
    expect(path(opened)).toBe(fixPath(item))
    expect((await queueOf())[0].state.kind).toBe('rejected')
  })

  it('이 경로의 저장은 중복 경고를 하지 않는다(D-04 중복 경고)', async () => {
    const item = await seedRejected(expense({ payee: '올래국수', amount: 12000 }), { fieldErrors: [{ field: 'memo', code: 'TOO_LONG' }] })
    const opened = await openFix(item)
    transactions.response = accept
    await opened.user.clear(memo())
    await opened.user.click(saveButton())
    await backToList(opened)
    expect(screen.queryByRole('dialog', { name: '같은 거래가 이미 있어요' })).toBeNull()
    await waitFor(() => expect(rows()).toEqual([]))
  })

  it('그사이 다른 탭이 그 입력을 버렸으면 저장하지 않고 목록으로 돌아가 토스트를 보인다(designer #237 D7)', async () => {
    const item = await seedRejected(expense({ payee: '사라질 것' }), accountGone)
    await seedRejected(expense({ payee: '남는 것' }), accountGone)
    const opened = await openFix(item)
    await pickAccount(opened.user, '비상금')
    const { removePending } = await import('../src/device/pendingQueue')
    await act(() => removePending('user-1', item.body.id))
    await opened.user.click(saveButton())
    await backToList(opened)
    expect(toastText()).toBe(CHANGED_ELSEWHERE)
    expect(titles()).toEqual(['남는 것'])
    expect(transactions.sent).toEqual([])
  })

  it('그사이 다른 탭이 먼저 고쳐 대기로 넣었으면 덮어쓰지 않는다', async () => {
    const item = await seedRejected(expense({ payee: '먼저 고침' }), accountGone)
    const opened = await openFix(item)
    const { readPending, refilePending } = await import('../src/device/pendingQueue')
    const seen = (await readPending('user-1', item.body.id))!
    await act(() => refilePending(seen, { ...item.body, accountId: id.wallet }))
    await pickAccount(opened.user, '비상금')
    await opened.user.click(saveButton())
    await backToList(opened)
    expect(toastText()).toBe(CHANGED_ELSEWHERE)
    expect((await queueOf()).map(({ body }) => body.accountId)).toEqual([id.wallet])
  })

  it('기기 저장소를 쓸 수 없으면 저장 위에 문구와 "다시 시도"를 보이고 값을 둔다(designer #237 D8)', async () => {
    const item = await seedRejected(expense({ payee: '저장 실패' }), accountGone)
    const opened = await openFix(item)
    await pickAccount(opened.user, '비상금')
    const transaction = IDBDatabase.prototype.transaction
    const broken = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args) {
      if (args[1] === 'readwrite') throw new DOMException('막힘', 'InvalidStateError')
      return transaction.apply(this, args)
    })
    await opened.user.click(saveButton())
    const message = await screen.findByRole('alert')
    expect(message.textContent).toBe(SAVE_TROUBLE)
    expect(path(opened)).toBe(fixPath(item))
    expect(accountField().textContent).toContain('비상금')
    broken.mockRestore()
    transactions.response = accept
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await backToList(opened)
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    await waitFor(() => expect(rows()).toEqual([]))
  })

})

describe('닫기(D-04 (1))', () => {
  it('바꾼 값 없이 닫으면 바로 목록으로 가고 그 줄은 보낼 수 없음 그대로다', async () => {
    await seedRejected(expense({ payee: '그대로' }), accountGone)
    const opened = await fixFromList('그대로')
    await opened.user.click(closeButton())
    await backToList(opened)
    expect(discardQuestion()).toBeNull()
    expect(within(rowOf('그대로')).getByText('보낼 수 없음')).toBeTruthy()
    expect((await queueOf())[0].state.kind).toBe('rejected')
  })

  it('바꾼 값이 있으면 "쓰던 내용을 버릴까요?"를 거친다. 계속 쓰기는 값을 두고, 버리기는 목록으로 가며 그 줄은 그대로다', async () => {
    await seedRejected(expense({ payee: '바꾸다 닫음' }), accountGone)
    const opened = await fixFromList('바꾸다 닫음')
    await pickAccount(opened.user, '비상금')
    await opened.user.click(closeButton())
    const question = await openedDialog('쓰던 내용을 버릴까요?')
    await opened.user.click(within(question).getByRole('button', { name: '계속 쓰기' }))
    await waitFor(() => expect(discardQuestion()).toBeNull())
    expect(accountField().textContent).toContain('비상금')
    await opened.user.click(closeButton())
    await opened.user.click(within(await openedDialog('쓰던 내용을 버릴까요?')).getByRole('button', { name: '버리기' }))
    await backToList(opened)
    expect(within(rowOf('바꾸다 닫음')).getByText('보낼 수 없음')).toBeTruthy()
    expect((await queueOf())[0].body.accountId).toBe(id.salary)
  })

  it('브라우저 뒤로 가기도 같다', async () => {
    await seedRejected(expense({ payee: '뒤로' }), accountGone)
    const opened = await fixFromList('뒤로')
    await pickAccount(opened.user, '비상금')
    await act(() => opened.router.navigate(-1))
    await openedDialog('쓰던 내용을 버릴까요?')
    expect(path(opened)).not.toBe('/pending')
  })

  it('주소로 바로 열었으면 닫을 때 보내지 않은 입력 목록으로 간다', async () => {
    const item = await seedRejected(expense({ payee: '주소로' }), accountGone)
    const opened = await openFix(item)
    await opened.user.click(closeButton())
    await backToList(opened)
  })
})

describe('비로그인(D-04 예외 처리, planner #237 P3)', () => {
  it('비로그인으로 주소에 오면 로그인(A-02)으로 보내고, 로그인 뒤 이 화면으로 돌아온다', async () => {
    backend.cookieUser = undefined
    const item = await seedRejected(expense(), accountGone)
    installMatchMedia(390)
    const { user, router } = await openApp(fixPath(item))
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    await logIn(user)
    await untilFixForm()
    expect(router.state.location.pathname).toBe(fixPath(item))
  })

  it('쓰던 중 로그인이 풀리면 바꾼 값을 이 기기에 남기고, 같은 계정으로 돌아오면 채운다. 그 줄은 그동안 보낼 수 없음이다', async () => {
    const item = await seedRejected(expense({ payee: '쓰던 값' }), accountGone)
    // 다른 요청(저절로 보내기)이 로그인이 풀린 것을 알게 한다
    await seedPending(expense({ payee: '대기' }))
    const opened = await openFix(item)
    await pickAccount(opened.user, '비상금')
    backend.expireTokens()
    backend.cookieUser = undefined
    show()
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect((await queueOf()).find(({ id: rowId }) => rowId === item.body.id)!.state.kind).toBe('rejected')
    transactions.response = accept
    await logIn(opened.user)
    await untilFixForm()
    expect(path(opened)).toBe(fixPath(item))
    await waitFor(() => expect(accountField().textContent).toContain('비상금'))
    // 다시 로그인한 뒤 저절로 보내기가 대기 줄을 보낸다. 고치던 줄은 보낼 수 없음 그대로다
    await waitFor(async () => expect((await queueOf()).map(({ body }) => body.payee)).toEqual(['쓰던 값']))
  })
})

async function logIn(user: User) {
  backend.loginUser = 'user-1'
  backend.cookieUser = 'user-1'
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await user.click(screen.getByRole('button', { name: '로그인' }))
}
