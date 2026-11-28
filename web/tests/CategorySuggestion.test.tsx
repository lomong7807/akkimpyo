import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CategorySuggestions } from './support/categories'
import { setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { seedLedgerCopy, seedPending } from './support/device'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import {
  amount,
  categoryField,
  hasSuggestedHelp,
  id,
  LEDGER,
  openForm,
  payee,
  pick,
  resetGlobals,
  saveButton,
  settle,
  startServer,
  typeRadio,
  type User,
} from './support/transactionScreen'
import { expenseOf, incomeOf, lastMonthCopyOf } from './support/transactionList'
import type { Transactions } from './support/transactions'
import { resetViewport } from './support/viewport'

/*
 * 거래 입력(D-04 (4))의 새 지출: 가맹점/내용 칸을 벗어날 때마다, 카테고리를 직접 고르지 않았으면 같은 장부에서 같은 가맹점으로
 * 가장 최근에 저장된 지출의 카테고리를 채우고 도움말을 보인다(P-219, P-502, #233). 그런 지출이 없으면 미분류로 둔다.
 * 같은 가맹점과 가장 최근은 서버가 정한다(#61). 연결이 없으면 기기의 최근 31일 사본(#238)에서 서버와 같은 규칙으로 찾는다(#348).
 * 한 줄 입력 결과 확인(D-05)의 제안은 OneLineEntry.test.tsx가 본다.
 */

const server = startMockServer()
let suggestions: CategorySuggestions
let transactions: Transactions

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ suggestions, transactions } = startServer(server))
  suggestions.byPayee.set('스타벅스', id.dining)
  suggestions.byPayee.set('이마트', id.grocery)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const categoryText = () => categoryField().textContent

/** 가맹점/내용을 지우고 `text`를 쓴 뒤 칸을 벗어난다 */
async function typePayee(user: User, text: string) {
  await user.clear(payee())
  if (text !== '') await user.type(payee(), text)
  await user.tab()
}

describe('가맹점/내용을 벗어나면 제안한다(D-04 (4))', () => {
  it('같은 가맹점에 쓴 지출의 카테고리를 채우고 칸 아래에 도움말을 보인다', async () => {
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    expect(hasSuggestedHelp()).toBe(true)
    expect(suggestions.requests).toEqual(['스타벅스'])
  })

  it('서버가 맞추는 그대로 보낸다: 앞뒤 공백을 지우고 조합형으로 맞춘다', async () => {
    const { user } = await openForm()
    await typePayee(user, '  스타 벅스 ')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    expect(suggestions.requests).toEqual(['스타 벅스'])
  })

  it('그런 지출이 없으면 미분류로 두고 앞서 채운 제안과 도움말도 지운다', async () => {
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    await typePayee(user, '동네 빵집')
    await waitFor(() => expect(categoryText()).toBe('미분류'))
    expect(hasSuggestedHelp()).toBe(false)
  })

  it('가맹점을 비우고 벗어나면 묻지 않고 미분류로 둔다', async () => {
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    await typePayee(user, '')
    expect(categoryText()).toBe('미분류')
    expect(suggestions.requests).toEqual(['스타벅스'])
  })

  it('서버가 미분류 카테고리를 주면 제안이 없는 것과 같다', async () => {
    suggestions.byPayee.set('편의점', id.expenseNone)
    const { user } = await openForm()
    await typePayee(user, '편의점')
    await settle()
    expect(categoryText()).toBe('미분류')
    expect(hasSuggestedHelp()).toBe(false)
  })

  it('가맹점을 바꿔 벗어날 때마다 다시 제안한다', async () => {
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    await typePayee(user, '이마트')
    await waitFor(() => expect(categoryText()).toBe('장보기'))
    expect(hasSuggestedHelp()).toBe(true)
  })

  it('카테고리를 바꾸면 도움말이 사라지고, 그 뒤에는 가맹점을 바꿔도 덮어쓰지 않는다(P-502)', async () => {
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    await pick(user, categoryField(), '교통')
    expect(hasSuggestedHelp()).toBe(false)
    await typePayee(user, '이마트')
    await settle()
    expect(categoryText()).toBe('교통')
    expect(suggestions.requests).toEqual(['스타벅스'])
  })

  it('먼저 미분류를 직접 골랐어도 덮어쓰지 않는다', async () => {
    const { user } = await openForm()
    await pick(user, categoryField(), '미분류')
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('미분류')
    expect(suggestions.requests).toEqual([])
  })

  it('저장하면 채운 카테고리로 보낸다', async () => {
    const { user } = await openForm()
    await user.click(amount())
    await user.keyboard('4500')
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    await user.click(saveButton())
    await waitFor(() => expect(transactions.sent).toHaveLength(1))
    expect(transactions.sent[0].body).toMatchObject({ payee: '스타벅스', categoryId: id.dining })
  })

  it('답이 늦게 오는 동안 가맹점을 다시 바꿨으면 앞 답은 버린다', async () => {
    let release = () => {}
    suggestions.response = (sent) => {
      const answer = HttpResponse.json({ categoryId: sent === '스타벅스' ? id.dining : id.grocery })
      if (sent !== '스타벅스') return answer
      return new Promise((resolve) => (release = () => resolve(answer)))
    }
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await typePayee(user, '이마트')
    await waitFor(() => expect(categoryText()).toBe('장보기'))
    release()
    await settle()
    expect(categoryText()).toBe('장보기')
  })

  it('제안을 받지 못하면(서버 오류) 제안이 없는 것과 같고 문구를 띄우지 않는다', async () => {
    suggestions.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('미분류')
    expect(screen.queryByRole('alert')).toBeNull()
  })

})

