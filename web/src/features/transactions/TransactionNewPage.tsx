import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { currentUserId } from '../../api/session'
import { Button } from '../../components/Button'
import FullScreenForm from '../../components/FullScreenForm'
import RetryMessage from '../../components/RetryMessage'
import { useToast } from '../../components/ToastContext'
import { useGoBack } from '../../components/useGoBack'
import type { FieldErrors } from '../../components/useFormFields'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import { uuidV7 } from '../../lib/uuid'
import { useAccounts } from '../accounts/useAccounts'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { defaultAccountOf } from './formDefaults'
import { useListMemory } from './listMemory'
import TransactionFields from './TransactionFields'
import { foldedFields, toNewTransaction, validateTransaction, type TransactionField } from './transactionForm'
import { rejectedFields } from './transactionRejection'
import { idConflictOf, needsResendNotice, type CreateResult } from './transactions'
import { useCreateTransaction } from './useCreateTransaction'
import { useTransactionForm } from './useTransactionForm'

/** 앞서 본 화면이 없을 때(주소를 바로 연 경우) 닫으면 가는 곳 */
const HOME = '/home'

/**
 * D-04 거래 입력(새 입력). 빠른 입력(B-03)과 사이드바의 "거래 입력"이 지출 유형으로 연다.
 * 거래 id는 화면을 열 때 만들고, 실패한 뒤 다시 시도하거나 값을 고쳐 다시 저장해도 같은 id로 보낸다(ADR 006).
 * 앞 요청이 서버에 저장됐을 수 있기 때문이다. 새 id는 그 id를 쓸 수 없다는 거부(current 없는 409)에서
 * "새 거래로 저장"을 누를 때만 만든다.
 */
export default function TransactionNewPage() {
  const ledger = useCurrentLedger()
  const showToast = useToast()
  const listMemory = useListMemory()
  const goBack = useGoBack(HOME)
  const creation = useCreateTransaction()
  const accounts = useAccounts()
  // 이 화면을 연 사용자. 기본 계좌를 고르고, 보내는 순간의 사용자와 같은지 본다
  const [owner] = useState(() => ({ userId: currentUserId(), ledgerId: ledger.id }))
  const [defaultAccountId, setDefaultAccountId] = useState<string>()
  if (defaultAccountId === undefined && accounts.data) setDefaultAccountId(defaultAccountOf(owner, accounts.data))
  const form = useTransactionForm(defaultAccountId ?? '')
  const [id, setId] = useState(uuidV7)
  const [moreOpen, setMoreOpen] = useState(false)
  const saveButton = useRef<HTMLButtonElement>(null)

  const busy = creation.isPending || creation.isSuccess
  const guard = useLeaveGuard({ parent: HOME, changed: form.changed, busy })
  const failure = failureOf(creation.error)

  /** 접힌 칸에 보일 오류가 있으면 먼저 펼쳐 그 칸으로 초점을 옮길 수 있게 한다. */
  function unfoldFor(errors: FieldErrors<TransactionField>) {
    if (foldedFields.some((field) => errors[field])) flushSync(() => setMoreOpen(true))
  }

  function submit(transactionId = id) {
    if (busy) return
    unfoldFor(validateTransaction(form.effective))
    if (!form.checkAll()) {
      creation.reset()
      return
    }
    creation.mutate(
      { transaction: toNewTransaction(form.effective, transactionId), user: owner.userId },
      { onSuccess: finish, onError: showRejected },
    )
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(result: CreateResult) {
    // 돌아간 화면이 내역이면 그 줄을 강조한다(D-01 성공 뒤). 주소와 방문 기록에는 넣지 않는다
    listMemory.rememberSaved(result.transaction.id)
    showToast(needsResendNotice(result) ? '이미 저장된 거래가 있어요. 내역에서 확인해 주세요.' : '저장했어요')
    guard.leave(goBack)
  }

  function showRejected(error: Error) {
    const rejected = rejectedFields(error)
    if (!rejected) return
    unfoldFor(rejected)
    form.reject(rejected)
  }

  function retry() {
    // 다시 보내는 동안 누른 버튼은 사라지므로 초점을 잃지 않게 옮긴다
    saveButton.current?.focus()
    submit()
  }

  function saveAsNew() {
    const next = uuidV7()
    setId(next)
    saveButton.current?.focus()
    submit(next)
  }

  return (
    <FullScreenForm
      title="거래 입력"
      guard={guard}
      onSubmit={submit}
      submitShortcut
      bottom={
        <>
          {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
          {failure?.kind === 'retry' && (
            <RetryMessage onRetry={retry}>문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.</RetryMessage>
          )}
          {failure?.kind === 'saved-differently' && (
            <RetryMessage to={`/transactions/${failure.savedId}`} actionLabel="저장된 거래 보기">
              앞서 저장한 거래와 내용이 달라 저장하지 못했어요. 내역에서 확인해 주세요.
            </RetryMessage>
          )}
          {failure?.kind === 'id-unusable' && (
            <RetryMessage onRetry={saveAsNew} actionLabel="새 거래로 저장">
              문제가 생겨 저장하지 못했어요. 새 거래로 저장해 주세요.
            </RetryMessage>
          )}
          <Button ref={saveButton} kind="primary" type="submit" busy={busy}>
            저장
          </Button>
        </>
      }
    >
      <TransactionFields
        form={form}
        readOnly={busy}
        moreOpen={moreOpen}
        onMoreOpenChange={setMoreOpen}
      />
    </FullScreenForm>
  )
}

type Failure =
  /** 서버 오류, 지연, 연결 실패, 모르는 거부. 같은 id로 다시 보낸다 */
  | { kind: 'retry' }
  /** 같은 id로 앞서 저장한 내 거래가 있는데 내용이 다르다(current 있는 409). 1A는 그 거래를 보러 가게만 한다 */
  | { kind: 'saved-differently'; savedId: string }
  /** 그 id를 쓸 수 없다(current 없는 409). 새 id로 만든다 */
  | { kind: 'id-unusable' }

/** 저장 위에 보일 실패. 칸에 보인 거부와 실패가 없으면 없다. */
function failureOf(error: Error | null): Failure | undefined {
  if (!error || rejectedFields(error)) return undefined
  const conflict = idConflictOf(error)
  if (!conflict) return { kind: 'retry' }
  return conflict.savedId ? { kind: 'saved-differently', savedId: conflict.savedId } : { kind: 'id-unusable' }
}
