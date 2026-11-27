import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Accounts } from './support/accounts'
import type { CategorySuggestions } from './support/categories'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { queueOf } from './support/device'
import { untilOpened, untilUnshielded } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { holdClock, passTime } from './support/testClock'
import { toastRegion } from './support/toast'
import { expenseOf, startTransactionList, type TransactionList } from './support/transactionList'
import {
  accountField,
  amount,
  categoryField,
  dateField,
  errorOf,
  hasSuggestedHelp,
  id,
  LAST_ACCOUNT_KEY,
  LEDGER,
  openApp,
  payee,
  pick,
  resetGlobals,
  saveButton,
  settle,
  startServer,
  time,
  typeRadio,
  type Opened,
  type User,
} from './support/transactionScreen'
import { savedOf, type Transactions } from './support/transactions'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 홈의 한 줄 입력(C-01 (1), F-114, F-210)과 결과 확인(D-05, F-211, #233). 해석 규칙 자체는 oneLine.test.ts가 본다.
 * 휴대폰 배치(390px)는 모달 판(전체 화면 입력 모양), 넓은 화면(1280px)은 입력칸 아래 펼친 구역이다.
 */

const NOW = '2026-11-26T12:30:00+09:00'
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const EMPTY = '입력할 내용을 적어 주세요. 예: 점심 12000'
const TOO_LONG = '100자까지 쓸 수 있어요'
const NOT_FOUND = '금액을 찾지 못했어요. 예: 점심 12000'
const FAILED = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const QUEUED = '기기에 저장했어요. 연결되면 보낼게요.'
const RESULT = '한 줄 입력 확인'

const server = startMockServer()
let backend: Backend
let accounts: Accounts
let transactions: Transactions
let list: TransactionList
let suggestions: CategorySuggestions

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions, accounts, suggestions } = startServer(server))
  list = startTransactionList(server, backend)
  installIntersectionObserver()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const oneLine = () => screen.getByRole<HTMLInputElement>('textbox', { name: '한 줄 입력' })
const enterButton = () => screen.getByRole('button', { name: '입력' })
const resultDialog = () => screen.queryByRole('dialog', { name: RESULT })
const resultRegion = () => screen.queryByRole('region', { name: RESULT })
const detailButton = () => screen.getByRole('button', { name: '자세히' })
const closeButton = () => screen.getByRole('button', { name: '닫기' })
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const toastText = () => toastRegion().textContent ?? ''
const tabBar = () => document.querySelector<HTMLElement>('[class*="tabBar"]')
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true'
const pathOf = ({ router }: Opened) => router.state.location.pathname

/** 홈을 열고 한 줄 입력칸과 계좌 목록이 올 때까지 기다린다. */
async function openHome() {
  const opened = await openApp('/home')
  await screen.findByRole('textbox', { name: '한 줄 입력' })
  await waitFor(() => expect(within(screen.getByRole('main')).queryByText('계좌 잔액')).not.toBeNull())
  return opened
}

/** 한 줄을 쓰고 "입력"을 누른다. */
async function submitLine(user: User, text: string) {
  await user.click(oneLine())
  if (text !== '') await user.keyboard(text)
  await user.click(enterButton())
}

/** 한 줄을 써서 휴대폰 배치의 D-05를 열고 기본 계좌가 들어갈 때까지 기다린다. */
async function openResult(user: User, text = '점심 12000') {
  await submitLine(user, text)
  await screen.findByRole('dialog', { name: RESULT })
  await untilOpened()
  const field = accountField()
  await waitFor(() => expect(field.textContent).not.toBe(''))
}

/** 마지막으로 받은 거래 만들기를 저장한 응답(201) */
const created = () => HttpResponse.json(savedOf(transactions.sent.at(-1)!.body, 'user-1'), { status: 201 })

/** 서버가 저장한 거래를 홈의 목록에도 넣는다(다시 불러오면 보인다). */
function listSaved() {
  transactions.response = (sent) => {
    const saved = savedOf(sent.body, sent.user)
    list.months.set('2026-11', [...(list.months.get('2026-11') ?? []), saved])
    return HttpResponse.json(saved, { status: 201 })
  }
}

