import { describe, expect, it } from 'vitest'
import type { PendingTransaction, Rejection } from '../src/device/pendingQueue'
import { bandText, fixOpeningOf, FIX_REASONS } from '../src/features/pending/fixOpening'

/*
 * 고쳐서 보내기(F-108, B-05 (7), D-04 (33), #237)로 D-04를 열 때의 값, 이유 칸의 오류, 띠의 이유. 문구는 화면설계서 D-04 (33)과
 * designer #237 D1·D3 답이다. 거부의 code와 칸은 거래 만들기의 응답 계약(#14, transactionRejection)을 따른다.
 */

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const TO_ACCOUNT = '22222222-2222-4222-8222-222222222222'
const CATEGORY = '33333333-3333-4333-8333-333333333333'
const ID = '0193a000-0000-7000-8000-000000000001'

function pendingOf(body: Record<string, unknown>, state: PendingTransaction['state']): PendingTransaction {
  return {
    schema: 1,
    userId: 'user-1',
    id: ID,
    ledgerId: '1ed9e700-0000-4000-8000-000000000001',
    queuedAt: 1,
    state,
    body: { id: ID, type: 'EXPENSE', ...body } as PendingTransaction['body'],
  }
}

const expenseBody = {
  type: 'EXPENSE',
  occurredOn: '2026-11-26',
  occurredTime: '12:30',
  accountId: ACCOUNT,
  categoryId: CATEGORY,
  amount: 12000,
  payee: '점심',
  memo: '팀 점심',
}

const transferBody = {
  type: 'TRANSFER',
  occurredOn: '2026-11-25',
  occurredTime: null,
  fromAccountId: ACCOUNT,
  toAccountId: TO_ACCOUNT,
  amount: 50000,
  memo: null,
}

const field = (name: string, code: string) => ({ field: name, code })

function rejected(fields: Partial<Rejection> = {}): PendingTransaction['state'] {
  return { kind: 'rejected', status: 400, code: 'VALIDATION_FAILED', fieldErrors: [], at: 1, ...fields }
}

describe('연 때의 값', () => {
  it('지출·수입은 쌓은 본문 그대로 채운다. 비운 값(null)은 빈 칸이다', () => {
    expect(fixOpeningOf(pendingOf(expenseBody, rejected({ fieldErrors: [field('amount', 'OUT_OF_RANGE')] })))?.values).toEqual({
      type: 'EXPENSE',
      amount: 12000,
      payee: '점심',
      categoryId: CATEGORY,
      accountId: ACCOUNT,
      toAccountId: '',
      occurredOn: '2026-11-26',
      occurredTime: '12:30',
      memo: '팀 점심',
    })
    const blank = { ...expenseBody, type: 'INCOME', categoryId: null, payee: null, memo: null, occurredTime: null }
    expect(fixOpeningOf(pendingOf(blank, rejected()))?.values).toMatchObject({
      type: 'INCOME',
      categoryId: '',
      payee: '',
      memo: '',
      occurredTime: '',
    })
  })

  it('이체는 보내는 계좌를 계좌 칸에 채운다', () => {
    expect(fixOpeningOf(pendingOf(transferBody, rejected()))?.values).toEqual({
      type: 'TRANSFER',
      amount: 50000,
      payee: '',
      categoryId: '',
      accountId: ACCOUNT,
      toAccountId: TO_ACCOUNT,
      occurredOn: '2026-11-25',
      occurredTime: '',
      memo: '',
    })
  })

  it.each([
    ['대기인 입력(누를 수 없다)', expenseBody, { kind: 'waiting' } as const],
    ['current가 있는 409(비교해서 고르기, #280)', expenseBody, rejected({ status: 409, code: 'ID_CONFLICT', current: { id: ID } })],
    ['날짜를 읽을 수 없는 본문', { ...expenseBody, occurredOn: '2026-13-01' }, rejected()],
    ['금액이 정수가 아닌 본문', { ...expenseBody, amount: 12.5 }, rejected()],
    ['시각을 읽을 수 없는 본문', { ...expenseBody, occurredTime: '25:00' }, rejected()],
    ['계좌가 글자가 아닌 본문', { ...expenseBody, accountId: 7 }, rejected()],
    ['이체의 받는 계좌가 없는 본문', { ...transferBody, toAccountId: undefined }, rejected()],
  ])('고칠 수 없으면 없다: %s', (_, body, state) => {
    expect(fixOpeningOf(pendingOf(body, state))).toBeUndefined()
  })
})

