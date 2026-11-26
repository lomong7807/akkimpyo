import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { seedPending } from './support/device'
import { startGuardClock } from './support/guardClock'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { readCssRule } from './support/cssRule'
import { expenseOf, incomeOf, startTransactionList, type TransactionList } from './support/transactionList'
import { amount, id, LEDGER, openApp, resetGlobals, saveButton, settle, startServer } from './support/transactionScreen'
import { resetViewport } from './support/viewport'

/*
 * 쌓은 거래의 "보내지 않음" 표시(C-01 (9)(10), D-01 (4)(8)(11), F-103, #234 B). 홈 최근 거래와 내역에 서버 거래와 같은 순서
 * 규칙으로 섞이고 셋째 줄에 표시 칩이 붙는다(0.4, "취소"와 같은 자리, designer #234 B). 내역 합계와 날짜 묶음 머리의 그날
 * 합계에는 더하고, 홈의 이번 달 합계와 계좌 잔액에는 더하지 않는다(작성자 판단 43, planner Q5). 대신 홈 합계 아래에 합계에
 * 없는 건수를 알린다(designer #234 B). 1B 임시로 보내지 않음 줄은 눌리지 않는다(#236).
 */

const server = startMockServer()
let backend: Backend
let list: TransactionList

const NOW = '2026-11-26T12:30:00+09:00'
const now = Date.parse(NOW)

