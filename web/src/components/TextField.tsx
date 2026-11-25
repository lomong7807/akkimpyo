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

export function TextField({ type = 'text', ...rest }: FieldProps & { type?: 'text' | 'email' }) {
  return <Field {...rest} type={type} />
}

/** 칸 오른쪽 끝의 버튼으로 값을 보거나 가린다. */
export function PasswordField(props: FieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      // 보이는 동안 브라우저가 값을 맞춤법 검사에 보내거나 첫 글자를 바꾸지 않게 한다
      spellCheck={false}
      autoCapitalize="none"
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
  action,
  ...inputProps
}: FieldProps & { type: string; action?: ReactNode }) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [help && helpId, error && errorId].filter(Boolean).join(' ')
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
      {help && (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      )}
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </div>
  )
}
