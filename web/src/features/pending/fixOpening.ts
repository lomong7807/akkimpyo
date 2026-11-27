import type { FieldErrors } from '../../components/useFormFields'
import type { PendingBody, PendingTransaction } from '../../device/pendingQueue'
import { isDate } from '../../lib/calendarDate'
import { isValidTime } from '../../lib/timeText'
import type { TransactionField, TransactionValues } from '../transactions/transactionForm'
import { goneFields, goneReference, rejectedFieldsOf } from '../transactions/transactionRejection'
import { INVALID_VALUE } from './rejectionText'

/*
 * 고쳐서 보내기(F-108, B-05 (7), D-04 (33), #237)로 거래 입력을 열 때의 값과 이유. 문구는 화면설계서 D-04 (33)과 designer #237 답이다.
 * current가 있는 409는 고쳐서 보내지 않고 비교해서 고른다(#280, designer #102). 장부 관련 거부(나감·내보내짐, 보기 전용, 장부 삭제)는
 * 2단계라 1단계에서는 그 밖의 검증 실패로 읽힌다.
 */

/** 띠 "보내지 못한 이유: {이유}"의 이유(D-04 (33), designer #237 D1) */
export const FIX_REASONS = {
  account: '계좌가 삭제되었어요',
  category: '카테고리가 삭제되었어요',
  invalid: '입력한 값을 저장할 수 없어요',
  /** current 없는 409. 고칠 칸이 없고 새 거래 id로 보낸다 */
  taken: '이미 있는 다른 거래와 겹쳤어요',
} as const

export function bandText(reason: string): string {
  return `보내지 못한 이유: ${reason}`
}

export interface FixOpening {
  /** 연 때의 값. 그사이 지워진 계좌·카테고리는 비운다 */
  values: TransactionValues
  /** 이유가 된 칸의 문구. 열면 첫 칸으로 초점을 옮긴다 */
  fieldErrors: FieldErrors<TransactionField>
  /** 띠의 이유 */
  reason: string
  /** 검증 실패인데 서버가 알려 준 칸을 모를 때 저장 버튼 바로 위에 보일 문구(designer #237 D3) */
  unplaced?: string
  /** current 없는 409: 그 id를 쓸 수 없어 새 거래 id로 보낸다(ADR 006 결정 3). 그 밖의 거부는 같은 id다(architect #237 A1) */
  newId: boolean
}

/** 보낼 수 없음인 입력을 고칠 때 연 값과 이유. 고칠 수 없으면(대기, current 있는 409, 읽을 수 없는 본문) 없다 */
export function fixOpeningOf({ state, body }: PendingTransaction): FixOpening | undefined {
  if (state.kind !== 'rejected') return undefined
  const { code, fieldErrors, current } = state
  if (code === 'ID_CONFLICT' && current !== undefined) return undefined
  const values = pendingValuesOf(body)
  if (!values) return undefined
  if (code === 'ID_CONFLICT') return { values, fieldErrors: {}, reason: FIX_REASONS.taken, newId: true }

  const cleared: Partial<TransactionValues> = Object.fromEntries(goneFields(code, fieldErrors).map((field) => [field, '']))
  const shown = shownFields(values.type)
  const placed = Object.fromEntries(
    Object.entries(rejectedFieldsOf(code, fieldErrors) ?? {}).filter(([field]) => shown.includes(field as TransactionField)),
  ) as FieldErrors<TransactionField>
  const gone = goneReference(code, fieldErrors)
  return {
    values: { ...values, ...cleared },
    fieldErrors: placed,
    reason: gone ? FIX_REASONS[gone] : FIX_REASONS.invalid,
    ...(Object.keys(placed).length === 0 && { unplaced: INVALID_VALUE }),
    newId: false,
  }
}

/** 그 유형의 거래 입력에 있는 칸(D-04). 이체에는 가맹점/내용과 카테고리가 없고, 지출·수입에는 받는 계좌가 없다 */
function shownFields(type: TransactionValues['type']): TransactionField[] {
  const shared: TransactionField[] = ['amount', 'accountId', 'occurredOn', 'occurredTime', 'memo']
  return type === 'TRANSFER' ? [...shared, 'toAccountId'] : [...shared, 'payee', 'categoryId']
}

/**
 * 쌓은 거래 만들기 본문(pendingTransactions의 queueNewTransaction)을 칸의 값으로. 빈 값(null)은 빈 칸이고, 이체의 보내는 계좌는
 * 계좌 칸이 맡는다. 기기 저장소의 값이라 모양을 다시 보고, 읽을 수 없으면 없다.
 */
function pendingValuesOf(body: PendingBody): TransactionValues | undefined {
  const { type, occurredOn, occurredTime, amount, memo } = body
  if (typeof occurredOn !== 'string' || !isDate(occurredOn)) return undefined
  if (occurredTime !== null && !(typeof occurredTime === 'string' && isValidTime(occurredTime))) return undefined
  if (!Number.isSafeInteger(amount) || (amount as number) < 1) return undefined
  if (memo !== null && typeof memo !== 'string') return undefined
  const shared = { type, amount: amount as number, occurredOn, occurredTime: occurredTime ?? '', memo: memo ?? '' }
  if (type === 'TRANSFER') {
    const { fromAccountId, toAccountId } = body
    if (typeof fromAccountId !== 'string' || typeof toAccountId !== 'string') return undefined
    return { ...shared, payee: '', categoryId: '', accountId: fromAccountId, toAccountId }
  }
  const { accountId, categoryId, payee } = body
  if (typeof accountId !== 'string') return undefined
  if ((categoryId !== null && typeof categoryId !== 'string') || (payee !== null && typeof payee !== 'string')) return undefined
  return { ...shared, payee: payee ?? '', categoryId: categoryId ?? '', accountId, toAccountId: '' }
}
