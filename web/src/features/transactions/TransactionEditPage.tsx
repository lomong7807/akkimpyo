import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { sessionUserId } from '../../api/session'
import { Button } from '../../components/Button'
import DialogFrame from '../../components/DialogFrame'
import FullScreenForm from '../../components/FullScreenForm'
import LoadFailure from '../../components/LoadFailure'
import RetryMessage from '../../components/RetryMessage'
import { useToast } from '../../components/ToastContext'
import { useGoBack } from '../../components/useGoBack'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import { today as todayOfDevice } from '../../lib/calendarDate'
import { isUuid } from '../../lib/uuid'
import { useAccounts } from '../accounts/useAccounts'
import { useCategories } from '../categories/useCategories'
import NotFoundPage from '../not-found/NotFoundPage'
import ConflictPanel, { ConflictCompare, DeletedElsewhere } from './ConflictPanel'
import { compareRows, reapplyMine, updatedTextOf } from './conflictValues'
import { isUncategorized } from './formDefaults'
import { nameBookOf, type NameBook } from './listedText'
import TransactionFields from './TransactionFields'
import {
  hasSameContent,
  savedTransactionValues,
  toTransactionUpdate,
  validateTransaction,
  type TransactionValues,
} from './transactionForm'
import TransactionFieldsSkeleton from './TransactionFieldsSkeleton'
import { rejectedFields } from './transactionRejection'
import { isInvalidState, isNotFound, staleVersionOf, type TransactionDetail } from './transactions'
import { useTransactionToEdit } from './useTransactionDetail'
import { useMoreFold, useTransactionForm } from './useTransactionForm'
import { useKeepDraft } from '../drafts/keepDraft'
import { useRestoredDraft } from '../drafts/restoreDraft'
import { editTransactionDraftOf } from './transactionDraft'
import { useUpdateTransaction } from './useUpdateTransaction'

/**
 * D-04 거래 수정(1A). 거래 상세(D-06)의 "수정"이 연다. 주소의 id가 UUID 모양이 아니면 요청하지 않고 찾을 수 없음(N-01)이다.
 * 칸과 검사는 새 입력(TransactionFields)과 같고, 유형은 바꿀 수 없으며(P-213) "더 보기"는 펼친 채 연다.
 * 다른 기기가 먼저 고쳤으면(409 STALE_VERSION과 최신 거래) 저장하지 않고 수정 충돌 안내(N-04, F-909) 판을 띄운다. 최신 거래가
 * 내가 보낸 값과 같으면(앞 저장이 들어간 경우) 저장에 성공한 것으로 본다(planner #239). 최신 거래가 오지 않았거나 읽을 수
 * 없으면 판을 그릴 수 없어 1A처럼 저장 위에 안내와 "최신 내용 보기"만 보인다. version은 맞는데 휴지통이면(INVALID_STATE)
 * 같은 자리에 문구와 "삭제된 거래 보기"만 보인다(planner·designer #102, #239 P3).
 * 연결 없음의 비활성 저장과 그 안내(#238), 숨긴 계좌의 도움말(1C), 결제한 사람(2단계)은 없다.
 */
export default function TransactionEditPage() {
  const { id } = useParams()
  if (!isUuid(id)) return <NotFoundPage />
  const lowered = id.toLowerCase()
  return <EditScreen key={lowered} id={lowered} />
}

/**
 * 연 때의 거래와 그 값. 연 뒤에 캐시가 바뀌어도(충돌의 최신 내용, 다시 받기) 칸과 보낼 version은 이것이다(P-217).
 * "내 입력 다시 적용"을 누르면 그때의 최신 거래가 된다(F-909).
 */
interface Opened {
  transaction: TransactionDetail
  values: TransactionValues
}

/** 계좌와 카테고리를 받은 뒤의 이름표와, 받은 거래를 칸의 값으로 바꾸는 것(충돌 판이 쓴다) */
interface Lists {
  names: NameBook
  valuesOf: (transaction: TransactionDetail) => TransactionValues
}

/**
 * 고칠 거래, 계좌, 카테고리를 함께 기다린다. 상세에서 받아 둔 거래가 있으면 다시 받지 않는다.
 * 없는 거래(404)와 휴지통의 거래는 찾을 수 없음이다(1A는 휴지통의 거래를 고치지 않는다). 저장하다 그사이 완전히 지워진 것(404)을
 * 알아도 같다. 저장하다 그사이 휴지통으로 간 것을 알면 화면에 남는다(EditForm).
 */
