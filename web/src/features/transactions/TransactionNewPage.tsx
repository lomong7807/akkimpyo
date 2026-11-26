import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { connection } from '../../api/connection'
import { sessionUserId } from '../../api/session'
import { Button } from '../../components/Button'
import DialogFrame from '../../components/DialogFrame'
import FullScreenForm from '../../components/FullScreenForm'
import RetryMessage from '../../components/RetryMessage'
import { useToast } from '../../components/ToastContext'
import { useGoBack } from '../../components/useGoBack'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import { today as todayOfDevice } from '../../lib/calendarDate'
import { uuidV7 } from '../../lib/uuid'
import { useConnection } from '../connection/useConnection'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import ConflictPanel, { ConflictCompare, DeletedElsewhere, type PanelFailure } from './ConflictPanel'
import { compareRows } from './conflictValues'
import { EntryCopiesContext, useEntryAccounts, useEntryCategories } from './entryLists'
import { defaultAccountOf, isUncategorized } from './formDefaults'
import { nameBookOf } from './listedText'
import { useListMemory } from './listMemory'
import { isConnectionLoss, QUEUE_FAILED, QUEUED_TOAST, queueNewTransaction } from './pendingTransactions'
import TransactionFields from './TransactionFields'
import {
  hasSameContent,
  savedTransactionValues,
  toNewTransaction,
  toTransactionUpdate,
  validateTransaction,
} from './transactionForm'
import { rejectedFields } from './transactionRejection'
import {
  idConflictOf,
  needsResendNotice,
  staleVersionOf,
  type CreateResult,
  type NewTransaction,
  type TransactionDetail,
  type TransactionType,
} from './transactions'
import { useCreateTransaction } from './useCreateTransaction'
import { useMoreFold, useTransactionForm } from './useTransactionForm'
import { useUpdateTransaction } from './useUpdateTransaction'

/** 앞서 본 화면이 없을 때(주소를 바로 연 경우) 닫으면 가는 곳 */
const HOME = '/home'

/** 같은 id로 다시 보낸 거래가 이미 고쳐졌거나 휴지통·취소였을 때(200, ADR 006 결정 3)의 토스트(designer #239) */
const RESEND_NOTICE = '이미 저장된 거래라 저장된 내용으로 두었어요'

/* 선택 판(ADR 006 결정 3)의 문구(designer #239, #102). 화면에 "서버"라는 말을 쓰지 않는다 */
const CHOICE_TITLE = '이미 저장된 거래가 있어요'
const CHOICE_DESCRIPTION = '먼저 저장된 내용과 지금 입력이 달라요. 어느 쪽으로 할지 골라 주세요.'
const KEPT_TOAST = '저장된 내용으로 두었어요'
const KEPT_NOTICE = '저장된 거래는 그대로 남아요'
/* 선택 판의 실패와 비활성 문구는 D-04 저장의 것을 쓴다(designer #239 D1) */
const SAVE_FAILED = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const SAVE_LOST = '연결이 끊겨 저장하지 못했어요. 연결되면 다시 시도해 주세요.'
const SAVE_OFFLINE = '연결되면 저장할 수 있어요'

/** 선택 판에 보이는 저장된 거래와 그 판의 실패 */
interface Choice {
  current: TransactionDetail
  /** 판을 연 때의 기기의 오늘 */
  today: string
  /** 새 저장된 내용으로 다시 그린 횟수 */
  redraws: number
  failure?: PanelFailure
}

/**
 * D-04 거래 입력(새 입력). 빠른 입력(B-03)과 사이드바의 "거래 입력"이 지출 유형으로 연다.
 * 거래 id는 화면을 열 때 만들고, 실패한 뒤 다시 시도하거나 값을 고쳐 다시 저장해도 같은 id로 보낸다(ADR 006).
 * 앞 요청이 서버에 저장됐을 수 있기 때문이다. 새 id는 그 id를 쓸 수 없다는 거부(current 없는 409)에서, 그리고 선택 판에서
 * 유형이 달라 "새 거래로 저장"을 누를 때만 만든다.
 * 같은 id로 앞서 저장된 내 거래와 내용이 다르면(current 있는 409 ID_CONFLICT) 선택 판을 띄워 사용자가 고른다(ADR 006 결정 3).
 * 연결이 없으면 요청 없이 기기에 쌓고, 요청 중에 연결이 끊기면 같은 id로 쌓는다(F-103, P-904). 서버 오류와 15초 지연은 쌓지
 * 않는다. 저장 버튼은 연결과 관계없이 누를 수 있다.
 */
