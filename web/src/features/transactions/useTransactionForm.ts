import { useFormFields } from '../../components/useFormFields'
import { newTransactionValues, transactionFields, validateTransaction, type TransactionValues } from './transactionForm'

export type TransactionForm = ReturnType<typeof useTransactionForm>

/** 계좌를 고르지 않았으면 기본 계좌를 채운 값. 검사와 보내기는 이 값으로 한다. */
export function withAccount(values: TransactionValues, defaultAccountId: string): TransactionValues {
  return values.accountId === '' ? { ...values, accountId: defaultAccountId } : values
}

/**
 * 새 거래의 칸. 계좌의 기본값은 계좌 목록을 받은 뒤에야 정해지므로 처음 값에 넣지 않고 `defaultAccountId`로 받는다.
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
