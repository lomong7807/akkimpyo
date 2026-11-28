import { cleanup, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CategorySuggestions } from './support/categories'
import { setDeviceClock } from './support/clock'
import { goOffline } from './support/connection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import {
  amount,
  categoryField,
  hasSuggestedHelp,
  id,
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
import type { Transactions } from './support/transactions'
import { resetViewport } from './support/viewport'

/*
 * 거래 입력(D-04 (4))의 새 지출: 가맹점/내용 칸을 벗어날 때마다, 카테고리를 직접 고르지 않았으면 같은 장부에서 같은 가맹점으로
 * 가장 최근에 저장된 지출의 카테고리를 채우고 도움말을 보인다(P-219, P-502, #233). 그런 지출이 없으면 미분류로 둔다.
 * 같은 가맹점과 가장 최근은 서버가 정한다(#61). 한 줄 입력 결과 확인(D-05)의 제안은 OneLineEntry.test.tsx가 본다.
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

  it('연결이 없으면 묻지 않고 미분류로 둔다(1B 임시)', async () => {
    const { user } = await openForm()
    goOffline()
    await typePayee(user, '스타벅스')
    await settle()
    expect(categoryText()).toBe('미분류')
    expect(suggestions.requests).toEqual([])
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