function EditScreen({ id }: { id: string }) {
  const transaction = useTransactionToEdit(id)
  const accounts = useAccounts()
  const categories = useCategories()
  const [opened, setOpened] = useState<Opened>()
  const [gone, setGone] = useState(false)
  const shown = opened?.transaction ?? transaction.data
  const lists = useMemo<Lists | undefined>(() => {
    if (!accounts.data || !categories.data) return undefined
    const list = categories.data
    return {
      names: nameBookOf(accounts.data, list),
      valuesOf: (saved) => savedTransactionValues(saved, (categoryId) => isUncategorized(list, categoryId)),
    }
  }, [accounts.data, categories.data])

  if (!opened && transaction.data && transaction.data.deletedAt === null && lists) {
    setOpened({ transaction: transaction.data, values: lists.valuesOf(transaction.data) })
  }

  // 없거나 다른 장부의 거래, 완전히 지운 거래는 서버가 구분하지 않고 404다(P-903)
  const missing = !transaction.data && isNotFound(transaction.error)
  if (gone || missing || (shown !== undefined && shown.deletedAt !== null)) return <NotFoundPage />

  return (
    <EditForm
      id={id}
      opened={opened}
      lists={lists}
      waiting={<Waiting queries={[transaction, accounts, categories]} />}
      onGone={() => setGone(true)}
      onRebase={setOpened}
    />
  )
}

interface EditFormProps {
  id: string
  /** 아직 받는 중이면 없다 */
  opened: Opened | undefined
  /** opened가 있으면 있다 */
  lists: Lists | undefined
  /** 받는 동안 칸 자리에 보이는 것 */
  waiting: ReactNode
  /** 저장하다 그사이 완전히 지워진 것(404)을 알았다 */
  onGone: () => void
  /** "내 입력 다시 적용": 최신 거래를 연 때의 거래로 삼는다. 다시 저장하면 그 version을 보낸다 */
  onRebase: (opened: Opened) => void
}

/** 충돌 판에 보이는 최신 거래. 다시 충돌할 때마다 redraws를 올린다 */
interface Conflict {
  current: TransactionDetail
  /** 판을 연 때의 기기의 오늘 */
  today: string
  redraws: number
}

/** "내 입력 다시 적용" 뒤 화면 이름 아래의 안내(D-04 상태, F-909) */
const REAPPLIED = '최신 내용에 내가 바꾼 항목을 다시 얹었어요. 확인하고 저장해 주세요.'

/**
 * 전체 화면 입력 하나가 받는 동안과 받은 뒤를 함께 그린다. 받은 뒤에 다시 그리면 화면이 아래에서 다시 올라오기 때문이다.
 * 받는 동안에는 저장 자리를 숨긴다(D-04 상태). 닫기·뒤로·Esc와 성공 뒤에는 앞 화면(상세)으로, 앞 화면이 없으면(주소로 바로 열면)
 * 방문 기록을 그 거래의 상세로 바꾼다. 상세 위에 상세를 쌓지 않는다.
 */
