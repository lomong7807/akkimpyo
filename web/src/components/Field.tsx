import { useId, type ReactNode } from 'react'
import ErrorMessage from './ErrorMessage'
import styles from './Field.module.css'

export interface FieldLabels {
  label: string
  /** 선택 칸. 이름 뒤에 "(선택)"을 붙인다(화면설계서 00-common 5.2). */
  optional?: boolean
  help?: string
  error?: string
}

interface FieldProps extends FieldLabels {
  /** 칸이 여럿인 묶음. 이름을 한 칸과 묶지 않고 글자로만 둔다. 묶음은 스스로 이름을 단다. */
  group?: boolean
  /** 글자 수 제한이 있는 칸의 지금 글자 수와 최대. 최대에 가까워지면 보인다. */
  count?: { current: number; max: number }
  /** 칸. 받은 속성을 칸의 요소에 넘겨 모양을 입히고 이름과 설명을 잇는다. */
  children: (control: { id: string; className: string; 'aria-describedby': string | undefined }, labelId: string) => ReactNode
}

/** 입력칸의 틀(화면설계서 00-common 5.2). 이름, 칸, 도움말, 오류 문구를 놓는다. */
export default function Field({ label, optional = false, help, error, group = false, count, children }: FieldProps) {
  const id = useId()
  const labelId = `${id}-label`
  const helpId = `${id}-help`
  const countId = `${id}-count`
  const errorId = `${id}-error`
  // 제한의 80%를 넘으면 보인다(화면설계서 00-common 4.4)
  const shownCount = count && count.current > count.max * 0.8 ? `${count.current}/${count.max}` : undefined
  const describedBy = [help && helpId, shownCount && countId, error && errorId].filter(Boolean).join(' ')
  const className = error ? `${styles.control} ${styles.invalid}` : styles.control
  const name = optional ? `${label} (선택)` : label
  return (
    <div className={styles.field}>
      {group ? (
        <span id={labelId} className={styles.label}>
          {name}
        </span>
      ) : (
        <label id={labelId} htmlFor={id} className={styles.label}>
          {name}
        </label>
      )}
      <div className={styles.box}>{children({ id, className, 'aria-describedby': describedBy || undefined }, labelId)}</div>
      {(help || shownCount) && (
        <div className={styles.hint}>
          {help && <p id={helpId}>{help}</p>}
          {shownCount && (
            <p id={countId} className={`${styles.count} tabular-nums`}>
              {shownCount}
            </p>
          )}
        </div>
      )}
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </div>
  )
}
