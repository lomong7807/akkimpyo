import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { Button } from '../../components/Button'
import DisabledReason from '../../components/DisabledReason'
import FullScreenForm from '../../components/FullScreenForm'
import RetryMessage from '../../components/RetryMessage'
import { useToast } from '../../components/ToastContext'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import { isUuid } from '../../lib/uuid'
import LoadFailureHere from '../connection/LoadFailureHere'
import { failureTextOf, isConnectionLost, offlineReasonOf, SAVE } from '../connection/offlineAction'
import { useConnection } from '../connection/useConnection'
import { useRestoredDraft } from '../drafts/restoreDraft'
import { useKeepDraft } from '../drafts/useKeepDraft'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useKeptCopy, type Kept } from '../me/ledgerCopy'
import NotFoundPage from '../not-found/NotFoundPage'
import { accountValuesOf } from './accountDraft'
import { editableAccountOf, type EditableAccount } from './accountEdit'
import AccountFields from './AccountFields'
import AccountFieldsSkeleton from './AccountFieldsSkeleton'
import { isSameAccount, savedAccountValues, toAccountUpdate } from './accountForm'
import { rejectedFields } from './accountRejection'
import { parseAccounts, type Account } from './accounts'
import { isOpenedFromList } from './openedFromList'
import { useAccountForm } from './useAccountForm'
import { useAccounts } from './useAccounts'
import { isGone, useUpdateAccount } from './useUpdateAccount'

const LIST = '/accounts'

/**
 * G-02 계좌 수정(#243, F-503). 1B 동안은 계좌 목록(G-01)의 계좌 줄이 열고, 저장하거나 닫으면 계좌 목록으로 돌아간다(planner #102).
 * 주소의 id가 UUID 모양이 아니면 요청하지 않고 찾을 수 없음(N-01)이다. 칸, 검사, 문구, 서버 거부의 문구는 계좌 추가와 같고
 * 기준일 아래에 다시 계산 안내를 더한다. 계좌는 수정 충돌 검사가 없어 나중 저장이 남는다(P-217, R6).
 * 넓은 화면의 오른쪽 칸(#244), 할부가 있는 카드의 종류 고정과 카드 식별 문구(3단계)는 없다.
 */
export default function AccountEditPage() {
  const { id } = useParams()
  if (!isUuid(id)) return <NotFoundPage />
  const lowered = id.toLowerCase()
  return <EditScreen key={lowered} id={lowered} />
}

/** 고칠 계좌를 찾은 결과 */
type ToEdit =
  | { state: 'ready'; account: EditableAccount }
  | { state: 'loading' }
  /** 받지 못했거나, 기기 사본에 없거나 사본이 시작 잔액·기준일을 담기 전의 것이다(planner #243 P3) */
  | { state: 'failed' }
  /** 받은 목록(숨긴 계좌 포함)에 없다 */
  | { state: 'missing' }

/**
 * 고칠 계좌는 계좌 목록에서 찾는다(계좌 하나를 받는 API는 없다). 받아 둔 목록이 있으면 다시 받는 동안에도 그것으로 채운다.
 * 없으면 연결이 있는 동안 받기를 기다리고(뼈대), 연결이 없거나 받지 못했으면 기기에 남긴 계좌 값으로 채운다(G-02 상태, P-902).
 * 찾을 수 없음은 서버의 목록에 없을 때만이다. 기기 사본에 없으면 그 뒤에 만든 계좌일 수 있어 불러오지 못한 것으로 본다(P3).
 */
function chooseAccount(
  id: string,
  server: { data: Account[] | undefined; isFetchedAfterMount: boolean },
  kept: Kept<Account[]> | null | undefined,
  online: boolean,
): ToEdit {
  if (server.data) {
    const found = server.data.find((account) => account.id === id)
    if (!found) return { state: 'missing' }
    const account = editableAccountOf(found)
    return account ? { state: 'ready', account } : { state: 'failed' }
  }
  // 다시 받는 동안에는 isError가 풀리므로 이 화면에서 받아 본 적이 있는지로 본다
  if ((online && !server.isFetchedAfterMount) || kept === undefined) return { state: 'loading' }
  const found = kept?.value.find((account) => account.id === id)
  const account = found && editableAccountOf(found)
  return account ? { state: 'ready', account } : { state: 'failed' }
}

/**
 * 고칠 계좌를 기다린다. 한 번 채운 뒤에는 목록이 다시 와도(다른 기기의 수정, 그사이 지워짐) 칸과 비교의 바탕을 바꾸지 않는다.
 * 저장하다 그사이 지워진 것(404)을 알면 찾을 수 없음이다(R6).
 */