describe('이유 칸과 띠(D-04 (33))', () => {
  it('계좌가 삭제됐으면 계좌를 비우고 그 칸에 문구를 붙인다. 띠의 이유는 "계좌가 삭제되었어요"다', () => {
    const opening = fixOpeningOf(pendingOf(expenseBody, rejected({ fieldErrors: [field('accountId', 'NOT_FOUND')] })))!
    expect(opening.values.accountId).toBe('')
    expect(opening.fieldErrors).toEqual({ accountId: '고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.' })
    expect(opening.reason).toBe(FIX_REASONS.account)
    expect(bandText(opening.reason)).toBe('보내지 못한 이유: 계좌가 삭제되었어요')
    expect(opening.unplaced).toBeUndefined()
    expect(opening.newId).toBe(false)
  })

  it('이체의 보내는 계좌가 삭제됐으면 계좌 칸, 받는 계좌가 삭제됐으면 받는 계좌 칸을 비운다', () => {
    const from = fixOpeningOf(pendingOf(transferBody, rejected({ fieldErrors: [field('fromAccountId', 'NOT_FOUND')] })))!
    expect([from.values.accountId, from.values.toAccountId]).toEqual(['', TO_ACCOUNT])
    expect(from.fieldErrors).toEqual({ accountId: '고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.' })
    const to = fixOpeningOf(pendingOf(transferBody, rejected({ fieldErrors: [field('toAccountId', 'NOT_FOUND')] })))!
    expect([to.values.accountId, to.values.toAccountId]).toEqual([ACCOUNT, ''])
    expect(to.fieldErrors).toEqual({ toAccountId: '고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.' })
    expect(to.reason).toBe(FIX_REASONS.account)
  })

  it('카테고리가 삭제됐으면 카테고리를 비우고(미분류) 그 칸에 문구를 붙인다. 띠의 이유는 "카테고리가 삭제되었어요"다', () => {
    const opening = fixOpeningOf(pendingOf(expenseBody, rejected({ fieldErrors: [field('categoryId', 'NOT_FOUND')] })))!
    expect(opening.values.categoryId).toBe('')
    expect(opening.fieldErrors).toEqual({ categoryId: '고른 카테고리가 삭제되었어요. 다시 골라 주세요.' })
    expect(opening.reason).toBe('카테고리가 삭제되었어요')
  })

  it('계좌와 카테고리가 함께 삭제됐으면 둘 다 비우고, 띠는 계좌가 앞선다(B-05 거부 이유 표의 순서)', () => {
    const fieldErrors = [field('categoryId', 'NOT_FOUND'), field('accountId', 'NOT_FOUND')]
    const opening = fixOpeningOf(pendingOf(expenseBody, rejected({ fieldErrors })))!
    expect([opening.values.accountId, opening.values.categoryId]).toEqual(['', ''])
    expect(Object.keys(opening.fieldErrors).sort()).toEqual(['accountId', 'categoryId'])
    expect(opening.reason).toBe(FIX_REASONS.account)
  })

  it('그 밖의 검증 실패는 그 칸에 검증 오류 문구를 붙이고 값은 그대로 둔다. 띠의 이유는 "입력한 값을 저장할 수 없어요"다', () => {
    const fieldErrors = [field('payee', 'TOO_LONG'), field('memo', 'INVALID_FORMAT')]
    const opening = fixOpeningOf(pendingOf(expenseBody, rejected({ fieldErrors })))!
    expect(opening.values).toMatchObject({ payee: '점심', memo: '팀 점심' })
    expect(opening.fieldErrors).toEqual({
      payee: '100자까지 쓸 수 있어요',
      memo: '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.',
    })
    expect(opening.reason).toBe('입력한 값을 저장할 수 없어요')
    expect(opening.unplaced).toBeUndefined()
  })

  it.each([
    ['칸이 없는 검증 실패', rejected()],
    ['모르는 칸', rejected({ fieldErrors: [field('ledgerId', 'NOT_FOUND')] })],
    ['모르는 code', rejected({ fieldErrors: [field('amount', 'SOMETHING_NEW')] })],
    ['VALIDATION_FAILED가 아닌 code', rejected({ code: 'MALFORMED_REQUEST', fieldErrors: [field('amount', 'OUT_OF_RANGE')] })],
    ['그 유형에 없는 칸(지출의 받는 계좌)', rejected({ fieldErrors: [field('toAccountId', 'NOT_ALLOWED')] })],
  ])('서버가 알려 준 칸을 모르면(%s) 저장 버튼 위 문구다(designer #237 D3)', (_, state) => {
    const opening = fixOpeningOf(pendingOf(expenseBody, state))!
    expect(opening.fieldErrors).toEqual({})
    expect(opening.unplaced).toBe('입력한 값을 저장할 수 없어요. 고쳐서 보내 주세요.')
    expect(opening.reason).toBe(FIX_REASONS.invalid)
  })

  it('이체의 카테고리 칸 거부는 이체에 그 칸이 없어 저장 버튼 위 문구다', () => {
    const opening = fixOpeningOf(pendingOf(transferBody, rejected({ fieldErrors: [field('payee', 'TOO_LONG')] })))!
    expect(opening.fieldErrors).toEqual({})
    expect(opening.unplaced).toBeDefined()
  })

  it('current가 없는 409는 고칠 칸이 없어 띠만 있고 새 거래 id로 보낸다(ADR 006 결정 3, architect #237 A1)', () => {
    const opening = fixOpeningOf(pendingOf(expenseBody, rejected({ status: 409, code: 'ID_CONFLICT' })))!
    expect(opening.values.accountId).toBe(ACCOUNT)
    expect(opening.fieldErrors).toEqual({})
    expect(opening.unplaced).toBeUndefined()
    expect(opening.reason).toBe('이미 있는 다른 거래와 겹쳤어요')
    expect(opening.newId).toBe(true)
  })

  it('다른 판의 앱이 남긴 모양이 틀린 칸은 무시한다', () => {
    const fieldErrors = [null, 'accountId', { field: 3, code: 'NOT_FOUND' }, field('categoryId', 'NOT_FOUND')] as never
    const opening = fixOpeningOf(pendingOf(expenseBody, rejected({ fieldErrors })))!
    expect(opening.values.accountId).toBe(ACCOUNT)
    expect(opening.fieldErrors).toEqual({ categoryId: '고른 카테고리가 삭제되었어요. 다시 골라 주세요.' })
  })
})