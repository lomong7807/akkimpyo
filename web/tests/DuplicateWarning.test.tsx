import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { queueOf, seedLedgerCopy } from './support/device'
import { untilOpened, untilUnshielded } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { holdClock, passTime } from './support/testClock'
import { toastRegion } from './support/toast'
import { expenseOf, incomeOf, startTransactionList, transferOf, type TransactionList } from './support/transactionList'
import { startTransactionDetail } from './support/transactionDetail'
import {
  accountField,
  amount,
  id,
  LEDGER,
  openApp,
  openForm,
  path,
  payee,
  pick,
  resetGlobals,
  saveButton,
  settle,
  startServer,
  typeRadio,
  untilDefaultAccount,
  type Opened,
  type User,
} from './support/transactionScreen'
import { savedOf, type Duplicates, type Transactions } from './support/transactions'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

/*
 * 중복 경고(F-209, P-218, D-04 (16)의 (나)·(30)·(31)·"중복 경고", D-05 (10), #241). 새 입력의 지출·수입을 저장할 때 기기 검증
 * 다음, 저장 전에 같은 장부에 같은 날짜·금액·가맹점의 거래가 있는지 묻는다. 연결이 있으면 서버(#59)가 정하고, 없으면 기기의 최근
 * 31일 사본(#238)으로 본다. 맞는 거래가 있으면 판(휴대폰은 바닥 시트, 넓은 화면은 가운데 창)을 띄우고 "닫기"와 "그래도 저장"을
 * 고르게 한다. 수정과 "고쳐서 보내기"(#237)는 묻지 않는다(planner #241 P1). 묻기가 실패하면 경고 없이 저장을 이어 간다(P3).
 */

const NOW = '2026-11-26T12:30:00+09:00'
const TITLE = '같은 거래가 이미 있어요'
const DESCRIPTION = '날짜, 금액, 가맹점이 같은 거래예요. 그래도 저장할까요?'
const QUEUED = '기기에 저장했어요. 연결되면 보낼게요.'
const FAILED = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const ONE_LINE_RESULT = '한 줄 입력 확인'

const server = startMockServer()
let backend: Backend
let transactions: Transactions
let duplicates: Duplicates
let list: TransactionList

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions, duplicates } = startServer(server))
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

const warning = () => screen.queryByRole('dialog', { name: TITLE })
const warningHeading = () => within(warning()!).getByRole('heading', { name: TITLE })
/** 판 아래의 글자 버튼. 바닥 시트의 X 아이콘(이름 "닫기")은 빼고 글자가 그 이름인 버튼이다 */
const inWarning = (name: string) =>
  within(warning()!)
    .getAllByRole('button', { name })
    .find((button) => button.textContent === name)!
/** 판의 맞는 거래 줄마다 글자 줄: 날짜와 가맹점, 입력한 사람, (취소 칩), 금액 */
const rows = () =>
  within(warning()!)
    .getAllByRole('listitem')
    .map((row) => [...row.querySelectorAll('p')].map((line) => line.textContent))
const toastText = () => toastRegion().textContent ?? ''

/** 서버가 저장한 지출(user-1이 넣음). 기본은 오늘 점심 12,000원이다 */
function lunch(fields: Record<string, unknown> = {}, changes: object = {}) {
  return expenseOf(
    { occurredOn: '2026-11-26', accountId: id.salary, categoryId: id.dining, amount: 12000, payee: '점심', ...fields },
    changes,
  )
}

/** 거래 입력을 열어 금액과 가맹점/내용을 넣는다 */
async function fillForm(typedAmount = '12000', typedPayee = '점심') {
  const opened = await openForm()
  await opened.user.click(amount())
  if (typedAmount !== '') await opened.user.keyboard(typedAmount)
  if (typedPayee !== '') await opened.user.type(payee(), typedPayee)
  return opened
}