describe('홈의 한 줄 입력(C-01 (1))', () => {
  it('맨 위 구역에 이름 "한 줄 입력", 입력칸, 오른쪽 보조 버튼 "입력", 도움말 "예: 점심 12000"이 있다', async () => {
    await openHome()
    const input = oneLine()
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    const help = document.getElementById(input.getAttribute('aria-describedby')!)!
    expect(help.textContent).toBe('예: 점심 12000')
    expect(input.placeholder).toBe('')
    expect(input.getAttribute('enterkeyhint')).toBe('done')
    expect(enterButton().className).toMatch(/secondary/)
    // 이번 달 합계보다 앞이다
    const first = screen.getByRole('heading', { level: 2, name: /월 합계$/ })
    expect(input.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('화면을 열 때 초점을 주지 않는다(휴대폰 키보드가 저절로 올라오지 않는다)', async () => {
    await openHome()
    await settle()
    expect(document.activeElement).not.toBe(oneLine())
  })

  it('보기 전용이면 구역 전체가 없다', async () => {
    const me = meOf('user-1')
    backend.meResponse = () => HttpResponse.json({ ...me, ledgers: [{ ...me.ledgers[0], role: 'VIEWER' }] })
    await openApp('/home')
    await screen.findByRole('heading', { level: 2, name: '최근 거래' })
    expect(screen.queryByRole('textbox', { name: '한 줄 입력' })).toBeNull()
  })

  it('비운 채 "입력"을 누르면 도움말 아래에 문구를 보이고 입력칸에 초점을 둔다. 해석하지 않는다', async () => {
    const { user } = await openHome()
    await user.click(enterButton())
    expect(errorOf(oneLine())).toBe(EMPTY)
    expect(oneLine().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(oneLine())
    await settle()
    expect(resultDialog()).toBeNull()
  })

  it('공백만 있어도 빈 글이다', async () => {
    const { user } = await openHome()
    await submitLine(user, '   ')
    expect(errorOf(oneLine())).toBe(EMPTY)
    expect(oneLine().value).toBe('   ')
  })

  it('100자를 넘으면 "100자까지 쓸 수 있어요"를 보이고 해석하지 않으며 글을 지우지 않는다', async () => {
    const { user } = await openHome()
    const text = `${'가'.repeat(96)} 12000`
    fireEvent.change(oneLine(), { target: { value: text } })
    await user.click(enterButton())
    expect(errorOf(oneLine())).toBe(TOO_LONG)
    expect(oneLine().value).toBe(text)
    await settle()
    expect(resultDialog()).toBeNull()
  })

  it('100자까지는 해석한다', async () => {
    const { user } = await openHome()
    fireEvent.change(oneLine(), { target: { value: `${'가'.repeat(94)} 12000` } })
    await user.click(enterButton())
    expect(await screen.findByRole('dialog', { name: RESULT })).toBeTruthy()
  })

  it.each(['점심', '점심 0', '점심 10000000000'])(
    '"%s"는 D-05를 열지 않고 "금액을 찾지 못했어요"와 글자 링크 "자세히 입력"을 보인다. 글은 그대로다',
    async (text) => {
      const { user } = await openHome()
      await submitLine(user, text)
      expect(errorOf(oneLine())).toBe(NOT_FOUND)
      const link = screen.getByRole('link', { name: '자세히 입력' })
      expect(link.getAttribute('href')).toBe('/transactions/new')
      expect(oneLine().value).toBe(text)
      await settle()
      expect(resultDialog()).toBeNull()
      expect(transactions.sent).toEqual([])
    },
  )

  it('보인 문구는 그 까닭을 고치면 바로 지운다. 쓰는 동안 새 문구를 띄우지 않는다(00-common 4.4)', async () => {
    const { user } = await openHome()
    await user.click(enterButton())
    expect(errorOf(oneLine())).toBe(EMPTY)
    await user.keyboard('점')
    expect(errorOf(oneLine())).toBeUndefined()
    await user.click(enterButton())
    expect(errorOf(oneLine())).toBe(NOT_FOUND)
    await user.keyboard('심')
    expect(errorOf(oneLine())).toBe(NOT_FOUND)
    await user.keyboard(' 12000')
    expect(errorOf(oneLine())).toBeUndefined()
    expect(screen.queryByRole('link', { name: '자세히 입력' })).toBeNull()
  })

  it('키보드의 엔터는 "입력"과 같다', async () => {
    const { user } = await openHome()
    await user.click(oneLine())
    await user.keyboard('점심 12000{Enter}')
    expect(await screen.findByRole('dialog', { name: RESULT })).toBeTruthy()
  })

  it('한글을 조합하는 중의 엔터는 글자를 끝낼 뿐 해석하지 않는다', async () => {
    await openHome()
    fireEvent.change(oneLine(), { target: { value: '점심 12000' } })
    const event = fireEvent.keyDown(oneLine(), { key: 'Enter', keyCode: 229, isComposing: true })
    expect(event).toBe(false)
    await settle()
    expect(resultDialog()).toBeNull()
  })

  it('해석은 기기에서 한다. 처리 중 표시 없이 바로 연다', async () => {
    const { user } = await openHome()
    const before = list.requests.length
    await submitLine(user, '점심 12000')
    expect(await screen.findByRole('dialog', { name: RESULT })).toBeTruthy()
    expect(enterButton().getAttribute('aria-busy')).toBeNull()
    expect(list.requests.length).toBe(before)
    expect(transactions.sent).toEqual([])
  })
})

describe('결과 확인(D-05) 휴대폰 배치', () => {
  it('아래에서 올라오는 전체 화면이다. 머리는 X "닫기"와 "한 줄 입력 확인", 주소는 그대로다', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    const dialog = resultDialog()!
    expect(within(dialog).getByRole('heading', { name: RESULT })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '닫기' }).textContent).toBe('')
    expect(pathOf(opened)).toBe('/home')
    expect(opened.router.state.location.search).toBe('')
  })

  it('칸과 기본값: 입력한 글, 지출, 해석한 금액과 가맹점, 미분류, 첫 계좌, 기기의 지금. 초점은 저장에 있다', async () => {
    const { user } = await openHome()
    await openResult(user)
    const dialog = resultDialog()!
    expect(within(dialog).getByText('입력한 글: 점심 12000')).toBeTruthy()
    expect(typeRadio('지출').getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['지출', '수입'])
    expect(amount().value).toBe('12,000')
    expect(payee().value).toBe('점심')
    expect(categoryField().textContent).toContain('미분류')
    expect(accountField().textContent).toContain('급여통장')
    expect(dateField().textContent).toContain('11월 26일 (목)')
    expect(time().value).toBe('12:30')
    expect(within(dialog).getByRole('group', { name: '날짜·시각' })).toBeTruthy()
    expect(document.activeElement).toBe(saveButton())
    expect(within(dialog).queryByRole('button', { name: '더 보기' })).toBeNull()
    expect(within(dialog).queryByLabelText('메모 (선택)')).toBeNull()
  })

  it('계좌는 이 사용자가 이 장부에서 마지막으로 쓴 계좌다', async () => {
    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify({ userId: 'user-1', ledgerId: LEDGER, accountId: id.card }))
    const { user } = await openHome()
    await openResult(user)
    expect(accountField().textContent).toContain('신한카드')
  })

  it('수입으로 바꾸면 계좌 칸의 이름이 "들어온 계좌"다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await user.click(typeRadio('수입'))
    expect(accountField('들어온 계좌').textContent).toContain('급여통장')
  })

  it('고를 계좌가 없으면(계좌를 받지 못함) 계좌 칸이 비고 저장하면 "계좌를 골라 주세요"', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openApp('/home')
    await screen.findByRole('textbox', { name: '한 줄 입력' })
    await submitLine(user, '점심 12000')
    await screen.findByRole('dialog', { name: RESULT })
    await untilOpened()
    expect(accountField().textContent).toBe('')
    await user.click(saveButton())
    expect(errorOf(accountField())).toBe('계좌를 골라 주세요')
    expect(transactions.sent).toEqual([])
  })

  it('금액과 가맹점/내용의 검증과 문구는 거래 입력과 같다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await user.clear(amount())
    await user.click(saveButton())
    expect(errorOf(amount())).toBe('1원부터 9,999,999,999원까지 입력할 수 있어요')
    expect(document.activeElement).toBe(amount())
    expect(resultDialog()).not.toBeNull()
    expect(transactions.sent).toEqual([])
  })

  it('시각을 비우면 시각 없음으로 저장한다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await user.clear(time())
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(transactions.sent[0].body.occurredTime).toBeNull()
  })
})

