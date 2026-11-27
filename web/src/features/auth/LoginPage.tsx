import { useState, type SubmitEvent } from 'react'
import { Button } from '../../components/Button'
import DisabledReason from '../../components/DisabledReason'
import ErrorMessage from '../../components/ErrorMessage'
import Notice from '../../components/Notice'
import { keepFocusInField } from '../../components/keepFocusInField'
import RetryMessage from '../../components/RetryMessage'
import { PasswordField, TextField } from '../../components/TextField'
import { useFormFields } from '../../components/useFormFields'
import { failureTextOf, LOG_IN, offlineReasonOf } from '../connection/offlineAction'
import { useConnection } from '../connection/useConnection'
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
  /** 로그인이 풀릴 때 열린 입력 화면의 쓰던 값을 이 기기에 남겼다(#234 C2) */
  draftKept: boolean
  /** 가입 화면에서 넘어온 이메일. 없으면 빈 글자다. */
  initialEmail: string
}

/**
 * A-02 로그인. 연결이 없으면 로그인 버튼을 비활성으로 두고 바로 위에 "연결되면 로그인할 수 있어요"를 보인다(공통 틀이 없어 띠가
 * 없는 화면, 00-common 4.3). 요청 중에 끊기면 그 줄 대신 "연결이 끊겨 로그인하지 못했어요."와 "다시 시도"(연결이 없는 동안 비활성)다.
 */
export default function LoginPage({ signIn, onSignedIn, sessionEnded, draftKept, initialEmail }: LoginPageProps) {
  const login = useLogin(signIn)
  const online = useConnection() === 'online'
  const { values, fieldProps, checkAll } = useFormFields({
    fields: loginFields,
    initialValues: { email: initialEmail, password: '' },
    validate: validateLogin,
  })
  // 로그인 위의 실패 문구. 다시 보내는 동안에도 새 결과가 올 때까지 남기고, 실패마다 count를 올려 새로 그려 다시
  // 읽히게 한다. 없으면 없다
  const [shown, setShown] = useState<{ failure: Failure; count: number; text?: string }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 규칙 #102)
  const [sender, setSender] = useState<Sender>('login')

  const busy = login.isPending || login.isSuccess

  function submit(from: Sender = 'login') {
    // 엔터로 보내는 길도 막는다(버튼은 누를 수 없게만 둔다)
    if (busy || !online) return
    if (!checkAll()) {
      login.reset()
      setShown(undefined)
      return
    }
    setSender(from)
    login.mutate(values, { onSuccess: onSignedIn, onError: showFailure })
  }

  function showFailure(error: Error) {
    const failure = isWrongCredentials(error) ? 'refused' : 'retry'
    setShown((last) => ({ failure, count: (last?.count ?? 0) + 1, text: failureTextOf(error, LOG_IN) }))
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    submit()
  }

  return (
    <div className={styles.page} onMouseDown={keepFocusInField}>
      {sessionEnded && (
        <div className={styles.notice}>
          <Notice detail={draftKept ? '쓰던 내용은 이 기기에 남아 있어요.' : undefined}>
            로그인이 풀렸어요. 다시 로그인해 주세요.
          </Notice>
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
        {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
        {shown?.failure === 'refused' && (
          <ErrorMessage key={shown.count} role="alert">
            이메일 또는 비밀번호가 맞지 않아요
          </ErrorMessage>
        )}
        {shown?.failure === 'retry' && (
          <RetryMessage
            failures={shown.count}
            onRetry={() => submit('retry')}
            busy={busy && sender === 'retry'}
            disabled={(busy && sender === 'login') || !online}
          >
            {shown.text!}
          </RetryMessage>
        )}
        {/* 한 버튼 위에는 한 줄만 둔다. 실패 문구가 있으면 덧붙이지 않는다(00-common 4.3) */}
        {!online && shown?.failure !== 'retry' && <DisabledReason>{offlineReasonOf(LOG_IN)}</DisabledReason>}
        <Button
          kind="primary"
          type="submit"
          busy={busy && sender === 'login'}
          disabled={(busy && sender === 'retry') || !online}
        >
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

type Failure =
  /** 이메일이나 비밀번호가 맞지 않음(P-105). 고쳐서 다시 누르므로 "다시 시도"가 없다 */
  | 'refused'
  /** 서버 오류, 지연, 연결 실패. 같은 값으로 다시 보내는 "다시 시도"가 있다 */
  | 'retry'
