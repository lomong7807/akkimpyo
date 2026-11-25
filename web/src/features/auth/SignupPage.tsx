import { useRef, type SubmitEvent } from 'react'
import { Button } from '../../components/Button'
import layout from '../../components/layout.module.css'
import { TitleBar } from '../../components/Screen'
import { PasswordField, TextField } from '../../components/TextField'
import AuthLink from './AuthLink'
import { keepFocusInField } from './keepFocusInField'
import RetryMessage from './RetryMessage'
import {
  DISPLAY_NAME_MAX,
  displayNameLength,
  passwordRule,
  signupFields,
  toNewAccount,
  validateSignup,
} from './signupForm'
import { rejectedFields } from './signupRejection'
import { useFormFields } from './useFormFields'
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
  const signupButton = useRef<HTMLButtonElement>(null)

  const busy = signup.isPending || signup.isSuccess
  const failed = signup.isError && !rejectedFields(signup.error)

  function leavePassword() {
    check('password')
    // 확인 칸을 쓴 뒤에 비밀번호를 고쳤을 수 있다
    if (values.passwordConfirm !== '') check('passwordConfirm')
  }

  function submit() {
    if (!checkAll()) {
      signup.reset()
      return
    }
    signup.mutate(toNewAccount(values), { onSuccess: onSignedUp, onError: showRejected })
  }

  function showRejected(error: Error) {
    const rejected = rejectedFields(error)
    if (rejected) reject(rejected)
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    submit()
  }

  function retry() {
    // 다시 보내는 동안 이 버튼은 사라지므로 초점을 잃지 않게 옮긴다
    signupButton.current?.focus()
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
              help="장부를 함께 쓰는 사람에게 보여요."
              count={{ current: displayNameLength(values.displayName), max: DISPLAY_NAME_MAX }}
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className={`${layout.contentWidth} ${styles.bottom}`}>
            {failed && (
              <RetryMessage onRetry={retry} autoFocus>
                문제가 생겨 가입하지 못했어요. 잠시 후 다시 시도해 주세요.
              </RetryMessage>
            )}
            <Button ref={signupButton} kind="primary" type="submit" busy={busy}>
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
