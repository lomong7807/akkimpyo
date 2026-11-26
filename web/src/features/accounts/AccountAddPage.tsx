import { useState } from 'react'
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
  // 저장 위의 실패 문구. 다시 보내는 동안에도 남기고, 실패마다 올려 새로 그려 다시 읽히게 한다. 없으면 없다
  const [failures, setFailures] = useState<number>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 검토 2026-11-26)
  const [sender, setSender] = useState<'save' | 'retry'>('save')

  const busy = creation.isPending || creation.isSuccess
  const guard = useLeaveGuard({ parent: LIST, changed: form.changed, busy })

  function submit(from: 'save' | 'retry' = 'save') {
    if (busy) return
    if (!form.checkAll()) {
      creation.reset()
      setFailures(undefined)
      return
    }
    setSender(from)
    creation.mutate(toNewAccount(form.values), { onSuccess: finish, onError: showFailure })
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(account: Account) {
    showToast(`'${account.name}' 계좌를 추가했어요`)
    guard.leave(() => (isOpenedFromList(state) ? navigate(-1) : navigate(LIST, { replace: true })))
  }

  function showFailure(error: Error) {
    const rejected = rejectedFields(error)
    if (rejected) form.reject(rejected)
    setFailures((last) => (rejected ? undefined : (last ?? 0) + 1))
  }

  return (
    <FullScreenForm
      title="계좌 추가"
      guard={guard}
      onSubmit={submit}
      bottom={
        <>
          {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
          {failures !== undefined && (
            <RetryMessage
              failures={failures}
              onRetry={() => submit('retry')}
              busy={busy && sender === 'retry'}
              disabled={busy && sender === 'save'}
            >
              문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.
            </RetryMessage>
          )}
          <Button kind="primary" type="submit" busy={busy && sender === 'save'} disabled={busy && sender === 'retry'}>
            저장
          </Button>
        </>
      }
    >
      <AccountFields form={form} readOnly={busy} />
    </FullScreenForm>
  )
}
