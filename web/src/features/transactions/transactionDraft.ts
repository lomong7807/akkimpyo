import { isDate } from '../../lib/calendarDate'
import { isUuid } from '../../lib/uuid'
import type { TransactionValues } from './transactionForm'
import { transactionTypes } from './transactions'

/*
 * 거래 입력의 쓰던 값(00-common 4.1, #234 C2, 설계 7절). 기기 저장소의 값은 믿지 않고 모양을 다시 본다.
 * - 새 입력은 거래 id를 꼭 같이 남긴다. 앞 요청이 서버에 저장됐을 수 있어 다시 저장할 때 같은 id로 보내야 한다(ADR 006)
 * - 수정은 연 때의 version과 값을 짝으로 남긴다. 그사이 서버의 거래가 바뀌었으면 저장할 때 충돌(N-04)이 뜨고, "내 입력 다시 적용"
 *   (F-909)은 내가 바꾼 칸을 연 때의 값과 비교한다(#266). 연 때의 값이 없으면(#266 전에 남긴 것) 그대로 받는다
 */

export interface NewTransactionDraft {
  id: string
  values: TransactionValues
}

export interface EditTransactionDraft {
  version: number
  values: TransactionValues
  /** 연 때의 값. #266 전에 남긴 것에는 없다 */
  openedValues?: TransactionValues
}

/** 고쳐서 보내기(#237)의 쓰던 값. 거래 id는 대기열의 그 입력이 정하므로(주소의 id) 값만 남긴다 */
export interface FixTransactionDraft {
  values: TransactionValues
}

/**
 * 홈의 한 줄 입력의 쓰던 값(C-01 예외 처리, D-05 예외 처리, architect #233 3). 입력칸의 글과, 결과 확인(D-05)이 열려 있었거나 보내는
 * 중이었으면 그 거래 id(ADR 006)와 입력한 글, 칸 값이다. 같은 계정으로 홈에 돌아오면 글을 되돌리고 D-05를 같은 값으로 다시 연다
 */
export interface OneLineDraft {
  text: string
  result?: { id: string; text: string; values: TransactionValues }
}

export function oneLineDraftOf(saved: unknown): OneLineDraft | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const { text, result } = saved as Partial<Record<keyof OneLineDraft, unknown>>
  if (typeof text !== 'string') return undefined
  if (result === undefined) return { text }
  if (typeof result !== 'object' || result === null) return undefined
  const { id, text: resultText, values } = result as Record<string, unknown>
  const checked = transactionValuesOf(values)
  if (!isUuid(id) || typeof resultText !== 'string' || !checked) return undefined
  return { text, result: { id, text: resultText, values: checked } }
}

export function fixTransactionDraftOf(saved: unknown): FixTransactionDraft | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const values = transactionValuesOf((saved as Partial<Record<keyof FixTransactionDraft, unknown>>).values)
  return values && { values }
}

export function newTransactionDraftOf(saved: unknown): NewTransactionDraft | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const { id, values } = saved as Partial<Record<keyof NewTransactionDraft, unknown>>
  const checked = transactionValuesOf(values)
  return isUuid(id) && checked ? { id, values: checked } : undefined
}

/** 연 때의 값이 있는데 모양이 틀리면 채우지 않는다. 옛 동작(다시 연 때의 값과 비교)으로 떨어지면 다른 기기의 수정을 되돌린다 */
export function editTransactionDraftOf(saved: unknown): EditTransactionDraft | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const { version, values, openedValues } = saved as Partial<Record<keyof EditTransactionDraft, unknown>>
  const checked = transactionValuesOf(values)
  if (!Number.isSafeInteger(version) || !checked) return undefined
  const draft = { version: version as number, values: checked }
  if (openedValues === undefined) return draft
  const opened = transactionValuesOf(openedValues)
  return opened && { ...draft, openedValues: opened }
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