describe('카테고리 제안(D-05 (6), P-219)', () => {
  beforeEach(() => {
    suggestions.byPayee.set('점심', id.dining)
    suggestions.byPayee.set('이마트', id.grocery)
  })

  it('해석한 가맹점으로 같은 가맹점에 쓴 지출의 카테고리를 채우고 칸 아래에 도움말을 보인다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    expect(hasSuggestedHelp()).toBe(true)
    expect(suggestions.requests).toEqual(['점심'])
    // 제안이 와도 초점은 저장에 있다
    expect(document.activeElement).toBe(saveButton())
  })

  it('그런 지출이 없으면 미분류이고 도움말이 없다', async () => {
    const { user } = await openHome()
    await openResult(user, '택시 8000')
    await settle()
    expect(categoryField().textContent).toBe('미분류')
    expect(hasSuggestedHelp()).toBe(false)
    expect(suggestions.requests).toEqual(['택시'])
  })

  it('가맹점이 비어 있으면 묻지 않고 미분류다', async () => {
    const { user } = await openHome()
    await openResult(user, '12000')
    await settle()
    expect(categoryField().textContent).toBe('미분류')
    expect(suggestions.requests).toEqual([])
  })

  it('카테고리를 바꾸면 도움말이 사라지고, 그 뒤에는 가맹점을 바꿔도 덮어쓰지 않는다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    await pick(user, categoryField(), '교통')
    expect(hasSuggestedHelp()).toBe(false)
    await user.clear(payee())
    await user.type(payee(), '이마트')
    await user.tab()
    await settle()
    expect(categoryField().textContent).toBe('교통')
    expect(suggestions.requests).toEqual(['점심'])
  })

  it('가맹점을 바꾸고 칸을 벗어나면 같은 규칙으로 다시 제안한다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    await user.clear(payee())
    await user.type(payee(), '이마트')
    await user.tab()
    await waitFor(() => expect(categoryField().textContent).toBe('장보기'))
    expect(hasSuggestedHelp()).toBe(true)
  })

  it('수입으로 바꾸면 미분류이고 도움말이 없으며, 지출로 돌아오면 제안한 카테고리로 돌아간다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    await user.click(typeRadio('수입'))
    expect(categoryField().textContent).toBe('미분류')
    expect(hasSuggestedHelp()).toBe(false)
    await user.click(typeRadio('지출'))
    expect(categoryField().textContent).toBe('외식')
    expect(hasSuggestedHelp()).toBe(true)
  })

  it('저장하면 제안한 카테고리로 보낸다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(transactions.sent[0].body).toMatchObject({ payee: '점심', categoryId: id.dining })
  })

  it('"자세히"는 제안한 카테고리와 도움말을 거래 입력에 넘긴다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    await user.click(detailButton())
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    expect(hasSuggestedHelp()).toBe(true)
  })

  it('D-05에서 직접 고른 카테고리는 "자세히"로 연 거래 입력에서 가맹점을 바꿔도 덮어쓰지 않는다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await waitFor(() => expect(categoryField().textContent).toBe('외식'))
    await pick(user, categoryField(), '교통')
    await user.click(detailButton())
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(() => expect(categoryField().textContent).toBe('교통'))
    await user.clear(payee())
    await user.type(payee(), '이마트')
    await user.tab()
    await settle()
    expect(categoryField().textContent).toBe('교통')
    expect(suggestions.requests).toEqual(['점심'])
  })

  it('연결이 없으면 묻지 않고 미분류다(1B 임시)', async () => {
    const { user } = await openHome()
    goOffline()
    await openResult(user)
    await settle()
    expect(categoryField().textContent).toBe('미분류')
    expect(suggestions.requests).toEqual([])
  })
})

