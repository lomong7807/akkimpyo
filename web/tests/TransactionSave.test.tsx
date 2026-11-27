import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Accounts } from './support/accounts'
import { delayed, type Backend } from './support/backend'
import { untilOpened } from './support/dialog'
import { setDeviceClock } from './support/clock'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import {
  accountField,
  amount,
  categoryField,
  closeButton,
  dateField,
  discardQuestion,
  errorOf,
  id,
  LEDGER,
  memo,
  moreButton,
  openForm,
  openFromMore,
  path,
  payee,
  pick,
  resetGlobals,
  saveAmount,
  saveButton,
  settle,
  startServer,
  time,
  typeRadio,
  type Opened,
  type User,
} from './support/transactionScreen'
import { holdClock, passTime } from './support/testClock'
import { startTransactionDetail } from './support/transactionDetail'
import { savedOf, type Transactions } from './support/transactions'
import { resetViewport } from './support/viewport'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const failed = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const savedDifferently = '앞서 저장한 거래와 내용이 달라 저장하지 못했어요. 내역에서 확인해 주세요.'
const idUnusable = '문제가 생겨 저장하지 못했어요. 새 거래로 저장해 주세요.'
/** designer #239: 1A 문구를 바꾼다 */
const resendNotice = '이미 저장된 거래라 저장된 내용으로 두었어요'

const server = startMockServer()
let backend: Backend
let accounts: Accounts
let transactions: Transactions

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, accounts, transactions } = startServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const sentIds = () => transactions.sent.map(({ body }) => body.id)
const toastText = () => document.querySelector('[class*="region"]')?.textContent ?? ''
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })

const refuse =
  (...fieldErrors: [field: string, code: string][]) =>
  () =>
    problem(400, 'VALIDATION_FAILED', {
      fieldErrors: fieldErrors.map(([field, code]) => ({ field, code, message: '개발자가 읽는 글' })),
    })

async function fillExpense(user: User) {
  await user.keyboard('12000')
  await user.click(payee())
  await user.paste('올래국수')
  await pick(user, categoryField(), '외식')
}

