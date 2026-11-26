import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { sessionUserId } from '../../api/session'
import { Button } from '../../components/Button'
import FullScreenForm from '../../components/FullScreenForm'
import RetryMessage from '../../components/RetryMessage'
import { useToast } from '../../components/ToastContext'
import { useGoBack } from '../../components/useGoBack'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import { uuidV7 } from '../../lib/uuid'
import { useAccounts } from '../accounts/useAccounts'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { defaultAccountOf } from './formDefaults'
import { useListMemory } from './listMemory'
import TransactionFields from './TransactionFields'
import { toNewTransaction, validateTransaction } from './transactionForm'
import { rejectedFields } from './transactionRejection'
import { idConflictOf, needsResendNotice, type CreateResult } from './transactions'
import { useCreateTransaction } from './useCreateTransaction'
import { useMoreFold, useTransactionForm } from './useTransactionForm'

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
  const navigate = useNavigate()
  const creation = useCreateTransaction()
  const accounts = useAccounts()
  // 이 화면을 연 사용자(입력의 주인). 기본 계좌를 고르고, 보내는 순간의 사용자(토큰의 sub)와 같은지 요청 계층이 본다.
  // 확인하지 못한 로그인이면 기록의 사용자다. 같은 사용자로 확인돼야 보낸다(#234)
  const [owner] = useState(() => ({ userId: sessionUserId(), ledgerId: ledger.id }))
  const [defaultAccountId, setDefaultAccountId] = useState<string>()
  if (defaultAccountId === undefined && accounts.data) setDefaultAccountId(defaultAccountOf(owner, accounts.data))
  const form = useTransactionForm(defaultAccountId ?? '')
  const [id, setId] = useState(uuidV7)
  const { moreOpen, setMoreOpen, unfoldFor } = useMoreFold(false)
  // 저장 위의 실패. 다시 보내는 동안에도 남기고, 실패마다 count를 올려 새로 그려 다시 읽히게 한다
  const [shown, setShown] = useState<{ failure: Failure; count: number }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 검토 2026-11-26)
  const [sender, setSender] = useState<Sender>('save')

  const busy = creation.isPending || creation.isSuccess
  const guard = useLeaveGuard({ parent: HOME, changed: form.changed, busy })
  const failure = shown?.failure

  function submit(transactionId = id, from: Sender = 'save') {
    if (busy) return
    unfoldFor(validateTransaction(form.effective))
    if (!form.checkAll()) {
      creation.reset()
      setShown(undefined)
      return
    }
    setSender(from)
    creation.mutate(
      { transaction: toNewTransaction(form.effective, transactionId), user: owner.userId },
      { onSuccess: finish, onError: showFailure },
    )
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(result: CreateResult) {
    // 돌아간 화면이 내역이면 그 줄을 강조한다(D-01 성공 뒤). 주소와 방문 기록에는 넣지 않는다
    listMemory.rememberSaved(result.transaction.id)
    showToast(needsResendNotice(result) ? '이미 저장된 거래가 있어요. 내역에서 확인해 주세요.' : '저장했어요')
    guard.leaveAfterSave(goBack)
  }

  function showFailure(error: Error) {
    const rejected = rejectedFields(error)
    if (rejected) {
      unfoldFor(rejected)
      form.reject(rejected)
    }
    const next = failureOf(error)
    setShown((last) => next && { failure: next, count: (last?.count ?? 0) + 1 })
  }

  function retry() {
    submit(id, 'message')
  }

  /**
   * 앞서 저장한 거래를 보러 간다. 확인 창 없이 쓰던 입력을 버린다(planner 결정 2026-11-26, #102). 버린 입력 화면은
   * 방문 기록에서 상세로 바꿔, 상세에서 뒤로 가면 입력을 연 화면이다.
   */
  function viewSaved(event: MouseEvent<HTMLAnchorElement>, path: string) {
    // 새 탭이나 창으로 여는 누름은 브라우저에 맡긴다. 이 화면의 입력은 그대로 남는다
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    // 저장을 다시 보내는 중에는 떠나지 않는다. 요청이 어디까지 갔는지 모른다
    if (busy) return
    guard.leave(() => navigate(path, { replace: true }))
  }

  function saveAsNew() {
    const next = uuidV7()
    setId(next)
    submit(next, 'message')
  }

  const messageBusy = busy && sender === 'message'
  const saveBusy = busy && sender === 'save'

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
            <RetryMessage failures={shown?.count} onRetry={retry} busy={messageBusy} disabled={saveBusy}>
              문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.
            </RetryMessage>
          )}
          {failure?.kind === 'saved-differently' && (
            <RetryMessage
              failures={shown?.count}
              to={`/transactions/${failure.savedId}`}
              actionLabel="저장된 거래 보기"
              onClick={(event) => viewSaved(event, `/transactions/${failure.savedId}`)}
            >
              앞서 저장한 거래와 내용이 달라 저장하지 못했어요. 내역에서 확인해 주세요.
            </RetryMessage>
          )}
          {failure?.kind === 'id-unusable' && (
            <RetryMessage
              failures={shown?.count}
              onRetry={saveAsNew}
              actionLabel="새 거래로 저장"
              busy={messageBusy}
              disabled={saveBusy}
            >
              문제가 생겨 저장하지 못했어요. 새 거래로 저장해 주세요.
            </RetryMessage>
          )}
          <Button kind="primary" type="submit" busy={saveBusy} disabled={messageBusy}>
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

/** 저장 버튼, 또는 실패 문구의 버튼("다시 시도", "새 거래로 저장") */
type Sender = 'save' | 'message'

type Failure =
  /** 서버 오류, 지연, 연결 실패, 모르는 거부. 같은 id로 다시 보낸다 */
  | { kind: 'retry' }
  /** 같은 id로 앞서 저장한 내 거래가 있는데 내용이 다르다(current 있는 409). 1A는 그 거래를 보러 가게만 한다 */
  | { kind: 'saved-differently'; savedId: string }
  /** 그 id를 쓸 수 없다(current 없는 409). 새 id로 만든다 */
  | { kind: 'id-unusable' }

/** 저장 위에 보일 실패. 칸에 보인 거부와 실패가 없으면 없다. */
function failureOf(error: Error): Failure | undefined {
  if (rejectedFields(error)) return undefined
  const conflict = idConflictOf(error)
  if (!conflict) return { kind: 'retry' }
  return conflict.savedId ? { kind: 'saved-differently', savedId: conflict.savedId } : { kind: 'id-unusable' }
}
