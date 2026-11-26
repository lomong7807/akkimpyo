import { useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { ApiError } from '../../api/apiError'
import { sessionUserId } from '../../api/session'
import Amount from '../../components/Amount'
import { Button, ButtonLink } from '../../components/Button'
import { ConfirmQuestion, type ConfirmFailure } from '../../components/ConfirmDialog'
import DialogFrame from '../../components/DialogFrame'
import LoadFailure from '../../components/LoadFailure'
import Notice from '../../components/Notice'
import { SubScreen } from '../../components/Screen'
import { LoadingStatus, SkeletonSpace } from '../../components/Skeleton'
import { useGoBack } from '../../components/useGoBack'
import { useLoadingMessage } from '../../components/useLoadingMessage'
import { formatDate, today as todayOfDevice } from '../../lib/calendarDate'
import { now } from '../../lib/clock'
import { isUuid } from '../../lib/uuid'
import { useAccounts } from '../accounts/useAccounts'
import { useCategories } from '../categories/useCategories'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useConnection } from '../connection/useConnection'
import { canEdit } from '../me/me'
import NotFoundPage from '../not-found/NotFoundPage'
import ConflictPanel, { AgainQuestion, LatestRow, type PanelFailure } from './ConflictPanel'
import { updatedTextOf } from './conflictValues'
import { nameBookOf, titleOf, type NameBook } from './listedText'
import { DetailSkeleton, FieldsSkeleton } from './TransactionDetailSkeleton'
import { purgeNoticeOf } from './purgeNotice'
import { isConnectionLoss } from './pendingTransactions'
import { isInvalidState, staleVersionOf, type ListedTransaction, type TransactionDetail } from './transactions'
import { useDeleteTransaction, useOfferUndo } from './useDeleteTransaction'
import { useListedTransaction, useTransactionDetail } from './useTransactionDetail'
import styles from './TransactionDetail.module.css'

/** 앞서 본 화면이 없을 때(주소를 바로 연 경우) "뒤로"와 삭제 뒤에 가는 곳 */
const PARENT = '/transactions'

