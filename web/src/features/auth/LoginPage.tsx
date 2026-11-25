import { useRef, type SubmitEvent } from 'react'
import { Button, ButtonLink } from '../../components/Button'
import ErrorMessage from '../../components/ErrorMessage'
import Notice from '../../components/Notice'
import { PasswordField, TextField } from '../../components/TextField'
import { keepFocusInField } from './keepFocusInField'
import { loginFields, validateLogin } from './loginForm'
import RetryMessage from './RetryMessage'
import { useFormFields } from './useFormFields'
import { isWrongCredentials, useLogin, type SignIn } from './useLogin'
import styles from './LoginPage.module.css'

interface LoginPageProps {
  signIn: SignIn
  /** 로그인했고 이 화면을 아직 떠나지 않았다 */
  onSignedIn: () => void
  /** 쓰던 로그인이 풀려 이 화면에 왔다 */
  sessionEnded: boolean
  /** 가입 화면에서 넘어온 이메일. 없으면 빈 글자다. */
  initialEmail: string
}

/** A-02 로그인 */
export default function LoginPage({ signIn, onSignedIn, sessionEnded, initialEmail }: LoginPageProps) {
  const login = useLogin(signIn)
  const { values, fieldProps, checkAll } = useFormFields({
    fields: loginFields,
    initialValues: { email: initialEmail, password: '' },
    validate: validateLogin,
  })
  const loginButton = useRef<HTMLButtonElement>(null)

  const busy = login.isPending || login.isSuccess

  function submit() {
    if (!checkAll()) {
      login.reset()
      return
    }
    login.mutate(values, { onSuccess: onSignedIn })
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

  return (
    <div className={styles.page} onMouseDown={keepFocusInField}>
      {sessionEnded && (
        <div className={styles.notice}>
          <Notice>로그인이 풀렸어요. 다시 로그인해 주세요.</Notice>
        </div>
      )}
      <h1>로그인</h1>
      <form className={styles.form} noValidate onSubmit={handleSubmit}>
        <TextField
          {...fieldProps('email')}
          readOnly={busy}
          label="이메일"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="name@example.com"
          autoFocus={initialEmail === ''}
        />
        <PasswordField
          {...fieldProps('password')}
          readOnly={busy}
          label="비밀번호"
          autoComplete="current-password"
          autoFocus={initialEmail !== ''}
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
    return <ErrorMessage role="alert">이메일 또는 비밀번호가 맞지 않아요</ErrorMessage>
  }
  return (
    <RetryMessage onRetry={onRetry}>문제가 생겨 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.</RetryMessage>
  )
}
