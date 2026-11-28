import { use, useEffect, useState, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { sessionUserId } from '../../api/session'
import { Button } from '../../components/Button'
import FullScreenForm from '../../components/FullScreenForm'
import { InPaneContext } from '../../components/sidePane'
import { useToast } from '../../components/ToastContext'
import { useGoBack } from '../../components/useGoBack'
import { useLeaveGuard } from '../../components/useLeaveGuard'
import { clampDate, isDate, selectableRange, today as todayOfDevice } from '../../lib/calendarDate'
import { useKeepDraft } from '../drafts/useKeepDraft'
import { useRestoredDraft } from '../drafts/restoreDraft'
import { useCurrentLedger } from '../me/CurrentLedgerContext'
import { useCategorySuggestion } from './categorySuggestion'
import { EntryCopiesContext, useEntryAccounts, useEntryCategories } from './entryLists'
import { defaultAccountOf } from './formDefaults'
import { useListMemory } from './listMemory'
import { entryHandoffOf, returnToOneLine } from './oneLineHandoff'
import { QUEUED_TOAST } from './pendingTransactions'
import TransactionFields from './TransactionFields'
import { newTransactionDraftOf } from './transactionDraft'
import { newTransactionValues } from './transactionForm'
import { DuplicateWarningDialog, SaveChoiceDialog, SaveFailureMessages } from './SaveParts'
import { useNewTransactionSave } from './useNewTransactionSave'
import { useMoreFold, useTransactionForm } from './useTransactionForm'

/** 앞서 본 화면이 없을 때(주소를 바로 연 경우) 닫으면 가는 곳 */
const HOME = '/home'

/**
 * D-04 거래 입력(새 입력). 빠른 입력(B-03)과 사이드바의 "거래 입력"이 지출 유형으로 연다.
 * 저장(중복 경고, 같은 id 다시 보내기, 기기에 쌓기, 선택 판)은 useNewTransactionSave가 한다. 이 화면은 저장을 마치면 이전 화면으로 떠나고,
 * 보내는 동안에는 떠나는 길을 막는다(useLeaveGuard).
 * 홈의 한 줄 입력(D-05의 "자세히", 해석 실패의 "자세히 입력")이 열면 넘긴 값으로 채우고 더 보기를 펼친 채 연다(#233). 떠나면 홈의
 * 한 줄 입력칸에 글을 되돌리고, 저장했으면 비운다(D-04 (1)과 성공 뒤 표).
 */
export default function TransactionNewPage() {
  const ledger = useCurrentLedger()
  const showToast = useToast()
  const listMemory = useListMemory()
  const goBack = useGoBack(HOME)
  const navigate = useNavigate()
  const location = useLocation()
  // 넓은 화면 내역의 오른쪽 칸에 연 입력(D-04 넓은 화면, #244)
  const inPane = use(InPaneContext)
  // 기기에 있는 계좌로 바로 열고 서버의 목록이 오면 바꾼다(#234)
  const accounts = useEntryAccounts(true)
  const categories = useEntryCategories(true)
  // 이 화면을 연 사용자(입력의 주인). 기본 계좌를 고르고, 보내는 순간의 사용자(토큰의 sub)와 같은지 요청 계층이 본다.
  // 확인하지 못한 로그인이면 기록의 사용자다. 같은 사용자로 확인돼야 보낸다(#234)
  const [owner] = useState(() => ({ userId: sessionUserId(), ledgerId: ledger.id }))
  // 홈의 한 줄 입력이 넘긴 값. 방문 기록에는 표시만 있어 새로고침하면 없다(architect #233 5)
  const [handoff] = useState(() => entryHandoffOf(location.state, owner))
  const [defaultAccountId, setDefaultAccountId] = useState<string>()
  if (defaultAccountId === undefined && accounts.data) setDefaultAccountId(defaultAccountOf(owner, accounts.data))
  // 달력(D-02)의 데이터 없음 자리에서 열면 날짜를 고른 날로 채운다(D-04 들어오는 길, architect #300). 주소에는 담지 않는다.
  // 한 줄 입력이 넘긴 값은 그 위에 채운다
  const form = useTransactionForm(defaultAccountId ?? '', () => ({ ...valuesOnDate(location.state), ...handoff?.values }))
  // 값을 채운 입력은 펼친 채로 연다(D-04 (8))
  const { moreOpen, setMoreOpen, unfoldFor } = useMoreFold(handoff !== undefined)
  // 한 줄 입력에서 왔으면 닫기, 뒤로, 다른 길로 떠나도 홈의 입력칸에 글이 돌아온다. 저장하면 비운다(leaveAfterSave)
  useEffect(() => {
    if (handoff) returnToOneLine(owner, handoff.text)
  }, [handoff, owner])
  const save = useNewTransactionSave({
    form,
    owner,
    accounts: accounts.data,
    categories: categories.data,
    unfoldFor,
    onDone: leaveAfterSave,
  })
  // 새 지출의 가맹점/내용을 벗어나면 카테고리를 제안한다(D-04 (4)). D-05의 "자세히"면 그 상태를 잇는다
  const suggestion = useCategorySuggestion({
    form,
    owner,
    categories: categories.data,
    frozen: save.busy,
    initial: handoff?.suggestion,
  })
  const guard = useLeaveGuard({ parent: HOME, changed: form.changed, busy: save.busy })
  // 로그인이 풀리면 쓰던 값과 거래 id를 이 기기에 남기고, 같은 계정으로 이 주소에 돌아오면 채운다(00-common 4.1, #234 C2).
  // 저장은 사용자가 다시 누르고, 같은 id로 보낸다(앞 요청이 서버에 저장됐을 수 있다)
  useKeepDraft('transaction-new', () => (form.changed || handoff ? { id: save.id, values: form.values } : undefined))
  useRestoredDraft('transaction-new', (saved) => {
    const draft = newTransactionDraftOf(saved)
    if (!draft) return
    save.setId(draft.id)
    form.change(draft.values)
    // 남긴 카테고리는 직접 골랐을 수 있다. 덮어쓰지 않는다(P-502)
    if (draft.values.categoryId !== '') suggestion.pick()
    if (draft.values.memo !== '') setMoreOpen(true)
  })

  /**
   * 저장을 마쳤다. 돌아간 화면이 내역이면 그 줄을 강조한다(D-01 성공 뒤). 주소와 방문 기록에는 넣지 않는다.
   * 오른쪽 칸이면 칸이 저장한 거래의 상세로 바뀐다(D-04 저장 표). 입력은 방문 기록에서 상세로 바꿔, 뒤로 가면 목록이다.
   * 기기에 쌓은 입력은 아직 서버에 없어 상세를 열 수 없으므로 칸을 닫고 목록으로 돌아간다.
   */
  function leaveAfterSave(toast: string, savedId: string) {
    if (handoff) returnToOneLine(owner, '')
    listMemory.rememberSaved(savedId)
    showToast(toast)
    const showSaved = inPane && toast !== QUEUED_TOAST
    guard.leaveAfterSave(
      showSaved ? () => navigate(`/transactions/${savedId}`, { replace: true, preventScrollReset: true }) : goBack,
    )
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
    if (save.busy) return
    guard.leave(() => navigate(path, { replace: true, preventScrollReset: inPane }))
  }

  return (
    <EntryCopiesContext value>
      <FullScreenForm
        title="거래 입력"
        guard={guard}
        onSubmit={save.submit}
        submitShortcut
        bottom={
          <>
            <SaveFailureMessages save={save} onViewSaved={viewSaved} />
            <Button kind="primary" type="submit" busy={save.saveBusy} disabled={save.messageBusy}>
              저장
            </Button>
          </>
        }
      >
        <TransactionFields
          form={form}
          readOnly={save.busy}
          moreOpen={moreOpen}
          onMoreOpenChange={setMoreOpen}
          suggestion={suggestion}
        />
      </FullScreenForm>
      <SaveChoiceDialog save={save} form={form} />
      <DuplicateWarningDialog save={save} />
    </EntryCopiesContext>
  )
}

/**
 * 새 입력의 기본값. 들어온 길이 날짜(`{ date }`, 달력의 고른 날)를 넘겼고 고를 수 있는 날짜(P-202)이면 날짜만 그날로 바꾼다.
 * 모양이 다르거나 범위 밖이면 넘기지 않은 것과 같다(기기의 오늘).
 */
function valuesOnDate(state: unknown) {
  const values = newTransactionValues()
  const date = typeof state === 'object' && state !== null ? (state as Record<string, unknown>).date : undefined
  if (typeof date !== 'string' || !isDate(date) || clampDate(date, selectableRange(todayOfDevice())) !== date) return values
  return { ...values, occurredOn: date }
}
