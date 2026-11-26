import { useState, type SubmitEvent } from 'react'
import { Button } from '../../components/Button'
import { keepFocusInField } from '../../components/keepFocusInField'
import layout from '../../components/layout.module.css'
import RetryMessage from '../../components/RetryMessage'
import { TitleBar } from '../../components/Screen'
import { PasswordField, TextField } from '../../components/TextField'
import { useFormFields } from '../../components/useFormFields'
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

/** A-03 가입 */
export default function SignupPage({ signUp, onSignedUp, initialEmail }: SignupPageProps) {
  const signup = useSignup(signUp)
  const { values, fieldProps, check, checkAll, reject } = useFormFields({
    fields: signupFields,
    initialValues: { email: initialEmail, password: '', passwordConfirm: '', displayName: '' },
    validate: validateSignup,
  })
  // 가입 위의 실패 문구. 다시 보내는 동안에도 남기고, 실패마다 올려 새로 그려 다시 읽히게 한다. 없으면 없다
  const [failures, setFailures] = useState<number>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 규칙 #102)
  const [sender, setSender] = useState<Sender>('signup')

  const busy = signup.isPending || signup.isSuccess

  function leavePassword() {
    check('password')
    // 확인 칸을 쓴 뒤에 비밀번호를 고쳤을 수 있다
    if (values.passwordConfirm !== '') check('passwordConfirm')
  }

  function submit(from: Sender = 'signup') {
    if (busy) return
    if (!checkAll()) {
      signup.reset()
      setFailures(undefined)
      return
    }
    setSender(from)
    signup.mutate(toNewAccount(values), { onSuccess: onSignedUp, onError: showFailure })
  }

  function showFailure(error: Error) {
    const rejected = rejectedFields(error)
    if (rejected) reject(rejected)
    setFailures((last) => (rejected ? undefined : (last ?? 0) + 1))
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
            {failures !== undefined && (
              <RetryMessage
                failures={failures}
                onRetry={() => submit('retry')}
                busy={busy && sender === 'retry'}
                disabled={busy && sender === 'signup'}
                autoFocus
              >
                문제가 생겨 가입하지 못했어요. 잠시 후 다시 시도해 주세요.
              </RetryMessage>
            )}
            <Button
              kind="primary"
              type="submit"
              busy={busy && sender === 'signup'}
              disabled={busy && sender === 'retry'}
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
