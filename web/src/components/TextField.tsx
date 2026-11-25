import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from './Button'
import ErrorMessage from './ErrorMessage'
import styles from './TextField.module.css'

// 모양, 이름과 설명의 연결은 입력칸이 정한다. 화면에서 덮어쓸 수 있는 속성은 받지 않는다.
type InputProps = Omit<ComponentProps<'input'>, 'id' | 'type' | 'size' | 'disabled' | 'className' | 'style' | 'children'> & {
  // TypeScript는 JSX에서 선언하지 않은 aria- 속성을 막지 않으므로 빼지 않고 never로 적는다
  [name in 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid']?: never
}

type FieldProps = InputProps & {
  label: string
  help?: string
  error?: string
}

type TextFieldProps = FieldProps & {
  /** 글자 수 제한이 있는 칸의 지금 글자 수와 최대. 세는 법은 칸마다 다르므로 화면이 센다. 최대에 가까워지면 보인다. */
  count?: { current: number; max: number }
}

/** 브라우저가 쓴 값을 바꾸지 않도록 종류는 늘 text다. 화면 키보드는 inputMode로 고른다. */
export function TextField(props: TextFieldProps) {
  return <Field {...props} type="text" />
}

/** 칸 오른쪽 끝의 버튼으로 값을 보거나 가린다. */
export function PasswordField(props: FieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      // 보이는 동안 브라우저가 값을 맞춤법 검사에 보내거나 고치지 않게 한다
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      action={
        <Button
          kind="icon"
          icon={visible ? 'EyeSlash' : 'Eye'}
          aria-label={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
          onClick={() => setVisible(!visible)}
        />
      }
    />
  )
}

function Field({
  label,
  help,
  error,
  count,
  action,
  ...inputProps
}: TextFieldProps & { type: string; action?: ReactNode }) {
  const id = useId()
  const helpId = `${id}-help`
  const countId = `${id}-count`
  const errorId = `${id}-error`
  // 제한의 80%를 넘으면 보인다(화면설계서 00-common 4.4)
  const shownCount = count && count.current > count.max * 0.8 ? `${count.current}/${count.max}` : undefined
  const describedBy = [help && helpId, shownCount && countId, error && errorId].filter(Boolean).join(' ')
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.box}>
        <input
          {...inputProps}
          id={id}
          className={action ? `${styles.input} ${styles.withAction}` : styles.input}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
        />
        {action && <div className={styles.action}>{action}</div>}
      </div>
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
