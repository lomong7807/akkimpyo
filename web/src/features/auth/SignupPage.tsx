import { useState, type SubmitEvent } from 'react'
import { Button } from '../../components/Button'
import DisabledReason from '../../components/DisabledReason'
import { keepFocusInField } from '../../components/keepFocusInField'
import layout from '../../components/layout.module.css'
import RetryMessage from '../../components/RetryMessage'
import { TitleBar } from '../../components/Screen'
import { PasswordField, TextField } from '../../components/TextField'
import { useFormFields } from '../../components/useFormFields'
import { failureTextOf, isConnectionLost, offlineReasonOf, SIGN_UP } from '../connection/offlineAction'
import { useConnection } from '../connection/useConnection'
import AuthLink from './AuthLink'
import {
  DISPLAY_NAME_MAX,
  displayNameLength,
  passwordRule,
  signupFields,
  toNewAccount,
  validateSignup,
} from './signupForm'
import { rejectedFields } from './signupRejection'
import { useSignup, type SignUp } from './useSignup'
import styles from './SignupPage.module.css'

interface SignupPageProps {
  signUp: SignUp
  /** 가입했고 이 화면을 아직 떠나지 않았다 */
  onSignedUp: () => void
  /** 로그인 화면에서 넘어온 이메일. 없으면 빈 글자다. */
  initialEmail: string
}

/**
 * A-03 가입. 연결이 없으면 가입 버튼을 비활성으로 두고 바로 위에 "연결되면 가입할 수 있어요"를 보인다(공통 틀이 없어 띠가 없는
 * 화면, 00-common 4.3). 요청 중에 끊기면 그 줄 대신 "연결이 끊겨 가입하지 못했어요."와 "다시 시도"(연결이 없는 동안 비활성)다.
 */
export default function SignupPage({ signUp, onSignedUp, initialEmail }: SignupPageProps) {
  const signup = useSignup(signUp)
  const online = useConnection() === 'online'
  const { values, fieldProps, check, checkAll, reject } = useFormFields({
    fields: signupFields,
    initialValues: { email: initialEmail, password: '', passwordConfirm: '', displayName: '' },
    validate: validateSignup,
  })
  // 가입 위의 실패 문구. 다시 보내는 동안에도 남기고, 실패마다 count를 올려 새로 그려 다시 읽히게 한다. 없으면 없다
  const [failure, setFailure] = useState<{ count: number; text: string; lost: boolean }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 규칙 #102)
  const [sender, setSender] = useState<Sender>('signup')

  const busy = signup.isPending || signup.isSuccess
  // 연결이 끊기면 안내 줄이 앞선 실패 문구를 대신하고 다시 연결돼도 되살리지 않는다. 한 버튼 위에는 한 줄만(designer #238)
  if (!online && failure && !failure.lost) setFailure(undefined)

  function leavePassword() {
    check('password')
    // 확인 칸을 쓴 뒤에 비밀번호를 고쳤을 수 있다
    if (values.passwordConfirm !== '') check('passwordConfirm')
  }

  function submit(from: Sender = 'signup') {
    // 엔터로 보내는 길도 막는다(버튼은 누를 수 없게만 둔다)
    if (busy || !online) return
    if (!checkAll()) {
      signup.reset()
      setFailure(undefined)
      return
    }
    setSender(from)
    signup.mutate(toNewAccount(values), { onSuccess: onSignedUp, onError: showFailure })
  }

  function showFailure(error: Error) {
    const rejected = rejectedFields(error)
    if (rejected) reject(rejected)
    setFailure((last) =>
      rejected
        ? undefined
        : { count: (last?.count ?? 0) + 1, text: failureTextOf(error, SIGN_UP), lost: isConnectionLost(error) },
    )
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    submit()
  }

  return (
    <div className={styles.page} onMouseDown={keepFocusInField}>
      <TitleBar title="가입" parent="/login" />
      <main>
        <form className={styles.form} noValidate onSubmit={handleSubmit}>
          <div className={`${layout.contentWidth} ${styles.fields}`}>
            <TextField
              {...fieldProps('email')}
              readOnly={busy}
              label="이메일"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="name@example.com"
              autoFocus={initialEmail === ''}
            />
            <PasswordField
              {...fieldProps('password')}
              onBlur={leavePassword}
              readOnly={busy}
              label="비밀번호"
              help={passwordRule}
              autoComplete="new-password"
              autoFocus={initialEmail !== ''}
            />
            <PasswordField
              {...fieldProps('passwordConfirm')}
              readOnly={busy}
              label="비밀번호 확인"
              autoComplete="new-password"
            />
            <TextField
              {...fieldProps('displayName')}
              readOnly={busy}
              label="표시 이름"
              help="장부를 함께 쓰는 사람에게 보여요"
              count={{ current: displayNameLength(values.displayName), max: DISPLAY_NAME_MAX }}
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className={`${layout.contentWidth} ${styles.bottom}`}>
            {/* 실패할 때마다 초점을 "다시 시도"로 옮겨 화면 키보드를 내린다 */}
            {failure !== undefined && (
              <RetryMessage
                failures={failure.count}
                onRetry={() => submit('retry')}
                busy={busy && sender === 'retry'}
                disabled={(busy && sender === 'signup') || !online}
                autoFocus
              >
                {failure.text}
              </RetryMessage>
            )}
            {/* 한 버튼 위에는 한 줄만 둔다. 실패 문구가 있으면 덧붙이지 않는다(00-common 4.3) */}
            {!online && failure === undefined && <DisabledReason>{offlineReasonOf(SIGN_UP)}</DisabledReason>}
            <Button
              kind="primary"
              type="submit"
              busy={busy && sender === 'signup'}
              disabled={(busy && sender === 'retry') || !online}
            >
              가입
            </Button>
            <AuthLink question="이미 계정이 있나요?" to="/login" email={values.email}>
              로그인
            </AuthLink>
          </div>
        </form>
      </main>
    </div>
  )
}

/** 가입 버튼, 또는 실패 문구의 "다시 시도" */
type Sender = 'signup' | 'retry'