/** 저장을 눌러 판이 다 열리기를 기다린다 */
async function saveToWarning(user: User) {
  await user.click(saveButton())
  await screen.findByRole('dialog', { name: TITLE })
  await untilOpened()
}

describe('거래 입력(D-04 새 입력)에서 저장하면 묻는다', () => {
  it('기기 검증 다음, 보내기 전에 날짜·금액·가맹점을 묻는다. 맞는 거래가 없으면 판 없이 그대로 저장한다', async () => {
    const order: string[] = []
    duplicates.response = () => {
      order.push('묻기')
      return HttpResponse.json({ items: [] })
    }
    transactions.response = (sent) => {
      order.push('저장')
      return HttpResponse.json(savedOf(sent.body), { status: 201 })
    }
    const opened = await fillForm('12000', '  점심 ')
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(order).toEqual(['묻기', '저장'])
    expect(warning()).toBeNull()
    const [asked] = duplicates.requests
    expect(asked).toMatchObject({ ledgerId: LEDGER, user: 'user-1', occurredOn: '2026-11-26', amount: '12000', payee: '점심' })
    // 같은 id로 앞서 저장된 내 거래(응답만 잃은 저장)는 겹친 거래가 아니다
    expect(asked.exclude).toBe(transactions.sent[0].body.id)
    expect(asked.names).toEqual(['occurredOn', 'amount', 'payee', 'exclude'])
  })

  it('기기 검증에 걸리면 묻지 않는다', async () => {
    const opened = await fillForm('', '점심')
    await opened.user.click(saveButton())
    await settle()
    expect(duplicates.requests).toEqual([])
    expect(transactions.sent).toEqual([])
  })

  it('맞는 거래가 있으면 보내지 않고 판을 띄운다: 제목, 설명, 날짜·가맹점·금액과 입력한 사람', async () => {
    duplicates.items = [lunch()]
    const opened = await fillForm()
    await saveToWarning(opened.user)
    expect(within(warning()!).getByText(DESCRIPTION)).toBeTruthy()
    expect(rows()).toEqual([['11월 26일 (목) 점심', '입력한 사람: 나', '12,000원']])
    expect(transactions.sent).toEqual([])
    expect(path(opened)).toBe('/transactions/new')
  })

  it('다른 구성원이 넣은 거래는 그 이름, 탈퇴했으면 "탈퇴한 사용자", 취소 거래에는 "취소" 칩이 붙는다', async () => {
    duplicates.items = [
      lunch({}, { createdBy: { id: 'user-2', displayName: '김도윤' } }),
      lunch({}, { createdBy: null, status: 'CANCELED' }),
      lunch(),
    ]
    const opened = await fillForm()
    await saveToWarning(opened.user)
    expect(rows()).toEqual([
      ['11월 26일 (목) 점심', '입력한 사람: 김도윤', '12,000원'],
      ['11월 26일 (목) 점심', '입력한 사람: 탈퇴한 사용자', '취소', '12,000원'],
      ['11월 26일 (목) 점심', '입력한 사람: 나', '12,000원'],
    ])
    expect(within(warning()!).queryByText(/^외 /)).toBeNull()
  })

  it('맞는 거래가 넷 이상이면 최근 3건과 "외 {N}건"을 보인다(서버는 5건까지 준다)', async () => {
    duplicates.items = Array.from({ length: 6 }, () => lunch())
    const opened = await fillForm()
    await saveToWarning(opened.user)
    expect(rows()).toHaveLength(3)
    expect(within(warning()!).getByText('외 2건')).toBeTruthy()
  })

  it('수입이면 수입으로 묻고 금액은 수입 모양(+)이다', async () => {
    duplicates.items = [incomeOf({ occurredOn: '2026-11-26', accountId: id.salary, categoryId: id.pay, amount: 12000, payee: '점심' })]
    const opened = await fillForm()
    await opened.user.click(typeRadio('수입'))
    await saveToWarning(opened.user)
    expect(rows()).toEqual([['11월 26일 (목) 점심', '입력한 사람: 나', '+12,000원']])
  })

  it('처음 초점은 판 제목이다. Tab은 닫기, 그래도 저장 순서이고 그래도 저장이 주된 버튼이다', async () => {
    duplicates.items = [lunch()]
    const opened = await fillForm()
    await saveToWarning(opened.user)
    expect(document.activeElement).toBe(warningHeading())
    await opened.user.tab()
    // 바닥 시트의 X 아이콘이 먼저다
    if (document.activeElement !== inWarning('닫기')) await opened.user.tab()
    expect(document.activeElement).toBe(inWarning('닫기'))
    await opened.user.tab()
    expect(document.activeElement).toBe(inWarning('그래도 저장'))
    expect(inWarning('그래도 저장').className).toMatch(/primary/)
    expect(inWarning('닫기').className).toMatch(/secondary/)
  })

  it('"닫기"는 판을 닫고 입력 화면으로 돌아가며 값은 그대로다. 보내지 않고, 다시 저장하면 다시 묻는다', async () => {
    duplicates.items = [lunch()]
    const opened = await fillForm()
    await saveToWarning(opened.user)
    await opened.user.click(inWarning('닫기'))
    await waitFor(() => expect(warning()).toBeNull())
    await untilUnshielded()
    expect(amount().value).toBe('12,000')
    expect(payee().value).toBe('점심')
    expect(transactions.sent).toEqual([])
    await saveToWarning(opened.user)
    expect(duplicates.requests).toHaveLength(2)
  })

  it('Esc는 "닫기"와 같다', async () => {
    duplicates.items = [lunch()]
    const opened = await fillForm()
    await saveToWarning(opened.user)
    await opened.user.keyboard('{Escape}')
    await waitFor(() => expect(warning()).toBeNull())
    expect(path(opened)).toBe('/transactions/new')
    expect(transactions.sent).toEqual([])
  })

  it('"그래도 저장"은 판을 닫고 같은 id로 한 번 보내 저장을 마친다', async () => {
    duplicates.items = [lunch()]
    const opened = await openApp('/more')
    await screen.findByRole('main')
    await act(() => opened.router.navigate('/transactions/new'))
    await untilDefaultAccount()
    await opened.user.click(amount())
    await opened.user.keyboard('12000')
    await opened.user.type(payee(), '점심')
    await saveToWarning(opened.user)
    await opened.user.click(inWarning('그래도 저장'))
    await waitFor(() => expect(path(opened)).toBe('/more'))
    expect(toastText()).toBe('저장했어요')
    expect(transactions.sent).toHaveLength(1)
    expect(transactions.sent[0].body).toMatchObject({ type: 'EXPENSE', amount: 12000, payee: '점심' })
    expect(transactions.sent[0].body.id).toBe(duplicates.requests[0].exclude)
    expect(duplicates.requests).toHaveLength(1)
  })

  it('"그래도 저장" 뒤 서버 오류면 저장 위에 문구를 보이고, "다시 시도"는 다시 묻지 않고 같은 id로 보낸다', async () => {
    duplicates.items = [lunch()]
    transactions.response = () => problem(503, 'INTERNAL_ERROR')
    const opened = await fillForm()
    await saveToWarning(opened.user)
    await opened.user.click(inWarning('그래도 저장'))
    await screen.findByText(FAILED)
    expect(warning()).toBeNull()
    transactions.response = undefined
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(transactions.sent).toHaveLength(2)
    expect(transactions.sent[1].body.id).toBe(transactions.sent[0].body.id)
    expect(duplicates.requests).toHaveLength(1)
  })

  it('묻는 동안 저장 버튼은 처리 중이고 칸은 잠기며 화면을 떠나지 않는다', async () => {
    const answer = delayed()
    duplicates.response = answer.respond
    const opened = await fillForm()
    await opened.user.click(saveButton())
    await answer.arrived
    await waitFor(() => expect(saveButton().getAttribute('aria-busy')).toBe('true'))
    expect(amount().readOnly).toBe(true)
    expect(payee().readOnly).toBe(true)
    answer.answer(HttpResponse.json({ items: [] }))
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
  })

  it('가맹점/내용이 비었거나 공백뿐이면 묻지 않는다', async () => {
    const opened = await fillForm('12000', '   ')
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(duplicates.requests).toEqual([])
  })

  it('이체는 묻지 않는다', async () => {
    const opened = await openForm()
    await opened.user.click(typeRadio('이체'))
    await opened.user.click(amount())
    await opened.user.keyboard('12000')
    await pick(opened.user, accountField('받는 계좌'), '비상금')
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(duplicates.requests).toEqual([])
  })
})

