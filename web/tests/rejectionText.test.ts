import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_GONE,
  CATEGORY_GONE,
  DIFFERENT_CONTENT,
  INVALID_VALUE,
  rejectionText,
  TAKEN_ID,
} from '../src/features/pending/rejectionText'

/*
 * 보낼 수 없음인 줄의 거부 이유(B-05 (6), P-226, ADR 006 결정 3, #236). 서버 응답의 code와 칸(fieldErrors)에서 문구로 바꾸는 표.
 * 칸과 code는 거래 만들기의 응답 계약(#14, features/transactions/transactionRejection)을 따른다.
 */

const field = (name: string, code: string) => ({ field: name, code })

describe('거부 이유 문구 표', () => {
  it.each([
    ['계좌가 삭제됨(accountId NOT_FOUND)', 'VALIDATION_FAILED', [field('accountId', 'NOT_FOUND')], undefined, ACCOUNT_GONE],
    ['이체의 보내는 계좌가 삭제됨(fromAccountId NOT_FOUND)', 'VALIDATION_FAILED', [field('fromAccountId', 'NOT_FOUND')], undefined, ACCOUNT_GONE],
    ['이체의 받는 계좌가 삭제됨(toAccountId NOT_FOUND)', 'VALIDATION_FAILED', [field('toAccountId', 'NOT_FOUND')], undefined, ACCOUNT_GONE],
    ['카테고리가 삭제됨(categoryId NOT_FOUND)', 'VALIDATION_FAILED', [field('categoryId', 'NOT_FOUND')], undefined, CATEGORY_GONE],
    ['계좌와 카테고리가 함께 삭제됨(계좌가 앞선다)', 'VALIDATION_FAILED', [field('categoryId', 'NOT_FOUND'), field('accountId', 'NOT_FOUND')], undefined, ACCOUNT_GONE],
    ['그 밖의 칸 검증 실패(금액 범위)', 'VALIDATION_FAILED', [field('amount', 'OUT_OF_RANGE')], undefined, INVALID_VALUE],
    ['칸이 없는 검증 실패', 'VALIDATION_FAILED', [], undefined, INVALID_VALUE],
    ['계좌 칸의 다른 code(NOT_ALLOWED)', 'VALIDATION_FAILED', [field('accountId', 'NOT_ALLOWED')], undefined, INVALID_VALUE],
    ['모르는 칸의 NOT_FOUND', 'VALIDATION_FAILED', [field('ledgerId', 'NOT_FOUND')], undefined, INVALID_VALUE],
    ['VALIDATION_FAILED가 아닌 code의 칸은 보지 않는다', 'MALFORMED_REQUEST', [field('accountId', 'NOT_FOUND')], undefined, INVALID_VALUE],
    ['current가 없는 409 ID_CONFLICT', 'ID_CONFLICT', [], undefined, TAKEN_ID],
    ['current가 있는 409 ID_CONFLICT', 'ID_CONFLICT', [], { id: 'saved', version: 1 }, DIFFERENT_CONTENT],
    ['그 밖의 code(1단계에 나오지 않는 장부 권한 등)', 'FORBIDDEN', [], undefined, INVALID_VALUE],
  ])('%s', (_, code, fieldErrors, current, text) => {
    expect(rejectionText({ code, fieldErrors, current })).toBe(text)
  })

  it('다른 판의 앱이 남긴 모양이 틀린 칸은 무시한다', () => {
    const fieldErrors = [null, 'accountId', { field: 3, code: 'NOT_FOUND' }, field('categoryId', 'NOT_FOUND')] as never
    expect(rejectionText({ code: 'VALIDATION_FAILED', fieldErrors })).toBe(CATEGORY_GONE)
  })

  it('문구는 설계서 B-05 표와 designer #236 답 그대로다(두 문장이라 마침표)', () => {
    expect([ACCOUNT_GONE, CATEGORY_GONE, INVALID_VALUE, TAKEN_ID, DIFFERENT_CONTENT]).toEqual([
      '계좌가 삭제되어 보낼 수 없어요. 다른 계좌를 골라 보내 주세요.',
      '카테고리가 삭제되어 보낼 수 없어요. 다른 카테고리를 골라 보내 주세요.',
      '입력한 값을 저장할 수 없어요. 고쳐서 보내 주세요.',
      '이미 있는 다른 거래와 겹쳐 보낼 수 없어요. 버리고 새로 입력해 주세요.',
      '앞서 저장한 거래와 내용이 달라 보낼 수 없어요. 내역에서 확인해 주세요.',
    ])
  })
})
