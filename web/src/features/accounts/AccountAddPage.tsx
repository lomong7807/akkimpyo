import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button } from '../../components/Button'
import DisabledReason from '../../components/DisabledReason'
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
import { useKeepDraft } from '../drafts/keepDraft'
import { useRestoredDraft } from '../drafts/restoreDraft'
import { failureTextOf, isConnectionLost, offlineReasonOf, SAVE } from '../connection/offlineAction'
import { useConnection } from '../connection/useConnection'
import { accountValuesOf } from './accountDraft'

const LIST = '/accounts'

/**
 * G-02 계좌 추가. 연결이 없어도 열리고 값을 쓸 수 있지만 저장은 비활성이고 바로 위에 "연결되면 저장할 수 있어요"를 보인다(전체 화면
 * 입력은 저장 버튼이 띠와 떨어져 있다, 00-common 4.3, R1). 요청 중에 끊기면 그 줄 대신 "연결이 끊겨 저장하지 못했어요."와
 * "다시 시도"(연결이 없는 동안 비활성)다.
 */
export default function AccountAddPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const showToast = useToast()
  const creation = useCreateAccount()
  const form = useAccountForm()
  const online = useConnection() === 'online'
  // 저장 위의 실패 문구. 다시 보내는 동안에도 남기고, 실패마다 올려 새로 그려 다시 읽히게 한다. 없으면 없다
  const [failure, setFailure] = useState<{ count: number; text: string; lost: boolean }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 검토 2026-11-26)
  const [sender, setSender] = useState<'save' | 'retry'>('save')

  const busy = creation.isPending || creation.isSuccess
  // 연결이 끊기면 안내 줄이 앞선 실패 문구를 대신하고 다시 연결돼도 되살리지 않는다. 한 버튼 위에는 한 줄만(designer #238)
  if (!online && failure && !failure.lost) setFailure(undefined)
  const guard = useLeaveGuard({ parent: LIST, changed: form.changed, busy })
  // 로그인이 풀리면 쓰던 값을 이 기기에 남기고, 같은 계정으로 이 주소에 돌아오면 채운다(00-common 4.1, #234 C2)
  useKeepDraft('account-add', () => (form.changed ? form.values : undefined))
  useRestoredDraft('account-add', (saved) => {
    const values = accountValuesOf(saved)
    if (values) form.change(values)
  })

  function submit(from: 'save' | 'retry' = 'save') {
    // 엔터로 보내는 길도 막는다(버튼은 누를 수 없게만 둔다)
    if (busy || !online) return
    if (!form.checkAll()) {
      creation.reset()
      setFailure(undefined)
      return
    }
    setSender(from)
    creation.mutate(toNewAccount(form.values), { onSuccess: finish, onError: showFailure })
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(account: Account) {
    showToast(`'${account.name}' 계좌를 추가했어요`)
    guard.leaveAfterSave(() => (isOpenedFromList(state) ? navigate(-1) : navigate(LIST, { replace: true })))
  }

  function showFailure(error: Error) {
    const rejected = rejectedFields(error)
    if (rejected) form.reject(rejected)
    setFailure((last) =>
      rejected ? undefined : { count: (last?.count ?? 0) + 1, text: failureTextOf(error, SAVE), lost: isConnectionLost(error) },
    )
  }

  return (
    <FullScreenForm
      title="계좌 추가"
      guard={guard}
      onSubmit={submit}
      bottom={
        <>
          {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
          {failure !== undefined && (
            <RetryMessage
              failures={failure.count}
              onRetry={() => submit('retry')}
              busy={busy && sender === 'retry'}
              disabled={(busy && sender === 'save') || !online}
            >
              {failure.text}
            </RetryMessage>
          )}
          {/* 한 버튼 위에는 한 줄만 둔다. 실패 문구가 있으면 덧붙이지 않는다(00-common 4.3) */}
          {!online && failure === undefined && <DisabledReason>{offlineReasonOf(SAVE)}</DisabledReason>}
          <Button
            kind="primary"
            type="submit"
            busy={busy && sender === 'save'}
            disabled={(busy && sender === 'retry') || !online}
          >
            저장
          </Button>
        </>
      }
    >
      <AccountFields form={form} readOnly={busy} />
    </FullScreenForm>
  )
}