describe('연결된 상태에서 묻기가 실패하면 경고 없이 저장을 이어 간다(planner #241 P3)', () => {
  it('서버 오류(5xx)', async () => {
    duplicates.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await fillForm()
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(warning()).toBeNull()
    expect(transactions.sent).toHaveLength(1)
  })

  it('약속과 다른 응답', async () => {
    duplicates.response = () => HttpResponse.json({ items: [{ id: 'x' }] })
    const opened = await fillForm()
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(warning()).toBeNull()
  })

  it('15초 동안 응답이 없음(응답 지연)', async () => {
    duplicates.response = delayed().respond
    await fillForm()
    holdClock()
    fireEvent.click(saveButton())
    await passTime(14_900)
    expect(transactions.sent).toEqual([])
    await passTime(200)
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(warning()).toBeNull()
  })

  it('요청 중에 연결이 끊기면 기기의 최근 31일로 묻고, 그래도 저장하면 기기에 쌓는다', async () => {
    duplicates.response = () => HttpResponse.error()
    const opened = await fillForm()
    await keepLastMonth([lunch()])
    await saveToWarning(opened.user)
    expect(rows()).toEqual([['11월 26일 (목) 점심', '입력한 사람: 나', '12,000원']])
    await opened.user.click(inWarning('그래도 저장'))
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    expect(transactions.sent).toEqual([])
    expect(await queueOf('user-1')).toHaveLength(1)
  })
})