describe('닫기(D-05 (1))', () => {
  async function expectClosedWithText(opened: Opened) {
    await waitFor(() => expect(resultDialog()).toBeNull())
    expect(oneLine().value).toBe('점심 12000')
    await waitFor(() => expect(document.activeElement).toBe(oneLine()))
    expect(oneLine().selectionStart).toBe('점심 12000'.length)
    expect(transactions.sent).toEqual([])
    expect(pathOf(opened)).toBe('/home')
    expect(screen.queryByRole('dialog')).toBeNull()
  }

  it.each<[string, (opened: Opened) => Promise<void>]>([
    ['X', async ({ user }) => user.click(closeButton())],
    ['Esc', async ({ user }) => user.keyboard('{Escape}')],
    ['브라우저 뒤로', async ({ router }) => act(() => router.navigate(-1))],
    [
      '아래로 끌어내리기',
      async () => {
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
        const head = within(resultDialog()!).getByRole('heading', { name: RESULT }).closest('header')!
        const pointer = { pointerId: 1, isPrimary: true, button: 0 }
        fireEvent.pointerDown(head, { ...pointer, clientY: 100 })
        fireEvent.pointerMove(head, { ...pointer, clientY: 400 })
        await act(async () => {
          fireEvent.pointerUp(head, { ...pointer, clientY: 400 })
        })
      },
    ],
  ])('%s: 저장 없이 닫고 글을 입력칸에 되돌리며 커서를 둔다. 확인 창이 없다', async (_, close) => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.clear(payee())
    await close(opened)
    await expectClosedWithText(opened)
  })

  it('닫은 뒤 앞으로 가기로 판이 다시 열리지 않는다', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(closeButton())
    await waitFor(() => expect(resultDialog()).toBeNull())
    await act(() => opened.router.navigate(1))
    await settle()
    expect(resultDialog()).toBeNull()
  })

  it('닫고 다시 "입력"을 누르면 새 판이다(고친 값이 남지 않는다)', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.clear(payee())
    await opened.user.click(closeButton())
    await waitFor(() => expect(resultDialog()).toBeNull())
    await untilUnshielded()
    await opened.user.click(enterButton())
    await screen.findByRole('dialog', { name: RESULT })
    expect(payee().value).toBe('점심')
  })
})

