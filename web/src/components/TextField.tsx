import { useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from './Button'
import Field, { type FieldLabels } from './Field'
import styles from './TextField.module.css'

// 모양, 이름과 설명의 연결은 입력칸이 정한다. 화면에서 덮어쓸 수 있는 속성은 받지 않는다.
type InputProps = Omit<ComponentProps<'input'>, 'id' | 'type' | 'size' | 'disabled' | 'className' | 'style' | 'children'> & {
  // TypeScript는 JSX에서 선언하지 않은 aria- 속성을 막지 않으므로 빼지 않고 never로 적는다
  [name in 'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'aria-invalid']?: never
}

type FieldProps = InputProps & FieldLabels

type TextFieldProps = FieldProps & {
  /** 글자 수 제한이 있는 칸의 지금 글자 수와 최대. 세는 법은 칸마다 다르므로 화면이 센다. 최대에 가까워지면 보인다. */
  count?: { current: number; max: number }
}

/** 브라우저가 쓴 값을 바꾸지 않도록 종류는 늘 text다. 화면 키보드는 inputMode로 고른다. */
export function TextField(props: TextFieldProps) {
  return <InputField {...props} type="text" />
}

/** 칸 오른쪽 끝의 버튼으로 값을 보거나 가린다. */
export function PasswordField(props: FieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <InputField
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

/** 칸 오른쪽 끝에 버튼을 둘 수 있는 한 줄 칸. 종류(type)는 부르는 칸이 정한다. */
export function InputField({
  label,
  help,
  error,
  count,
  action,
  ...inputProps
}: TextFieldProps & { type: string; action?: ReactNode }) {
  const className = action ? `${styles.input} ${styles.withAction}` : styles.input
  return (
    <Field label={label} help={help} error={error} count={count}>
      {(control) => (
        <>
          <input
            {...inputProps}
            {...control}
            className={`${control.className} ${className}`}
            aria-invalid={error ? true : undefined}
          />
          {action && <div className={styles.action}>{action}</div>}
        </>
      )}
    </Field>
  )
}