/**
 * 기기에 최근 한 달(#238)을 남긴다. 앱이 열리며 로그인을 확인한 뒤에 부른다(그 전에 둔 사본은 앱을 열 때 주인 확인이 없어 지운다).
 */
async function keepLastMonth(items: object[]) {
  await seedLedgerCopy('user-1', LEDGER, 'transactions', lastMonthOf(items))
}

/** 기기에 남긴 최근 한 달(#238)의 모양. 저장 범위는 2026-10-27 ~ 2026-11-26이다 */
function lastMonthOf(items: object[], from = '2026-10-27', to = '2026-11-26') {
  const dates = [...new Set(items.map((item) => (item as { occurredOn: string }).occurredOn))]
  return {
    from,
    to,
    items,
    days: dates.map((date) => ({ date, income: 0, expense: 0 })),
    months: [
      { month: '2026-10', totals: { income: 0, expense: 0 } },
      { month: '2026-11', totals: { income: 0, expense: 0 } },
    ],
    truncated: false,
  }
}

describe('연결이 없으면 기기의 최근 31일 내역으로만 묻는다(F-209)', () => {
  /** 거래 입력을 열고 사본을 둔 뒤 연결을 끊는다 */
  async function openOffline(items: object[]) {
    const opened = await openForm()
    await keepLastMonth(items)
    act(() => goOffline())
    return opened
  }

  async function typeAndSave(user: User, typedAmount = '12000', typedPayee = '점심') {
    await user.click(amount())
    await user.keyboard(typedAmount)
    await user.type(payee(), typedPayee)
    await user.click(saveButton())
  }

  it('같은 날짜·금액·가맹점(공백과 대소문자 무시, 조합형)이 있으면 판을 띄운다. 요청은 보내지 않는다', async () => {
    const decomposed = '스타벅스'.normalize('NFD')
    const opened = await openOffline([
      lunch({ payee: `Star ${decomposed}` }, { createdBy: { id: 'user-2', displayName: '김도윤' } }),
    ])
    await typeAndSave(opened.user, '12000', 'star스타벅스')
    await screen.findByRole('dialog', { name: TITLE })
    await untilOpened()
    expect(rows()).toEqual([[`11월 26일 (목) Star ${decomposed}`, '입력한 사람: 김도윤', '12,000원']])
    expect(duplicates.requests).toEqual([])
  })

  it('"그래도 저장"은 기기에 쌓는다(연결되어 보낼 때 다시 묻지 않는 것은 D-05에서 본다)', async () => {
    const opened = await openOffline([lunch()])
    await typeAndSave(opened.user)
    await screen.findByRole('dialog', { name: TITLE })
    await untilOpened()
    await opened.user.click(inWarning('그래도 저장'))
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    const [queued] = await queueOf('user-1')
    expect(queued.body).toMatchObject({ amount: 12000, payee: '점심' })
    expect(transactions.sent).toEqual([])
  })

  it('이체, 휴지통의 거래, 다른 날짜, 다른 금액, 다른 가맹점은 맞지 않는다. 판 없이 쌓는다', async () => {
    const opened = await openOffline([
      transferOf({ occurredOn: '2026-11-26', fromAccountId: id.salary, toAccountId: id.saving, amount: 12000 }),
      lunch({ occurredOn: '2026-11-25' }),
      lunch({ amount: 12001 }),
      lunch({ payee: '점심 도시락' }),
    ])
    await typeAndSave(opened.user)
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    expect(warning()).toBeNull()
  })

  it('취소 거래는 맞는 거래다', async () => {
    const opened = await openOffline([lunch({}, { status: 'CANCELED' })])
    await typeAndSave(opened.user)
    await screen.findByRole('dialog', { name: TITLE })
    expect(rows()).toEqual([['11월 26일 (목) 점심', '입력한 사람: 나', '취소', '12,000원']])
  })

  it('사본이 없으면 묻지 않고 쌓는다', async () => {
    const opened = await openForm()
    act(() => goOffline())
    await typeAndSave(opened.user)
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    expect(warning()).toBeNull()
  })

  it('맞는 거래가 넷 이상이면 서버처럼 최근 저장 5건 가운데 3건과 "외 2건"이다', async () => {
    const items = Array.from({ length: 7 }, () => lunch())
    const opened = await openOffline(items)
    await typeAndSave(opened.user)
    await screen.findByRole('dialog', { name: TITLE })
    expect(rows()).toHaveLength(3)
    expect(within(warning()!).getByText('외 2건')).toBeTruthy()
  })
})