describe('저장(D-05 (10))', () => {
  it('판을 닫고 입력칸을 비워 커서를 주며, 토스트 "저장했어요"와 최근 거래의 새 줄이 보인다', async () => {
    listSaved()
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(resultDialog()).toBeNull())
    expect(oneLine().value).toBe('')
    expect(document.activeElement).toBe(oneLine())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    const recent = screen.getByRole('region', { name: '최근 거래' })
    await waitFor(() => expect(within(recent).getByText('점심')).toBeTruthy())
    expect(pathOf(opened)).toBe('/home')
  })

  it('계약의 필드 그대로 한 번 보낸다. id는 기기가 만든 UUID v7이다', async () => {
    const { user } = await openHome()
    await openResult(user)
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    const [sent] = transactions.sent
    expect(sent.ledgerId).toBe(LEDGER)
    expect(sent.body).toEqual({
      id: expect.stringMatching(UUID_V7),
      type: 'EXPENSE',
      occurredOn: '2026-11-26',
      occurredTime: '12:30',
      accountId: id.salary,
      categoryId: null,
      amount: 12000,
      payee: '점심',
      memo: null,
    })
  })

  it('누른 처리 안에서 판을 닫고 입력칸에 초점을 준 뒤 보낸다(iPhone 키보드)', async () => {
    const answer = delayed()
    transactions.response = answer.respond
    const { user } = await openHome()
    await openResult(user)
    let focusedAtSend: Element | null = null
    let shownAtSend = true
    transactions.response = () => {
      focusedAtSend = document.activeElement
      shownAtSend = resultDialog() !== null
      return answer.respond()
    }
    fireEvent.click(saveButton())
    expect(document.activeElement).toBe(oneLine())
    expect(oneLine().value).toBe('')
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(focusedAtSend).toBe(oneLine())
    expect(shownAtSend).toBe(false)
    answer.answer(created())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it('저장한 뒤 앞으로 가기로 판이 다시 열리지 않는다(두 번 저장하지 않는다)', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    await act(() => opened.router.navigate(1))
    await settle()
    expect(resultDialog()).toBeNull()
    expect(transactions.sent).toHaveLength(1)
  })

  it('저장하는 동안에는 홈을 떠나는 이동을 조용히 막는다', async () => {
    const answer = delayed()
    transactions.response = answer.respond
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    await untilUnshielded()
    await opened.user.click(within(tabBar()!).getByRole('link', { name: '내역' }))
    await settle()
    expect(pathOf(opened)).toBe('/home')
    expect(screen.queryByRole('dialog')).toBeNull()
    answer.answer(created())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    await opened.user.click(within(tabBar()!).getByRole('link', { name: '내역' }))
    await waitFor(() => expect(pathOf(opened)).toBe('/transactions'))
  })

  it('저장을 보내는 동안 새 글로 "입력"을 누르면 앞 저장이 끝난 뒤 새 판을 연다', async () => {
    const answer = delayed()
    transactions.response = answer.respond
    const { user } = await openHome()
    await openResult(user)
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    await untilUnshielded()
    await user.keyboard('커피 4500{Enter}')
    await settle()
    expect(resultDialog()).toBeNull()
    answer.answer(created())
    await screen.findByRole('dialog', { name: RESULT })
    await waitFor(() => expect(amount().value).toBe('4,500'))
    expect(payee().value).toBe('커피')
  })
})

describe('저장 실패(서버 오류, 지연)', () => {
  it('5xx면 판을 같은 값으로 다시 열고 저장 위에 문구와 "다시 시도"를 보인다. 닫으면 글이 입력칸에 돌아온다', async () => {
    transactions.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openHome()
    await openResult(user)
    await user.clear(payee())
    await user.type(payee(), '올래국수')
    await user.click(saveButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(FAILED)
    expect(resultDialog()).not.toBeNull()
    expect([amount().value, payee().value]).toEqual(['12,000', '올래국수'])
    const notice = saveButton().closest('[class*="bottom"]')!
    expect(notice.contains(retryButton())).toBe(true)
    await untilOpened()
    await user.click(closeButton())
    await waitFor(() => expect(resultDialog()).toBeNull())
    expect(oneLine().value).toBe('점심 12000')
  })

  it('15초 동안 응답이 없으면 같은 문구로 다시 연다', async () => {
    transactions.response = delayed().respond
    const { user } = await openHome()
    await openResult(user)
    holdClock()
    fireEvent.click(saveButton())
    await passTime(14_900)
    expect(resultDialog()).toBeNull()
    await passTime(200)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(FAILED))
    expect(resultDialog()).not.toBeNull()
  })

  it('"다시 시도"는 같은 id로 보내고, 보내는 동안 판에 처리 중(다시 시도만 돎, 저장 비활성, 칸 잠금)이다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR')]
    const answer = delayed()
    transactions.response = () => answers.shift()?.() ?? answer.respond()
    const { user } = await openHome()
    await openResult(user)
    await user.click(saveButton())
    await screen.findByRole('alert')
    await untilOpened()
    await user.click(retryButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(2))
    expect(transactions.sent[1].body.id).toBe(transactions.sent[0].body.id)
    expect(resultDialog()).not.toBeNull()
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(isDisabled(saveButton())).toBe(true)
    expect(amount().readOnly).toBe(true)
    expect(payee().readOnly).toBe(true)
    answer.answer(created())
    await waitFor(() => expect(resultDialog()).toBeNull())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(oneLine().value).toBe('')
  })

  it('서버가 칸을 거부하면 다시 열고 그 칸에 문구를 보이며 초점을 옮긴다', async () => {
    transactions.response = () =>
      problem(400, 'VALIDATION_FAILED', {
        fieldErrors: [{ field: 'payee', code: 'TOO_LONG', message: '개발자가 읽는 글' }],
      })
    const { user } = await openHome()
    await openResult(user)
    await user.click(saveButton())
    await waitFor(() => expect(resultDialog()).not.toBeNull())
    await waitFor(() => expect(errorOf(payee())).toBe('100자까지 쓸 수 있어요'))
    expect(document.activeElement).toBe(payee())
  })

  it('실패로 다시 열 때 그사이 입력칸에 쓴 새 글은 그대로 두고, 판을 닫아도 덮어쓰지 않는다', async () => {
    const answer = delayed()
    transactions.response = answer.respond
    const { user } = await openHome()
    await openResult(user)
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    await untilUnshielded()
    await user.keyboard('커피 4500{Enter}')
    answer.answer(problem(500, 'INTERNAL_ERROR'))
    await screen.findByRole('alert')
    expect(payee().value).toBe('점심')
    expect(oneLine().value).toBe('커피 4500')
    await untilOpened()
    await user.click(closeButton())
    await waitFor(() => expect(resultDialog()).toBeNull())
    expect(oneLine().value).toBe('커피 4500')
  })
})

