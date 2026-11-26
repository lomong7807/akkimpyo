import { useState } from 'react'
import { flushSync } from 'react-dom'
import { useFormFields, type FieldErrors } from '../../components/useFormFields'
import {
  foldedFields,
  newTransactionValues,
  transactionFields,
  validateTransaction,
  type TransactionField,
  type TransactionValues,
} from './transactionForm'

export type TransactionForm = ReturnType<typeof useTransactionForm>

/** 계좌를 고르지 않았으면 기본 계좌를 채운 값. 검사와 보내기는 이 값으로 한다. */
export function withAccount(values: TransactionValues, defaultAccountId: string): TransactionValues {
  return values.accountId === '' ? { ...values, accountId: defaultAccountId } : values
}

/**
 * 거래의 칸. 처음 값은 새 입력의 기본값이다(D-04 칸별 기본값). 수정은 고칠 거래를 받은 뒤 `reset`으로 그 값을 채운다.
 * 새 입력의 계좌 기본값은 계좌 목록을 받은 뒤에야 정해지므로 처음 값에 넣지 않고 `defaultAccountId`로 받는다.
 * 그래서 기본 계좌가 채워져도 바꾼 값이 아니다.
 */
export function useTransactionForm(defaultAccountId: string) {
  const form = useFormFields({
    fields: transactionFields,
    initialValues: newTransactionValues(),
    validate: (values: TransactionValues) => validateTransaction(withAccount(values, defaultAccountId)),
  })
  return { ...form, effective: withAccount(form.values, defaultAccountId) }
}

/**
 * "더 보기"(D-04 (8))를 펼쳤는지. 새 입력은 접힌 채로, 수정은 펼친 채로 연다. 접혀 있어도 그 아래 칸의 값은 저장된다.
 * `unfoldFor`: 보일 오류가 접힌 칸에 있으면 먼저 펼쳐 그 칸으로 초점을 옮길 수 있게 한다.
 */
export function useMoreFold(initiallyOpen: boolean) {
  const [moreOpen, setMoreOpen] = useState(initiallyOpen)
  function unfoldFor(errors: FieldErrors<TransactionField>) {
    if (foldedFields.some((field) => errors[field])) flushSync(() => setMoreOpen(true))
  }
  return { moreOpen, setMoreOpen, unfoldFor }
}