beforeEach(() => {
  setDeviceClock(NOW)
  startGuardClock()
  vi.stubGlobal('scrollTo', vi.fn())
  const started = startServer(server)
  backend = started.backend
  // 이 파일은 쌓인 줄의 모양을 본다. 저절로 보내기(#235)가 줄을 지우지 않게 서버가 받지 않는다
  started.transactions.response = () => problem(503, 'INTERNAL_ERROR')
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

let pendingCount = 0
/** 기기가 만든 것처럼 서버 거래보다 뒤에 만든 UUID v7 */
function pendingId() {
  pendingCount += 1
  return `0193a000-0000-7000-8000-${String(pendingCount).padStart(12, '0')}`
}

function pendingExpense(fields: Record<string, unknown>, userId = 'user-1') {
  const bodyId = pendingId()
  return {
    userId,
    ledgerId: LEDGER,
    queuedAt: now,
    body: {
      id: bodyId,
      type: 'EXPENSE' as const,
      occurredOn: '2026-11-26',
      occurredTime: null,
      accountId: id.salary,
      categoryId: null,
      amount: 5000,
      payee: null,
      memo: null,
      ...fields,
    },
  }
}

function pendingIncome(fields: Record<string, unknown>) {
  const item = pendingExpense(fields)
  return { ...item, body: { ...item.body, type: 'INCOME' as const, accountId: id.salary, ...fields } }
}

function pendingTransfer(fields: Record<string, unknown>) {
  const bodyId = pendingId()
  return {
    userId: 'user-1',
    ledgerId: LEDGER,
    queuedAt: now,
    body: {
      id: bodyId,
      type: 'TRANSFER' as const,
      occurredOn: '2026-11-26',
      occurredTime: null,
      fromAccountId: id.salary,
      toAccountId: id.saving,
      amount: 10000,
      memo: null,
      ...fields,
    },
  }
}

const titles = () => [...document.querySelectorAll('[class*="_title_"]')].map((element) => element.textContent)
const rowOf = (title: string) => screen.getByText(title).closest('li')!
const chipIn = (row: HTMLElement) => within(row).queryByText('보내지 않음')
const rejectedChipIn = (row: HTMLElement) => within(row).queryByText('보낼 수 없음')

/** 서버가 거부해 보낼 수 없음이 된 입력을 쌓는다(#235) */
async function seedRejected(item: ReturnType<typeof pendingExpense>) {
  await seedPending(item)
  vi.resetModules()
  const { pendingOf, settlePending } = await import('../src/device/pendingQueue')
  const seen = (await pendingOf(item.userId)).find(({ id: rowId }) => rowId === item.body.id)!
  await settlePending(seen, { kind: 'rejected', status: 400, code: 'VALIDATION_FAILED', fieldErrors: [], at: now })
}

/** 내역(11월)을 열고 목록이 그려질 때까지 기다린다. */
async function openHistory(month = '2026-11') {
  const opened = await openApp(`/transactions?month=${month}`)
  await waitFor(() => expect(document.querySelector('[class*="_totals_"]')).not.toBeNull())
  await settle()
  return opened
}

/** 합계 줄의 금액(수입, 지출 순) */
function historyTotals() {
  const totals = document.querySelector('[class*="_totals_"]')!
  return [...totals.querySelectorAll('dd')].map((amountText) => amountText.textContent)
}

describe('내역(D-01)', () => {
  it('그 달의 보내지 않은 입력이 서버 거래와 같은 순서 규칙으로 섞이고 셋째 줄에 "보내지 않음"이 붙는다', async () => {
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-26', occurredTime: '12:30', accountId: id.salary, categoryId: id.food, amount: 8000, payee: '서버의 점심' }),
      incomeOf({ occurredOn: '2026-11-25', accountId: id.salary, categoryId: id.pay, amount: 100000, payee: '서버의 급여' }),
    ])
    await seedPending(pendingExpense({ occurredOn: '2026-11-26', payee: '시각 없는 대기' }))
    await seedPending(pendingExpense({ occurredOn: '2026-11-25', occurredTime: '09:00', payee: '아침의 대기' }))
    await openHistory()
    expect(titles()).toEqual(['서버의 점심', '시각 없는 대기', '아침의 대기', '서버의 급여'])
    expect(chipIn(rowOf('시각 없는 대기'))).not.toBeNull()
    expect(chipIn(rowOf('서버의 점심'))).toBeNull()
    // 둘째 줄(카테고리 · 계좌)은 그대로이고, 칩은 그 아래 "취소" 칩과 같은 자리(셋째 줄)에 있다(0.4)
    const row = rowOf('아침의 대기')
    expect(row.querySelector('[class*="_detail_"]')!.textContent).toBe('미분류 · 급여통장')
    expect(chipIn(row)!.closest('[class*="_status_"]')!.textContent).toBe('보내지 않음')
  })

  it('보내지 않음 줄은 눌리지 않는다(1B 임시, #236)', async () => {
    await seedPending(pendingExpense({ payee: '대기' }))
    await openHistory()
    expect(within(rowOf('대기')).queryByRole('link')).toBeNull()
  })

  it('수입·지출 합계에 그 달의 보내지 않은 입력을 더한다(이체는 빼고)', async () => {
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-20', accountId: id.salary, categoryId: id.food, amount: 8000 }),
      incomeOf({ occurredOn: '2026-11-20', accountId: id.salary, categoryId: id.pay, amount: 100000 }),
    ])
    await seedPending(pendingExpense({ amount: 5000 }))
    await seedPending(pendingIncome({ amount: 3000 }))
    await seedPending(pendingTransfer({ amount: 10000 }))
    await openHistory()
    expect(historyTotals()).toEqual(['+103,000원', '13,000원'])
  })

  it('날짜 묶음 머리의 그날 합계에도 더한다(planner Q5)', async () => {
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-26', accountId: id.salary, categoryId: id.food, amount: 8000 }),
    ])
    await seedPending(pendingExpense({ occurredOn: '2026-11-26', amount: 5000 }))
    await seedPending(pendingExpense({ occurredOn: '2026-11-24', amount: 2000, payee: '그날 대기뿐' }))
    await openHistory()
    const heads = [...document.querySelectorAll('[class*="_dayHead_"]')].map((head) => head.textContent)
    expect(heads).toEqual(['11월 26일 (목)지출13,000원', '11월 24일 (화)지출2,000원'])
  })

  describe('보낼 수 없음(D-01 (11), #235)', () => {
    it('서버가 거부한 입력의 줄에는 오류 칩 "보낼 수 없음"이 붙고 눌리지 않는다', async () => {
      await seedPending(pendingExpense({ payee: '대기' }))
      await seedRejected(pendingExpense({ payee: '거부됨' }))
      await openHistory()
      const row = rowOf('거부됨')
      expect(rejectedChipIn(row)).not.toBeNull()
      expect(chipIn(row)).toBeNull()
      expect(rejectedChipIn(rowOf('대기'))).toBeNull()
      expect(within(row).queryByRole('link')).toBeNull()
      // 셋째 줄, 다른 칩과 같은 자리
      expect(rejectedChipIn(row)!.closest('[class*="_status_"]')).not.toBeNull()
    })

    it('오류 칩은 color-surface 바탕, 1px color-danger 테두리, color-danger 글자다', async () => {
      await seedRejected(pendingExpense({ payee: '거부됨' }))
      await openHistory()
      const chip = rejectedChipIn(rowOf('거부됨'))!
      const style = getComputedStyle(chip)
      expect(style.backgroundColor).toBe('var(--color-surface)')
      expect(style.color).toBe('var(--color-danger)')
      // jsdom은 var()가 든 border 줄임을 계산하지 않아 규칙을 읽는다
      expect(chip.className).toMatch(/_danger_/)
      expect(readCssRule('src/components/StatusChip.module.css', '.danger')).toContain('border: 1px solid var(--color-danger);')
    })

    it('보낼 수 없음 줄의 금액도 수입·지출 합계와 그날 합계에 더한다(보이는 줄과 맞게, planner #102)', async () => {
      list.months.set('2026-11', [
        expenseOf({ occurredOn: '2026-11-26', accountId: id.salary, categoryId: id.food, amount: 8000 }),
      ])
      await seedPending(pendingExpense({ occurredOn: '2026-11-26', amount: 5000 }))
      await seedRejected(pendingExpense({ occurredOn: '2026-11-26', amount: 1000, payee: '거부됨' }))
      await openHistory()
      expect(historyTotals()).toEqual(['0원', '14,000원'])
      const heads = [...document.querySelectorAll('[class*="_dayHead_"]')].map((head) => head.textContent)
      expect(heads).toEqual(['11월 26일 (목)지출14,000원'])
    })
  })

  it('그 달의 것만 보인다(11월 30일은 11월, 12월 1일은 12월)', async () => {
    await seedPending(pendingExpense({ occurredOn: '2026-11-30', payee: '11월 끝' }))
    await seedPending(pendingExpense({ occurredOn: '2026-12-01', payee: '12월 처음' }))
    await openHistory()
    expect(titles()).toEqual(['11월 끝'])
  })

  it('같은 id가 서버 목록에 있으면(요청 중 끊겼지만 서버에는 저장됨) 서버 줄만 보인다', async () => {
    const item = pendingExpense({ payee: '서버에도 있음' })
    await seedPending(item)
    list.months.set('2026-11', [
      { ...expenseOf({ occurredOn: '2026-11-26', accountId: id.salary, categoryId: id.food, amount: 5000, payee: '서버에도 있음' }), id: item.body.id },
    ])
    await openHistory()
    expect(titles()).toEqual(['서버에도 있음'])
    expect(chipIn(rowOf('서버에도 있음'))).toBeNull()
  })

  it('다른 사용자의 보내지 않은 입력은 보이지 않는다', async () => {
    await seedPending(pendingExpense({ payee: '남의 대기' }, 'user-2'))
    await openHistory()
    expect(screen.queryByText('남의 대기')).toBeNull()
  })

  it('다음 쪽이 남았으면 받은 마지막 서버 줄보다 뒤에 올 항목은 아직 넣지 않는다(합계에는 더한다)', async () => {
    const items = Array.from({ length: 51 }, (_, index) =>
      expenseOf({ occurredOn: '2026-11-20', occurredTime: `1${String(index % 10)}:0${index % 6}`, accountId: id.salary, categoryId: id.food, amount: 1000 }),
    )
    list.months.set('2026-11', items)
    await seedPending(pendingExpense({ occurredOn: '2026-11-01', amount: 7000, payee: '달 처음의 대기' }))
    await openHistory()
    expect(screen.queryByText('달 처음의 대기')).toBeNull()
    expect(historyTotals()[1]).toBe('58,000원')
  })

  it('서버 거래가 없고 보내지 않은 입력만 있으면 빈 상태 대신 그 줄을 보인다', async () => {
    await seedPending(pendingExpense({ payee: '혼자인 대기' }))
    await openHistory()
    expect(screen.getByText('혼자인 대기')).toBeTruthy()
    expect(screen.queryByText('11월에 입력한 거래가 없어요')).toBeNull()
  })

  it('다른 탭에서 쌓으면 이 탭의 내역에 바로 보인다', async () => {
    await openHistory()
    await seedPending(pendingExpense({ payee: '다른 탭의 대기' }))
    expect(await screen.findByText('다른 탭의 대기')).toBeTruthy()
  })
})

