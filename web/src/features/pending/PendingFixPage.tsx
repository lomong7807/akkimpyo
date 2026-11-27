import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useState } from 'react'
import { useParams } from 'react-router'
import { connection } from '../../api/connection'
import { Button } from '../../components/Button'
import ErrorMessage from '../../components/ErrorMessage'
import FullScreenForm from '../../components/FullScreenForm'
import RetryMessage from '../../components/RetryMessage'
import { useToast } from '../../components/ToastContext'
import { useGoBack } from '../../components/useGoBack'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import { refilePending, type PendingTransaction } from '../../device/pendingQueue'
import { isUuid, uuidV7 } from '../../lib/uuid'
import { useKeepDraft } from '../drafts/useKeepDraft'
import { useRestoredDraft } from '../drafts/restoreDraft'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { ledgerScope } from '../me/ledgerKey'
import NotFoundPage from '../not-found/NotFoundPage'
import { sendQueue } from '../sync/sendQueue'
import { resendNoticeText } from '../sync/useAutoSend'
import { PENDING_PATH } from '../sync/useSyncState'
import { EntryCopiesContext } from '../transactions/entryLists'
import { rememberLastAccount } from '../transactions/lastAccount'
import { usePendingRead } from '../transactions/pendingTransactions'
import TransactionFields from '../transactions/TransactionFields'
import { fixTransactionDraftOf } from '../transactions/transactionDraft'
import { toNewTransaction, validateTransaction } from '../transactions/transactionForm'
import { useMoreFold, useTransactionForm } from '../transactions/useTransactionForm'
import { bandText, fixOpeningOf, type FixOpening } from './fixOpening'

/*
 * 보낼 수 없는 입력 고쳐서 다시 보내기(F-108, B-05 (7), D-04 (33), P-226, #237). 보내지 않은 입력 목록(B-05)의 "고쳐서 보내기"가
 * 그 입력을 채운 거래 입력(D-04, 화면 이름 "거래 입력")을 연다. 주소는 `/pending/{id}/edit`이다(planner #237 P1).
 * - 화면 이름 아래 위험색 띠 "보내지 못한 이유: {이유}"와 이유가 된 칸의 오류를 붙인 채 열고 첫 이유 칸으로 초점을 옮긴다
 * - 저장은 서버에 보내지 않고 그 줄을 고친 본문의 대기로 바꾼다(원래 순서 자리, refilePending). 그 뒤 목록으로 돌아가 토스트를
 *   보이고, 연결이 있으면 저절로 보내기와 같은 보내기를 바로 한다(designer #237 D6, architect #237 A2). 중복 경고는 하지 않는다
 * - 거래 id는 그대로다. current 없는 409만 그 id를 쓸 수 없어 새 id로 보낸다(ADR 006 결정 3, architect #237 A1)
 * - 1B 임시: 넓은 화면에서도 오른쪽 칸 없이 한 칸으로 연다(#244에서 맞춘다). 장부 고르기(D-04 (32))는 2단계다
 */

/** 저장한 뒤의 토스트(D-04 상태 "성공 뒤") */
export const FIXED = '고쳐서 다시 보낼게요'
/** 그사이 다른 탭이 버렸거나 먼저 고쳐 보낸 입력(designer #237 D7) */
export const CHANGED_ELSEWHERE = '다른 곳에서 먼저 바뀐 입력이에요. 목록에서 확인해 주세요.'
/** 기기 저장소를 쓸 수 없어 고친 값을 넣지 못했다(designer #237 D8, D-04 서버 오류와 같은 문구) */
const SAVE_TROUBLE = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'

/** 주소의 id가 UUID 모양이 아니면 대기열을 읽지 않고 찾을 수 없음(N-01)이다 */
export default function PendingFixPage() {
  const { id } = useParams()
  if (!isUuid(id)) return <NotFoundPage />
  const lowered = id.toLowerCase()
  return <FixScreen key={lowered} id={lowered} />
}

interface Opened {
  /** 연 때의 줄. 그 뒤 대기열이 바뀌어도(다른 탭) 저장은 이 줄과 비교한다 */
  item: PendingTransaction
  opening: FixOpening
}

/**
 * 이 기기의 대기열에서 그 입력을 찾는다. 기기 데이터라 뼈대 없이 바로 연다. 고칠 수 없으면(없음, 대기, current 있는 409, 지금 장부가
 * 아닌 장부의 입력, 읽을 수 없는 본문) 찾을 수 없음이다(planner #237 P2).
 */
function FixScreen({ id }: { id: string }) {
  const ledger = useCurrentLedger()
  const items = usePendingRead()
  const [opened, setOpened] = useState<Opened | 'missing'>()
  if (opened === undefined && items) {
    const item = items.find((row) => row.id.toLowerCase() === id)
    const opening = item && item.ledgerId === ledger.id ? fixOpeningOf(item) : undefined
    setOpened(item && opening ? { item, opening } : 'missing')
  }
  if (opened === undefined) return null
  if (opened === 'missing') return <NotFoundPage />
  return (
    <EntryCopiesContext value>
      <FixForm item={opened.item} opening={opened.opening} />
    </EntryCopiesContext>
  )
}

