import { isDate } from '../../lib/calendarDate'
import { isUuid } from '../../lib/uuid'
import type { TransactionValues } from './transactionForm'
import { transactionTypes } from './transactions'

/*
 * 거래 입력의 쓰던 값(00-common 4.1, #234 C2, 설계 7절). 기기 저장소의 값은 믿지 않고 모양을 다시 본다.
 * - 새 입력은 거래 id를 꼭 같이 남긴다. 앞 요청이 서버에 저장됐을 수 있어 다시 저장할 때 같은 id로 보내야 한다(ADR 006)
 * - 수정은 연 때의 version을 남긴다. 그사이 서버의 거래가 바뀌었으면 저장할 때 충돌(N-04)이 뜬다
 */

export interface NewTransactionDraft {
  id: string
  values: TransactionValues
}

export interface EditTransactionDraft {
  version: number
  values: TransactionValues
}

export function newTransactionDraftOf(saved: unknown): NewTransactionDraft | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const { id, values } = saved as Partial<Record<keyof NewTransactionDraft, unknown>>
  const checked = transactionValuesOf(values)
  return isUuid(id) && checked ? { id, values: checked } : undefined
}

export function editTransactionDraftOf(saved: unknown): EditTransactionDraft | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const { version, values } = saved as Partial<Record<keyof EditTransactionDraft, unknown>>
  const checked = transactionValuesOf(values)
  return Number.isSafeInteger(version) && checked ? { version: version as number, values: checked } : undefined
}

function transactionValuesOf(values: unknown): TransactionValues | undefined {
  if (typeof values !== 'object' || values === null) return undefined
  const { type, amount, payee, categoryId, accountId, toAccountId, occurredOn, occurredTime, memo } = values as Record<
    keyof TransactionValues,
    unknown
  >
  const texts = [payee, categoryId, accountId, toAccountId, occurredTime, memo]
  if (!transactionTypes.includes(type as TransactionValues['type'])) return undefined
  if (amount !== undefined && !(Number.isSafeInteger(amount) && (amount as number) >= 0)) return undefined
  if (!texts.every((text) => typeof text === 'string') || typeof occurredOn !== 'string' || !isDate(occurredOn)) {
    return undefined
  }
  return {
    type: type as TransactionValues['type'],
    amount: amount as number | undefined,
    payee: payee as string,
    categoryId: categoryId as string,
    accountId: accountId as string,
    toAccountId: toAccountId as string,
    occurredOn,
    occurredTime: occurredTime as string,
    memo: memo as string,
  }
}
