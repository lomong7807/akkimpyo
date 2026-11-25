import { Fragment } from 'react'
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
      /** 잔액과 합계 */
      kind: 'balance'
      value: number
      canceled?: never
    }

const kindClasses = {
  expense: styles.expense,
  income: styles.income,
  transfer: styles.transfer,
  balance: styles.balance,
}

const digits = new Intl.NumberFormat('ko-KR')

/** 원 단위 금액(화면설계서 00-common 2.2, 3.2). 글자 크기는 놓인 자리를 따른다. */
export default function Amount({ kind, value, canceled = false }: AmountProps) {
  const look = canceled ? styles.canceled : kindClasses[kind]
  const text = `${signOf(kind, value)}${digits.format(Math.abs(value))}원`
  return <span className={`tabular-nums ${styles.amount} ${look}`}>{breakableAfterCommas(text)}</span>
}

/** 줄 폭보다 길면 쉼표 뒤에서 줄을 바꾼다. */
function breakableAfterCommas(text: string) {
  const groups = text.split(',')
  return groups.map((group, index) => (
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {index < groups.length - 1 ? `${group},` : group}
    </Fragment>
  ))
}

/** 거래의 부호는 유형이 정한다. 값의 부호를 보이는 것은 잔액과 합계뿐이다. */
function signOf(kind: AmountProps['kind'], value: number): string {
  if (kind === 'income') return '+'
  return kind === 'balance' && value < 0 ? '-' : ''
}
