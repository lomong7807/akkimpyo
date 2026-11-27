import { amountText } from './amountDisplay'
import styles from './Amount.module.css'

// 색과 부호는 종류로만 정한다. 화면에서 덮어쓸 수 있는 속성은 받지 않는다.
type AmountProps =
  | {
      kind: 'expense' | 'income' | 'transfer'
      value: number
      /** 취소한 거래. 부호는 원래 유형의 것이다. */
      canceled?: boolean
    }
  | {
      /** 잔액과 합계, 차액(수입 − 지출) */
      kind: 'balance' | 'difference'
      value: number
      canceled?: never
    }

const kindClasses = {
  expense: styles.expense,
  income: styles.income,
  transfer: styles.transfer,
  balance: styles.balance,
  difference: styles.balance,
}

/** 원 단위 금액(화면설계서 00-common 2.2, 3.2). 글자 크기는 놓인 자리를 따른다. */
export default function Amount({ kind, value, canceled = false }: AmountProps) {
  const look = canceled ? styles.canceled : kindClasses[kind]
  return (
    <span className={`tabular-nums ${styles.amount} ${look}`}>{amountText(kind, value)}</span>
  )
}