function EditForm({ id, opened, lists, waiting, onGone, onRebase }: EditFormProps) {
  const detailPath = `/transactions/${id}`
  const showToast = useToast()
  const goBack = useGoBack(detailPath)
  const updating = useUpdateTransaction(id)
  // 이 화면을 연 사용자(동작의 주인). 보내는 순간의 사용자(토큰의 sub)와 같은지 요청 계층이 본다(거래 입력과 같다).
  // 확인하지 못한 로그인이면 기록의 사용자이고, 같은 사용자로 확인돼야 보낸다(#234)
  const [user] = useState(sessionUserId)
  const form = useTransactionForm('')
  const [filled, setFilled] = useState(false)
  if (opened && !filled) {
    setFilled(true)
    form.reset(opened.values)
  }
  const { moreOpen, setMoreOpen, unfoldFor } = useMoreFold(true)
  // 로그인이 풀리면 쓰던 값과 연 때의 version을 이 기기에 남기고, 같은 계정으로 이 주소에 돌아오면 채운다(00-common 4.1, #234 C2).
  // 채웠으면 그 version으로 보내, 그사이 서버의 거래가 바뀌었으면 충돌(N-04)이 뜬다
  const [draftVersion, setDraftVersion] = useState<number>()
  const baseVersion = draftVersion ?? opened?.transaction.version
  useKeepDraft('transaction-edit', () =>
    baseVersion !== undefined && form.changed ? { version: baseVersion, values: form.values } : undefined,
  )
  useRestoredDraft(
    'transaction-edit',
    (saved) => {
      const draft = editTransactionDraftOf(saved)
      if (!draft) return
      setDraftVersion(draft.version)
      form.change(draft.values)
    },
    filled,
  )
  // 저장 위의 실패. 다시 보내는 동안에도 남기고, 실패마다 count를 올려 새로 그려 다시 읽히게 한다
  const [shown, setShown] = useState<{ failure: Failure; count: number }>()
  // 보내는 동안 도는 표시를 둘 버튼. 누른 버튼만 돈다(00-common 4.5)
  const [sender, setSender] = useState<Sender>('save')
  // 충돌 판(N-04). 닫히는 움직임 동안 내용이 남도록 열림을 따로 둔다
  const [conflict, setConflict] = useState<Conflict>()
  const [conflictOpen, setConflictOpen] = useState(false)
  const [reapplied, setReapplied] = useState(false)

  const busy = updating.isPending || updating.isSuccess
  const guard = useLeaveGuard({ parent: detailPath, changed: form.changed, busy })
  const failure = shown?.failure

  function submit(from: Sender = 'save') {
    if (busy || !opened) return
    // 바꾼 값이 없으면 보내지 않고 닫는다. 토스트도 없다
    if (!form.changed) return guard.leave(goBack)
    unfoldFor(validateTransaction(form.effective))
    if (!form.checkAll()) {
      updating.reset()
      setShown(undefined)
      return
    }
    // 칸의 글자는 달라도 보낼 값이 연 때와 같으면(앞뒤 공백 등) 바꾼 것이 없다
    if (hasSameContent(form.effective, opened.values)) return guard.leave(goBack)
    setSender(from)
    updating.mutate(
      { update: toTransactionUpdate(form.effective, baseVersion ?? opened.transaction.version), user },
      { onSuccess: finish, onError: showFailure },
    )
  }

  // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
  function finish() {
    showToast('저장했어요')
    guard.leaveAfterSave(goBack)
  }

  function showFailure(error: Error) {
    // 완전히 지웠거나 다른 장부의 거래(404)다. 고칠 거래가 없다
    if (isNotFound(error)) return onGone()
    const current = staleVersionOf(error, id)?.current
    if (current && lists) return showConflict(current, lists)
    const rejected = rejectedFields(error)
    if (rejected) {
      unfoldFor(rejected)
      form.reject(rejected)
    }
    const next = failureOf(error, id)
    setShown((last) => next && { failure: next, count: (last?.count ?? 0) + 1 })
  }

  /**
   * 다른 기기가 먼저 고쳤다(N-04). 최신 거래가 내가 보낸 값과 같으면 앞서 보낸 저장이 들어간 것이라 저장에 성공한 것으로 본다.
   * 비교는 고칠 수 있는 칸만으로 한다(planner #239). 아니면 저장 위의 실패를 지우고 판을 띄운다. 상세는 이미 최신 거래로
   * 바뀌어 있다(useUpdateTransaction).
   */
  function showConflict(current: TransactionDetail, { valuesOf }: Lists) {
    if (current.deletedAt === null && hasSameContent(form.effective, valuesOf(current))) return finish()
    setShown(undefined)
    setConflict((last) => ({ current, today: todayOfDevice(), redraws: (last?.redraws ?? 0) + 1 }))
    setConflictOpen(true)
  }

  /** (3) 최신 내용 위에 내가 바꾼 칸만 얹어 다시 채운다. 보내지 않는다. 다시 저장하면 최신 version을 보낸다(F-909). */
  function reapply() {
    if (!conflict || !opened || !lists) return
    const latest = lists.valuesOf(conflict.current)
    const merged = reapplyMine(opened.values, form.effective, latest)
    onRebase({ transaction: conflict.current, values: latest })
    // 이 기기에 남겼다 채운 입력의 version(#234 C2)이 아니라 최신 version으로 보낸다
    setDraftVersion(undefined)
    form.reset(latest, merged)
    setReapplied(true)
    setConflictOpen(false)
  }

  /** (4) 내 입력을 버리고 최신 거래의 상세(휴지통에 있으면 휴지통에서 연 상세)로 간다. 묻지 않는다(F-909). */
  function viewLatest() {
    guard.leave(goBack)
  }

  /**
   * 그 거래의 상세(최신 내용, 휴지통의 거래)를 보러 간다. 확인 창 없이 쓰던 입력을 버린다. 상세는 충돌 응답의 최신 거래로
   * 그린다(useUpdateTransaction). 새 탭이나 창으로 여는 누름은 브라우저에 맡긴다. 이 화면의 입력은 그대로 남는다.
   */
  function viewDetail(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    // 저장을 다시 보내는 중에는 떠나지 않는다. 요청이 어디까지 갔는지 모른다
    if (busy) return
    guard.leave(goBack)
  }

  const messageBusy = busy && sender === 'message'
  const saveBusy = busy && sender === 'save'

  return (
    <>
      <FullScreenForm
        title="거래 수정"
        guard={guard}
        onSubmit={submit}
        notice={reapplied ? REAPPLIED : undefined}
        submitShortcut
        bottom={
          filled ? (
            <>
              {/* 초점은 옮기지 않는다. 문구는 role="alert"로 읽힌다 */}
              {failure === 'retry' && (
                <RetryMessage
                  failures={shown?.count}
                  onRetry={() => submit('message')}
                  busy={messageBusy}
                  disabled={saveBusy}
                >
                  문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.
                </RetryMessage>
              )}
              {failure === 'conflict' && (
                <RetryMessage failures={shown?.count} to={detailPath} actionLabel="최신 내용 보기" onClick={viewDetail}>
                  다른 기기에서 먼저 고쳤어요
                </RetryMessage>
              )}
              {failure === 'deleted' && (
                <RetryMessage failures={shown?.count} to={detailPath} actionLabel="삭제된 거래 보기" onClick={viewDetail}>
                  {DELETED_MEANWHILE}
                </RetryMessage>
              )}
              <Button kind="primary" type="submit" busy={saveBusy} disabled={messageBusy}>
                저장
              </Button>
            </>
          ) : undefined
        }
      >
        {filled ? (
          <TransactionFields form={form} readOnly={busy} moreOpen={moreOpen} onMoreOpenChange={setMoreOpen} editing />
        ) : (
          waiting
        )}
      </FullScreenForm>
      {/* 판 바깥, 끌어내리기, X, Esc로 닫으면 내 입력을 그대로 둔다. 다시 저장하면 다시 충돌한다(N-04) */}
      <DialogFrame
        open={conflictOpen}
        title="다른 기기에서 먼저 고쳤어요"
        titleFocusable
        onClose={() => setConflictOpen(false)}
      >
        {conflict && lists && (
          <ConflictPanel
            description={updatedTextOf(conflict.current.updatedAt, conflict.today)}
            closeLabel="최신 내용 보기"
            onCloseAction={viewLatest}
            action={
              conflict.current.deletedAt === null ? { label: '내 입력 다시 적용', kind: 'primary', onClick: reapply } : undefined
            }
            redraws={conflict.redraws}
          >
            {conflict.current.deletedAt === null ? (
              <ConflictCompare
                latestLabel="최신 내용"
                rows={compareRows(lists.valuesOf(conflict.current), form.effective, lists.names, conflict.today)}
              />
            ) : (
              <DeletedElsewhere />
            )}
          </ConflictPanel>
        )}
      </DialogFrame>
    </>
  )
}