describe('사본의 저장 범위 경계(날짜 경계)', () => {
  /** 달력(D-02)에서 그날로 연 것처럼 날짜를 채운 거래 입력을 열고, 사본을 둔 뒤 연결을 끊고 저장한다 */
  async function openOnDate(date: string, kept: object[]) {
    const opened = await openApp('/more')
    await screen.findByRole('main')
    await act(() => opened.router.navigate('/transactions/new', { state: { date } }))
    await untilDefaultAccount()
    await keepLastMonth(kept)
    act(() => goOffline())
    await opened.user.click(amount())
    await opened.user.keyboard('12000')
    await opened.user.type(payee(), '점심')
    await opened.user.click(saveButton())
    return opened
  }

  it.each([
    ['2026-10-27', '저장 범위의 첫날'],
    ['2026-11-26', '저장 범위의 끝날'],
  ])('%s(%s)의 거래도 사본으로 맞춘다', async (date) => {
    await openOnDate(date, [lunch({ occurredOn: date })])
    await screen.findByRole('dialog', { name: TITLE })
    expect(rows()[0][0]).toContain(date === '2026-10-27' ? '10월 27일 (화)' : '11월 26일 (목)')
  })

  it.each([
    ['2026-10-26', '2026-10-27', '저장 범위의 첫날 전날'],
    ['2026-11-27', '2026-11-26', '저장 범위의 끝날 다음 날'],
  ])('%s(%s 옆, %s)는 사본에 없는 날이라 판 없이 쌓는다', async (date, neighbor) => {
    await openOnDate(date, [lunch({ occurredOn: neighbor })])
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    expect(warning()).toBeNull()
    const [queued] = await queueOf('user-1')
    expect(queued.body).toMatchObject({ occurredOn: date })
  })

  it.each([
    ['2026-11-26T23:59:00+09:00', 'Asia/Seoul', '2026-11-26'],
    ['2026-11-27T00:00:00+09:00', 'Asia/Seoul', '2026-11-27'],
    ['2026-11-26T23:59:00-08:00', 'America/Los_Angeles', '2026-11-26'],
    ['2026-11-27T00:00:00+14:00', 'Pacific/Kiritimati', '2026-11-27'],
    ['2026-11-26T23:59:00-11:00', 'Pacific/Pago_Pago', '2026-11-26'],
  ])('기기의 지금 %s(%s)이면 날짜 %s로 묻는다', async (at, zone, date) => {
    setDeviceClock(at, zone)
    const opened = await fillForm()
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(duplicates.requests[0].occurredOn).toBe(date)
  })
})

