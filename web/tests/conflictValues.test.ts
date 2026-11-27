import { describe, expect, it } from 'vitest'
import { reapplyMine } from '../src/features/transactions/conflictValues'
import type { TransactionField, TransactionValues } from '../src/features/transactions/transactionForm'

/*
 * "내 입력 다시 적용"(F-909, ADR 006 결정 5, #282): 최신 내용 위에 내가 바꾼 칸(연 때의 값과 달라진 칸)만 얹는다.
 * 칸마다 두 경우를 고정한다. 그 칸만 내가 바꿨으면 내 값을 얹고, 그 칸을 다른 기기만 바꿨으면 최신 내용 그대로 둔다.
 * 두 경우 모두 다른 한 칸(짝)은 반대편이 바꿔, 그 칸의 판정이 짝에 번지지 않는 것도 함께 본다.
 */

/** 연 때의 지출(시각과 메모가 있다) */
const lunch: TransactionValues = {
  type: 'EXPENSE',
  amount: 25000,
  payee: '김밥천국',
  categoryId: 'category-dining',
  accountId: 'account-wallet',
  toAccountId: '',
  occurredOn: '2026-11-25',
  occurredTime: '13:05',
  memo: '팀 점심',
}

/** 연 때의 이체. 받는 계좌는 이체에만 있다 */
const saving: TransactionValues = {
  type: 'TRANSFER',
  amount: 500000,
  payee: '',
  categoryId: '',
  accountId: 'account-salary',
  toAccountId: 'account-saving',
  occurredOn: '2026-11-24',
  occurredTime: '09:00',
  memo: '비상금',
}

interface FieldCase {
  name: string
  field: TransactionField
  opened: TransactionValues
  /** 내가 그 칸에 쓴 값 */
  mine: TransactionValues[TransactionField]
  /** 다른 기기가 그 칸에 고친 값 */
  elsewhere: TransactionValues[TransactionField]
}

const fieldCases: FieldCase[] = [
  { name: '금액', field: 'amount', opened: lunch, mine: 30000, elsewhere: 40000 },
  { name: '날짜', field: 'occurredOn', opened: lunch, mine: '2026-11-24', elsewhere: '2026-11-23' },
  { name: '시각', field: 'occurredTime', opened: lunch, mine: '12:10', elsewhere: '14:00' },
  { name: '계좌', field: 'accountId', opened: lunch, mine: 'account-card', elsewhere: 'account-bank' },
  { name: '카테고리', field: 'categoryId', opened: lunch, mine: 'category-grocery', elsewhere: 'category-traffic' },
  { name: '가맹점/내용', field: 'payee', opened: lunch, mine: '김밥나라', elsewhere: '고기국수집' },
  { name: '메모', field: 'memo', opened: lunch, mine: '영수증은 사진첩에', elsewhere: '팀 회식' },
  { name: '받는 계좌(이체)', field: 'toAccountId', opened: saving, mine: 'account-wallet', elsewhere: 'account-card' },
]

/** 짝 칸과 그 칸에 내가 쓴 값, 다른 기기가 고친 값. 메모를 보는 경우만 금액이 짝이다 */
function partnerOf(field: TransactionField) {
  return field === 'memo'
    ? { partner: 'amount' as const, mine: 31000, elsewhere: 41000 }
    : { partner: 'memo' as const, mine: '내가 쓴 메모', elsewhere: '다른 기기의 메모' }
}

describe.each(fieldCases)('내 입력 다시 적용: $name', ({ field, opened, mine, elsewhere }) => {
  const { partner, mine: partnerMine, elsewhere: partnerElsewhere } = partnerOf(field)

  it('그 칸만 내가 바꿨으면 내 값을 얹고, 다른 기기가 고친 짝 칸은 최신 내용 그대로다', () => {
    const typed = { ...opened, [field]: mine }
    const latest = { ...opened, [partner]: partnerElsewhere }
    expect(reapplyMine(opened, typed, latest)).toEqual({ ...opened, [field]: mine, [partner]: partnerElsewhere })
  })

  it('그 칸을 다른 기기만 바꿨으면 최신 내용 그대로이고, 내가 바꾼 짝 칸은 얹는다', () => {
    const typed = { ...opened, [partner]: partnerMine }
    const latest = { ...opened, [field]: elsewhere }
    expect(reapplyMine(opened, typed, latest)).toEqual({ ...opened, [field]: elsewhere, [partner]: partnerMine })
  })
})