const typeNames = { EXPENSE: '지출', INCOME: '수입', TRANSFER: '이체' } as const
const amountKinds = { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer' } as const
const statusNames = { POSTED: '완료', CANCELED: '취소', PENDING: '승인 대기' } as const

/**
 * D-06 거래 상세(1A). 주소의 id가 UUID 모양이 아니면 요청하지 않고 찾을 수 없음(N-01)을 보인다.
 * 1A에는 승인취소, 변경 이력, 이벤트·결제한 사람(2단계), 넓은 화면의 오른쪽 칸이 없다.
 */
export default function TransactionDetailPage() {
  const { id } = useParams()
  if (!isUuid(id)) return <NotFoundPage />
  const lowered = id.toLowerCase()
  return <TransactionScreen key={lowered} id={lowered} />
}

/** 거래, 계좌, 카테고리를 함께 기다린다. 계좌와 카테고리 이름은 목록으로 바꾼다(내역과 같다). */
function TransactionScreen({ id }: { id: string }) {
  const ledger = useCurrentLedger()
  const detail = useTransactionDetail(id)
  const accounts = useAccounts()
  const categories = useCategories()
  const listed = useListedTransaction(id)
  const [today] = useState(todayOfDevice)
  const names = useMemo(
    () => accounts.data && categories.data && nameBookOf(accounts.data, categories.data),
    [accounts.data, categories.data],
  )

  // (1) 수정은 편집 이상에게만 보이고 휴지통의 거래에는 없다. 휴지통에 있는지 알아야 하므로 거래를 받은 뒤에 보인다
  const editable = detail.data !== undefined && detail.data.deletedAt === null && canEdit(ledger)

  // 없거나 다른 장부의 거래, 완전히 지운 거래는 서버가 구분하지 않고 404다(P-903)
  if (!detail.data && detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />

  return (
    <SubScreen title="거래 상세" parent={PARENT} action={editable ? <EditLink id={id} /> : undefined}>
      {detail.data && names ? (
        <DetailContent transaction={detail.data} names={names} today={today} />
      ) : (
        <Waiting queries={[detail, accounts, categories]} listed={listed} names={names} today={today} />
      )}
    </SubScreen>
  )
}

interface Query {
  data: unknown
  isFetchedAfterMount: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
}

interface WaitingProps {
  queries: Query[]
  listed: ListedTransaction | undefined
  names: NameBook | undefined
  today: string
}

/** 불러오는 중이거나 불러오지 못한 때 */
function Waiting({ queries, listed, names, today }: WaitingProps) {
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
  return listed ? <ListedSkeleton listed={listed} names={names} today={today} /> : <DetailSkeleton />
}

interface DetailContentProps {
  transaction: TransactionDetail
  names: NameBook
  today: string
}

function DetailContent({ transaction, names, today }: DetailContentProps) {
  const ledger = useCurrentLedger()
  // 안내 띠의 남은 날은 화면을 연 때로 센다
  const [openedAt] = useState(now)
  const deleted = transaction.deletedAt !== null
  return (
    <>
      {transaction.purgeAt !== null && (
        <div className={styles.notice}>
          <Notice>{purgeNoticeOf(transaction.purgeAt, openedAt)}</Notice>
        </div>
      )}
      <div className={styles.detail}>
        <Summary transaction={transaction} names={names} />
        <dl className={styles.list}>
          <Fields transaction={transaction} names={names} today={today} />
        </dl>
        {/* 휴지통에서 연 거래(1A는 주소로 연 것)에는 버튼이 없다. 복원과 완전히 지우기는 1C다 */}
        {!deleted && canEdit(ledger) && <DeleteAction transaction={transaction} names={names} />}
      </div>
    </>
  )
}

/** (1) 수정. 상단 바 오른쪽 끝의 글자 버튼이고(계좌 G-01의 "추가"와 같다) 거래 수정(D-04)을 연다(F-208). */
function EditLink({ id }: { id: string }) {
  return (
    <ButtonLink kind="text" to={`/transactions/${id}/edit`}>
      수정
    </ButtonLink>
  )
}

/** (2) 유형과 금액, (3) 가맹점/내용(비면 카테고리 이름, 이체는 줄이 없다). 이름을 아직 모르면 가맹점만 보인다. */
function Summary({ transaction, names }: { transaction: ListedTransaction; names: NameBook | undefined }) {
  const { type, amount, status } = transaction
  return (
    <div className={styles.summary}>
      <p className={styles.head}>
        <span className={styles.type}>{typeNames[type]}</span>
        <span className={styles.amount}>
          <Amount kind={amountKinds[type]} value={amount} canceled={status === 'CANCELED'} />
        </span>
      </p>
      {transaction.type !== 'TRANSFER' && (
        <p className={styles.payee}>{names ? titleOf(transaction, names) : (transaction.payee ?? '')}</p>
      )}
    </div>
  )
}

/** (4)~(10) 항목 줄. 1A에는 승인취소, 이벤트, 결제한 사람이 없다. */
function Fields({ transaction, names, today }: DetailContentProps) {
  return (
    <>
      <Field name="날짜·시각" value={dateTimeOf(transaction, today)} />
      {transaction.type === 'TRANSFER' ? (
        <>
          <Field name="보내는 계좌" value={names.account(transaction.fromAccountId) ?? ''} />
          <Field name="받는 계좌" value={names.account(transaction.toAccountId) ?? ''} />
        </>
      ) : (
        <>
          <Field name="카테고리" value={names.categoryWithParent(transaction.categoryId) ?? ''} />
          <Field
            name={transaction.type === 'INCOME' ? '들어온 계좌' : '계좌'}
            value={names.account(transaction.accountId) ?? ''}
          />
        </>
      )}
      {transaction.memo && <Field name="메모" value={transaction.memo} memo />}
      <Field name="상태" value={statusNames[transaction.status]} />
      <Field name="작성자" value={transaction.createdBy?.displayName ?? '탈퇴한 사용자'} />
    </>
  )
}

/** 이름은 줄지 않는 한 줄, 값은 오른쪽 정렬이고 값만 줄을 바꾼다. 메모는 이름 아래에 왼쪽 정렬로 줄바꿈 그대로다. */
function Field({ name, value, memo = false }: { name: string; value: string; memo?: boolean }) {
  return (
    <div className={memo ? `${styles.item} ${styles.memo}` : styles.item}>
      <dt className={styles.name}>{name}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  )
}

/** `11월 18일 (수) 12:30`, 시각이 없으면 `11월 18일 (수) · 시각 없음`. 다른 해는 날짜에 연도를 붙인다(3.2). */
function dateTimeOf({ occurredOn, occurredTime }: ListedTransaction, today: string): string {
  return `${formatDate(occurredOn, today)}${occurredTime === null ? ' · 시각 없음' : ` ${occurredTime}`}`
}

/** 목록에서 들어온 때: 목록에 있던 유형, 금액, 가맹점, 날짜를 먼저 보이고 나머지 항목만 뼈대다. */
function ListedSkeleton({ listed, names, today }: { listed: ListedTransaction; names: NameBook | undefined; today: string }) {
  const message = useLoadingMessage()
  return (
    <>
      <LoadingStatus message={message} />
      <div className={styles.detail}>
        <Summary transaction={listed} names={names} />
        <dl className={styles.list}>
          <Field name="날짜·시각" value={dateTimeOf(listed, today)} />
        </dl>
        <SkeletonSpace shown={message !== undefined}>
          <FieldsSkeleton count={4} />
        </SkeletonSpace>
      </div>
    </>
  )
}

const failedToDelete = '문제가 생겨 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.'
/** 최신 거래가 오지 않은 충돌(1A와 같다). 판(N-04)을 그릴 수 없어 확인 창의 오류 자리에 제목을 쓴다 */
const conflict = '다른 기기에서 먼저 고쳤어요'

/** N-04 다른 동작 판의 문구(01 화면설계서 N-04 예외 처리) */
const againOffline = '연결되면 다시 할 수 있어요'
const againLost = '연결이 끊겨 다시 하지 못했어요. 연결되면 다시 시도해 주세요.'
const againFailed = '문제가 생겨 다시 하지 못했어요. 잠시 후 다시 시도해 주세요.'

/** 실패와 그때의 실행 버튼 글자. 실패마다 새로 만들어 같은 문구여도 다시 알린다. */
interface DeleteFailure {
  failure: ConfirmFailure
  actionLabel: string
}

/** 다른 동작 판(N-04 (5)~(8))에 보이는 최신 거래와 그 판의 실패 */
interface DeleteConflict {
  current: TransactionDetail
  /** 판을 연 때의 기기의 오늘 */
  today: string
  /** 새 최신 내용으로 다시 그린 횟수 */
  redraws: number
  failure?: PanelFailure
}

interface DeleteActionProps {
  transaction: TransactionDetail
  names: NameBook
}

/**
 * (21) 삭제. 편집 이상에게만 보인다. 누르면 확인 창을 열고, 실행하면 이 화면이 본 version으로 한 번 보낸다.
 * 성공하면 앞 화면(없으면 내역)으로 돌아가 "휴지통으로 옮겼어요"와 "되돌리기"를 보인다. 창이 닫힌 뒤에 알린다.
 * 실패하면 창이 남고 버튼 위에 문구, 실행 버튼은 "다시 시도"다(00-common 5.6, 4.3).
 * 다른 기기가 먼저 고쳤으면(최신 거래가 온 409 STALE_VERSION) 확인 창이 그 자리에서 N-04의 다른 동작 판으로 바뀌고,
 * 화면은 최신 내용으로 그린다. 최신 거래가 오지 않았으면 1A처럼 창 안에 "다른 기기에서 먼저 고쳤어요"와 "다시 하기"다.
 * 다른 기기가 이미 지웠거나 상태가 맞지 않으면 창을 닫고 최신 상태(휴지통의 거래)로 그린다.
 */
function DeleteAction({ transaction, names }: DeleteActionProps) {
  const deletion = useDeleteTransaction(transaction.id)
  const offerUndo = useOfferUndo()
  const goBack = useGoBack(PARENT)
  const online = useConnection() === 'online'
  // 이 화면을 연 사용자(동작의 주인). 보내는 순간의 사용자(토큰의 sub)와 같은지 요청 계층이 본다(거래 입력과 같다).
  // 확인하지 못한 로그인이면 기록의 사용자이고, 같은 사용자로 확인돼야 보낸다(#234)
  const [user] = useState(sessionUserId)
  const [asking, setAsking] = useState(false)
  // 연 횟수. 열 때마다 확인 창의 내용을 새로 그린다
  const [openings, setOpenings] = useState(0)
  const [failed, setFailed] = useState<DeleteFailure>()
  const [stale, setStale] = useState<DeleteConflict>()
  // 상태가 바뀌어 그려지기 전에 또 눌러도 요청은 하나다
  const sending = useRef(false)
  const busy = deletion.isPending || deletion.isSuccess

  function ask() {
    deletion.reset()
    setFailed(undefined)
    setStale(undefined)
    setOpenings((count) => count + 1)
    setAsking(true)
  }

  /** `version`으로 삭제를 보낸다. 확인 창의 실행과 판의 "다시 하기"가 같이 쓴다 */
  function send(version: number) {
    if (sending.current) return
    sending.current = true
    deletion.mutate(
      { version, user },
      {
        // 화면을 떠난 뒤에 온 응답으로는 불리지 않는다
        onSuccess: (deleted) => {
          offerUndo(deleted, user)
          goBack()
        },
        onError: (error) => {
          sending.current = false
          showFailure(error)
        },
      },
    )
  }

  function showFailure(error: Error) {
    const latest = staleVersionOf(error, transaction.id)
    const current = latest?.current
    // 다른 기기가 이미 지웠거나 상태가 맞지 않다. 화면은 최신 상태(휴지통의 거래)로 그린다
    if ((current && current.deletedAt !== null) || isInvalidState(error)) return setAsking(false)
    if (current) {
      setStale((last) => ({ current, today: todayOfDevice(), redraws: (last?.redraws ?? 0) + 1 }))
      return
    }
    // 판에서 다시 한 것이 최신 거래 없이 충돌했다. 화면이 최신을 다시 받으므로 판을 닫는다
    if (latest && stale) return setAsking(false)
    if (latest) {
      setFailed({ failure: { message: conflict, focus: 'close' }, actionLabel: '다시 하기' })
      return
    }
    if (stale) {
      const message = isConnectionLoss(error) ? againLost : againFailed
      setStale({ ...stale, failure: { message, count: (stale.failure?.count ?? 0) + 1 } })
      return
    }
    setFailed({ failure: { message: failedToDelete, focus: 'action' }, actionLabel: '다시 시도' })
  }

  // 판의 (7). 실패한 뒤에는 "다시 시도"이고 연결이 없는 동안은 누를 수 없다
  const againLabel = stale?.failure ? '다시 시도' : '다시 하기'
  const againNotice = !online && !stale?.failure ? againOffline : undefined

  return (
    <>
      <div className={styles.deleteSlot}>
        <Button kind="text-danger" onClick={ask}>
          삭제
        </Button>
      </div>
      <DialogFrame
        open={asking}
        title={stale ? conflict : '이 거래를 삭제할까요?'}
        busy={busy}
        titleFocusable={stale !== undefined}
        onClose={() => setAsking(false)}
      >
        {stale ? (
          <ConflictPanel
            description={updatedTextOf(stale.current.updatedAt, stale.today)}
            closeLabel="닫기"
            onCloseAction={() => setAsking(false)}
            action={{ label: againLabel, kind: 'danger', onClick: () => send(stale.current.version), disabled: !online }}
            busy={busy}
            notice={againNotice}
            failure={stale.failure}
            redraws={stale.redraws}
          >
            <LatestRow transaction={stale.current} names={names} today={stale.today} />
            <AgainQuestion>그래도 삭제할까요?</AgainQuestion>
          </ConflictPanel>
        ) : (
          <ConfirmQuestion
            key={openings}
            description="휴지통으로 옮겨요. 30일 안에 복원할 수 있어요."
            closeLabel="닫기"
            actionLabel={failed?.actionLabel ?? '삭제'}
            busy={busy}
            failure={failed?.failure}
            onClose={() => setAsking(false)}
            onAction={() => send(transaction.version)}
          />
        )}
      </DialogFrame>
    </>
  )
}