describe('한 줄 입력 결과 확인(D-05)에서 저장하면 묻는다', () => {
  const oneLine = () => screen.getByRole<HTMLInputElement>('textbox', { name: '한 줄 입력' })
  const resultDialog = () => screen.queryByRole('dialog', { name: ONE_LINE_RESULT })

  async function openHome() {
    const opened = await openApp('/home')
    await screen.findByRole('textbox', { name: '한 줄 입력' })
    await waitFor(() => expect(within(screen.getByRole('main')).queryByText('계좌 잔액')).not.toBeNull())
    return opened
  }

  /** 한 줄을 써서 D-05를 열고 기본 계좌가 들어갈 때까지 기다린다. 넓은 화면이면 펼친 구역이다 */
  async function openResult(user: User, text = '점심 12000') {
    await user.click(oneLine())
    await user.keyboard(text)
    await user.click(screen.getByRole('button', { name: '입력' }))
    const { loadChunk } = await import('../src/features/home/oneLineLoader')
    await act(() => loadChunk())
    await screen.findByRole('button', { name: '자세히' })
    // 휴대폰 배치의 판은 여는 동안 누르기를 막는다
    if (resultDialog()) await untilOpened()
    const field = accountField()
    await waitFor(() => expect(field.textContent).not.toBe(''))
  }

  async function saveToWarning(opened: Opened) {
    await opened.user.click(saveButton())
    await screen.findByRole('dialog', { name: TITLE })
    await untilOpened()
  }

  it('맞는 거래가 있으면 D-05를 같은 값으로 다시 열고 그 위에 판을 띄운다. "닫기"는 판만 닫는다', async () => {
    duplicates.items = [lunch()]
    const opened = await openHome()
    await openResult(opened.user)
    await saveToWarning(opened)
    expect(resultDialog()).not.toBeNull()
    expect(rows()).toEqual([['11월 26일 (목) 점심', '입력한 사람: 나', '12,000원']])
    expect(document.activeElement).toBe(warningHeading())
    expect(transactions.sent).toEqual([])
    await opened.user.click(inWarning('닫기'))
    await waitFor(() => expect(warning()).toBeNull())
    expect(resultDialog()).not.toBeNull()
    expect(amount().value).toBe('12,000')
    expect(payee().value).toBe('점심')
    expect(transactions.sent).toEqual([])
  })

  it('"그래도 저장"은 판과 D-05를 닫고 입력칸을 비워 초점을 준 뒤 같은 id로 보낸다', async () => {
    duplicates.items = [lunch()]
    const opened = await openHome()
    await openResult(opened.user)
    await saveToWarning(opened)
    await opened.user.click(inWarning('그래도 저장'))
    // 누른 처리 안에서 입력칸에 초점을 준다(iPhone 키보드)
    expect(document.activeElement).toBe(oneLine())
    expect(oneLine().value).toBe('')
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(warning()).toBeNull()
    expect(resultDialog()).toBeNull()
    expect(transactions.sent).toHaveLength(1)
    expect(transactions.sent[0].body.id).toBe(duplicates.requests[0].exclude)
  })

  it('맞는 거래가 없으면 판 없이 저장한다', async () => {
    const opened = await openHome()
    await openResult(opened.user)
    await opened.user.click(saveButton())
    await waitFor(() => expect(toastText()).toBe('저장했어요'))
    expect(duplicates.requests).toHaveLength(1)
    expect(duplicates.requests[0]).toMatchObject({ occurredOn: '2026-11-26', amount: '12000', payee: '점심' })
    expect(warning()).toBeNull()
  })

  it('넓은 화면에서는 가운데 창이다. "닫기"는 펼친 구역으로 돌아간다', async () => {
    installMatchMedia(1280)
    setViewportWidth(1280)
    duplicates.items = [lunch()]
    const opened = await openHome()
    await openResult(opened.user)
    await saveToWarning(opened)
    expect(warning()!.querySelector('[class*="window"]')).toBeTruthy()
    await opened.user.click(inWarning('닫기'))
    await waitFor(() => expect(warning()).toBeNull())
    expect(screen.getByRole('region', { name: ONE_LINE_RESULT })).toBeTruthy()
    expect(transactions.sent).toEqual([])
  })

  it('연결이 없으면 앱이 남긴 최근 31일로 묻고, 그래도 저장하면 쌓는다. 연결되어 보낼 때는 다시 묻지 않는다', async () => {
    // 홈이 받은 최근 한 달을 앱이 기기에 남긴다(#238). 테스트 도우미로 두면 모듈을 새로 불러 앱의 보내기가 다른 세션을 본다
    list.months.set('2026-11', [lunch()])
    const opened = await openHome()
    await screen.findByText('점심', { selector: '[class*="title"]' })
    await waitFor(() => expect(list.requests.some(({ month, limit }) => month === null && limit === '50')).toBe(true))
    await settle()
    act(() => goOffline())
    await openResult(opened.user)
    await saveToWarning(opened)
    expect(rows()).toEqual([['11월 26일 (목) 점심', '입력한 사람: 나', '12,000원']])
    await opened.user.click(inWarning('그래도 저장'))
    await waitFor(() => expect(toastText()).toBe(QUEUED))
    expect(transactions.sent).toEqual([])
    act(() => goOnline())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(transactions.sent[0].body).toMatchObject({ amount: 12000, payee: '점심' })
    expect(duplicates.requests).toEqual([])
  })
})

describe('거래 수정(D-04 수정)은 묻지 않는다(planner #241 P1)', () => {
  it('가맹점이 있는 지출을 고쳐 저장해도 묻지 않는다', async () => {
    const detail = startTransactionDetail(server, backend)
    detail.uncategorized = { EXPENSE: id.expenseNone, INCOME: id.incomeNone }
    const item = lunch({ occurredTime: '12:00', memo: null })
    duplicates.items = [lunch()]
    detail.put(item)
    list.months.set('2026-11', [item])
    const opened = await openApp(`/transactions/${String(item.id)}/edit`)
    await screen.findByRole('heading', { level: 1, name: '거래 수정' })
    await waitFor(() => expect(payee().value).toBe('점심'))
    await opened.user.type(payee(), ' 정식')
    await opened.user.click(saveButton())
    await waitFor(() => expect(detail.requests.update).toHaveLength(1))
    expect(duplicates.requests).toEqual([])
    expect(warning()).toBeNull()
  })
})