describe('저장에 성공', () => {
  it('이전 화면으로 돌아가 토스트 "저장했어요"가 뜬다', async () => {
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it('앞 화면이 없으면(주소로 바로 열면) 홈으로 가고 방문 기록을 바꾼다', async () => {
    const opened = await openForm()
    await saveAmount(opened.user)
    await waitFor(() => expect(path(opened)).toBe('/home'))
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it('지출을 계약의 필드 그대로 한 번 보낸다', async () => {
    const opened = await openForm()
    await fillExpense(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    const { ledgerId, body, user } = transactions.sent[0]
    expect([ledgerId, user]).toEqual([LEDGER, 'user-1'])
    expect(Object.keys(body).toSorted()).toEqual(
      ['id', 'type', 'occurredOn', 'occurredTime', 'accountId', 'categoryId', 'amount', 'payee', 'memo'].toSorted(),
    )
    expect(body).toEqual({
      id: body.id,
      type: 'EXPENSE',
      occurredOn: '2026-11-26',
      occurredTime: '12:30',
      accountId: id.salary,
      categoryId: id.dining,
      amount: 12000,
      payee: '올래국수',
      memo: null,
    })
  })

  it('수입은 INCOME으로 보낸다', async () => {
    const { user } = await openForm()
    await user.click(typeRadio('수입'))
    await pick(user, categoryField(), '급여')
    await saveAmount(user, '3200000')
    await waitFor(() => expect(transactions.sent[0]?.body).toMatchObject({ type: 'INCOME', categoryId: id.pay, amount: 3200000 }))
  })

  it('거래 id는 기기가 만든 UUID v7이다', async () => {
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(sentIds()).toHaveLength(1))
    expect(sentIds()[0]).toMatch(UUID_V7)
  })

  it('다음 입력은 새 id다', async () => {
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await act(() => opened.router.navigate('/transactions/new'))
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await saveAmount(opened.user)
    await waitFor(() => expect(sentIds()).toHaveLength(2))
    expect(sentIds()[1]).not.toBe(sentIds()[0])
    expect(sentIds()[1] > sentIds()[0]).toBe(true)
  })

  it('기기 값을 X-Akkimpyo-Device로 싣는다', async () => {
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(transactions.sent[0].device).toMatch(/^[a-z]+\.[a-z]+$/)
  })

  it('장부의 데이터를 모두 다시 받는다(잔액이 바뀐 계좌 목록)', async () => {
    const opened = await openFromMore()
    await act(() => opened.router.navigate('/accounts'))
    await screen.findByText('자산 합계')
    await act(() => opened.router.navigate('/transactions/new'))
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    const before = accounts.requests.length
    accounts.items = accounts.items.map((each) => ({ ...each, balance: 1 }))
    await saveAmount(opened.user)
    await waitFor(() => expect(accounts.requests.length).toBeGreaterThan(before))
  })

  it('두 번 누르거나 엔터, Ctrl+엔터를 함께 눌러도 한 번만 보낸다', async () => {
    transactions.response = delayed().respond
    const { user } = await openForm()
    await user.keyboard('12000')
    await user.dblClick(saveButton())
    await user.click(payee())
    await user.keyboard('{Enter}{Control>}{Enter}{/Control}')
    await settle()
    expect(transactions.sent).toHaveLength(1)
  })

  it.each([
    ['Ctrl', '{Control>}{Enter}{/Control}'],
    ['Cmd', '{Meta>}{Enter}{/Meta}'],
  ])('%s+엔터는 어느 칸에서나 저장이다(메모에서도)', async (_, keys) => {
    const { user } = await openForm()
    await user.keyboard('12000')
    await user.click(moreButton())
    await user.click(memo())
    await user.keyboard(`줄${keys}`)
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(transactions.sent[0].body.memo).toBe('줄')
  })

  it('한글을 조합하는 중의 Ctrl+엔터는 저장하지 않는다', async () => {
    const { user } = await openForm()
    await user.keyboard('12000')
    fireEvent.keyDown(amount(), { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.keyDown(amount(), { key: 'Enter', ctrlKey: true, keyCode: 229 })
    await settle()
    expect(transactions.sent).toEqual([])
  })

  it('고르기 판이 열린 동안 Ctrl+엔터는 저장하지 않는다', async () => {
    const { user } = await openForm()
    await user.keyboard('12000')
    await user.click(categoryField())
    await untilOpened()
    await user.keyboard('{Control>}{Enter}{/Control}')
    await settle()
    expect(transactions.sent).toEqual([])
  })
})

describe('같은 id를 다시 보냄(200)', () => {
  it('그대로인 거래면 "저장했어요"다', async () => {
    transactions.response = ({ body, user }) => HttpResponse.json(savedOf(body, user), { status: 200 })
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it.each([
    ['고쳐진 거래', { version: 2 }],
    ['휴지통의 거래', { deletedAt: '2026-11-26T04:00:00.000Z' }],
    ['취소된 거래', { status: 'CANCELED' }],
    ['결제한 사람이 탈퇴한 거래', { paidBy: null }],
  ])('%s이면 "이미 저장된 거래라 저장된 내용으로 두었어요"를 알리고 이전 화면으로 간다', async (_, changes) => {
    transactions.response = ({ body, user }) => HttpResponse.json(savedOf(body, user, changes), { status: 200 })
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await waitFor(() => expect(path(opened)).toBe('/more'))
    await waitFor(() => expect(toastText()).toBe(resendNotice))
  })

  it('201이면 알리지 않는다', async () => {
    transactions.response = ({ body, user }) => HttpResponse.json(savedOf(body, user, { version: 2 }), { status: 201 })
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })
})

describe('서버 오류와 지연', () => {
  // 요청 중에 연결이 끊긴 새 거래(응답 없음)는 #234부터 같은 id로 기기에 쌓는다(P-904). OfflineSave.test.tsx가 본다
  it.each([
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['404', () => problem(404, 'NOT_FOUND')],
    ['모르는 칸만 온 400', refuse(['refund', 'NOT_ALLOWED'])],
    ['모르는 code만 온 400', refuse(['amount', 'SOMETHING_NEW'])],
    ['id 오류', refuse(['id', 'INVALID_FORMAT'])],
    ['type 오류', refuse(['type', 'REQUIRED'])],
    ['기기 값 오류', refuse(['X-Akkimpyo-Device', 'INVALID_FORMAT'])],
    ['칸이 없는 400', refuse()],
    ['약속과 다른 201', () => HttpResponse.json({}, { status: 201 })],
    ['다른 409', () => problem(409, 'INVALID_STATE')],
  ])('%s이면 저장 바로 위에 문구와 "다시 시도"를 보이고 입력값이 남는다', async (_, respond) => {
    transactions.response = respond
    const opened = await openForm()
    await fillExpense(opened.user)
    await opened.user.click(saveButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(failed)
    const notice = saveButton().previousElementSibling as HTMLElement
    expect(notice.contains(alert)).toBe(true)
    expect(notice.contains(retryButton())).toBe(true)
    expect([amount().value, payee().value, categoryField().textContent]).toEqual(['12,000', '올래국수', '외식'])
    expect(path(opened)).toBe('/transactions/new')
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })

  it('15초 동안 응답이 없으면 같은 문구를 보인다', async () => {
    transactions.response = delayed().respond
    const { user } = await openForm()
    await user.keyboard('12000')
    holdClock()
    fireEvent.click(saveButton())
    await passTime(14_900)
    expect(screen.queryByRole('alert')).toBeNull()
    await passTime(200)
    expect(screen.getByRole('alert').textContent).toBe(failed)
  })

  it('실패해도 초점을 옮기지 않는다', async () => {
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openForm()
    await user.keyboard('12000')
    await user.click(payee())
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')
    await settle()
    expect(document.activeElement).toBe(payee())
  })

  it('"다시 시도"는 같은 id로 보낸다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), () => new HttpResponse('<html>', { status: 502 }), undefined]
    transactions.response = (sent) => answers.shift()?.() ?? HttpResponse.json(savedOf(sent.body), { status: 201 })
    const { user } = await openForm()
    await saveAmount(user)
    await screen.findByRole('alert')
    await user.click(retryButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(2))
    await screen.findByRole('alert')
    await user.click(retryButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(3))
    expect(new Set(sentIds()).size).toBe(1)
  })

  it('값을 고쳐 다시 저장해도 같은 id로 보낸다(앞 요청이 저장됐을 수 있다)', async () => {
    const answers = [() => problem(503, 'INTERNAL_ERROR')]
    transactions.response = (sent) => answers.shift()?.() ?? HttpResponse.json(savedOf(sent.body), { status: 201 })
    const { user } = await openForm()
    await saveAmount(user)
    await screen.findByRole('alert')
    await user.click(amount())
    await user.keyboard('5')
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(2))
    expect(transactions.sent[1].body.amount).toBe(120005)
    expect(sentIds()[1]).toBe(sentIds()[0])
  })

  it('칸이 거부된 뒤 고쳐 다시 저장해도 같은 id다', async () => {
    const answers = [refuse(['payee', 'TOO_LONG'])]
    transactions.response = (sent) => answers.shift()?.() ?? HttpResponse.json(savedOf(sent.body), { status: 201 })
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(errorOf(payee())).toBe('100자까지 쓸 수 있어요'))
    await user.type(payee(), '가')
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(2))
    expect(sentIds()[1]).toBe(sentIds()[0])
  })

  it('저절로 다시 보내지 않는다', async () => {
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openForm()
    await saveAmount(user)
    await screen.findByRole('alert')
    await settle(100)
    expect(transactions.sent).toHaveLength(1)
  })

  it('실패한 뒤 닫으면 버릴지 묻는다', async () => {
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openForm()
    await saveAmount(user)
    await screen.findByRole('alert')
    await user.click(closeButton())
    expect(discardQuestion()).toBeTruthy()
  })
})

describe('서버가 칸을 거부함(400)', () => {
  const amountMessage = '1원부터 9,999,999,999원까지 입력할 수 있어요'
  const unusable = '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'
  const accountGone = '고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.'

  it.each([
    ['amount', 'REQUIRED', amount, amountMessage],
    ['amount', 'INVALID_FORMAT', amount, amountMessage],
    ['amount', 'OUT_OF_RANGE', amount, amountMessage],
    ['payee', 'TOO_LONG', payee, '100자까지 쓸 수 있어요'],
    ['payee', 'INVALID_FORMAT', payee, unusable],
    ['categoryId', 'REQUIRED', categoryField, '카테고리를 골라 주세요'],
    ['categoryId', 'INVALID_FORMAT', categoryField, '카테고리를 골라 주세요'],
    ['categoryId', 'NOT_FOUND', categoryField, '고른 카테고리가 삭제되었어요. 다시 골라 주세요.'],
    ['categoryId', 'NOT_ALLOWED', categoryField, '카테고리를 골라 주세요'],
    ['accountId', 'REQUIRED', accountField, '계좌를 골라 주세요'],
    ['accountId', 'INVALID_FORMAT', accountField, '계좌를 골라 주세요'],
    ['accountId', 'NOT_FOUND', accountField, accountGone],
    ['occurredOn', 'REQUIRED', dateField, '날짜를 골라 주세요'],
    ['occurredOn', 'INVALID_FORMAT', dateField, '날짜를 골라 주세요'],
    ['occurredOn', 'OUT_OF_RANGE', dateField, '2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요'],
  ] as const)('%s %s는 그 칸 아래에 보이고 초점이 그 칸으로 간다', async (field, code, control, message) => {
    transactions.response = refuse([field, code])
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(errorOf(control())).toBe(message))
    expect(document.activeElement).toBe(control())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })

  it.each([
    ['occurredTime', 'INVALID_FORMAT', time, '시각은 00:00부터 23:59까지 입력할 수 있어요'],
    ['memo', 'TOO_LONG', memo, '500자까지 쓸 수 있어요'],
    ['memo', 'INVALID_FORMAT', memo, unusable],
  ] as const)('접힌 %s %s는 펼쳐 그 칸 아래에 보이고 초점을 옮긴다', async (field, code, control, message) => {
    transactions.response = refuse([field, code])
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(errorOf(control())).toBe(message))
    expect(moreButton().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(control())
  })

  it.each([
    ['fromAccountId', 'REQUIRED', '보내는 계좌', '계좌를 골라 주세요'],
    ['fromAccountId', 'NOT_FOUND', '보내는 계좌', accountGone],
    ['toAccountId', 'REQUIRED', '받는 계좌', '받는 계좌를 골라 주세요'],
    ['toAccountId', 'INVALID_FORMAT', '받는 계좌', '받는 계좌를 골라 주세요'],
    ['toAccountId', 'NOT_FOUND', '받는 계좌', accountGone],
    ['toAccountId', 'NOT_ALLOWED', '받는 계좌', '같은 계좌로는 이체할 수 없어요'],
  ] as const)('이체의 %s %s는 %s 아래에 보인다', async (field, code, label, message) => {
    transactions.response = refuse([field, code])
    const { user } = await openForm()
    await user.click(typeRadio('이체'))
    await pick(user, accountField('받는 계좌'), '신한카드')
    await saveAmount(user)
    await waitFor(() => expect(errorOf(accountField(label))).toBe(message))
  })

  it('여러 칸이 함께 오면 모두 보이고 위에서부터 첫 칸으로 초점이 간다. 모르는 칸은 버린다', async () => {
    transactions.response = refuse(['occurredOn', 'OUT_OF_RANGE'], ['refund', 'NEW'], ['payee', 'TOO_LONG'])
    const { user } = await openForm()
    await saveAmount(user)
    await waitFor(() => expect(errorOf(payee())).toBe('100자까지 쓸 수 있어요'))
    expect(errorOf(dateField())).toBeTruthy()
    expect(document.activeElement).toBe(payee())
  })

  it('"constructor" 같은 code는 모르는 code다', async () => {
    transactions.response = refuse(['amount', 'constructor'], ['payee', '__proto__'])
    const { user } = await openForm()
    await saveAmount(user)
    expect((await screen.findByRole('alert')).textContent).toBe(failed)
  })
})

/*
 * current가 보낸 거래의 것으로 온 409는 선택 판이다(IdConflictChoice.test.tsx). 아래 current는 보낸 거래와 id가 달라 약속과 다른
 * 응답이다. 선택 판을 그릴 수 없어 1A처럼 그 거래를 보러 가게만 한다.
 */
describe('같은 id로 만들 수 없음(409 ID_CONFLICT)', () => {
  const savedId = '019a5f2e-8a7d-7b60-9c11-0b9f6c1e3d52'

  it('current가 보낸 거래의 것이 아니면 문구와 "저장된 거래 보기" 하나를 보이고 초점을 옮기지 않는다', async () => {
    transactions.response = ({ body }) => problem(409, 'ID_CONFLICT', { current: savedOf({ ...body, id: savedId }) })
    const { user } = await openForm()
    await user.keyboard('12000')
    await user.click(payee())
    await user.keyboard('{Enter}')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(savedDifferently)
    const link = screen.getByRole('link', { name: '저장된 거래 보기' })
    expect(link.getAttribute('href')).toBe(`/transactions/${savedId}`)
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    expect(screen.queryByRole('button', { name: '새 거래로 저장' })).toBeNull()
    expect(document.activeElement).toBe(payee())
  })

  it('"저장된 거래 보기"는 쓰던 내용이 있어도 묻지 않고 입력을 버려 그 거래의 상세로 간다(planner #102)', async () => {
    const detail = startTransactionDetail(server, backend)
    transactions.response = ({ body }) => {
      const current = savedOf({ ...body, id: savedId })
      detail.put(current)
      return problem(409, 'ID_CONFLICT', { current })
    }
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await opened.user.click(await screen.findByRole('link', { name: '저장된 거래 보기' }))
    await waitFor(() => expect(path(opened)).toBe(`/transactions/${savedId}`))
    expect(discardQuestion()).toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: '거래 상세' })).toBeTruthy()
    // 상세 요청은 상세 화면의 코드가 온 뒤에 나간다(#251)
    await waitFor(() => expect(detail.requests.get.map(({ id }) => id)).toEqual([savedId]))
  })

  it('버린 입력 화면은 방문 기록에서 상세로 바뀌어, 상세에서 뒤로 가면 입력을 연 화면이다', async () => {
    startTransactionDetail(server, backend)
    transactions.response = ({ body }) => problem(409, 'ID_CONFLICT', { current: savedOf({ ...body, id: savedId }) })
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await opened.user.click(await screen.findByRole('link', { name: '저장된 거래 보기' }))
    await waitFor(() => expect(path(opened)).toBe(`/transactions/${savedId}`))
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(discardQuestion()).toBeNull()
  })

  it('current가 없으면 문구와 "새 거래로 저장" 하나를 보이고, 누르면 새 id로 보낸다', async () => {
    const answers = [() => problem(409, 'ID_CONFLICT')]
    transactions.response = (sent) => answers.shift()?.() ?? HttpResponse.json(savedOf(sent.body), { status: 201 })
    const opened = await openFromMore()
    await saveAmount(opened.user)
    expect((await screen.findByRole('alert')).textContent).toBe(idUnusable)
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    await opened.user.click(screen.getByRole('button', { name: '새 거래로 저장' }))
    await waitFor(() => expect(transactions.sent).toHaveLength(2))
    expect(sentIds()[1]).toMatch(UUID_V7)
    expect(sentIds()[1]).not.toBe(sentIds()[0])
    await waitFor(() => expect(path(opened)).toBe('/more'))
  })

  it('"새 거래로 저장"이 실패해 다시 시도하면 그 새 id를 쓴다', async () => {
    const answers = [() => problem(409, 'ID_CONFLICT'), () => problem(500, 'INTERNAL_ERROR')]
    transactions.response = (sent) => answers.shift()?.() ?? HttpResponse.json(savedOf(sent.body), { status: 201 })
    const { user } = await openForm()
    await saveAmount(user)
    await user.click(await screen.findByRole('button', { name: '새 거래로 저장' }))
    await user.click(await screen.findByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(transactions.sent).toHaveLength(3))
    expect(sentIds()[2]).toBe(sentIds()[1])
    expect(sentIds()[1]).not.toBe(sentIds()[0])
  })

  it('current의 id가 UUID 모양이 아니면 current가 없는 것으로 본다', async () => {
    transactions.response = () => problem(409, 'ID_CONFLICT', { current: { id: '../../me' } })
    const { user } = await openForm()
    await saveAmount(user)
    expect((await screen.findByRole('alert')).textContent).toBe(idUnusable)
    expect(screen.queryByRole('link', { name: '저장된 거래 보기' })).toBeNull()
  })
})

/* 다시 보내는 동안 문구를 남기고 누른 버튼만 도는 표시다(designer 검토 2026-11-26, 확인 창과 같다) */
describe('다시 보내는 동안', () => {
  async function failOnce(next: () => Response | Promise<Response>, first = () => problem(500, 'INTERNAL_ERROR')) {
    const answers = [first, next]
    transactions.response = () => answers.shift()!()
    const opened = await openForm()
    await saveAmount(opened.user)
    await screen.findByRole('alert')
    return opened
  }

  it('"다시 시도"를 누르면 문구를 둔 채 "다시 시도"만 도는 표시이고, 저장은 누를 수 없으며 초점은 "다시 시도"에 남는다', async () => {
    const answer = delayed()
    const { user } = await failOnce(answer.respond)
    retryButton().focus()
    await user.keyboard('{Enter}')
    await answer.arrived
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(saveButton().getAttribute('aria-busy')).toBeNull()
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(retryButton())
    await user.click(saveButton())
    expect(transactions.sent).toHaveLength(2)
  })

  it('저장을 다시 누르면 문구를 둔 채 저장만 도는 표시이고 "다시 시도"는 누를 수 없다', async () => {
    const answer = delayed()
    const { user } = await failOnce(answer.respond)
    await user.click(saveButton())
    await answer.arrived
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(saveButton().getAttribute('aria-busy')).toBe('true')
    expect(retryButton().getAttribute('aria-busy')).toBeNull()
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    await user.click(retryButton())
    expect(transactions.sent).toHaveLength(2)
  })

  it('"새 거래로 저장"도 누른 그 버튼만 도는 표시다', async () => {
    const answer = delayed()
    const { user } = await failOnce(answer.respond, () => problem(409, 'ID_CONFLICT'))
    await user.click(screen.getByRole('button', { name: '새 거래로 저장' }))
    await answer.arrived
    expect(screen.getByRole('alert').textContent).toBe(idUnusable)
    expect(screen.getByRole('button', { name: '새 거래로 저장' }).getAttribute('aria-busy')).toBe('true')
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
  })

  it('또 실패하면 문구를 새로 그려 다시 읽히게 한다', async () => {
    const { user } = await failOnce(() => problem(503, 'INTERNAL_ERROR'))
    const first = screen.getByRole('alert')
    await user.click(retryButton())
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(retryButton().hasAttribute('aria-busy')).toBe(false)
  })

  it('성공하면 그대로 떠난다', async () => {
    const { user } = await failOnce(() => HttpResponse.json(savedOf(transactions.sent[0].body), { status: 201 }))
    await user.click(retryButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })
})

describe('처리 중', () => {
  async function startSaving() {
    const answer = delayed()
    transactions.response = answer.respond
    const opened = await openFromMore()
    await opened.user.keyboard('12000')
    await opened.user.click(saveButton())
    await answer.arrived
    return { ...opened, answer }
  }

  it('저장 버튼만 처리 중이고 칸은 바꿀 수 없다', async () => {
    const { user, answer } = await startSaving()
    expect(saveButton().getAttribute('aria-busy')).toBe('true')
    expect([amount().readOnly, payee().readOnly]).toEqual([true, true])
    await user.click(typeRadio('수입'))
    expect(typeRadio('지출').getAttribute('aria-checked')).toBe('true')
    await user.click(categoryField())
    await user.click(accountField())
    await user.click(dateField())
    expect(document.querySelector('dialog')).toBeNull()
    answer.answer(problem(500, 'INTERNAL_ERROR'))
    await screen.findByRole('alert')
    expect(saveButton().hasAttribute('aria-busy')).toBe(false)
    expect(amount().readOnly).toBe(false)
  })

  it('닫기, 뒤로, Esc로 닫히지 않고 끝나면 이전 화면으로 간다', async () => {
    const opened = await startSaving()
    await opened.user.click(closeButton())
    await opened.user.keyboard('{Escape}')
    await act(() => opened.router.navigate(-1))
    await settle()
    expect(path(opened)).toBe('/transactions/new')
    expect(discardQuestion()).toBeNull()
    opened.answer.answer(HttpResponse.json(savedOf(transactions.sent[0].body), { status: 201 }))
    await waitFor(() => expect(path(opened)).toBe('/more'))
  })
})

describe('로그인이 바뀜', () => {
  const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })

  async function logOutElsewhere() {
    vi.resetModules()
    const other = await import('../src/api/sessionMarks')
    other.settleLogout(other.recordLogout())
    backend.cookieUser = undefined
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'akkimpyo-logout' })))
  }

  it.each([
    ['이 탭', async (opened: Opened) => opened.user.click(screen.getByRole('button', { name: '로그아웃', hidden: true }))],
    ['다른 탭', async () => logOutElsewhere()],
  ])('응답이 늦은 사이 %s에서 로그아웃하면 뒤늦은 응답이 화면과 토스트에 나오지 않는다', async (_, logOut) => {
    const answer = delayed()
    transactions.response = answer.respond
    const opened = await openFromMore()
    await saveAmount(opened.user)
    await answer.arrived
    const dom = recordDom()
    await logOut(opened)
    await loginHeading()
    answer.answer(HttpResponse.json(savedOf(transactions.sent[0].body), { status: 201 }))
    await settle(100)
    expect(path(opened)).toBe('/login')
    expect(dom.sawText('저장했어요')).toBe(false)
    expect(dom.sawText('이미 저장된')).toBe(false)
  })

  it('저장하다 로그인이 풀리면 묻지 않고 로그인 화면으로 간다', async () => {
    const opened = await openForm()
    await opened.user.keyboard('12000')
    backend.expireTokens()
    backend.cookieUser = undefined
    const dom = recordDom()
    await opened.user.click(saveButton())
    await loginHeading()
    expect(screen.getByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeTruthy()
    expect(dom.sawElement('dialog')).toBe(false)
  })

  it('토큰이 만료됐으면 같은 사용자로 갱신해 한 번 더 보내 저장한다', async () => {
    const opened = await openFromMore()
    await opened.user.keyboard('12000')
    backend.expireTokens()
    await opened.user.click(saveButton())
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(transactions.sent.map(({ user }) => user)).toEqual([undefined, 'user-1'])
    expect(new Set(sentIds()).size).toBe(1)
  })
})
