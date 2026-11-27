import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { sessionUserId } from '../../api/session'
import Amount from '../../components/Amount'
import { Button, ButtonLink } from '../../components/Button'
import ConfirmDialog, { type ConfirmFailure } from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import ErrorMessage from '../../components/ErrorMessage'
import { afterModals } from '../../components/openModal'
import { SubScreen } from '../../components/Screen'
import { focusScreenTitle } from '../../components/screenTitle'
import StatusChip from '../../components/StatusChip'
import { useToast } from '../../components/ToastContext'
import type { PendingTransaction } from '../../device/pendingQueue'
import { formatDate, today } from '../../lib/calendarDate'
import { accountsQuery } from '../accounts/useAccounts'
import { parseAccounts } from '../accounts/accounts'
import { categoriesQuery } from '../categories/useCategories'
import { parseCategories, type Category } from '../categories/categories'
import { useConnection } from '../connection/useConnection'
import { useLedgerCopy } from '../me/ledgerCopy'
import { ledgerScope } from '../me/ledgerKey'
import { useMeCopy } from '../me/meCopy'
import { useMe } from '../me/useMe'
import { onSendFinished, sendQueue, type SendResult } from '../sync/sendQueue'
import { resendNoticeText } from '../sync/useAutoSend'
import { NEVER_SYNCED, syncedMoment } from '../sync/syncedText'
import { useEveryMinute, useSyncedAt } from '../sync/useSyncState'
import { detailOf, nameBookOf, titleOf, type NameBook } from '../transactions/listedText'
import { pendingRow, usePendingRead } from '../transactions/pendingTransactions'
import { discardPending } from './discardPending'
import { fixOpeningOf } from './fixOpening'
import { rejectionText } from './rejectionText'
import styles from './Pending.module.css'

/*
 * B-05 보내지 않은 입력 목록(화면설계서 00-common 6.6, F-106, F-107, F-109, P-226, #236). 이 기기에서 이 계정이 쌓은 입력을
 * 모든 장부에서 오래된 순으로 보인다. 기기 데이터라 뼈대 없이 바로 그린다. 연결이 없어도 목록이 보이고 버릴 수 있다.
 * 보낼 수 없음 줄은 "고쳐서 보내기"와 줄 누르기로 그 입력을 채운 거래 입력을 연다(F-108, #237, PendingFixPage). current가 있는
 * 409 줄은 그 자리에 #280의 "비교해서 고르기"가 들어오므로 그때까지 "버리기"만 있다(designer #102).
 */

/** 데이터 없음(F-106). 모두 보냈다는 뜻이라 권할 동작이 없어 버튼을 두지 않는다(작성자 판단 65) */
export const NOTHING_LEFT = '보낼 입력이 없어요. 모두 보냈어요.'
export const CONNECTION_LOST = (count: number) => `연결이 끊겨 ${count}건을 보내지 못했어요. 연결되면 자동으로 보낼게요.`
export const SEND_TROUBLE = '문제가 생겨 보내지 못했어요. 잠시 후 다시 시도해 주세요.'
export const DISCARDED = '입력을 버렸어요'
/** 버리기를 기다리는 사이 그 입력이 보내져 이미 저장됐다(designer #236 Q6) */
export const ALREADY_SENT = '이미 보내서 버리지 못했어요. 내역에서 확인해 주세요.'
/** 다른 탭이 보내기를 쥔 채 놓지 않았거나 기기 저장소를 쓸 수 없다(designer #236 Q7) */
export const DISCARD_TROUBLE = '문제가 생겨 버리지 못했어요. 잠시 후 다시 시도해 주세요.'

