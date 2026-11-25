import { useRef, useState, type MouseEvent, type SubmitEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button, ButtonLink } from '../../components/Button'
import ErrorMessage from '../../components/ErrorMessage'
import { PasswordField, TextField } from '../../components/TextField'
import { loginFields, normalizeEmail, validateLogin, type LoginField } from './loginForm'
import { isWrongCredentials, useLogin } from './useLogin'
import styles from './LoginPage.module.css'

/** A-02 로그인 */
export default function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()
  const [values, setValues] = useState({ email: '', password: '' })
  /** 칸을 벗어나거나 제출해 오류 문구를 보이고 있는 칸 */
  const [shown, setShown] = useState({ email: false, password: false })
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const loginButton = useRef<HTMLButtonElement>(null)

  const errors = validateLogin(values)
  const busy = login.isPending || login.isSuccess

  function change(field: LoginField, value: string) {
    const changed = { ...values, [field]: value }
    setValues(changed)
    // 맞게 고치면 바로 지운다. 다시 틀려도 칸을 벗어나기 전에는 띄우지 않는다.
    if (!validateLogin(changed)[field]) setShown((current) => ({ ...current, [field]: false }))
  }

  function check(field: LoginField) {
    setShown((current) => ({ ...current, [field]: errors[field] !== undefined }))
  }

  function submit() {
    const firstInvalid = loginFields.find((field) => errors[field])
    if (firstInvalid) {
      loginFields.forEach(check)
      login.reset()
      const input = firstInvalid === 'email' ? emailInput : passwordInput
      input.current?.focus()
      return
    }
    login.mutate(
      { email: normalizeEmail(values.email), password: values.password },
      { onSuccess: () => navigate('/home', { replace: true }) },
    )
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    submit()
  }

  function retry() {
    // 다시 보내는 동안 이 버튼은 사라지므로 초점을 잃지 않게 옮긴다
    loginButton.current?.focus()
    submit()
  }

  function fieldProps(field: LoginField) {
    return {
      value: values[field],
      error: shown[field] ? errors[field] : undefined,
      readOnly: busy,
      onChange: (event: { target: HTMLInputElement }) => change(field, event.target.value),
      onBlur: () => check(field),
    }
  }

  return (
    <div className={styles.page} onMouseDown={keepFocusInField}>
      <h1>로그인</h1>
      <form className={styles.form} noValidate onSubmit={handleSubmit}>
        <TextField
          {...fieldProps('email')}
          ref={emailInput}
          label="이메일"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@example.com"
          autoFocus
        />
        <PasswordField
          {...fieldProps('password')}
          ref={passwordInput}
          label="비밀번호"
          autoComplete="current-password"
        />
        {login.isError && <LoginFailure error={login.error} onRetry={retry} />}
        <Button ref={loginButton} kind="primary" type="submit" busy={busy}>
          로그인
        </Button>
      </form>
      <p className={styles.signup}>
        계정이 없나요?{' '}
        <ButtonLink kind="text" to="/signup" state={{ email: values.email }}>
          가입
        </ButtonLink>
      </p>
    </div>
  )
}

function LoginFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isWrongCredentials(error)) {
    return (
      <div>
        <ErrorMessage role="alert">이메일 또는 비밀번호가 맞지 않아요</ErrorMessage>
      </div>
    )
  }
  return (
    <div>
      <ErrorMessage role="alert">문제가 생겨 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.</ErrorMessage>
      <div className={styles.retry}>
        <Button kind="text" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    </div>
  )
}

/**
 * 버튼을 누르는 순간 칸을 벗어난 검사로 오류 문구가 나오면 버튼이 밀려 눌리지 않는다.
 * 버튼과 링크를 누르는 동안에는 초점을 칸에 남긴다.
 */
function keepFocusInField(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, a')) event.preventDefault()
}