describe('연결이 없을 때(F-103, #234)', () => {
  it('저장하면 요청 없이 기기에 쌓고 판을 닫으며 입력칸을 비우고 토스트를 보인다. 최근 거래에 보내지 않음 줄이 생긴다', async () => {
    const { user } = await openHome()
    act(() => goOffline())
    await openResult(user)
    await user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    expect(resultDialog()).toBeNull()
    expect(oneLine().value).toBe('')
    expect(transactions.sent).toEqual([])
    const [item] = await queueOf('user-1')
    expect(item.body).toMatchObject({ type: 'EXPENSE', amount: 12000, payee: '점심', accountId: id.salary })
    const recent = screen.getByRole('region', { name: '최근 거래' })
    await waitFor(() => expect(within(recent).getByText('보내지 않음')).toBeTruthy())
  })

  it('요청 중에 연결이 끊기면 보낸 것과 같은 id로 쌓는다', async () => {
    transactions.response = () => HttpResponse.error()
    const { user } = await openHome()
    await openResult(user)
    await user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    const [item] = await queueOf('user-1')
    expect(item.id).toBe(transactions.sent[0].body.id)
  })

  it('해석은 연결이 없어도 된다', async () => {
    const { user } = await openHome()
    act(() => goOffline())
    await openResult(user)
    expect(amount().value).toBe('12,000')
  })
})

describe('자세히(D-05 (9))와 거래 입력(D-04)', () => {
  const formHeading = () => screen.findByRole('heading', { level: 1, name: '거래 입력' })

  it('판을 닫고 지금 값(유형 포함)을 채운 거래 입력을 연다. 더 보기는 펼쳐 있다', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(typeRadio('수입'))
    await opened.user.clear(payee())
    await opened.user.type(payee(), '용돈')
    await opened.user.click(detailButton())
    await formHeading()
    await waitFor(() => expect(amount().value).toBe('12,000'))
    expect(pathOf(opened)).toBe('/transactions/new')
    expect(typeRadio('수입').getAttribute('aria-checked')).toBe('true')
    expect(payee().value).toBe('용돈')
    expect(accountField('들어온 계좌').textContent).toContain('급여통장')
    expect(time().value).toBe('12:30')
    expect(screen.getByRole('button', { name: '더 보기' }).getAttribute('aria-expanded')).toBe('true')
    expect(resultDialog()).toBeNull()
  })

  it('쓴 글과 값은 방문 기록(history state)에 남기지 않는다', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(detailButton())
    await formHeading()
    expect(JSON.stringify(window.history.state)).not.toContain('점심')
    expect(JSON.stringify(window.history.state)).not.toContain('12000')
  })

  it('거래 입력에서 저장하면 홈으로 가 입력칸을 비우고 커서를 두며 토스트 "저장했어요"', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(detailButton())
    await formHeading()
    await waitFor(() => expect(amount().value).toBe('12,000'))
    await opened.user.click(saveButton())
    await waitFor(() => expect(pathOf(opened)).toBe('/home'))
    await waitFor(() => expect(document.activeElement).toBe(oneLine()))
    expect(oneLine().value).toBe('')
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(transactions.sent).toHaveLength(1)
    expect(transactions.sent[0].body).toMatchObject({ amount: 12000, payee: '점심', occurredTime: '12:30' })
  })

  it.each<[string, (opened: Opened) => Promise<void>]>([
    ['닫기', async ({ user }) => user.click(screen.getByRole('button', { name: '닫기' }))],
    ['브라우저 뒤로', async ({ router }) => act(() => router.navigate(-1))],
  ])('거래 입력을 %s로 떠나면 확인 없이 홈으로 가 입력했던 글을 되돌리고 커서를 둔다', async (_, leave) => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(detailButton())
    await formHeading()
    await waitFor(() => expect(amount().value).toBe('12,000'))
    await leave(opened)
    await waitFor(() => expect(pathOf(opened)).toBe('/home'))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(oneLine().value).toBe('점심 12000'))
    await waitFor(() => expect(document.activeElement).toBe(oneLine()))
    expect(resultDialog()).toBeNull()
  })

  it('해석 실패의 "자세히 입력"은 글 전체를 가맹점/내용에 채운 거래 입력을 연다. 닫으면 글이 돌아온다', async () => {
    const opened = await openHome()
    await submitLine(opened.user, '친구 생일 선물')
    await opened.user.click(screen.getByRole('link', { name: '자세히 입력' }))
    await formHeading()
    await waitFor(() => expect(payee().value).toBe('친구 생일 선물'))
    expect(amount().value).toBe('')
    expect(typeRadio('지출').getAttribute('aria-checked')).toBe('true')
    await opened.user.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(pathOf(opened)).toBe('/home'))
    await waitFor(() => expect(oneLine().value).toBe('친구 생일 선물'))
  })

  it('새로고침한 것처럼 기억이 없는 표시로 열면 빈 새 입력이다', async () => {
    const opened = await openApp('/more')
    await screen.findByRole('main')
    await act(() => opened.router.navigate('/transactions/new', { state: { oneLine: 'stale-mark' } }))
    await formHeading()
    await waitFor(() => expect(accountField().textContent).not.toBe(''))
    expect(payee().value).toBe('')
    expect(amount().value).toBe('')
    expect(screen.getByRole('button', { name: '더 보기' }).getAttribute('aria-expanded')).toBe('false')
  })
})

