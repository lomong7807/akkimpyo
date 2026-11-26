import { useState, type SubmitEvent } from 'react'
import { Button } from '../../components/Button'
import ErrorMessage from '../../components/ErrorMessage'
import Notice from '../../components/Notice'
import { keepFocusInField } from '../../components/keepFocusInField'
import RetryMessage from '../../components/RetryMessage'
import { PasswordField, TextField } from '../../components/TextField'
import { useFormFields } from '../../components/useFormFields'
import AuthLink from './AuthLink'
import { loginFields, validateLogin } from './loginForm'
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
  // 로그인 위의 "다시 시도" 문구. 다시 보내는 동안에도 남기고, 실패마다 올려 새로 그려 다시 읽히게 한다. 없으면 없다
  const [failures, setFailures] = useState<number>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 규칙 #102)
  const [sender, setSender] = useState<Sender>('login')

  const busy = login.isPending || login.isSuccess

  function submit(from: Sender = 'login') {
    if (busy) return
    if (!checkAll()) {
      login.reset()
      setFailures(undefined)
      return
    }
    setSender(from)
    login.mutate(values, { onSuccess: onSignedIn, onError: showFailure })
  }

  // 맞지 않는 이메일·비밀번호는 "다시 시도" 없이 login.error로 보이고, 다시 보내는 동안 지운다(전과 같다)
  function showFailure(error: Error) {
    setFailures((last) => (isWrongCredentials(error) ? undefined : (last ?? 0) + 1))
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
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
        {login.isError && isWrongCredentials(login.error) && (
          <ErrorMessage role="alert">이메일 또는 비밀번호가 맞지 않아요</ErrorMessage>
        )}
        {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
        {failures !== undefined && (
          <RetryMessage
            failures={failures}
            onRetry={() => submit('retry')}
            busy={busy && sender === 'retry'}
            disabled={busy && sender === 'login'}
          >
            문제가 생겨 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.
          </RetryMessage>
        )}
        <Button kind="primary" type="submit" busy={busy && sender === 'login'} disabled={busy && sender === 'retry'}>
          로그인
        </Button>
      </form>
      <AuthLink question="계정이 없나요?" to="/signup" email={values.email}>
        가입
      </AuthLink>
    </div>
  )
}

/** 로그인 버튼, 또는 실패 문구의 "다시 시도" */
type Sender = 'login' | 'retry'