/** 기기에 최근 한 달(#238)을 남긴다. 앱이 열리며 로그인을 확인한 뒤에 부른다(그 전에 둔 사본은 주인 확인이 없어 지운다) */
async function keepLastMonth(items: object[]) {
  await seedLedgerCopy('user-1', LEDGER, 'transactions', lastMonthCopyOf(items))
}

/** 사본에 있는 지출 하나. `savedAt`은 서버가 저장한 시각(createdAt)이다 */
function keptExpense(payeeText: string, categoryId: string, savedAt = '2026-11-26T03:15:00.123Z', changes: object = {}) {
  return expenseOf(
    { occurredOn: '2026-11-26', accountId: id.salary, categoryId, amount: 5000, payee: payeeText },
    { createdAt: savedAt, ...changes },
  )
}

describe('연결이 없으면 기기의 최근 31일 사본에서 찾는다(D-04 (4), #348)', () => {
  /** 거래 입력을 열고 사본을 둔 뒤 연결을 끊는다 */
  async function openOffline(kept: object[]) {
    const opened = await openForm()
    await keepLastMonth(kept)
    act(() => goOffline())
    return opened
  }

  it('같은 가맹점(공백과 대소문자 무시)의 지출 가운데 가장 늦게 저장한 것의 카테고리를 채우고 도움말을 보인다. 요청은 보내지 않는다', async () => {
    // 날짜 순이나 사본의 순서가 아니라 저장한 시각 순이다(planner #348 1)
    const { user } = await openOffline([
      { ...keptExpense('Star Bucks', id.grocery, '2026-11-25T01:00:00.000Z'), occurredOn: '2026-11-25' },
      { ...keptExpense('starbucks', id.dining, '2026-11-26T01:00:00.000Z'), occurredOn: '2026-11-20' },
      keptExpense('STARBUCKS', id.traffic, '2026-11-24T01:00:00.000Z'),
    ])
    await typePayee(user, ' STAR bucks ')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    expect(hasSuggestedHelp()).toBe(true)
    expect(suggestions.requests).toEqual([])
  })

  it('저장한 시각이 같으면 id가 큰 거래다(서버와 같다)', async () => {
    const smaller = keptExpense('스타벅스', id.grocery)
    const larger = keptExpense('스타벅스', id.dining)
    const { user } = await openOffline([smaller, larger])
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
  })

  it('수입과 휴지통의 거래는 보지 않고, 취소한 거래는 본다', async () => {
    const { user } = await openOffline([
      incomeOf(
        { occurredOn: '2026-11-26', accountId: id.salary, categoryId: id.pay, amount: 5000, payee: '스타벅스' },
        { createdAt: '2026-11-26T03:00:00.000Z' },
      ),
      keptExpense('스타벅스', id.traffic, '2026-11-26T02:00:00.000Z', {
        deletedAt: '2026-11-26T02:30:00.000Z',
        purgeAt: '2026-12-26T02:30:00.000Z',
      }),
      keptExpense('스타벅스', id.dining, '2026-11-26T01:00:00.000Z', { status: 'CANCELED' }),
      keptExpense('스타벅스', id.grocery, '2026-11-25T01:00:00.000Z'),
    ])
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
  })

  it('사본에 같은 가맹점의 지출이 없으면 미분류로 두고 앞서 채운 제안과 도움말도 지운다', async () => {
    const { user } = await openOffline([keptExpense('스타벅스', id.dining)])
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    await typePayee(user, '이마트')
    await waitFor(() => expect(categoryText()).toBe('미분류'))
    expect(hasSuggestedHelp()).toBe(false)
  })

  it('사본이 없으면 미분류로 둔다', async () => {
    const { user } = await openForm()
    act(() => goOffline())
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('미분류')
    expect(suggestions.requests).toEqual([])
  })

  it('보내지 않은 입력은 보지 않는다(planner #348 2)', async () => {
    const { user } = await openOffline([])
    await seedPending({
      userId: 'user-1',
      ledgerId: LEDGER,
      queuedAt: Date.parse('2026-11-26T03:00:00.000Z'),
      body: {
        id: '0193a000-0000-7000-8000-000000000001',
        type: 'EXPENSE',
        occurredOn: '2026-11-26',
        occurredTime: null,
        accountId: id.salary,
        categoryId: id.dining,
        amount: 5000,
        payee: '스타벅스',
        memo: null,
      },
    })
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('미분류')
  })

  it('지금 카테고리 목록에 없는 카테고리(사본이 오래됨)는 제안하지 않는다', async () => {
    const { user } = await openOffline([keptExpense('스타벅스', 'cccccccc-0000-4000-8000-000000000009')])
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('미분류')
    expect(hasSuggestedHelp()).toBe(false)
  })

  it('직접 고른 카테고리는 덮어쓰지 않는다(P-502)', async () => {
    const { user } = await openOffline([keptExpense('스타벅스', id.dining)])
    await pick(user, categoryField(), '교통')
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('교통')
  })

  it('묻는 중에 연결이 끊기면 사본에서 찾는다', async () => {
    suggestions.response = () => HttpResponse.error()
    const { user } = await openForm()
    await keepLastMonth([keptExpense('스타벅스', id.grocery)])
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('장보기'))
    expect(suggestions.requests).toEqual(['스타벅스'])
  })
})

describe('지출이 아니면 제안하지 않는다', () => {
  it('수입은 가맹점/내용을 벗어나도 묻지 않는다', async () => {
    const { user } = await openForm()
    await user.click(typeRadio('수입'))
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('미분류')
    expect(suggestions.requests).toEqual([])
  })

  it('지출에서 채운 제안은 수입으로 바꾸면 비고 도움말도 없다', async () => {
    const { user } = await openForm()
    await typePayee(user, '스타벅스')
    await waitFor(() => expect(categoryText()).toBe('외식'))
    await user.click(typeRadio('수입'))
    expect(categoryText()).toBe('미분류')
    expect(hasSuggestedHelp()).toBe(false)
  })

  it('이체에는 가맹점/내용 칸이 없다', async () => {
    const { user } = await openForm()
    await user.click(typeRadio('이체'))
    expect(screen.queryByLabelText('가맹점/내용 (선택)')).toBeNull()
  })
})
