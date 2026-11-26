import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { untilOpened } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { startTransactionDetail, type TransactionDetailServer } from './support/transactionDetail'
import {
  amount,
  discardQuestion,
  id,
  openFromMore,
  path,
  resetGlobals,
  saveButton,
  settle,
  startServer,
} from './support/transactionScreen'
import { savedOf, type SentTransaction, type Transactions } from './support/transactions'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 같은 거래를 다시 보냈는데 앞서 저장된 내용과 다를 때(current가 있는 409 ID_CONFLICT, ADR 006 결정 3)의 선택 판.
 * 문구와 모양은 designer, 동작은 planner의 답(#239 댓글, #102)이다. 대기열(#236)에서 받은 409의 선택은 #236에서 한다.
 */

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const title = '이미 저장된 거래가 있어요'
const description = '먼저 저장된 내용과 지금 입력이 달라요. 어느 쪽으로 할지 골라 주세요.'
const keptNotice = '저장된 거래는 그대로 남아요'
const lostConnection = '연결이 끊겨 저장하지 못했어요. 연결되면 다시 시도해 주세요.'
const serverFailure = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const offlineNotice = '연결되면 저장할 수 있어요'
const queued = '기기에 저장했어요. 연결되면 보낼게요.'

const server = startMockServer()
let backend: Backend
let transactions: Transactions
let detail: TransactionDetailServer

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  detail = startTransactionDetail(server, backend)
  detail.uncategorized = { EXPENSE: id.expenseNone, INCOME: id.incomeNone }
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const board = () => screen.queryByRole('dialog', { name: title })
const inBoard = (name: string) => within(board()!).queryAllByRole('button', { name }).at(-1)
const keepButton = () => inBoard('저장된 내용 그대로')!
const heading = () => within(board()!).getByRole('heading', { name: title })
const fixButton = () => inBoard('내 입력으로 고치기')
const saveNewButton = () => inBoard('새 거래로 저장')
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true'
const toastText = () => document.querySelector('[class*="region"]')?.textContent ?? ''
const sentIds = () => transactions.sent.map(({ body }) => body.id)

function compareRows() {
  return [...board()!.querySelectorAll('dl > div')].map((row) => [
    row.querySelector('dt')!.textContent,
    ...[...row.querySelectorAll('dd')].map((value) => value.lastElementChild!.textContent),
  ])
}

/** 앞서 같은 id로 저장된 거래. 받은 본문에서 `changes`만 다르다. 서버(상세·수정)에도 넣는다. */
function storedOf(sent: SentTransaction, changes: object = {}) {
  const stored = savedOf(sent.body, sent.user, { categoryId: id.expenseNone, ...changes })
  detail.put(stored)
  return stored
}

/** 더보기에서 연 입력 화면에서 12,000원(지출)을 저장하고, 앞서 저장된 거래와 내용이 달라 판이 뜰 때까지 기다린다. */
async function conflictOnSave(changes: object = { amount: 15000, payee: '올래국수' }) {
  const answers = [(sent: SentTransaction) => problem(409, 'ID_CONFLICT', { current: storedOf(sent, changes) })]
  transactions.response = (sent) => answers.shift()?.(sent) ?? HttpResponse.json(savedOf(sent.body, sent.user), { status: 201 })
  const opened = await openFromMore()
  await opened.user.click(amount())
  await opened.user.keyboard('12000')
  await opened.user.click(saveButton())
  await waitFor(() => expect(board()).toBeTruthy())
  await untilOpened()
  return opened
}

describe('유형이 같을 때', () => {
  it('제목, 설명, 두 열 "저장된 내용"과 "내 입력", 다른 항목만 줄로 보인다', async () => {
    await conflictOnSave()
    const inside = within(board()!)
    expect(inside.getByText(description)).toBeTruthy()
    const columns = [...board()!.querySelector('[class*="columns"]')!.children].map((column) => column.textContent)
    expect(columns).toEqual(['저장된 내용', '내 입력'])
    expect(compareRows()).toEqual([
      ['금액', '15,000원', '12,000원'],
      ['가맹점/내용', '올래국수', '(없음)'],
    ])
    expect(inside.queryByText(/서버/)).toBeNull()
  })

  it('"저장된 내용 그대로"가 왼쪽, "내 입력으로 고치기"가 오른쪽이고 "새 거래로 저장"은 없다. 처음 초점은 판 제목이다', async () => {
    await conflictOnSave()
    const buttons = [...board()!.querySelectorAll('[class*="actions"] button')].map((button) => button.textContent)
    expect(buttons).toEqual(['저장된 내용 그대로', '내 입력으로 고치기'])
    expect(saveNewButton()).toBeUndefined()
    expect(document.activeElement).toBe(heading())
  })

  it('넓은 화면은 가운데 창이다', async () => {
    installMatchMedia(1280)
    setViewportWidth(1280)
    await conflictOnSave()
    expect(board()!.querySelector('[class*="window"]')).toBeTruthy()
  })

  it('"내 입력으로 고치기"는 그 거래의 수정을 저장된 거래의 version과 함께 보내고, 저장되면 이전 화면으로 가 "저장했어요"', async () => {
    const opened = await conflictOnSave()
    await opened.user.click(fixButton()!)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(detail.requests.update).toHaveLength(1)
    expect(detail.requests.update[0]).toMatchObject({ id: sentIds()[0] })
    expect(detail.requests.update[0].body).toMatchObject({ type: 'EXPENSE', amount: 12000, payee: null, version: 1 })
    expect(transactions.sent).toHaveLength(1)
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it('"저장된 내용 그대로"는 보내지 않고 묻지 않고 입력을 버려 이전 화면으로 가 "저장된 내용으로 두었어요"', async () => {
    const opened = await conflictOnSave()
    await opened.user.click(keepButton())
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(discardQuestion()).toBeNull()
    expect(detail.requests.update).toHaveLength(0)
    expect(transactions.sent).toHaveLength(1)
    await waitFor(() => expect(toastText()).toBe('저장된 내용으로 두었어요'))
  })

  it('판 바깥을 누르면 입력 화면으로 돌아가 입력을 둔다. 다시 저장하면 같은 id로 보내고 다시 판이 뜬다', async () => {
    const opened = await conflictOnSave()
    fireEvent.pointerDown(board()!)
    fireEvent.click(board()!)
    await waitFor(() => expect(board()).toBeNull())
    expect(amount().value).toBe('12,000')
    const again = (sent: SentTransaction) => problem(409, 'ID_CONFLICT', { current: storedOf(sent, { amount: 15000 }) })
    transactions.response = again
    await opened.user.click(saveButton())
    await waitFor(() => expect(board()).toBeTruthy())
    await untilOpened()
    expect(sentIds()).toHaveLength(2)
    expect(sentIds()[1]).toBe(sentIds()[0])
  })
})

describe('"내 입력으로 고치기"의 처리 중과 실패', () => {
  async function fixWith(respond: () => Response | Promise<Response>) {
    const opened = await conflictOnSave()
    detail.updateResponse = respond
    await opened.user.click(fixButton()!)
    return opened
  }

  it('처리 중에는 누른 버튼 안에 돌아가는 원이고 두 버튼은 비활성이며 판이 닫히지 않는다', async () => {
    const answer = delayed()
    const opened = await fixWith(answer.respond)
    await answer.arrived
    expect(fixButton()!.getAttribute('aria-busy')).toBe('true')
    expect(isDisabled(keepButton())).toBe(true)
    fireEvent.pointerDown(board()!)
    fireEvent.click(board()!)
    await settle()
    expect(board()).toBeTruthy()
    answer.answer(problem(500, 'INTERNAL_ERROR'))
    await within(board()!).findByRole('alert')
    expect(path(opened)).toBe('/transactions/new')
  })

  it('서버 오류면 주 버튼 바로 위에 문구, 글자는 "다시 시도"이고 초점이 간다. 누르면 같은 수정을 다시 보낸다', async () => {
    const opened = await fixWith(() => problem(500, 'INTERNAL_ERROR'))
    const alert = await within(board()!).findByRole('alert')
    expect(alert.textContent).toBe(serverFailure)
    const actions = board()!.querySelector('[class*="actions"]')!
    expect(actions.previousElementSibling!.contains(alert)).toBe(true)
    expect(document.activeElement).toBe(inBoard('다시 시도'))
    detail.updateResponse = undefined
    await opened.user.click(inBoard('다시 시도')!)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(detail.requests.update.map(({ body }) => body)).toEqual([
      detail.requests.update[0].body,
      detail.requests.update[0].body,
    ])
  })

  it('요청 중에 연결이 끊기면 "연결이 끊겨 저장하지 못했어요."이고 "다시 시도"는 연결이 없는 동안 비활성이다', async () => {
    await fixWith(() => HttpResponse.error())
    const alert = await within(board()!).findByRole('alert')
    expect(alert.textContent).toBe(lostConnection)
    expect(isDisabled(inBoard('다시 시도')!)).toBe(true)
    goOnline()
    await waitFor(() => expect(isDisabled(inBoard('다시 시도')!)).toBe(false))
  })

  it('판이 떠 있는 동안 연결이 없으면 "내 입력으로 고치기"는 비활성이고 바로 위에 "연결되면 저장할 수 있어요". "저장된 내용 그대로"는 된다', async () => {
    const opened = await conflictOnSave()
    goOffline()
    await waitFor(() => expect(within(board()!).queryByText(offlineNotice)).toBeTruthy())
    expect(isDisabled(fixButton()!)).toBe(true)
    await opened.user.click(fixButton()!)
    await settle()
    expect(detail.requests.update).toHaveLength(0)
    await opened.user.click(keepButton())
    await waitFor(() => expect(path(opened)).toBe('/more'))
  })

  it('그사이 다른 기기가 또 고쳤으면(409 STALE_VERSION) 같은 판을 새 저장된 내용으로 다시 그린다', async () => {
    const opened = await conflictOnSave()
    const stored = detail.items.get(String(sentIds()[0]))!
    Object.assign(stored, { amount: 18000, version: 2 })
    await opened.user.click(fixButton()!)
    await waitFor(() => expect(compareRows()[0]).toEqual(['금액', '18,000원', '12,000원']))
    await opened.user.click(fixButton()!)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(detail.requests.update.map(({ body }) => (body as { version: number }).version)).toEqual([1, 2])
  })

  it('다시 그린 저장된 내용이 내 입력과 같으면 저장에 성공한 것이다', async () => {
    const opened = await conflictOnSave()
    const stored = detail.items.get(String(sentIds()[0]))!
    Object.assign(stored, { amount: 12000, payee: null, version: 2 })
    await opened.user.click(fixButton()!)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })
})

describe('유형이 다를 때', () => {
  async function incomeConflict() {
    return conflictOnSave({ type: 'INCOME', categoryId: id.pay, accountId: id.salary, amount: 15000 })
  }

  it('맨 위에 유형 줄이 있고, 주 버튼은 "새 거래로 저장"이며 그 위에 "저장된 거래는 그대로 남아요"', async () => {
    await incomeConflict()
    expect(compareRows()[0]).toEqual(['유형', '수입', '지출'])
    expect(compareRows()[1]).toEqual(['금액', '+15,000원', '12,000원'])
    expect(fixButton()).toBeUndefined()
    expect(saveNewButton()).toBeTruthy()
    const actions = board()!.querySelector('[class*="actions"]')!
    expect(actions.previousElementSibling!.textContent).toBe(keptNotice)
    expect(document.activeElement).toBe(heading())
  })

  it('"새 거래로 저장"은 새 id로 만들고 이전 화면으로 가 "저장했어요"', async () => {
    const opened = await incomeConflict()
    await opened.user.click(saveNewButton()!)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(sentIds()).toHaveLength(2)
    expect(sentIds()[1]).toMatch(UUID_V7)
    expect(sentIds()[1]).not.toBe(sentIds()[0])
    expect(detail.requests.update).toHaveLength(0)
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it('"새 거래로 저장"이 서버 오류면 판에 문구와 "다시 시도"이고, 다시 시도는 같은 새 id로 보낸다', async () => {
    const opened = await incomeConflict()
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    await opened.user.click(saveNewButton()!)
    expect((await within(board()!).findByRole('alert')).textContent).toBe(serverFailure)
    transactions.response = undefined
    await opened.user.click(inBoard('다시 시도')!)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(sentIds()).toHaveLength(3)
    expect(sentIds()[2]).toBe(sentIds()[1])
    expect(sentIds()[1]).not.toBe(sentIds()[0])
  })

  it('연결이 없으면 "새 거래로 저장"은 새 id로 기기에 쌓고 이전 화면으로 간다', async () => {
    const opened = await incomeConflict()
    goOffline()
    await settle()
    expect(isDisabled(saveNewButton()!)).toBe(false)
    await opened.user.click(saveNewButton()!)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await waitFor(() => expect(toastText()).toBe(queued))
    expect(transactions.sent).toHaveLength(1)
  })
})

