import { ApiError } from '../../api/apiError'
import type { FieldErrors } from '../../components/useFormFields'
import { formatDate, selectableRange, today } from '../../lib/calendarDate'
import {
  accountRequired,
  amountOutOfRange,
  dateRequired,
  memoTooLong,
  payeeTooLong,
  sameAccount,
  timeInvalid,
  toAccountRequired,
  unusableCharacter,
  type TransactionField,
} from './transactionForm'

/*
 * 거래 만들기가 거부된 칸의 code(#14의 응답 계약)는 이 파일에만 있다. 문구는 화면설계서 D-04의 것이다.
 * 계좌와 카테고리가 그사이 지워진 문구는 D-04 (33)의 것을 쓴다. id, type과 모르는 칸·code는 칸에 붙이지 않는다.
 */

/** 서버가 거부한 칸의 문구. 아는 칸과 code가 하나도 없으면 없다. */
export function rejectedFields(error: unknown): FieldErrors<TransactionField> | undefined {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return undefined
  const rejected: FieldErrors<TransactionField> = {}
  for (const { field, code } of error.fieldErrors) {
    const known = fieldOf(field)
    const message = known && messageFor(known, code)
    // 같은 칸에 여럿이 오면 앞의 것을 보인다
    if (known && message && rejected[known] === undefined) rejected[known] = message
  }
  return Object.keys(rejected).length > 0 ? rejected : undefined
}

/** 보낸 필드 이름에서 화면의 칸. 이체의 보내는 계좌는 계좌 칸이 맡는다. */
function fieldOf(field: string): TransactionField | undefined {
  if (field === 'fromAccountId') return 'accountId'
  const known: string[] = ['amount', 'payee', 'categoryId', 'accountId', 'toAccountId', 'occurredOn', 'occurredTime', 'memo']
  return known.includes(field) ? (field as TransactionField) : undefined
}

const accountGone = '고른 계좌가 삭제되었어요. 다른 계좌를 골라 주세요.'
const categoryGone = '고른 카테고리가 삭제되었어요. 다시 골라 주세요.'
/** 나눈 줄의 빈 카테고리 문구(D-04). 카테고리 칸에는 오류가 없어 가장 가까운 문구로 쓴다. */
const categoryRequired = '카테고리를 골라 주세요'

function messageFor(field: TransactionField, code: string): string | undefined {
  const messages: Record<TransactionField, Partial<Record<string, string>>> = {
    amount: {
      REQUIRED: amountOutOfRange,
      INVALID_FORMAT: amountOutOfRange,
      OUT_OF_RANGE: amountOutOfRange,
    },
    payee: { TOO_LONG: payeeTooLong, INVALID_FORMAT: unusableCharacter },
    memo: { TOO_LONG: memoTooLong, INVALID_FORMAT: unusableCharacter },
    occurredOn: { REQUIRED: dateRequired, INVALID_FORMAT: dateRequired, OUT_OF_RANGE: dateOutOfRange(today()) },
    occurredTime: { INVALID_FORMAT: timeInvalid },
    accountId: { REQUIRED: accountRequired, INVALID_FORMAT: accountRequired, NOT_FOUND: accountGone },
    toAccountId: {
      REQUIRED: toAccountRequired,
      INVALID_FORMAT: toAccountRequired,
      NOT_FOUND: accountGone,
      NOT_ALLOWED: sameAccount,
    },
    categoryId: {
      REQUIRED: categoryRequired,
      INVALID_FORMAT: categoryRequired,
      NOT_FOUND: categoryGone,
      NOT_ALLOWED: categoryRequired,
    },
  }
  const byCode = messages[field]
  // 서버가 준 글자로 객체의 속성을 고르지 않는다("constructor" 같은 code)
  return Object.hasOwn(byCode, code) ? byCode[code] : undefined
}

/** 달력이 막으므로 서버가 거부한 때에만 나온다(D-04). 서버는 장부의 시간대로 판정한다. */
function dateOutOfRange(today: string): string {
  const { first, last } = selectableRange(today)
  return `${formatDate(first, today)}부터 ${formatDate(last, today)}까지 고를 수 있어요`
}