const typeNames = { EXPENSE: '지출', INCOME: '수입', TRANSFER: '이체' } as const
const amountKinds = { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer' } as const

export default function PendingPage() {
  return (
    <SubScreen title="보내지 않은 입력" parent="/more">
      <PendingList />
    </SubScreen>
  )
}

function PendingList() {
  const items = usePendingRead()
  const sending = useSendNow()
  const [discarding, setDiscarding] = useState<PendingTransaction>()
  const discardButtons = useRef(new Map<string, HTMLButtonElement>())
  const waiting = items?.filter(({ state }) => state.kind === 'waiting').length ?? 0
  const { clearProblem } = sending
  // 대기가 0건이 되면 버튼 위 문구도 지운다(designer #236 Q4). 다시 쌓여도 앞의 문구가 되살아나지 않는다
  useEffect(() => {
    if (items && waiting === 0) clearProblem()
  }, [items, waiting, clearProblem])

  return (
    <>
      <SyncedLine />
      {sending.problem && waiting > 0 && (
        <div className={styles.problem}>
          <ErrorMessage role="alert">{sending.problem}</ErrorMessage>
        </div>
      )}
      {waiting > 0 && <SendNowButton busy={sending.busy} onSend={sending.send} />}
      <p role="status" className={styles.spoken}>
        {sending.announcement}
      </p>
      {items &&
        (items.length === 0 ? (
          <EmptyState description={NOTHING_LEFT} />
        ) : (
          // Safari는 점을 없앤 목록을 목록으로 알리지 않으므로 role을 적는다
          <ul role="list" className={styles.rows}>
            {items.map((item) => (
              <PendingRow
                key={item.id}
                item={item}
                busy={sending.busy}
                discardRef={(button) => {
                  if (button) discardButtons.current.set(item.id, button)
                  else discardButtons.current.delete(item.id)
                }}
                onDiscard={() => setDiscarding(item)}
              />
            ))}
          </ul>
        ))}
      <DiscardDialog
        item={discarding}
        onClose={() => setDiscarding(undefined)}
        onDiscarded={(id) => {
          // 지운 줄의 버리기가 없어지므로 창이 닫힌 뒤 다음 줄(없으면 앞 줄)의 버리기로, 마지막 줄이었으면 화면 제목으로
          // 초점을 옮긴다(designer #236)
          const ids = items?.map((item) => item.id) ?? []
          const index = ids.indexOf(id)
          const neighbor = ids[index + 1] ?? ids[index - 1]
          afterModals(() => {
            const button = neighbor === undefined ? undefined : discardButtons.current.get(neighbor)
            if (button) button.focus()
            else focusScreenTitle()
          })
        }}
      />
    </>
  )
}

/** (1) 마지막으로 맞춘 시각. 열어 둔 채 자정이 지나면 날짜를 붙인다. 읽기 전이나 읽지 못하면 그리지 않는다 */
function SyncedLine() {
  const syncedAt = useSyncedAt()
  useEveryMinute()
  if (syncedAt === undefined) return null
  return (
    <p className={styles.synced}>
      {syncedAt === null ? NEVER_SYNCED : `마지막으로 맞춘 시각 ${syncedMoment(syncedAt)}`}
    </p>
  )
}

/** (2) 지금 보내기. 연결이 없으면 비활성이고 까닭은 연결 없음 띠가 알린다(F-107, 5.1) */
function SendNowButton({ busy, onSend }: { busy: boolean; onSend: () => void }) {
  const offline = useConnection() === 'offline'
  return (
    <div className={styles.sendNow}>
      <Button kind="primary" busy={busy} disabled={offline} onClick={onSend}>
        지금 보내기
      </Button>
    </div>
  )
}

interface Sending {
  busy: boolean
  /** 버튼 위의 문구(보내던 중 연결이 끊김, 서버 오류·지연). 다음 보내기가 끝나면 그 결과로 바뀐다 */
  problem?: string
  /** 저절로 보낸 건수를 화면 읽기에 알리는 글 */
  announcement: string
  send: () => void
  clearProblem: () => void
}

/**
 * 지금 보내기(F-107). 보내기와 응답 처리는 저절로 보내기와 같은 sendQueue다(#235). 다른 탭이 보내는 중이면 끝나기를 기다린다.
 * 보낸 줄은 대기열이 바뀔 때마다 목록에서 움직임 없이 사라진다. 이 탭의 보내기가 끝날 때마다(저절로 보내기 포함) 버튼 위 문구를
 * 그 결과로 바꾸고, 저절로 보낸 건수는 화면 읽기에 알린다. 지금 보내기의 건수는 토스트(role="status")가 알린다.
 */
function useSendNow(): Sending {
  const queryClient = useQueryClient()
  const showToast = useToast()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [announcement, setAnnouncement] = useState('')

  useEffect(
    () =>
      onSendFinished((result, byUser) => {
        setProblem(problemOf(result))
        if (!byUser && result.sent > 0) setAnnouncement(`${result.sent}건을 보냈어요`)
      }),
    [],
  )

  async function send() {
    setBusy(true)
    setProblem(undefined)
    setAnnouncement('')
    const onSent = (ledgerId: string) => void queryClient.invalidateQueries({ queryKey: ledgerScope(ledgerId) })
    const result = await sendQueue({ onSent, byUser: true })
    setBusy(false)
    const done = doneText(result)
    if (done) showToast(done)
    // 200 알림은 저절로 보내기와 같다(designer #235 Q1). 결과 토스트가 끝난 뒤에 보인다
    if (result.noticed > 0) showToast(resendNoticeText(result.noticed), undefined, { afterShown: true })
  }

  const clearProblem = useCallback(() => setProblem(undefined), [])
  return { busy, problem, announcement, send: () => void send(), clearProblem }
}

function problemOf({ stopped, unsent }: SendResult): string | undefined {
  if (stopped === 'connection') return CONNECTION_LOST(unsent)
  return stopped === 'trouble' ? SEND_TROUBLE : undefined
}

/** 끝난 뒤의 토스트(B-05 (2), designer #236 Q1·Q2). 보낸 것도 거부된 것도 없으면 없다 */
function doneText({ sent, rejected }: SendResult): string | undefined {
  if (sent > 0) return rejected > 0 ? `${sent}건을 보냈고 ${rejected}건은 보낼 수 없어요` : `${sent}건을 보냈어요`
  return rejected > 0 ? `${rejected}건은 보낼 수 없어요` : undefined
}

interface PendingRowProps {
  item: PendingTransaction
  /** 지금 보내기 처리 중. 버리기를 누를 수 없다(designer #236 Q5) */
  busy: boolean
  /** 버리기 버튼. 앞 줄을 버린 뒤 초점을 받는다 */
  discardRef: (button: HTMLButtonElement | null) => void
  onDiscard: () => void
}

/** 고쳐서 보내기로 여는 거래 입력의 주소(planner #237 P1) */
function fixPathOf(id: string): string {
  return `/pending/${id}/edit`
}

/**
 * (3) 입력 줄. 첫 줄은 "{장부 이름} · {날짜} · {유형}", 둘째 줄은 가맹점/내용(비었으면 카테고리 이름)과 금액, 이체는 "이체"와 그
 * 아래 "{보내는 계좌}에서 {받는 계좌}로". 셋째 줄은 상태 칩(4)과 오른쪽의 고쳐서 보내기(7)·버리기(5), 보낼 수 없음이면 그 아래
 * 거부 이유(6). 고칠 수 있는 보낼 수 없음 줄은 줄 전체를 눌러도 고쳐서 보내기와 같다(F-108). 키보드는 고쳐서 보내기 버튼으로
 * 하므로 줄은 초점을 받지 않는다(designer #237 D5). 대기 줄과 current가 있는 409 줄(#280)은 누를 수 없다.
 * 지금 보내기 처리 중에는 버리기처럼 고쳐서 보내기와 줄 누르기도 막는다(designer #237 D5).
 */
function PendingRow({ item, busy, discardRef, onDiscard }: PendingRowProps) {
  const id = useId()
  const navigate = useNavigate()
  const { names, categories } = useNameBook(item.ledgerId)
  const ledgerName = useLedgerName(item.ledgerId)
  // 카테고리를 비운 입력은 그 장부의 미분류다(제목 "미분류")
  const shown = useMemo(() => pendingRow(item, categories), [item, categories])
  const { type } = item.body
  const date = shown && formatDate(shown.occurredOn, today())
  const title = shown ? titleOf(shown, names) : payeeOf(item)
  const transfer = shown?.type === 'TRANSFER' ? detailOf(shown, names) : undefined
  const meta = [ledgerName, date, typeNames[type]].filter(Boolean).join(' · ')
  const rejected = item.state.kind === 'rejected' ? item.state : undefined
  const fixable = useMemo(() => fixOpeningOf(item) !== undefined, [item])
  const describedBy = `${id}-title ${shown ? `${id}-amount ` : ''}${id}-meta`

  /** 줄 안의 버튼과 링크는 스스로 동작한다. 그 밖의 자리를 누르면 고쳐서 보내기와 같다 */
  function pressRow(event: MouseEvent<HTMLLIElement>) {
    if (busy || (event.target as Element).closest('a, button')) return
    navigate(fixPathOf(item.id))
  }

  const className = [styles.row, fixable && styles.fixable, fixable && !busy && styles.pressable].filter(Boolean).join(' ')
  return (
    <li className={className} onClick={fixable ? pressRow : undefined}>
      <p id={`${id}-meta`} className={styles.meta}>
        {meta}
      </p>
      <p className={styles.main}>
        <span id={`${id}-title`} className={styles.title}>
          {title}
        </span>
        {shown && (
          <span id={`${id}-amount`} className={styles.amount}>
            <Amount kind={amountKinds[shown.type]} value={shown.amount} />
          </span>
        )}
      </p>
      {transfer && <p className={styles.meta}>{transfer}</p>}
      <div className={styles.status}>
        {rejected ? <StatusChip danger>보낼 수 없음</StatusChip> : <StatusChip>대기</StatusChip>}
        <span className={styles.actions}>
          {fixable && (
            <ButtonLink
              kind="text"
              to={fixPathOf(item.id)}
              aria-describedby={describedBy}
              aria-disabled={busy || undefined}
              onClick={busy ? ignoreWhileBusy : undefined}
            >
              고쳐서 보내기
            </ButtonLink>
          )}
          <Button ref={discardRef} kind="text-danger" disabled={busy} aria-describedby={describedBy} onClick={onDiscard}>
            버리기
          </Button>
        </span>
      </div>
      {rejected && <p className={styles.reason}>{rejectionText(rejected)}</p>}
    </li>
  )
}

/** 지금 보내기 처리 중의 고쳐서 보내기. 링크라 비활성이 없어 누름을 막는다 */
function ignoreWhileBusy(event: MouseEvent) {
  event.preventDefault()
}

/** 목록에 보일 수 없는 본문(약속과 다름)이어도 버릴 수 있게 줄은 둔다. 그때의 제목 */
function payeeOf({ body }: PendingTransaction): string {
  return typeof body.payee === 'string' ? body.payee : ''
}

/**
 * 그 장부의 계좌·카테고리 이름. 이 탭이 받아 둔 목록이 있으면 그것을, 없으면 기기 사본을 쓴다. 쌓은 입력은 이 기기가 그때 본
 * 계좌·카테고리로 만든 것이라 보통 사본에 있다. 사본도 없을 때만(30일이 지나 지워짐 등) 서버에서 받는다. 받지 못하면 이름 없이 그린다.
 */
function useNameBook(ledgerId: string): { names: NameBook; categories: Category[] } {
  // 사본은 받은 시각과 함께 온다(#238). 여기서는 값만 쓴다. 읽는 중이면 undefined, 없으면 null이다
  const accountsCopy = useLedgerCopy(ledgerId, 'accounts', parseAccounts).data
  const categoriesCopy = useLedgerCopy(ledgerId, 'categories', parseCategories).data
  const accounts = useQuery({ ...accountsQuery(ledgerId), enabled: accountsCopy === null }).data
  const categories = useQuery({ ...categoriesQuery(ledgerId), enabled: categoriesCopy === null }).data
  return useMemo(() => {
    const shownCategories = categories ?? categoriesCopy?.value ?? NO_CATEGORIES
    return { names: nameBookOf(accounts ?? accountsCopy?.value ?? [], shownCategories), categories: shownCategories }
  }, [accounts, accountsCopy, categories, categoriesCopy])
}

const NO_CATEGORIES: Category[] = []

/** 장부 이름. 이 탭이 받은 내 정보가 있으면 그것을, 없으면 기기 사본을 쓴다. 목록에 없는 장부면 없다 */
function useLedgerName(ledgerId: string): string | undefined {
  const me = useMe({ enabled: false }).data
  const copy = useMeCopy(sessionUserId()).data
  return (me ?? copy ?? undefined)?.ledgers.find(({ id }) => id === ledgerId)?.name
}

/** (5)의 확인 창. 기기 안의 동작이라 연결과 관계없이 열리고 실행된다(F-109, 4.6) */
interface DiscardDialogProps {
  item: PendingTransaction | undefined
  onClose: () => void
  /** 지웠다(그사이 보내져 없던 것도). 줄의 id다 */
  onDiscarded: (id: string) => void
}

function DiscardDialog({ item, onClose, onDiscarded }: DiscardDialogProps) {
  const showToast = useToast()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ConfirmFailure>()

  function close() {
    setFailure(undefined)
    onClose()
  }

  async function discard(target: PendingTransaction) {
    setBusy(true)
    try {
      const outcome = await discardPending(target.userId, target.id)
      onDiscarded(target.id)
      close()
      showToast(outcome === 'discarded' ? DISCARDED : ALREADY_SENT)
    } catch {
      setFailure({ message: DISCARD_TROUBLE, focus: 'action' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open={item !== undefined}
      title="이 입력을 버릴까요?"
      description="서버에 저장되지 않고 이 기기에서 사라져요"
      closeLabel="닫기"
      actionLabel={failure ? '다시 시도' : '버리기'}
      busy={busy}
      failure={failure}
      onClose={close}
      onAction={() => item && void discard(item)}
    />
  )
}