/** 저장 버튼, 또는 실패 문구의 "다시 시도" */
type Sender = 'save' | 'message'

type Failure =
  /** 서버 오류, 지연, 연결 실패, 모르는 거부(유형이 다르다는 400 포함). 같은 본문을 다시 보낸다 */
  | 'retry'
  /**
   * 다른 기기가 먼저 고쳤는데(409 STALE_VERSION) 최신 거래가 오지 않았거나 읽을 수 없다. 판을 그릴 수 없어 1A처럼
   * 최신 내용을 보러 가게만 한다(planner #239 P3)
   */
  | 'conflict'
  /**
   * version은 맞는데 휴지통에 있다(409 INVALID_STATE, planner·designer #102). 휴지통의 거래는 고칠 수 없어 그 거래를
   * 보러 가게만 한다
   */
  | 'deleted'

/** 그사이 휴지통으로 간 거래의 문구(planner 확정 #89) */
const DELETED_MEANWHILE = '그사이 삭제된 거래라 저장하지 못했어요'

/**
 * 저장 위에 보일 실패. 칸에 보인 거부면 없다. 최신 거래가 온 충돌은 판으로 보이므로(showConflict) 여기에 오지 않는다.
 */
function failureOf(error: Error, id: string): Failure | undefined {
  if (rejectedFields(error)) return undefined
  if (isInvalidState(error)) return 'deleted'
  return staleVersionOf(error, id) ? 'conflict' : 'retry'
}

interface Query {
  data: unknown
  isFetchedAfterMount: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
}

/** 받는 동안의 뼈대, 받지 못한 때의 "불러오지 못했어요."(F-904). 받아 둔 것은 다시 받지 않는다. */
function Waiting({ queries }: { queries: Query[] }) {
  // 다시 받는 동안에는 isError가 풀리므로 이 화면에서 받아 본 적이 있는지로 본다
  const failed = queries.filter((query) => !query.data && query.isFetchedAfterMount)
  if (failed.length > 0) {
    return (
      <LoadFailure
        headingLevel={2}
        busy={queries.some((query) => query.isFetching)}
        onRetry={() => failed.forEach((query) => void query.refetch())}
      />
    )
  }
  return <TransactionFieldsSkeleton />
}