/** 저장 버튼, 또는 실패 문구의 "다시 시도" */
type Sender = 'save' | 'message'

function FixForm({ item, opening }: Opened) {
  const showToast = useToast()
  const queryClient = useQueryClient()
  const goBack = useGoBack(PENDING_PATH)
  // 기본 계좌로 채우지 않는다. 비운 계좌(그사이 삭제됨)는 사용자가 다시 골라야 한다(D-04 (33))
  const form = useTransactionForm('', () => opening.values)
  // 값을 채운 입력이라 펼친 채 연다(D-04 (8))
  const { moreOpen, setMoreOpen, unfoldFor } = useMoreFold(true)
  // current 없는 409는 그 id를 쓸 수 없어 새 id다. 다시 시도해도 같은 새 id다
  const [newId] = useState(uuidV7)
  const [sender, setSender] = useState<Sender>()
  const [failures, setFailures] = useState(0)
  const busy = sender !== undefined
  const guard = useLeaveGuard({ parent: PENDING_PATH, changed: form.changed, busy })

  // 이유가 된 칸에 오류를 붙이고 첫 칸으로 초점을 옮긴다(D-04 (33)). 칸이 없으면 새 입력처럼 금액 칸이다(designer #237 D4)
  const showReasons = useEffectEvent(() => {
    if (Object.keys(opening.fieldErrors).length > 0) form.reject(opening.fieldErrors)
  })
  useEffect(() => showReasons(), [])

  // 로그인이 풀리면 쓰던 값을 이 기기에 남기고, 같은 계정으로 이 주소에 돌아오면 채운다(00-common 4.1, planner #237 P3)
  useKeepDraft('pending-fix', () => (form.changed ? { values: form.values } : undefined))
  useRestoredDraft('pending-fix', (saved) => {
    const draft = fixTransactionDraftOf(saved)
    if (draft) form.change(draft.values)
  })

  async function submit(from: Sender = 'save') {
    if (busy) return
    unfoldFor(validateTransaction(form.effective))
    if (!form.checkAll()) return
    const transaction = toNewTransaction(form.effective, opening.newId ? newId : item.id)
    setSender(from)
    let refiled: boolean
    try {
      refiled = await refilePending(item, { ...transaction })
    } catch {
      setSender(undefined)
      setFailures((count) => count + 1)
      return
    }
    if (!refiled) {
      showToast(CHANGED_ELSEWHERE)
      guard.leaveAfterSave(goBack)
      return
    }
    const account = transaction.type === 'TRANSFER' ? transaction.fromAccountId : transaction.accountId
    rememberLastAccount({ userId: item.userId, ledgerId: item.ledgerId }, account)
    showToast(FIXED)
    guard.leaveAfterSave(goBack)
    // 연결이 없으면 대기로 남고 저절로 보내기가 연결되면 보낸다
    if (connection() === 'online') {
      const onSent = (ledgerId: string) => void queryClient.invalidateQueries({ queryKey: ledgerScope(ledgerId) })
      const onNoticed = (count: number) => showToast(resendNoticeText(count), undefined, { afterShown: true })
      void resendFixed(onSent, onNoticed)
    }
  }

  return (
    <FullScreenForm
      title="거래 입력"
      guard={guard}
      onSubmit={() => void submit()}
      submitShortcut
      notice={bandText(opening.reason)}
      noticeDanger
      bottom={
        <>
          {/* 서버가 알려 준 칸을 모르는 검증 실패(designer #237 D3). 열 때부터 있어 읽히게 하지 않는다 */}
          {failures === 0 && opening.unplaced && <ErrorMessage>{opening.unplaced}</ErrorMessage>}
          {failures > 0 && (
            <RetryMessage
              failures={failures}
              onRetry={() => void submit('message')}
              busy={sender === 'message'}
              disabled={sender === 'save'}
            >
              {SAVE_TROUBLE}
            </RetryMessage>
          )}
          <Button kind="primary" type="submit" busy={sender === 'save'} disabled={sender === 'message'}>
            저장
          </Button>
        </>
      }
    >
      <TransactionFields form={form} readOnly={busy} moreOpen={moreOpen} onMoreOpenChange={setMoreOpen} />
    </FullScreenForm>
  )
}

/**
 * 고쳐 넣은 뒤의 보내기(designer #237 D6, architect #237 A2). 저절로 보내기와 같이 결과를 알리되(B-05가 화면 읽기에 건수를
 * 알리고 버튼 위 문구를 바꾼다), 다른 탭이 보내는 중이면 건너뛰지 않고 기다린다. 화면을 떠난 뒤에도 끝까지 간다.
 */
async function resendFixed(onSent: (ledgerId: string) => void, onNoticed: (count: number) => void): Promise<void> {
  const { noticed } = await sendQueue({ onSent, wait: true })
  if (noticed > 0) onNoticed(noticed)
}
