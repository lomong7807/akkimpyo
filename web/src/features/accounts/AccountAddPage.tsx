import { useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '../../components/Button'
import FullScreenForm from '../../components/FullScreenForm'
import RetryMessage from '../../components/RetryMessage'
import { useToast } from '../../components/ToastContext'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import AccountFields from './AccountFields'
import { toNewAccount } from './accountForm'
import { rejectedFields } from './accountRejection'
import type { Account } from './accounts'
import { isOpenedFromList } from './openedFromList'
import { useAccountForm } from './useAccountForm'
import { useCreateAccount } from './useCreateAccount'

const LIST = '/accounts'

/** G-02 계좌 추가 */
export default function AccountAddPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const showToast = useToast()
  const creation = useCreateAccount()
  const form = useAccountForm()
  const saveButton = useRef<HTMLButtonElement>(null)

  const busy = creation.isPending || creation.isSuccess
  const failed = creation.isError && !rejectedFields(creation.error)
  const guard = useLeaveGuard({ parent: LIST, changed: form.changed, busy })

  function submit() {
    if (!form.checkAll()) {
      creation.reset()
      return
    }
    creation.mutate(toNewAccount(form.values), { onSuccess: finish, onError: showRejected })
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(account: Account) {
    showToast(`'${account.name}' 계좌를 추가했어요`)
    guard.leave(() => (isOpenedFromList(state) ? navigate(-1) : navigate(LIST, { replace: true })))
  }

  function showRejected(error: Error) {
    const rejected = rejectedFields(error)
    if (rejected) form.reject(rejected)
  }

  function retry() {
    // 다시 보내는 동안 이 버튼은 사라지므로 초점을 잃지 않게 옮긴다
    saveButton.current?.focus()
    submit()
  }

  return (
    <FullScreenForm
      title="계좌 추가"
      guard={guard}
      onSubmit={submit}
      bottom={
        <>
          {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
          {failed && (
            <RetryMessage onRetry={retry}>
              문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.
            </RetryMessage>
          )}
          <Button ref={saveButton} kind="primary" type="submit" busy={busy}>
            저장
          </Button>
        </>
      }
    >
      <AccountFields form={form} readOnly={busy} />
    </FullScreenForm>
  )
}