describe('넓은 화면(1280px)', () => {
  beforeEach(() => {
    installMatchMedia(1280)
  })

  async function openWide() {
    const opened = await openHome()
    setViewportWidth(1280)
    return opened
  }

  async function openWideResult(user: User, text = '점심 12000') {
    await submitLine(user, text)
    const region = await screen.findByRole('region', { name: RESULT })
    await waitFor(() => expect(accountField().textContent).not.toBe(''))
    return region
  }

  it('입력칸 바로 아래에 펼쳐지고(모달이 아님) 홈의 나머지 내용은 아래에 그대로 있다', async () => {
    const { user } = await openWide()
    const region = await openWideResult(user)
    expect(resultDialog()).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(oneLine().compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const totals = screen.getByRole('heading', { level: 2, name: /월 합계$/ })
    expect(region.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('버튼 줄은 닫기, 자세히, 저장 순서이고 초점이 저장에 있어 엔터 한 번으로 저장된다', async () => {
    const { user } = await openWide()
    const region = await openWideResult(user)
    const buttons = within(region)
      .getAllByRole('button')
      .filter((button) => ['닫기', '자세히', '저장'].includes(button.textContent ?? ''))
    expect(buttons.map((button) => button.textContent)).toEqual(['닫기', '자세히', '저장'])
    expect(document.activeElement).toBe(saveButton())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    await waitFor(() => expect(resultRegion()).toBeNull())
    expect(document.activeElement).toBe(oneLine())
  })

  it('Tab 순서는 유형, 금액, 가맹점/내용, 카테고리, 계좌, 날짜, 시각, 닫기, 자세히, 저장', async () => {
    const { user } = await openWide()
    await openWideResult(user)
    typeRadio('지출').focus()
    const names: string[] = []
    for (let step = 0; step < 11; step += 1) {
      const focused = document.activeElement as HTMLElement
      // 시각 칸 안의 "지우기"는 시각 칸의 것이다(D-04와 같다)
      if (focused.textContent !== '지우기') {
        names.push(focused.getAttribute('aria-label') ?? (focused.labels?.[0]?.textContent || focused.textContent) ?? '')
      }
      await user.tab()
    }
    expect(names.map((name) => name.split(' ')[0])).toEqual([
      '지출',
      '금액',
      '가맹점/내용',
      '카테고리',
      '계좌',
      '날짜',
      '시각',
      '닫기',
      '자세히',
      '저장',
    ])
  })

  it('"닫기"와 Esc는 저장 없이 접고 입력칸에 커서를 둔다', async () => {
    const { user } = await openWide()
    await openWideResult(user)
    await user.click(within(resultRegion()!).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(resultRegion()).toBeNull())
    expect(document.activeElement).toBe(oneLine())
    expect(oneLine().value).toBe('점심 12000')
    await user.keyboard('{Enter}')
    await screen.findByRole('region', { name: RESULT })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(resultRegion()).toBeNull())
    expect(transactions.sent).toEqual([])
  })

  it('(4)~(6)이 한 줄, (7)~(8)이 한 줄이다', async () => {
    const { user } = await openWide()
    const region = await openWideResult(user)
    // 따로 싣는 조각의 CSS는 연 뒤에 들어온다
    setViewportWidth(1280)
    const rowOf = (element: Element) => element.closest('[class*="fieldRow"]')
    expect(rowOf(amount())).toBe(rowOf(payee()))
    expect(rowOf(payee())).toBe(rowOf(categoryField()))
    expect(rowOf(accountField())).toBe(rowOf(dateField()))
    expect(rowOf(amount())).not.toBe(rowOf(accountField()))
    expect(getComputedStyle(rowOf(amount())!).display).toBe('grid')
    expect(region.contains(time())).toBe(true)
  })
})

describe('기본 날짜·시각과 자정 경계', () => {
  it.each([
    ['2026-11-26T23:59:59+09:00', 'Asia/Seoul', '11월 26일 (목)', '23:59', '2026-11-26'],
    ['2026-11-27T00:00:00+09:00', 'Asia/Seoul', '11월 27일 (금)', '00:00', '2026-11-27'],
    ['2026-11-30T23:59:00+09:00', 'Asia/Seoul', '11월 30일 (월)', '23:59', '2026-11-30'],
    ['2026-12-01T00:00:00+09:00', 'Asia/Seoul', '12월 1일 (화)', '00:00', '2026-12-01'],
    ['2026-11-26T23:59:00-08:00', 'America/Los_Angeles', '11월 26일 (목)', '23:59', '2026-11-26'],
    ['2026-11-27T00:00:00+14:00', 'Pacific/Kiritimati', '11월 27일 (금)', '00:00', '2026-11-27'],
    ['2026-11-26T23:59:00-11:00', 'Pacific/Pago_Pago', '11월 26일 (목)', '23:59', '2026-11-26'],
    ['2026-11-27T00:00:00Z', 'UTC', '11월 27일 (금)', '00:00', '2026-11-27'],
  ])('기기의 지금 %s(%s)이면 날짜 %s, 시각 %s로 열고 그대로 보낸다', async (at, zone, shown, clock, sent) => {
    setDeviceClock(at, zone)
    const { user } = await openHome()
    await openResult(user)
    expect(dateField().textContent).toContain(shown)
    expect(time().value).toBe(clock)
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(transactions.sent[0].body).toMatchObject({ occurredOn: sent, occurredTime: clock })
  })
})

describe('휴대폰 배치에서 화면 키보드가 올라오면 하단 탭을 숨긴다(00-common 6.2)', () => {
  function stubKeyboard() {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1, width: 390 })
    vi.stubGlobal('visualViewport', viewport)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(844)
    return {
      up: () => {
        viewport.height = 500
        viewport.dispatchEvent(new Event('resize'))
      },
      down: () => {
        viewport.height = 844
        viewport.dispatchEvent(new Event('resize'))
      },
    }
  }

  it('입력칸에 초점이 있고 보이는 영역이 줄면 숨기고, 키보드가 내려가면 다시 보인다', async () => {
    const keyboard = stubKeyboard()
    const { user } = await openHome()
    expect(tabBar()).not.toBeNull()
    await user.click(oneLine())
    act(() => keyboard.up())
    await waitFor(() => expect(tabBar()).toBeNull())
    act(() => keyboard.down())
    await waitFor(() => expect(tabBar()).not.toBeNull())
  })

  it('초점이 입력칸에 없으면 보이는 영역이 줄어도(확대 등) 숨기지 않는다', async () => {
    const keyboard = stubKeyboard()
    await openHome()
    act(() => keyboard.up())
    await settle()
    expect(tabBar()).not.toBeNull()
  })
})

describe('D-05 조각을 받지 못하면', () => {
  it.each([
    [false, '문제가 생겨 열지 못했어요. 잠시 후 다시 시도해 주세요.'],
    [true, '연결이 없어 열지 못했어요. 연결되면 다시 시도해 주세요.'],
  ])('연결 없음 %s: 오류 자리에 "%s"를 보이고 글을 그대로 둔다', async (offline, message) => {
    vi.doMock('../src/features/home/OneLineResult', () => {
      throw new Error('조각을 받지 못했다')
    })
    try {
      const { user } = await openHome()
      if (offline) act(() => goOffline())
      await submitLine(user, '점심 12000')
      await waitFor(() => expect(errorOf(oneLine())).toBe(message))
      expect(oneLine().value).toBe('점심 12000')
      expect(resultDialog()).toBeNull()
    } finally {
      vi.doUnmock('../src/features/home/OneLineResult')
    }
  })
})

describe('최근 거래가 이미 있을 때', () => {
  it('저장한 새 줄이 기존 줄과 함께 보인다', async () => {
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-25', occurredTime: '09:00', accountId: id.card, categoryId: id.food, amount: 5000, payee: '빵집' }),
    ])
    listSaved()
    const { user } = await openHome()
    await openResult(user)
    await user.click(saveButton())
    const recent = screen.getByRole('region', { name: '최근 거래' })
    await waitFor(() => expect(within(recent).getByText('점심')).toBeTruthy())
    expect(within(recent).getByText('빵집')).toBeTruthy()
  })
})