describe('홈 최근 거래(C-01)', () => {
  async function openHome() {
    const opened = await openApp('/home')
    await screen.findByRole('heading', { level: 1, name: '홈' })
    // 최근 거래 구역이 줄이나 빈 상태로 그려질 때까지
    await waitFor(() =>
      expect(
        document.querySelector('[class*="_dayHead_"]') ?? screen.queryByText('거래를 입력하면 여기에 보여요'),
      ).not.toBeNull(),
    )
    await settle()
    return opened
  }

  const recentTitles = () => {
    const section = screen.getByRole('region', { name: '최근 거래' })
    return [...section.querySelectorAll('[class*="_title_"]')].map((element) => element.textContent)
  }

  it('보내지 않은 입력을 같은 순서 규칙으로 섞고 위에서 10건만 보인다(planner Q6)', async () => {
    list.months.set(
      '2026-11',
      Array.from({ length: 10 }, (_, index) =>
        expenseOf({ occurredOn: `2026-11-${String(25 - index).padStart(2, '0')}`, accountId: id.salary, categoryId: id.food, amount: 1000, payee: `서버 ${index + 1}` }),
      ),
    )
    await seedPending(pendingExpense({ occurredOn: '2026-11-26', payee: '오늘의 대기' }))
    await openHome()
    const shown = recentTitles()
    expect(shown).toHaveLength(10)
    expect(shown[0]).toBe('오늘의 대기')
    expect(shown.at(-1)).toBe('서버 9')
    expect(chipIn(rowOf('오늘의 대기'))).not.toBeNull()
  })

  it('오늘보다 뒤 날짜의 보내지 않은 입력은 넣지 않는다(서버가 오늘까지만 주는 것과 같다)', async () => {
    await seedPending(pendingExpense({ occurredOn: '2026-11-27', payee: '내일의 대기' }))
    await seedPending(pendingExpense({ occurredOn: '2026-11-26', payee: '오늘의 대기' }))
    await openHome()
    expect(recentTitles()).toEqual(['오늘의 대기'])
  })

  it('보낼 수 없음 줄도 섞고 내역과 같은 오류 칩을 셋째 줄에 붙인다. 눌리지 않는다(designer #235 Q2)', async () => {
    await seedPending(pendingExpense({ occurredOn: '2026-11-26', payee: '대기' }))
    await seedRejected(pendingExpense({ occurredOn: '2026-11-26', occurredTime: '09:00', payee: '거부됨' }))
    await openHome()
    expect(recentTitles()).toEqual(['거부됨', '대기'])
    const row = rowOf('거부됨')
    expect(rejectedChipIn(row)!.closest('[class*="_status_"]')).not.toBeNull()
    expect(chipIn(row)).toBeNull()
    expect(within(row).queryByRole('link')).toBeNull()
  })

  it('이번 달 합계와 계좌 잔액에는 더하지 않는다(작성자 판단 43)', async () => {
    await seedPending(pendingExpense({ amount: 5000, payee: '대기' }))
    await openHome()
    const totals = screen.getByRole('region', { name: /11월 합계/ })
    expect(within(totals).getAllByText('0원').length).toBeGreaterThan(0)
    expect(within(totals).queryByText('5,000원')).toBeNull()
    expect(screen.getByText('대기')).toBeTruthy()
  })

  describe('이번 달 합계 아래 줄(designer #234 B)', () => {
    const totalsRegion = () => screen.getByRole('region', { name: /11월 합계/ })

    it('이번 달의 보내지 않은 수입·지출이 있으면 합계에 없는 건수를 알린다(이체, 다른 달은 세지 않는다)', async () => {
      await seedPending(pendingExpense({ occurredOn: '2026-11-01', amount: 5000 }))
      await seedPending(pendingIncome({ occurredOn: '2026-11-30', amount: 3000 }))
      await seedPending(pendingTransfer({ occurredOn: '2026-11-26', amount: 10000 }))
      await seedPending(pendingExpense({ occurredOn: '2026-10-31', amount: 1000 }))
      await seedPending(pendingExpense({ occurredOn: '2026-12-01', amount: 1000 }))
      await openHome()
      expect(within(totalsRegion()).getByText('보내지 않은 입력 2건은 아직 합계에 없어요')).toBeTruthy()
      expect(screen.getAllByText(/아직 합계에 없어요/)).toHaveLength(1)
    })

    it('보낼 수 없음은 세지 않는다(곧 합계에 들어갈 것이 아니다, planner #102)', async () => {
      await seedPending(pendingExpense({ amount: 1000 }))
      await seedRejected(pendingExpense({ amount: 2000 }))
      await openHome()
      expect(within(totalsRegion()).getByText('보내지 않은 입력 1건은 아직 합계에 없어요')).toBeTruthy()
    })

    it('보낼 수 없음만 있으면 줄이 없다', async () => {
      await seedRejected(pendingExpense({ amount: 2000 }))
      await openHome()
      await within(totalsRegion()).findByText('차액')
      expect(screen.queryByText(/아직 합계에 없어요/)).toBeNull()
    })

    it('이번 달의 보내지 않은 입력이 없으면 줄이 없다', async () => {
      await seedPending(pendingTransfer({ occurredOn: '2026-11-26', amount: 10000 }))
      await seedPending(pendingExpense({ occurredOn: '2026-10-31', amount: 1000 }))
      await seedPending(pendingExpense({ amount: 1000 }, 'user-2'))
      await openHome()
      await within(totalsRegion()).findByText('차액')
      expect(screen.queryByText(/아직 합계에 없어요/)).toBeNull()
    })

    it('다른 탭에서 쌓으면 건수가 바로 바뀐다', async () => {
      await seedPending(pendingExpense({ amount: 1000 }))
      await openHome()
      expect(within(totalsRegion()).getByText('보내지 않은 입력 1건은 아직 합계에 없어요')).toBeTruthy()
      await seedPending(pendingExpense({ amount: 2000 }))
      expect(await within(totalsRegion()).findByText('보내지 않은 입력 2건은 아직 합계에 없어요')).toBeTruthy()
    })
  })

  it('보던 중에 연결이 끊겨 빠른 입력으로 쌓고 돌아오면 최근 거래에 보내지 않음 줄이 보인다', async () => {
    const { user } = await openHome()
    act(() => goOffline())
    await user.click(screen.getAllByRole('link', { name: '거래 입력' })[0])
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(() => expect(screen.getByRole('button', { name: /^계좌/ }).textContent).not.toBe('계좌'))
    await user.click(amount())
    await user.keyboard('4200')
    await user.click(saveButton())
    await screen.findByRole('heading', { level: 1, name: '홈' })
    const row = (await screen.findByText('미분류')).closest('li')!
    expect(chipIn(row)).not.toBeNull()
    expect(row.textContent).toContain('4,200')
  })
})
