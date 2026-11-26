import { describe, expect, it } from 'vitest'
import { editTransactionDraftOf } from '../src/features/transactions/transactionDraft'

/*
 * 수정 입력(D-04 수정)의 쓰던 값 모양 검사(#234 C2, #266). 기기 저장소의 값은 믿지 않고 다시 본다. 모양이 틀리면 채우지 않는다.
 * 연 때의 값(openedValues)은 version과 짝으로 남긴다. "내 입력 다시 적용"(F-909)이 내가 바꾼 칸을 그것과 비교한다.
 * 없으면(#266 전에 남긴 것) 그대로 받는다.
 */

const opened = {
  type: 'EXPENSE',
  amount: 25000,
  payee: '김밥천국',
  categoryId: '',
  accountId: '',
  toAccountId: '',
  occurredOn: '2026-11-25',
  occurredTime: '13:05',
  memo: '',
} as const

const mine = { ...opened, amount: 30000 }

describe('수정 입력의 쓰던 값', () => {
  it('version, 쓰던 값, 연 때의 값을 받는다', () => {
    expect(editTransactionDraftOf({ version: 1, values: mine, openedValues: opened })).toEqual({
      version: 1,
      values: mine,
      openedValues: opened,
    })
  })

  it('연 때의 값이 없는 옛 모양도 받는다(#266 전에 남긴 것)', () => {
    const draft = editTransactionDraftOf({ version: 1, values: mine })
    expect(draft).toEqual({ version: 1, values: mine })
    expect(draft).not.toHaveProperty('openedValues')
  })

  it.each([
    ['null', null],
    ['금액이 글자', { ...opened, amount: '25000' }],
    ['금액이 음수', { ...opened, amount: -1 }],
    ['날짜가 없음', { ...opened, occurredOn: undefined }],
    ['날짜 모양이 아님', { ...opened, occurredOn: '2026-13-01' }],
    ['모르는 유형', { ...opened, type: 'REFUND' }],
    ['가맹점이 글자가 아님', { ...opened, payee: 1 }],
    ['객체가 아님', 'opened'],
  ])('연 때의 값이 있는데 모양이 틀리면(%s) 채우지 않는다', (_, openedValues) => {
    expect(editTransactionDraftOf({ version: 1, values: mine, openedValues })).toBeUndefined()
  })

  it.each([
    ['version이 정수가 아님', { version: 1.5, values: mine, openedValues: opened }],
    ['version이 없음', { values: mine, openedValues: opened }],
    ['쓰던 값의 모양이 틀림', { version: 1, values: { ...mine, amount: '30000' }, openedValues: opened }],
    ['쓰던 값이 없음', { version: 1, openedValues: opened }],
    ['객체가 아님', 'draft'],
  ])('그 밖의 모양이 틀리면(%s) 지금처럼 채우지 않는다', (_, saved) => {
    expect(editTransactionDraftOf(saved)).toBeUndefined()
  })
})