export default function TransactionNewPage() {
  const ledger = useCurrentLedger()
  const showToast = useToast()
  const listMemory = useListMemory()
  const goBack = useGoBack(HOME)
  const navigate = useNavigate()
  const creation = useCreateTransaction()
  // 기기에 있는 계좌로 바로 열고 서버의 목록이 오면 바꾼다(#234)
  const accounts = useEntryAccounts(true)
  const categories = useEntryCategories(true)
  // 이 화면을 연 사용자(입력의 주인). 기본 계좌를 고르고, 보내는 순간의 사용자(토큰의 sub)와 같은지 요청 계층이 본다.
  // 확인하지 못한 로그인이면 기록의 사용자다. 같은 사용자로 확인돼야 보낸다(#234)
  const [owner] = useState(() => ({ userId: sessionUserId(), ledgerId: ledger.id }))
  const [defaultAccountId, setDefaultAccountId] = useState<string>()
  if (defaultAccountId === undefined && accounts.data) setDefaultAccountId(defaultAccountOf(owner, accounts.data))
  const form = useTransactionForm(defaultAccountId ?? '')
  const [id, setId] = useState(uuidV7)
  // "내 입력으로 고치기"는 같은 id의 거래를 고친다
  const updating = useUpdateTransaction(id)
  const { moreOpen, setMoreOpen, unfoldFor } = useMoreFold(false)
  // 저장 위의 실패. 다시 보내는 동안에도 남기고, 실패마다 count를 올려 새로 그려 다시 읽히게 한다
  const [shown, setShown] = useState<{ failure: Failure; count: number }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돌고 다른 버튼은 누를 수 없다(00-common 4.5, designer 검토 2026-11-26)
  const [sender, setSender] = useState<Sender>('save')
  // 기기에 쌓는 중이거나 쌓았다. 쌓았으면 화면을 떠날 때까지 그대로다
  const [queueing, setQueueing] = useState(false)
  const online = useConnection() === 'online'
  // 선택 판. 닫히는 움직임 동안 내용이 남도록 열림을 따로 둔다
  const [choice, setChoice] = useState<Choice>()
  const [choiceOpen, setChoiceOpen] = useState(false)
  const lists = useMemo(() => {
    if (!accounts.data || !categories.data) return undefined
    const list = categories.data
    return {
      names: nameBookOf(accounts.data, list),
      valuesOf: (saved: TransactionDetail) => savedTransactionValues(saved, (categoryId) => isUncategorized(list, categoryId)),
    }
  }, [accounts.data, categories.data])

  const busy = creation.isPending || creation.isSuccess || queueing || updating.isPending || updating.isSuccess
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
    const transaction = toNewTransaction(form.effective, transactionId)
    if (connection() === 'offline') {
      void queue(transaction)
      return
    }
    creation.mutate(
      { transaction, user: owner.userId },
      {
        onSuccess: finish,
        onError: (error) => (isConnectionLoss(error) ? void queue(transaction) : showFailure(error, transactionId)),
      },
    )
  }

  /** 기기에 쌓고 이전 화면으로 간다. 쌓지 못하면 저장 위에 문구를 보이고 값을 둔다(designer Q8). */
  async function queue(transaction: NewTransaction) {
    setQueueing(true)
    try {
      await queueNewTransaction(owner, transaction)
    } catch {
      setQueueing(false)
      creation.reset()
      setShown((last) => ({ failure: { kind: 'not-queued' }, count: (last?.count ?? 0) + 1 }))
      return
    }
    // 돌아간 화면이 내역이면 보내지 않음 줄을 강조한다(서버에 저장했을 때와 같다)
    listMemory.rememberSaved(transaction.id)
    showToast(QUEUED_TOAST)
    guard.leaveAfterSave(goBack)
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish(result: CreateResult) {
    // 돌아간 화면이 내역이면 그 줄을 강조한다(D-01 성공 뒤). 주소와 방문 기록에는 넣지 않는다
    listMemory.rememberSaved(result.transaction.id)
    showToast(needsResendNotice(result) ? RESEND_NOTICE : '저장했어요')
    guard.leaveAfterSave(goBack)
  }

  function showFailure(error: Error, transactionId: string) {
    const current = idConflictOf(error, transactionId)?.current
    if (current && lists) {
      setShown(undefined)
      openChoice(current)
      return
    }
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

  /** 선택 판을 저장된 거래로 연다. 이미 떠 있으면 새 저장된 내용으로 다시 그린다 */
  function openChoice(current: TransactionDetail) {
    setChoice((last) => ({ current, today: todayOfDevice(), redraws: (last?.redraws ?? 0) + 1 }))
    setChoiceOpen(true)
  }

  /** 판에 실패 문구를 보인다. 실패마다 count를 올려 같은 문구여도 다시 알린다 */
  function failInChoice(message: string) {
    setChoice((last) => last && { ...last, failure: { message, count: (last.failure?.count ?? 0) + 1 } })
  }

  /** 내 입력을 버리고 저장된 거래를 그대로 둔다. 보내지 않는다. 저장 성공과 같이 이전 화면으로 간다(planner #239 P1) */
  function keepSaved(current: TransactionDetail) {
    if (busy) return
    listMemory.rememberSaved(current.id)
    showToast(KEPT_TOAST)
    guard.leaveAfterSave(goBack)
  }

  /**
   * "내 입력으로 고치기": 그 거래의 수정을 저장된 거래의 version과 함께 보낸다(ADR 006 결정 3). 그사이 또 고쳐졌으면 같은 판을
   * 새 저장된 내용으로 다시 그리고, 그 내용이 내 입력과 같으면 저장에 성공한 것이다(planner #239 P2).
   */
  function fixSaved(current: TransactionDetail) {
    if (busy || !lists) return
    setSender('choice')
    updating.mutate(
      { update: toTransactionUpdate(form.effective, current.version), user: owner.userId },
      {
        onSuccess: (saved) => {
          listMemory.rememberSaved(saved.id)
          showToast('저장했어요')
          guard.leaveAfterSave(goBack)
        },
        onError: (error) => {
          const latest = staleVersionOf(error, current.id)?.current
          if (latest) {
            if (latest.deletedAt === null && hasSameContent(form.effective, lists.valuesOf(latest))) {
              listMemory.rememberSaved(latest.id)
              showToast('저장했어요')
              guard.leaveAfterSave(goBack)
              return
            }
            openChoice(latest)
            return
          }
          const rejected = rejectedFields(error)
          if (rejected) {
            setChoiceOpen(false)
            unfoldFor(rejected)
            form.reject(rejected)
            return
          }
          failInChoice(isConnectionLoss(error) ? SAVE_LOST : SAVE_FAILED)
        },
      },
    )
  }

  /**
   * 유형이 달라 고칠 수 없을 때(P-213)의 "새 거래로 저장": 새 id로 만든다. 다시 시도는 그 새 id를 쓴다. 연결이 없거나 요청 중에
   * 끊기면 새 입력과 같이 기기에 쌓는다(F-103, P-904). 먼저 저장된 거래는 그대로 남는다(판의 안내).
   */
  function saveChosenAsNew() {
    if (busy) return
    const next = id === choice?.current.id ? uuidV7() : id
    setId(next)
    setSender('choice')
    const transaction = toNewTransaction(form.effective, next)
    if (connection() === 'offline') {
      setChoiceOpen(false)
      void queue(transaction)
      return
    }
    creation.mutate(
      { transaction, user: owner.userId },
      {
        onSuccess: finish,
        onError: (error) => {
          if (isConnectionLoss(error)) {
            setChoiceOpen(false)
            void queue(transaction)
          } else if (rejectedFields(error) || idConflictOf(error)) {
            setChoiceOpen(false)
            showFailure(error, next)
          } else {
            failInChoice(SAVE_FAILED)
          }
        },
      },
    )
  }

  const messageBusy = busy && sender === 'message'
  const saveBusy = busy && sender === 'save'
  const choiceBusy = busy && sender === 'choice'

  return (
    <EntryCopiesContext value>
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
            {failure?.kind === 'not-queued' && (
            <RetryMessage
              failures={shown?.count}
              onRetry={retry}
              busy={messageBusy}
              disabled={saveBusy || !online}
            >
              {QUEUE_FAILED}
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
      {/* 판 바깥, 끌어내리기, X, Esc로 닫으면 입력 화면으로 돌아가 입력을 둔다. 다시 저장하면 다시 이 판이다 */}
      <DialogFrame open={choiceOpen} title={CHOICE_TITLE} busy={choiceBusy} onClose={() => setChoiceOpen(false)}>
        {choice && lists && (
          <ChoiceContent
            choice={choice}
            mineType={form.effective.type}
            busy={choiceBusy}
            online={online}
            onKeep={() => keepSaved(choice.current)}
            onFix={() => fixSaved(choice.current)}
            onSaveAsNew={saveChosenAsNew}
          >
            {choice.current.deletedAt === null ? (
              <ConflictCompare
                latestLabel="저장된 내용"
                rows={compareRows(lists.valuesOf(choice.current), form.effective, lists.names, choice.today)}
              />
            ) : (
              <DeletedElsewhere />
            )}
          </ChoiceContent>
        )}
      </DialogFrame>
    </EntryCopiesContext>
  )
}

interface ChoiceContentProps {
  choice: Choice
  /** 내 입력의 유형 */
  mineType: TransactionType
  busy: boolean
  online: boolean
  onKeep: () => void
  onFix: () => void
  onSaveAsNew: () => void
  /** 비교 자리 */
  children: ReactNode
}

/**
 * 선택 판의 버튼(designer #239). 유형이 같으면 주 버튼 "내 입력으로 고치기"(연결이 없는 동안 비활성), 다르면 "새 거래로 저장"과
 * 그 위의 "저장된 거래는 그대로 남아요"다. 보조 버튼은 늘 "저장된 내용 그대로"이고 처음 초점이 간다(되돌리기 어려운 쪽이 주 버튼).
 * 저장된 거래가 그사이 휴지통으로 갔으면 주 버튼을 숨긴다. 실패한 뒤의 주 버튼은 "다시 시도"다.
 */
function ChoiceContent({ choice, mineType, busy, online, onKeep, onFix, onSaveAsNew, children }: ChoiceContentProps) {
  const { current, failure, redraws } = choice
  const sameType = current.type === mineType
  const again = failure ? '다시 시도' : undefined
  const action =
    current.deletedAt !== null
      ? undefined
      : sameType
        ? { label: again ?? '내 입력으로 고치기', kind: 'primary' as const, onClick: onFix, disabled: !online }
        : { label: again ?? '새 거래로 저장', kind: 'primary' as const, onClick: onSaveAsNew }
  // 연결이 없어 누를 수 없는 이유는 실패 문구가 없을 때만 보인다. 유형이 다르면 먼저 저장된 거래가 남는다는 것을 알린다
  const notice = !action ? undefined : !sameType ? KEPT_NOTICE : !online && !failure ? SAVE_OFFLINE : undefined
  return (
    <ConflictPanel
      description={CHOICE_DESCRIPTION}
      closeLabel="저장된 내용 그대로"
      onCloseAction={onKeep}
      action={action}
      busy={busy}
      notice={notice}
      failure={failure}
      focus="close"
      redraws={redraws}
    >
      {children}
    </ConflictPanel>
  )
}

/** 저장 버튼, 실패 문구의 버튼("다시 시도", "새 거래로 저장"), 또는 선택 판의 주 버튼 */
type Sender = 'save' | 'message' | 'choice'

type Failure =
  /** 서버 오류, 지연, 연결 실패, 모르는 거부. 같은 id로 다시 보낸다 */
  | { kind: 'retry' }
  /**
   * 같은 id로 앞서 저장한 내 거래가 있는데 내용이 다르고(current 있는 409) current를 읽을 수 없다. 선택 판을 그릴 수 없어
   * 1A처럼 그 거래를 보러 가게만 한다
   */
  | { kind: 'saved-differently'; savedId: string }
  /** 그 id를 쓸 수 없다(current 없는 409). 새 id로 만든다 */
  | { kind: 'id-unusable' }
  /** 연결이 없는데 기기에 쌓지 못했다(저장소를 쓸 수 없음). "다시 시도"는 연결이 없는 동안 비활성이다 */
  | { kind: 'not-queued' }

/** 저장 위에 보일 실패. 칸에 보인 거부와 실패가 없으면 없다. */
function failureOf(error: Error): Failure | undefined {
  if (rejectedFields(error)) return undefined
  const conflict = idConflictOf(error)
  if (!conflict) return { kind: 'retry' }
  return conflict.savedId ? { kind: 'saved-differently', savedId: conflict.savedId } : { kind: 'id-unusable' }
}