function EditScreen({ id }: { id: string }) {
  const ledger = useCurrentLedger()
  const query = useAccounts()
  const kept = useKeptCopy(ledger.id, 'accounts', parseAccounts)
  const online = useConnection() === 'online'
  const [opened, setOpened] = useState<EditableAccount>()
  const [gone, setGone] = useState(false)
  const toEdit = chooseAccount(id, query, kept, online)

  if (!opened && toEdit.state === 'ready') setOpened(toEdit.account)
  if (gone || (!opened && toEdit.state === 'missing')) return <NotFoundPage />

  const waiting =
    toEdit.state === 'failed' ? (
      <LoadFailureHere headingLevel={2} onRetry={() => void query.refetch()} busy={query.isFetching} />
    ) : (
      <AccountFieldsSkeleton />
    )
  return <EditForm id={id} opened={opened} waiting={waiting} onGone={() => setGone(true)} />
}

interface EditFormProps {
  id: string
  /** 연 때의 계좌. 아직 받는 중이면 없다 */
  opened: EditableAccount | undefined
  /** 받는 동안 칸 자리에 보이는 것 */
  waiting: ReactNode
  /** 저장하다 그사이 지워진 것(404)을 알았다 */
  onGone: () => void
}

/**
 * 전체 화면 입력 하나가 받는 동안과 받은 뒤를 함께 그린다. 받은 뒤에 다시 그리면 화면이 아래에서 다시 올라오기 때문이다.
 * 받는 동안에는 저장 자리를 숨긴다(거래 수정과 같다, designer #243 D2). 연결이 없으면 값은 쓸 수 있고 저장은 비활성이며 바로 위에
 * "연결되면 저장할 수 있어요"를 보인다(R1, #238). 저장에 성공하거나 바뀐 값이 없으면 계좌 목록으로 돌아간다.
 */
function EditForm({ id, opened, waiting, onGone }: EditFormProps) {
  const navigate = useNavigate()
  const { state } = useLocation()
  const showToast = useToast()
  const updating = useUpdateAccount(id)
  const form = useAccountForm()
  const [filled, setFilled] = useState(false)
  if (opened && !filled) {
    setFilled(true)
    form.reset(savedAccountValues(opened))
  }
  const online = useConnection() === 'online'
  // 저장 위의 실패 문구. 다시 보내는 동안에도 남기고, 실패마다 올려 새로 그려 다시 읽히게 한다. 없으면 없다
  const [failure, setFailure] = useState<{ count: number; text: string; lost: boolean }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5)
  const [sender, setSender] = useState<'save' | 'retry'>('save')

  const busy = updating.isPending || updating.isSuccess
  // 연결이 끊기면 안내 줄이 앞선 실패 문구를 대신하고 다시 연결돼도 되살리지 않는다. 한 버튼 위에는 한 줄만(designer #238)
  if (!online && failure && !failure.lost) setFailure(undefined)
  const guard = useLeaveGuard({ parent: LIST, changed: form.changed, busy })
  // 로그인이 풀리면 쓰던 값을 이 기기에 남기고, 같은 계정으로 이 주소(같은 계좌)에 돌아오면 채운 뒤에 덮는다(R5, #234 C2)
  useKeepDraft('account-edit', () => (filled && form.changed ? form.values : undefined))
  useRestoredDraft(
    'account-edit',
    (saved) => {
      const values = accountValuesOf(saved)
      if (values) form.change(values)
    },
    filled,
  )

  /** 목록에서 열었으면 그 목록으로 돌아가고, 주소로 바로 열었으면 목록으로 바꾼다(방문 기록에 목록을 쌓지 않는다) */
  function backToList() {
    if (isOpenedFromList(state)) navigate(-1)
    else navigate(LIST, { replace: true })
  }

  function submit(from: 'save' | 'retry' = 'save') {
    // 엔터로 보내는 길도 막는다(버튼은 누를 수 없게만 둔다)
    if (busy || !opened || !online) return
    // 바꾼 값이 없으면 보내지 않고 닫는다. 토스트도 없다(G-02 (8))
    if (!form.changed) return guard.leave(backToList)
    if (!form.checkAll()) {
      updating.reset()
      setFailure(undefined)
      return
    }
    const update = toAccountUpdate(form.values, opened)
    // 칸의 글자는 달라도 보낼 값이 저장된 계좌와 같으면(앞뒤 공백, 0원의 부호) 바꾼 것이 없다
    if (isSameAccount(update, opened)) return guard.leave(backToList)
    setSender(from)
    updating.mutate(update, { onSuccess: finish, onError: showFailure })
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish() {
    showToast('저장했어요')
    guard.leaveAfterSave(backToList)
  }

  function showFailure(error: Error) {
    if (isGone(error)) return onGone()
    const rejected = rejectedFields(error)
    if (rejected) form.reject(rejected)
    setFailure((last) =>
      rejected ? undefined : { count: (last?.count ?? 0) + 1, text: failureTextOf(error, SAVE), lost: isConnectionLost(error) },
    )
  }

  return (
    <FullScreenForm
      title="계좌 수정"
      guard={guard}
      onSubmit={submit}
      bottom={
        filled ? (
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
        ) : undefined
      }
    >
      {filled ? <AccountFields form={form} readOnly={busy} editing /> : waiting}
    </FullScreenForm>
  )
}
